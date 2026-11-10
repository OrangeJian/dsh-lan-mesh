import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTeamStore } from '../lib/team-store.mjs';
import { TeamCoordinator } from '../lib/team-coordinator.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(process.cwd(), '.test-tmp/team-coord-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const a = await openTeamStore({ directory: join(directory, 'a') });
  const b = await openTeamStore({ directory: join(directory, 'b') });
  let now = 1000, wakes = 0, offline = false, loseAck = false, loseResult = false;
  const nodes = {};
  const sent = [];
  const opts = { clock: { wallNow: () => now, monotonicNow: () => now }, authorize: () => true, getRoom: () => ({ leader: { key: 'a/leader' }, members: [{ key: 'a/leader' }, { key: 'b/worker' }] }) };
  const send = async (target, req) => {
    sent.push(req.operation);
    if (offline) throw new Error('offline');
    const result = await nodes[target].handle(req);
    if (loseAck && req.operation === 'dispatch') { loseAck = false; throw new Error('lost ACK'); }
    if (loseResult && req.operation === 'result') { loseResult = false; throw new Error('lost result ACK'); }
    return result;
  };
  nodes.a = new TeamCoordinator({ ...opts, nodeId: 'a', store: a, send, wake: () => true });
  nodes.b = new TeamCoordinator({ ...opts, nodeId: 'b', store: b, send, wake: () => { wakes++; return true; } });
  await nodes.a.create({ roomId: 'room-team', actorKey: 'a/leader' });
  const dispatch = (extra = {}) => nodes.a.dispatch({ roomId: 'room-team', actorKey: 'a/leader', title: 'Build', workerKey: 'b/worker', taskId: 't1', executionId: 'e1', ...extra });
  return { nodes, a, b, dispatch, sent, wakes: () => wakes, advance: ms => { now += ms; }, offline: value => { offline = value; }, loseAck: () => { loseAck = true; }, loseResult: () => { loseResult = true; }, opts, send };
}

test('lost dispatch acknowledgement never repeats wake; result goes to review', async t => {
  const f = await fixture(t);
  f.loseAck();
  await f.dispatch();
  await f.nodes.a.tick();
  assert.ok(f.sent.includes('status-query'));
  await f.nodes.b.tick();
  await f.nodes.a.tick();
  await f.nodes.b.tick();
  assert.equal(f.wakes(), 1);
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', result: { status: 'succeeded', summary: 'Built' } });
  await f.nodes.b.tick();
  assert.equal(f.a.read().tasks.t1.status, 'review');
});

test('result retransmission after a lost acknowledgement is idempotent', async t => {
  const f = await fixture(t);
  await f.dispatch();
  await f.nodes.b.tick();
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', result: { status: 'succeeded', summary: 'Built' } });
  f.loseResult();
  await f.nodes.b.tick();
  const saved = structuredClone(f.a.read().executions.e1);
  assert.equal(Object.keys(f.b.read().outbox).length, 1);
  await f.nodes.b.tick();
  assert.deepEqual(f.a.read().executions.e1, saved);
  assert.equal(Object.keys(f.b.read().outbox).length, 0);
});

test('wake failure remains uncertain and is not retried', async t => {
  const f = await fixture(t);
  f.nodes.b.wake = () => false;
  await f.dispatch();
  await f.nodes.b.tick();
  await f.nodes.b.tick();
  assert.equal(f.b.read().workerExecutions.e1.state, 'uncertain');
  assert.equal(f.wakes(), 0);
});

