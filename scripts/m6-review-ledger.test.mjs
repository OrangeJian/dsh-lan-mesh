// Dedicated regression tests for the M6 result-review LEDGER integration.
// Scope: the PURE evaluator (lib/m6-result-review.mjs) is reused, but this file
// exercises the transactional service against a real openTeamStore and the
// Team reducer. No HTTP, no real dispatch, no external process, no M6 enablement.
//
// Invariants under test (baseline 9f41030 + task brief):
//  - Worker success only reaches 'review'; only the Leader's accept -> 'accepted'.
//  - Rejection keeps the original fixed result + reason; rework must use a NEW
//    execution id (the reducer's existing queue CONFLICT/attempt rules).
//  - requestId idempotency, conflict on reuse with changed content, and replay
//    after a store restart.
//  - identity / ACL / generation / execution + hash are re-validated from the
//    CURRENT state inside the transaction; old ledgers without audit stay valid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openTeamStore } from '../lib/team-store.mjs';
import { emptyTeamState, applyTeamCommand } from '../lib/team-state.mjs';
import { resultHash } from '../lib/task-result-context.mjs';
import { createResultReviewLedger } from '../lib/m6-review-ledger.mjs';

const NODE = 'node-a';
const LEADER = `${NODE}/leader`;
const WORKER = 'node-b/worker';
const ROOM = 'r1';
const TASK = 't1';
const EXE = 'e1';
const RESULT = { status: 'succeeded', summary: 'Built candidate artifact', artifacts: [] };
const hash = resultHash;

const roomView = (over = {}) => ({
  deleted: false,
  leader: { key: LEADER },
  members: [{ key: WORKER }],
  ...over,
});

function makeLedger(store, over = {}) {
  return createResultReviewLedger({
    store,
    nodeId: over.nodeId ?? NODE,
    getRoom: over.getRoom ?? (() => roomView()),
    authorize: over.authorize ?? (async () => true),
  });
}

function request(ledger, over = {}) {
  return ledger.review({
    requestId: over.requestId ?? 'req-1',
    actorKey: over.actorKey ?? LEADER,
    roomId: over.roomId ?? ROOM,
    taskId: over.taskId ?? TASK,
    intent: {
      decision: 'accepted',
      generation: 1,
      reviewedExecutionId: EXE,
      resultHash: hash(RESULT),
      ...over.intent,
    },
  });
}

// Seed an authoritative M1 ledger: team -> task -> queued/acked/started
// execution -> Worker 'succeeded' result. The task must land in 'review'.
async function seed(t, over = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-review-ledger-'));
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
  return { store, directory };
}

// ---------------------------------------------------------------- happy path

test('Leader accept inside the transaction persists accepted + audit, no execution created', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const before = store.read();
  assert.equal(before.tasks[TASK].status, 'review', 'Worker success only reaches review');

  const out = await request(ledger);
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'accepted');
  assert.equal(out.replayed, false);
  assert.deepEqual(out.codes, []);
  assert.equal(out.record.decision, 'accepted');
  assert.equal(out.record.actorKey, LEADER);
  assert.equal(out.record.generation, 1);
  assert.equal(out.record.reviewedExecutionId, EXE);
  assert.equal(out.record.resultHash, hash(RESULT));
  assert.equal(out.record.producesExecution, false);

  const after = store.read();
  assert.equal(after.tasks[TASK].status, 'accepted');
  assert.equal(after.tasks[TASK].revision, before.tasks[TASK].revision + 1);
  assert.equal(after.tasks[TASK].reviews.length, 1);
  assert.deepEqual(after.tasks[TASK].reviews[0], out.record);
  assert.equal(after.tasks[TASK].reviews[0].requestId, 'req-1');
  assert.match(after.tasks[TASK].reviews[0].fingerprint, /^[a-f0-9]{64}$/);
  // Original fixed result and execution remain untouched; nothing was dispatched.
  assert.deepEqual(after.executions[EXE], before.executions[EXE]);
  assert.deepEqual(after.outbox, before.outbox);
  assert.deepEqual(Object.keys(after.executions), Object.keys(before.executions));
});

// ---------------------------------------------------------------- rejection

