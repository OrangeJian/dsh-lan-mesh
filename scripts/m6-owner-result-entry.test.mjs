// M6 Owner human fixed-result review entry: accept / reject through the same
// verified owner-only exact Fetch route as the plan entry.
//
// Invariants under test (baseline 20e3a85 + task brief):
//  - Only the owner-only route's admission fact can enter the review ledger.
//  - Identity is the server-derived local human; body identity is never read.
//  - Room id is canonical, and the CURRENT Room + Team Leader relationship is
//    re-checked inside the ledger transaction (no identity inference).
//  - The decision pins the exact executionId + resultHash, generation and
//    requestId; a rejection needs a reason; rework needs a NEW executionId.
//  - Non-owner, self-reported identity, revoked rights, old generation and
//    replay (including replay after a generation advance) are covered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MeshNode } from '../lib/service.mjs';
import { openTeamStore } from '../lib/team-store.mjs';
import { applyTeamCommand } from '../lib/team-state.mjs';
import { resultHash } from '../lib/task-result-context.mjs';
import { createM6ResultReviewEntry } from '../index.js';

const NODE = 'node-a';
const LEADER = 'node-a/human';
const WORKER = 'node-b/worker';
const ROOM = 'room-a';
const OTHER_ROOM = 'room-b';
const TASK = 't1';
const EXE = 'e1';
const RESULT = { status: 'succeeded', summary: 'Built candidate artifact', artifacts: [] };
const HASH = resultHash(RESULT);
const OWNER = Object.freeze({ kind: 'owner' });
const FORGED = {
  sessionId: 'human', actorKey: 'node-evil/human', via: 'panel',
  owner: true, principal: { kind: 'owner' }, role: 'owner', leaderKey: 'node-evil/human',
  decision: 'accepted', checks: [{ name: 'forged', passed: true }],
};

function roomOf(id, leaderKey, memberKeys, name = 'Owner Room') {
  return {
    id, name,
    leader: { key: leaderKey },
    members: memberKeys.map(key => ({ key })),
    lifecycle: { status: 'active' },
  };
}

// Seed an authoritative M1 ledger in the state the review entry must judge:
// team -> task -> queued/acked/started execution -> Worker 'succeeded' result.
async function setup(t, over = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'm6-owner-result-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openTeamStore({ directory });
  await store.transact(state => {
    let s = state;
    const c = { roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: EXE };
    s = applyTeamCommand(s, { ...c, type: 'create-team', leaderKey: LEADER }).state;
    s = applyTeamCommand(s, { ...c, type: 'create-task', title: 'Build artifact', workerKey: WORKER }).state;
    s = applyTeamCommand(s, { ...c, type: 'queue' }, { now: 1000 }).state;
    s = applyTeamCommand(s, { ...c, type: 'ack', actorKey: WORKER, seq: 1 }, { now: 1000 }).state;
    s = applyTeamCommand(s, { ...c, type: 'start', leaseMs: 90000 }, { now: 1000 }).state;
    s = applyTeamCommand(s, { ...c, type: 'result', actorKey: WORKER, seq: 2, result: over.result ?? RESULT }, { now: 2000 }).state;
    return { state: s, value: undefined };
  });
  const node = new MeshNode({ config: { teamEnabled: true } });
  node.started = true;
  node.identity = { nodeId: NODE, name: 'local' };
  const room = roomOf(ROOM, LEADER, [LEADER, WORKER]);
  node.roomsDoc.rooms[ROOM] = room;
  node.team = { store };
  const raw = createM6ResultReviewEntry({ node });
  // Test convenience: bind the owner admission fact explicitly, as the
  // owner-only route bridge does in production.
  const entry = Object.freeze({
    accept: payload => raw.accept(payload, OWNER),
    reject: payload => raw.reject(payload, OWNER),
  });
  return { directory, store, node, room, entry, raw };
}

function review(over = {}) {
  return {
    requestId: 'accept-1', roomId: ROOM, taskId: TASK, generation: 1,
    executionId: EXE, resultHash: HASH,
    ...over,
  };
}

function rejectRequest(over = {}) {
  return review({ requestId: 'reject-1', reason: 'artifact path outside workspace', ...over });
}

// ---------------------------------------------------------------- happy path