test('oversized local result is rejected before it can poison delivery queue', async t => {
  const f = await fixture(t);
  await f.dispatch(); await f.nodes.b.tick();
  await assert.rejects(f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', result: { status: 'succeeded', summary: 'Built', artifacts: [{ type: 'file', value: 'x'.repeat(300000) }] } }), { code: 'BAD_REQUEST' });
  assert.equal(f.b.read().workerExecutions.e1.state, 'running');
  assert.equal(Object.keys(f.b.read().outbox).length, 0);
});

test('lost progress ACK followed by later result does not brick the outbox', async t => {
  const f = await fixture(t);
  await f.dispatch(); await f.nodes.b.tick();
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', note: 'Progress' });
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', result: { status: 'succeeded', summary: 'Built' } });
  const original = f.nodes.b.send;
  let lost = false;
  f.nodes.b.send = async (target, request) => {
    const answer = await original(target, request);
    if (!lost && request.operation === 'progress') { lost = true; throw new Error('lost ACK'); }
    return answer;
  };
  await f.nodes.b.tick(); await f.nodes.b.tick();
  assert.equal(Object.keys(f.b.read().outbox).length, 0);
  assert.equal(f.a.read().tasks.t1.status, 'review');
});

test('lease expiring during durable start marker prevents wake', async t => {
  const f = await fixture(t);
  await f.dispatch();
  const transact = f.b.transact.bind(f.b);
  let delayed = false;
  f.b.transact = async fn => {
    const value = await transact(fn);
    if (!delayed && f.b.read().workerExecutions.e1.state === 'starting') { delayed = true; f.advance(90001); }
    return value;
  };
  await f.nodes.b.tick();
  assert.equal(f.wakes(), 0);
  assert.equal(f.b.read().workerExecutions.e1.state, 'uncertain');
});

test('cancellation during wake cannot be overwritten back to running', async t => {
  const f = await fixture(t);
  await f.dispatch();
  f.nodes.b.wake = async () => {
    await f.nodes.b.handle({ operation: 'cancel', body: f.b.read().workerExecutions.e1.descriptor });
    return true;
  };
  await f.nodes.b.tick();
  assert.equal(f.b.read().workerExecutions.e1.state, 'uncertain');
});

test('late progress and result remain auditable without freeing uncertain execution', async t => {
  const f = await fixture(t);
  await f.dispatch(); await f.nodes.b.tick();
  f.advance(90001); // No Leader tick: receipt itself must notice expiry.
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', note: 'Delayed progress' });
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', result: { status: 'succeeded', summary: 'Delayed result' } });
  await f.nodes.b.tick();
  assert.equal(f.a.read().executions.e1.state, 'uncertain');
  assert.equal(f.a.read().executions.e1.result.summary, 'Delayed result');
  assert.equal(f.a.read().executions.e1.lastEventSeq, 3);
  assert.equal(Object.keys(f.b.read().outbox).length, 0);
});

test('unstarted dispatch expires into uncertain rather than reserving forever', async t => {
  const f = await fixture(t);
  f.offline(true);
  await f.dispatch();
  f.advance(90001);
  await f.nodes.a.tick();
  assert.equal(f.a.read().executions.e1.state, 'uncertain');
  assert.equal(Object.keys(f.a.read().outbox).length, 0);
});

test('reconcile tombstone prevents a delayed dispatch from ever waking', async t => {
  const f = await fixture(t);
  f.offline(true); await f.dispatch();
  const descriptor = f.a.read().outbox.e1.body;
  await f.nodes.b.handle({ operation: 'reconcile', body: { ...descriptor, stopped: true, reason: 'Human confirmed never started' } });
  const result = await f.nodes.b.handle({ operation: 'dispatch', body: descriptor });
  assert.equal(result.state, 'cancelled');
  await f.nodes.b.tick();
  assert.equal(f.wakes(), 0);
});

test('cancellation preserves terminal worker results', async t => {
  const f = await fixture(t);
  await f.dispatch(); await f.nodes.b.tick();
  await f.nodes.b.report({ executionId: 'e1', actorKey: 'b/worker', result: { status: 'succeeded', summary: 'Built' } });
  await f.nodes.b.handle({ operation: 'cancel', body: f.b.read().workerExecutions.e1.descriptor });
  assert.equal(f.b.read().workerExecutions.e1.state, 'succeeded');
});

test('concurrent dispatch cannot bypass capacity and cancelled worker can be reconciled', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.dispatch(), f.dispatch({ taskId: 't2', executionId: 'e2' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await f.nodes.b.tick();
  const e = Object.values(f.a.read().executions)[0];
  const descriptor = f.b.read().workerExecutions[e.executionId].descriptor;
  await f.nodes.b.handle({ operation: 'cancel', body: descriptor });
  await f.nodes.b.handle({ operation: 'reconcile', body: { ...descriptor, stopped: true, reason: 'Human confirmed stopped' } });
  assert.equal(f.b.read().workerExecutions[e.executionId].state, 'cancelled');
});

test('revoked authority pauses even a Team with no executions', async t => {
  const f = await fixture(t);
  f.nodes.a.getRoom = () => ({ leader: { key: 'other/leader' }, members: [] });
  await f.nodes.a.tick();
  assert.equal(f.a.read().teams['room-team'].paused, true);
});

test('late start permission cannot wake Worker', async t => {
  const f = await fixture(t);
  await f.dispatch();
  const original = f.nodes.b.send;
  f.nodes.b.send = async (...args) => { const result = await original(...args); f.advance(90001); return result; };
  await f.nodes.b.tick();
  assert.equal(f.wakes(), 0);
  assert.equal(f.b.read().workerExecutions.e1.state, 'uncertain');
});

test('disconnect expires lease and retains uncertain capacity', async t => {
  const f = await fixture(t);
  await f.dispatch();
  await f.nodes.b.tick();
  f.offline(true);
  f.advance(90001);
  await f.nodes.a.tick();
  await f.nodes.b.tick();
  assert.equal(f.a.read().executions.e1.state, 'uncertain');
  assert.equal(f.b.read().workerExecutions.e1.state, 'uncertain');
});

test('recovery does not repeat a wake across the start-marker crash window', async t => {
  const f = await fixture(t);
  await f.dispatch();
  await f.nodes.b.tick();
  const restarted = new TeamCoordinator({ ...f.opts, nodeId: 'b', store: f.b, send: f.send, wake: () => { throw new Error('must not wake'); } });
  await restarted.recover();
  await restarted.tick();
  assert.equal(f.b.read().workerExecutions.e1.state, 'uncertain');
  assert.equal(f.wakes(), 1);
});
test('context authorization, pinned snapshot, audit failure blocks wake',async t=>{const f=await fixture(t);let prepared=0;f.nodes.a.prepareContext=async input=>{prepared++;return {roomId:input.roomId,selectedDocumentVersions:[{documentId:'d',revisionId:'r1',contentHash:'hash',content:'old'}],confirmedDecisions:[],openQuestions:[],referencedMessages:[],attachmentRefs:[],skillRefs:[],fetchRefs:[]};};f.nodes.a.authorize=()=>false;await assert.rejects(f.dispatch({contextSelection:{documentIds:['d']}}));assert.equal(prepared,0);f.nodes.a.authorize=()=>true;await f.dispatch({contextSelection:{documentIds:['d']}});assert.equal(f.b.read().workerExecutions.e1.descriptor.contextPacket.selectedDocumentVersions[0].revisionId,'r1');f.nodes.b.recordContextDelivery=async()=>{throw new Error('audit unavailable');};await f.nodes.b.tick();assert.equal(f.wakes(),0);assert.equal(f.b.read().workerExecutions.e1.state,'uncertain');await f.nodes.b.tick();assert.equal(f.wakes(),0);});
test('context packet remains pinned across retransmission and audit precedes wake',async t=>{const f=await fixture(t);let revision='old',audited=false;f.nodes.a.prepareContext=async input=>({roomId:input.roomId,selectedDocumentVersions:[{documentId:'d',revisionId:revision,contentHash:'hash',content:'body'}],confirmedDecisions:[],openQuestions:[],referencedMessages:[],attachmentRefs:[],skillRefs:[]});f.nodes.b.recordContextDelivery=async audit=>{assert.equal(audit.packet.selectedDocumentVersions[0].revisionId,'old');audited=true;};f.nodes.b.wake=({task})=>{assert.equal(audited,true);assert.equal(task.contextPacket.selectedDocumentVersions[0].revisionId,'old');return true;};f.loseAck();await f.dispatch({contextSelection:{documentIds:['d']}});revision='new';const retry=await f.dispatch({contextSelection:{documentIds:['d']}});assert.equal(retry.contextPacket.selectedDocumentVersions[0].revisionId,'old');await f.nodes.a.tick();await f.nodes.b.tick();assert.equal(f.a.read().executions.e1.descriptor.contextPacket.selectedDocumentVersions[0].revisionId,'old');assert.equal(f.b.read().workerExecutions.e1.state,'running');});
test('context rejects content declarations, cross-room and oversized incoming packets',async t=>{const f=await fixture(t);await assert.rejects(f.dispatch({contextSelection:{content:'untrusted'}}),{code:'BAD_REQUEST'});const body={roomId:'room-team',actorKey:'a/leader',leaderKey:'a/leader',generation:1,workerKey:'b/worker',taskId:'t1',executionId:'e1',title:'Build',detail:'',contextPacket:{roomId:'other'}};await assert.rejects(f.nodes.b.handle({operation:'dispatch',body}),{code:'BAD_REQUEST'});body.contextPacket={roomId:'room-team',content:'x'.repeat(65536)};await assert.rejects(f.nodes.b.handle({operation:'dispatch',body}),{code:'BAD_REQUEST'});assert.equal(Object.keys(f.b.read().workerExecutions).length,0);});