test('reject keeps original fixed result + reason and rework requires a NEW execution id', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const beforeResult = structuredClone(store.read().executions[EXE]);

  const out = await request(ledger, {
    requestId: 'reject-1',
    intent: { decision: 'rejected', reason: 'artifact path outside workspace' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'rejected');
  assert.equal(out.record.reason, 'artifact path outside workspace');

  const rejected = store.read();
  assert.equal(rejected.tasks[TASK].status, 'ready');
  assert.equal(rejected.tasks[TASK].reviews[0].decision, 'rejected');
  assert.equal(rejected.tasks[TASK].reviews[0].reason, 'artifact path outside workspace');
  assert.deepEqual(rejected.executions[EXE], beforeResult, 'fixed result is never overwritten');
  assert.equal(rejected.executions[EXE].state, 'succeeded');
  assert.equal(hash(rejected.executions[EXE].result), hash(RESULT));

  // Rework: same execution id is rejected, a new one is accepted with attempt 2.
  await assert.rejects(
    store.transact(state => ({ state: applyTeamCommand(state, {
      type: 'queue', roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: EXE,
    }).state, value: undefined })),
    { code: 'CONFLICT' },
  );
  await store.transact(state => ({ state: applyTeamCommand(state, {
    type: 'queue', roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: 'e2',
  }).state, value: undefined }));
  const requeued = store.read();
  assert.equal(requeued.tasks[TASK].status, 'active');
  assert.equal(requeued.tasks[TASK].currentExecutionId, 'e2');
  assert.equal(requeued.executions.e2.attempt, 2);
  assert.equal(requeued.executions.e2.executionId, 'e2');

  // Old e1 can no longer decide; it is no longer the current execution.
  await assert.rejects(request(ledger, { requestId: 'stale-1', intent: { reviewedExecutionId: EXE } }), err => {
    assert.ok(err.codes?.includes('STALE_RESULT') || err.code === 'STALE_RESULT', JSON.stringify(err.codes ?? err.code));
    return true;
  });
  assert.equal(store.read().tasks[TASK].reviews.length, 1, 'a denied review writes nothing');
});

test('reject without a reason is denied from the evaluator with no state change', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const before = store.read();
  await assert.rejects(
    request(ledger, { requestId: 'bad-reject', intent: { decision: 'rejected' } }),
    err => err.code === 'MISSING_REASON' || err.codes?.includes('MISSING_REASON'),
  );
  assert.deepEqual(store.read(), before);
});

// --------------------------------------------------- current-state re-checks

test('non-leader, remote leader, failed ACL and changed ACL are all denied', async t => {
  const { store } = await seed(t);
  const before = store.read();

  await assert.rejects(request(makeLedger(store), { actorKey: WORKER }), { code: 'FORBIDDEN' });
  await assert.rejects(request(makeLedger(store, { nodeId: 'node-x' })), { code: 'NOT_LOCAL_LEADER' });
  await assert.rejects(request(makeLedger(store, { authorize: async () => false })), { code: 'FORBIDDEN' });
  await assert.rejects(
    request(makeLedger(store, { getRoom: () => roomView({ leader: { key: 'node-c/leader' } }) })),
    { code: 'ROOM_CHANGED' },
  );
  await assert.rejects(
    request(makeLedger(store, { getRoom: () => roomView({ deleted: true }) })),
    { code: 'ROOM_CHANGED' },
  );
  assert.deepEqual(store.read(), before, 'every denied gate leaves the ledger unchanged');
});

test('generation, hash and execution references are re-validated from current state', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const before = store.read();

  const cases = [
    [{ requestId: 'g', intent: { generation: 2 } }, 'STALE_GENERATION'],
    [{ requestId: 'h', intent: { resultHash: 'f'.repeat(64) } }, 'RESULT_HASH_MISMATCH'],
    [{ requestId: 'x', intent: { reviewedExecutionId: 'e9' } }, 'EXECUTION_NOT_FOUND'],
    [{ requestId: 's', intent: { reviewedExecutionId: 'e1', resultHash: hash({ ...RESULT, summary: 'TAMPERED' }) } }, 'RESULT_HASH_MISMATCH'],
  ];
  for (const [over, code] of cases) {
    await assert.rejects(request(ledger, over), err => {
      assert.ok(err.code === code || err.codes?.includes(code), `${code}: ${JSON.stringify(err.codes ?? err.code)}`);
      return true;
    });
  }
  assert.deepEqual(store.read(), before);
});