test('owner accepts the exact fixed result through the entry', async t => {
  const { store, entry } = await setup(t);
  const before = store.read();
  assert.equal(before.tasks[TASK].status, 'review', 'Worker success only reaches review');

  const out = await entry.accept({ ...review(), ...FORGED });
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'accepted');
  assert.equal(out.replayed, false);
  assert.deepEqual(out.codes, []);
  assert.equal(out.record.actorKey, LEADER, 'identity is server-derived, not the forged body');
  assert.equal(out.record.leaderKey, LEADER);
  assert.equal(out.record.generation, 1);
  assert.equal(out.record.reviewedExecutionId, EXE);
  assert.equal(out.record.resultHash, HASH);
  assert.equal(out.record.producesExecution, false);
  assert.equal(out.record.reason, null, 'an accept records no caller-supplied reason');

  const after = store.read();
  assert.equal(after.tasks[TASK].status, 'accepted');
  assert.equal(after.tasks[TASK].revision, before.tasks[TASK].revision + 1);
  assert.deepEqual(after.tasks[TASK].reviews[0], out.record);
  assert.deepEqual(after.executions[EXE], before.executions[EXE], 'the fixed result is untouched');
  assert.deepEqual(after.outbox, before.outbox, 'no dispatch or wake was produced');
});

// ---------------------------------------------------------------- rejection

test('owner rejects with a reason; rework requires a NEW execution id', async t => {
  const { store, entry } = await setup(t);
  const before = store.read();

  const out = await entry.reject({ ...rejectRequest(), ...FORGED });
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'rejected');
  assert.equal(out.record.reason, 'artifact path outside workspace');
  assert.equal(out.record.actorKey, LEADER);

  const after = store.read();
  assert.equal(after.tasks[TASK].status, 'ready');
  assert.equal(after.tasks[TASK].reviews[0].decision, 'rejected');
  assert.deepEqual(after.executions[EXE], before.executions[EXE]);

  // Reusing the fixed execution id is refused; a new id becomes attempt 2.
  await assert.rejects(store.transact(state => ({
    state: applyTeamCommand(state, {
      type: 'queue', roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: EXE,
    }).state,
    value: undefined,
  })), { code: 'CONFLICT' });
  await store.transact(state => ({
    state: applyTeamCommand(state, {
      type: 'queue', roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: 'e2',
    }).state,
    value: undefined,
  }));
  assert.equal(store.read().tasks[TASK].currentExecutionId, 'e2');
  assert.equal(store.read().executions.e2.attempt, 2);
});

test('a rejection without a reason is denied with no state change', async t => {
  const { store, entry } = await setup(t);
  const before = store.read();
  await assert.rejects(
    entry.reject(rejectRequest({ reason: undefined })),
    error => error.code === 'MISSING_REASON' || error.codes?.includes('MISSING_REASON'),
  );
  await assert.rejects(
    entry.reject(rejectRequest({ reason: '   ' })),
    error => error.code === 'MISSING_REASON' || error.codes?.includes('MISSING_REASON'),
  );
  assert.deepEqual(store.read(), before);
});

// ------------------------------------------------------- admission and identity

test('owner admission fact is required before any Room or ledger access', async t => {
  const { raw, node } = await setup(t);
  let roomCalls = 0;
  const realOverview = node.ownerTeamOverview.bind(node);
  node.ownerTeamOverview = async (...args) => { roomCalls += 1; return realOverview(...args); };

  for (const admission of [
    undefined, null, 'owner', { kind: 'agent' }, { kind: 'api' },
    { sessionId: 'human', via: 'panel', owner: true },
    { id: 'agent', principal: { kind: 'agent' } },
  ]) {
    await assert.rejects(raw.accept(review(), admission), error => error.code === 'NOT_OWNER');
    await assert.rejects(raw.reject(rejectRequest(), admission), error => error.code === 'NOT_OWNER');
  }
  assert.equal(roomCalls, 0, 'refused before touching any Room');
});

test('self-reported body identity cannot become the reviewer', async t => {
  const { store, entry } = await setup(t);
  const out = await entry.accept({ ...review(), ...FORGED });
  assert.equal(out.record.actorKey, LEADER);
  assert.notEqual(out.record.actorKey, FORGED.actorKey);
  assert.equal(store.read().tasks[TASK].reviews[0].actorKey, LEADER);
  assert.equal(store.read().tasks[TASK].reviews[0].leaderKey, LEADER);
});

