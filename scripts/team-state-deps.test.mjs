import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyTeamState, applyTeamCommand } from '../lib/team-state.mjs';
import { openTeamStore } from '../lib/team-store.mjs';
import { createResultReviewLedger } from '../lib/m6-review-ledger.mjs';
import { resultHash } from '../lib/task-result-context.mjs';

const ROOM = 'room-deps';
const LEADER = 'node-a/human';

function seed(state) {
  return applyTeamCommand(state, {
    type: 'create-team', roomId: ROOM, actorKey: LEADER, leaderKey: LEADER,
  }, { now: 1000 }).state;
}

function run(state, type, extra = {}) {
  return applyTeamCommand(state, {
    type, roomId: ROOM, actorKey: extra.actorKey ?? LEADER, generation: 1, now: 1000, ...extra,
  }, { now: 1000 });
}

function task(state, taskId, extra = {}) {
  return state.tasks[taskId];
}

test('create-task allows same-Room dependencies and starts planned until accepted', () => {
  let state = seed(emptyTeamState());
  state = run(state, 'create-task', { taskId: 't1', title: 'first', workerKey: 'node-b/w1' }).state;
  assert.equal(task(state, 't1').status, 'ready');
  state = run(state, 'create-task', { taskId: 't2', title: 'second', workerKey: 'node-b/w2', dependsOn: ['t1'] }).state;
  assert.deepEqual(task(state, 't2').dependsOn, ['t1']);
  assert.equal(task(state, 't2').status, 'planned');
});

test('bad dependency references are rejected atomically', () => {
  let state = seed(emptyTeamState());
  state = run(state, 'create-task', { taskId: 't1', title: 'first', workerKey: 'node-b/w1' }).state;
  assert.throws(() => run(state, 'create-task', { taskId: 't2', title: 'x', workerKey: 'node-b/w1', dependsOn: ['unknown'] }), { code: 'BAD_DEPENDENCY' });
  assert.throws(() => run(state, 'create-task', { taskId: 't2', title: 'x', workerKey: 'node-b/w1', dependsOn: ['t2'] }), { code: 'SELF_DEPENDENCY' });
  assert.throws(() => run(state, 'create-task', { taskId: 't2', title: 'x', workerKey: 'node-b/w1', dependsOn: ['t1', 't1'] }), { code: 'DUPLICATE_DEPENDENCY' });
  assert.throws(() => run(state, 'create-task', { taskId: 't2', title: 'x', workerKey: 'node-b/w1', dependsOn: 't1' }), { code: 'BAD_REQUEST' });
  assert.equal(state.tasks.t2, undefined, 'nothing persisted after a rejected batch');
});

test('create-task alone cannot form a cycle; persisted tampering is caught on load', () => {
  // Dependencies must reference EXISTING tasks, so the new task can never be
  // reachable from the graph it points into: create-task cannot form a cycle.
  // The reducer keeps a whole-graph check as defense in depth, and the store
  // re-validates acyclicity on load (see the persistence test below, where a
  // hand-tampered t1 -> t2 edge fails closed with TEAM_STORAGE).
  let state = seed(emptyTeamState());
  state = run(state, 'create-task', { taskId: 't1', title: 'first', workerKey: 'node-b/w1' }).state;
  state = run(state, 'create-task', { taskId: 't2', title: 'second', workerKey: 'node-b/w2', dependsOn: ['t1'] }).state;
  state = run(state, 'create-task', { taskId: 't3', title: 'third', workerKey: 'node-b/w3', dependsOn: ['t1', 't2'] }).state;
  assert.deepEqual(task(state, 't3').dependsOn, ['t1', 't2']);
});

test('queue is gated on accepted dependencies', async () => {
  let state = seed(emptyTeamState());
  state = run(state, 'create-task', { taskId: 't1', title: 'first', workerKey: 'node-b/w1' }).state;
  state = run(state, 'create-task', { taskId: 't2', title: 'second', workerKey: 'node-b/w2', dependsOn: ['t1'] }).state;

  assert.throws(() => run(state, 'queue', { taskId: 't2', executionId: 'e2' }), { code: 'DEPENDENCY_NOT_ACCEPTED' });

  // Drive t1 to review and accept it through the authoritative review ledger.
  state = run(state, 'queue', { taskId: 't1', executionId: 'e1' }).state;
  state = run(state, 'ack', { taskId: 't1', executionId: 'e1', actorKey: 'node-b/w1', seq: 1 }).state;
  state = run(state, 'start', { taskId: 't1', executionId: 'e1', leaseMs: 90000 }).state;
  const result = { status: 'succeeded', summary: 'done' };
  state = run(state, 'result', { taskId: 't1', executionId: 'e1', actorKey: 'node-b/w1', seq: 2, result }).state;
  assert.equal(task(state, 't1').status, 'review');

  const directory = await mkDir();
  try {
    const store = await openTeamStore({ directory });
    await store.transact(current => ({ state, value: null }));
    const ledger = createResultReviewLedger({
      store, nodeId: 'node-a',
      getRoom: () => ({ id: ROOM, deleted: false, leader: { key: LEADER }, members: [{ key: LEADER }] }),
      authorize: async () => true,
    });
    const accepted = await ledger.review({
      requestId: 'accept-t1', actorKey: LEADER, roomId: ROOM, taskId: 't1',
      intent: { decision: 'accepted', generation: 1, reviewedExecutionId: 'e1', resultHash: resultHash(result) },
    });
    assert.equal(accepted.decision, 'accepted');
    const persisted = store.read();
    assert.equal(persisted.tasks.t1.status, 'accepted');
    // The dependency gate now opens: t2 (still planned) may be queued.
    const queued = applyTeamCommand(persisted, {
      type: 'queue', roomId: ROOM, actorKey: LEADER, generation: 1, taskId: 't2', executionId: 'e2', now: 1000,
    }, { now: 1000 });
    assert.equal(queued.state.tasks.t2.status, 'active');
    assert.equal(queued.value.attempt, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a persisted ledger keeps non-empty dependsOn; a tampered cycle fails closed', async () => {
  const directory = await mkDir();
  try {
    const store = await openTeamStore({ directory });
    let state = seed(emptyTeamState());
    state = run(state, 'create-task', { taskId: 't1', title: 'first', workerKey: 'node-b/w1' }).state;
    state = run(state, 'create-task', { taskId: 't2', title: 'second', workerKey: 'node-b/w2', dependsOn: ['t1'] }).state;
    await store.transact(current => ({ state, value: null }));
    await store.flush();

    // Reopen from disk: validation accepts the same-Room reference.
    const reopened = await openTeamStore({ directory });
    assert.deepEqual(reopened.read().tasks.t2.dependsOn, ['t1']);

    // A tampered cycle must fail closed on load, not silently open.
    const { writeFile } = await import('node:fs/promises');
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(join(directory, 'team.json'), 'utf8'));
    raw.tasks.t1.dependsOn = ['t2'];
    await writeFile(join(directory, 'team.json'), JSON.stringify(raw));
    await assert.rejects(openTeamStore({ directory }), error => error.code === 'TEAM_STORAGE');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function mkDir() {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'team-deps-'));
}