test('a non-review task cannot be accepted (worker success must reach review first)', async t => {
  const { store } = await seed(t);
  await store.transact(state => {
    const s = structuredClone(state);
    s.tasks[TASK].status = 'active';
    return { state: s, value: undefined };
  });
  const ledger = makeLedger(store);
  await assert.rejects(request(ledger, { requestId: 'early' }), err => {
    assert.ok(err.code === 'NOT_IN_REVIEW' || err.codes?.includes('NOT_IN_REVIEW'));
    return true;
  });
  assert.equal(store.read().tasks[TASK].reviews, undefined);
});

// --------------------------------------------------------- idempotency/replay

test('same requestId is idempotent; reuse with changed content is CONFLICT', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const first = await request(ledger, { requestId: 'idem-1' });
  const afterFirst = store.read();

  const replay = await request(ledger, { requestId: 'idem-1' });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, first.record);
  assert.deepEqual(store.read(), afterFirst, 'replay must not change state or revision');

  await assert.rejects(
    request(ledger, { requestId: 'idem-1', intent: { decision: 'rejected', reason: 'changed' } }),
    { code: 'CONFLICT' },
  );
  assert.deepEqual(store.read(), afterFirst, 'a conflicting replay must not change state');
});

test('replay after reopening the store returns the same decision', async t => {
  const { store, directory } = await seed(t);
  const first = await request(makeLedger(store), { requestId: 'restart-1' });

  const reopened = await openTeamStore({ directory });
  const replay = await request(makeLedger(reopened), { requestId: 'restart-1' });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, first.record);
  assert.equal(reopened.read().tasks[TASK].reviews.length, 1);
});

// ------------------------------------------------------- old-ledger compatibility

test('a legacy v1 ledger without any review audit still opens and accepts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-review-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = emptyTeamState();
  const c = { roomId: ROOM, generation: 1, actorKey: LEADER, taskId: TASK, executionId: EXE };
  state = applyTeamCommand(state, { ...c, type: 'create-team', leaderKey: LEADER }).state;
  state = applyTeamCommand(state, { ...c, type: 'create-task', title: 'Legacy task', workerKey: WORKER }).state;
  state = applyTeamCommand(state, { ...c, type: 'queue' }, { now: 1000 }).state;
  state = applyTeamCommand(state, { ...c, type: 'ack', actorKey: WORKER, seq: 1 }, { now: 1000 }).state;
  state = applyTeamCommand(state, { ...c, type: 'start', leaseMs: 90000 }, { now: 1000 }).state;
  state = applyTeamCommand(state, { ...c, type: 'result', actorKey: WORKER, seq: 2, result: RESULT }, { now: 2000 }).state;
  assert.equal(state.tasks[TASK].reviews, undefined, 'legacy ledger has no audit field');
  await writeFile(join(directory, 'team.json'), JSON.stringify(state));

  const store = await openTeamStore({ directory });
  const out = await request(makeLedger(store), { requestId: 'legacy-1' });
  assert.equal(out.ok, true);
  assert.equal(store.read().tasks[TASK].status, 'accepted');
});

test('a corrupt review audit record fails closed on reopen', async t => {
  const { store, directory } = await seed(t);
  await request(makeLedger(store), { requestId: 'corrupt-1' });
  const state = store.read();
  state.tasks[TASK].reviews[0].fingerprint = 'bad';
  await writeFile(join(directory, 'team.json'), JSON.stringify(state));
  await assert.rejects(openTeamStore({ directory }), { code: 'TEAM_STORAGE' });
});

// --------------------------------------------- single authoritative path / queue