// ------------------------------------------- current Room / Team Leader rights

test('the Owner human is checked against the CURRENT Team Leader, never inferred', async t => {
  const { store, entry } = await setup(t);
  // The human still leads the Room, but the Team was created by another leader
  // identity. Being the owner must not silently grant Team acceptance.
  await store.transact(state => {
    const s = structuredClone(state);
    s.teams[ROOM].leaderKey = 'node-a/agent';
    return { state: s, value: undefined };
  });
  await assert.rejects(entry.accept(review()), { code: 'FORBIDDEN' });
  assert.equal(store.read().tasks[TASK].status, 'review');
  assert.equal(store.read().tasks[TASK].reviews, undefined);
});

test('changed Room leader, revoked membership and wrong Room are refused', async t => {
  const { node, room, store, entry } = await setup(t);

  node.roomsDoc.rooms[OTHER_ROOM] = roomOf(OTHER_ROOM, 'node-a/agent', ['node-a/agent'], 'Other Room');
  await assert.rejects(entry.accept(review({ roomId: OTHER_ROOM })), { code: 'FORBIDDEN' });
  await assert.rejects(entry.accept(review({ roomId: 'no-such-room' })), { code: 'UNKNOWN_ROOM' });

  room.leader.key = 'foreign/human';
  await assert.rejects(entry.accept(review()), { code: 'FORBIDDEN' });
  assert.equal(store.read().tasks[TASK].status, 'review');

  room.leader.key = LEADER;
  room.members = [];
  await assert.rejects(entry.accept(review()), { code: 'FORBIDDEN' });
  assert.equal(store.read().tasks[TASK].status, 'review');
});

test('revocation that lands after the pre-check is caught inside the ledger transaction', async t => {
  const { node, room, entry } = await setup(t);
  const realOverview = node.ownerTeamOverview.bind(node);
  let calls = 0;
  // First call is the entry's canonical-Room pre-check; the second is the
  // delegate consulted INSIDE the ledger transaction. Revoke between them to
  // prove the decision is re-authorized at commit time.
  node.ownerTeamOverview = async (...args) => {
    calls += 1;
    if (calls === 2) room.leader.key = 'foreign/human';
    return realOverview(...args);
  };
  await assert.rejects(entry.accept(review()), { code: 'FORBIDDEN' });
  assert.equal(calls, 2, 'the delegate must be consulted inside the transaction');
  assert.equal(node.team.store.read().tasks[TASK].reviews, undefined, 'a revoked write must not persist');
});

// ------------------------------------------------- fixed-reference validation

test('execution, hash and generation references are re-validated from current state', async t => {
  const { store, entry } = await setup(t);
  const before = store.read();

  for (const [over, code] of [
    [{ executionId: 'e9' }, 'EXECUTION_NOT_FOUND'],
    [{ resultHash: 'f'.repeat(64) }, 'RESULT_HASH_MISMATCH'],
    [{ generation: 2 }, 'STALE_GENERATION'],
    [{ resultHash: undefined }, 'UNFIXED_HASH_REF'],
    [{ executionId: undefined }, 'UNFIXED_EXECUTION_REF'],
    [{ requestId: '' }, 'BAD_REQUEST'],
  ]) {
    await assert.rejects(entry.accept(review({ ...over })), error => {
      assert.ok(error.code === code || error.codes?.includes(code), code + ': ' + JSON.stringify(error.codes ?? error.code));
      return true;
    });
  }
  assert.deepEqual(store.read(), before);
});

test('an old execution cannot decide after a rework started', async t => {
  const { store, entry } = await setup(t);
  await entry.reject(rejectRequest());
  await store.transact(state => ({
    state: applyTeamCommand(state, {
      type: 'queue', roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: 'e2',
    }).state,
    value: undefined,
  }));
  await assert.rejects(entry.accept(review({ requestId: 'stale-1' })), error => {
    assert.ok(error.code === 'STALE_RESULT' || error.codes?.includes('STALE_RESULT'), JSON.stringify(error.codes ?? error.code));
    return true;
  });
  assert.equal(store.read().tasks[TASK].reviews.length, 1, 'a denied review writes nothing');
});

// ---------------------------------------------------------------- replay

test('same requestId is idempotent; changed content and old-generation replays are refused', async t => {
  const { store, entry } = await setup(t);
  const first = await entry.accept(review({ requestId: 'idem-1' }));
  const afterFirst = store.read();

  const replay = await entry.accept(review({ requestId: 'idem-1' }));
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, first.record);
  assert.deepEqual(store.read(), afterFirst, 'replay must not add another audit record');

  await assert.rejects(
    entry.reject(rejectRequest({ requestId: 'idem-1', executionId: EXE })),
    { code: 'CONFLICT' },
  );
  assert.deepEqual(store.read(), afterFirst);

  // A generation advance makes the stored replay stale; it must not silently
  // reuse the old decision, and a new-generation reuse is a CONFLICT.
  await store.transact(state => {
    const s = structuredClone(state);
    s.teams[ROOM].generation = 2;
    return { state: s, value: undefined };
  });
  await assert.rejects(entry.accept(review({ requestId: 'idem-1' })), error => {
    assert.ok(error.code === 'STALE_GENERATION' || error.codes?.includes('STALE_GENERATION'), JSON.stringify(error.codes ?? error.code));
    return true;
  });
  await assert.rejects(
    entry.accept(review({ requestId: 'idem-1', generation: 2 })),
    { code: 'CONFLICT' },
  );
  assert.equal(store.read().tasks[TASK].reviews.length, 1);
});

// --- Real public SDK owner-only exact-route boundary ------------------------

function resolveSdk() {
  let resolver = createRequire(new URL('../package.json', import.meta.url));
  try {
    resolver.resolve('@deepseek-ai/dsh/package.json');
  } catch {
    const root = execFileSync(
      process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npm root -g'] : ['root', '-g'],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true },
    ).trim();
    resolver = createRequire(join(root, '__m6_owner_result__.cjs'));
  }
  const hostPath = resolver.resolve('@deepseek-ai/dsh/package.json');
  return createRequire(hostPath);
}

test('real SDK exact route: non-owner is 403 before the handler; owner can accept', async t => {
  const { store, entry } = await setup(t);
  const fromHost = resolveSdk();
  const { Context } = await import(pathToFileURL(fromHost.resolve('@deepseek-ai/cordis')).href);
  const { HostConnectionService } = await import(
    pathToFileURL(fromHost.resolve('@deepseek-ai/dsh-client-connection')).href
  );

  const connection = new HostConnectionService(new Context(), [], {
    isAuthenticated: () => false, authenticateApi: () => undefined,
  });
  t.after(async () => {
    await connection.browserPeer.dispose().catch(() => {});
  });

  const ROUTE = '/api/m6-owner-result-entry-test';
  let handlerCalls = 0;
  let handlerArgs = null;
  const dispose = connection.fetch.register({
    path: ROUTE, methods: ['POST'], requestBody: 'buffered',
    fetch: async (...args) => {
      handlerCalls += 1;
      handlerArgs = args;
      const body = await args[0].json();
      const value = await entry[body.action](body.payload);
      return new Response(JSON.stringify(value), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  t.after(() => dispose());

  const handler = connection.createSharedFetchHandler('/api');
  const request = () => new Request('http://localhost' + ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner': 'true' },
    body: JSON.stringify({ action: 'accept', payload: { ...review(), ...FORGED } }),
  });

  for (const principal of [{ principal: { kind: 'api' } }, { id: 'agent', principal: { kind: 'agent' } }]) {
    const denied = await handler.fetch(request(), principal);
    assert.equal(denied.status, 403);
  }
  assert.equal(handlerCalls, 0);
  assert.equal(handlerArgs, null);
  assert.equal(store.read().tasks[TASK].status, 'review');

  // The real browserPeer owner principal reaches the handler, which still gets
  // only the Request (no request-level principal is forwarded).
  const admitted = await handler.fetch(request(), connection.browserPeer);
  assert.equal(admitted.status, 200);
  assert.equal(handlerCalls, 1);
  assert.equal(handlerArgs.length, 1);
  assert.equal(handlerArgs[0] instanceof Request, true);
  const accepted = await admitted.json();
  assert.equal(accepted.record.actorKey, LEADER);
  assert.equal(store.read().tasks[TASK].status, 'accepted');
  assert.equal(store.read().tasks[TASK].reviews[0].actorKey, LEADER);

  await dispose();
  const gone = await handler.fetch(request(), connection.browserPeer);
  assert.equal(gone.status, 404);
});