test('a persisted audit with a tampered result reference fails closed', async t => {
  const { store, directory } = await seed(t);
  await request(makeLedger(store), { requestId: 'hash-at-rest' });
  const state = store.read();
  state.tasks[TASK].reviews[0].resultHash = 'a'.repeat(64);
  await writeFile(join(directory, 'team.json'), JSON.stringify(state));
  await assert.rejects(openTeamStore({ directory }), { code: 'TEAM_STORAGE' });
});

test('no generic reducer review command can bypass the evaluator', async t => {
  const { store } = await seed(t);
  const before = store.read();
  // A raw applyTeamCommand caller must not be able to persist an arbitrary
  // resultHash/reference: that path no longer exists.
  assert.throws(() => applyTeamCommand(before, {
    type: 'review', roomId: ROOM, taskId: TASK, generation: 1, actorKey: LEADER,
    decision: 'accepted', reason: null, reviewedExecutionId: EXE,
    resultHash: 'a'.repeat(64), requestId: 'fake-1', fingerprint: 'b'.repeat(64),
  }), err => err.code === 'BAD_REQUEST');
  assert.deepEqual(store.read(), before);
});

test('queue cannot reactivate a review/accepted fixed result; M1 rework on ready still works', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const queueNew = executionId => store.transact(state => ({
    state: applyTeamCommand(state, {
      type: 'queue', roomId: ROOM, taskId: TASK, generation: 1, actorKey: LEADER, executionId,
    }).state,
    value: undefined,
  }));

  // Worker succeeded -> review: not queueable.
  await assert.rejects(queueNew('e2'), { code: 'TASK_NOT_QUEUEABLE' });

  // After rejection the task returns to 'ready'; rework on a NEW id is allowed.
  await request(ledger, { requestId: 'reject-q', intent: { decision: 'rejected', reason: 'redo' } });
  assert.equal(store.read().tasks[TASK].status, 'ready');
  await queueNew('e2');
  assert.equal(store.read().tasks[TASK].currentExecutionId, 'e2');
  assert.equal(store.read().executions.e2.attempt, 2);

  await store.transact(state => {
    let s = applyTeamCommand(state, { type: 'ack', roomId: ROOM, taskId: TASK, generation: 1, actorKey: WORKER, executionId: 'e2', seq: 1 }).state;
    s = applyTeamCommand(s, { type: 'start', roomId: ROOM, taskId: TASK, generation: 1, actorKey: LEADER, executionId: 'e2', leaseMs: 90000 }, { now: 1000 }).state;
    s = applyTeamCommand(s, { type: 'result', roomId: ROOM, taskId: TASK, generation: 1, actorKey: WORKER, executionId: 'e2', seq: 2, result: RESULT }, { now: 2000 }).state;
    return { state: s, value: undefined };
  });
  await request(ledger, { requestId: 'accept-q', intent: { reviewedExecutionId: 'e2', resultHash: hash(RESULT) } });
  assert.equal(store.read().tasks[TASK].status, 'accepted');

  // Accepted: still not queueable.
  await assert.rejects(queueNew('e3'), { code: 'TASK_NOT_QUEUEABLE' });
  assert.equal(store.read().tasks[TASK].currentExecutionId, 'e2');
});

test('replay is rejected at an old generation', async t => {
  const { store } = await seed(t);
  const ledger = makeLedger(store);
  const first = await request(ledger, { requestId: 'gen-replay' });

  // Simulate a generation advance (recovery/migration) after the decision.
  await store.transact(state => {
    const s = structuredClone(state);
    s.teams[ROOM].generation = 2;
    return { state: s, value: undefined };
  });

  await assert.rejects(request(ledger, { requestId: 'gen-replay' }), err => {
    assert.ok(err.code === 'STALE_GENERATION' || err.codes?.includes('STALE_GENERATION'), JSON.stringify(err.codes ?? err.code));
    return true;
  });
  // Replaying with the new generation but the same requestId is a CONFLICT,
  // never a silent reuse of the stored decision.
  await assert.rejects(
    request(ledger, { requestId: 'gen-replay', intent: { generation: 2 } }),
    { code: 'CONFLICT' },
  );
  assert.equal(store.read().tasks[TASK].reviews.length, 1);
  assert.deepEqual(store.read().tasks[TASK].reviews[0], first.record);
});
