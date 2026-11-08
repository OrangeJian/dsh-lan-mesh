import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTeamState, applyTeamCommand } from '../lib/team-state.mjs';

function fixture() {
  let state = emptyTeamState();
  const run = (type, extra = {}) => {
    const result = applyTeamCommand(state, { type, roomId: 'room-team', actorKey: 'node-a/leader', generation: 1, taskId: 'task-1', executionId: 'exec-1', ...extra }, { now: 1000 });
    state = result.state;
    return result.value;
  };
  run('create-team', { leaderKey: 'node-a/leader' });
  run('create-task', { title: 'Build module', workerKey: 'node-b/worker' });
  run('queue');
  return { run, state: () => state };
}

test('acknowledgement is not running and success requires review', () => {
  const f = fixture();
  f.run('ack', { actorKey: 'node-b/worker', seq: 1 });
  assert.equal(f.state().executions['exec-1'].state, 'acknowledged');
  f.run('start', { leaseMs: 90000 });
  f.run('result', { actorKey: 'node-b/worker', seq: 2, result: { summary: 'Built', status: 'succeeded' } });
  assert.equal(f.state().tasks['task-1'].status, 'review');
});

test('events are idempotent and conflicting sequence or actor is rejected', () => {
  const f = fixture();
  const ack = { actorKey: 'node-b/worker', seq: 1 };
  f.run('ack', ack);
  assert.equal(f.state().executions['exec-1'].events[1].eventId, 'exec-1:1');
  assert.equal(f.state().executions['exec-1'].events[1].actorKey, 'node-b/worker');
  const saved = structuredClone(f.state());
  f.run('ack', ack);
  assert.deepEqual(f.state(), saved);
  assert.throws(() => f.run('progress', { ...ack, note: 'different' }), { code: 'EVENT_CONFLICT' });
  assert.throws(() => f.run('progress', { actorKey: 'node-c/worker', seq: 2 }), { code: 'FORBIDDEN' });
  assert.throws(() => f.run('start', { generation: 2 }), { code: 'STALE_GENERATION' });
});

test('lease expiry keeps capacity until explicit reconciliation', () => {
  const f = fixture();
  f.run('ack', { actorKey: 'node-b/worker', seq: 1 });
  f.run('start', { leaseMs: 1 });
  f.run('expire', { now: 2000 });
  assert.equal(f.state().executions['exec-1'].state, 'uncertain');
  assert.throws(() => f.run('queue', { executionId: 'exec-2' }), { code: 'UNRESOLVED_EXECUTION' });
  f.run('reconcile', { stopped: true, reason: 'Operator confirmed stopped' });
  f.run('queue', { executionId: 'exec-2' });
  assert.equal(f.state().executions['exec-2'].attempt, 2);
});

test('commands preserve input and reject dependency claims in M1', () => {
  const f = fixture();
  const original = structuredClone(f.state());
  assert.throws(() => f.run('create-task', { taskId: 'task-2', title: 'Dependent', workerKey: 'node-b/worker', dependsOn: ['task-1'] }), { code: 'UNSUPPORTED' });
  assert.deepEqual(f.state(), original);
  const result = applyTeamCommand(f.state(), { type: 'pause', roomId: 'room-team', actorKey: 'node-a/leader', generation: 1 }, { now: 1000 });
  assert.equal(result.state.teams['room-team'].paused, true);
  assert.deepEqual(f.state(), original);
});

test('out-of-order and late progress cannot overwrite a terminal result', () => {
  const f = fixture();
  assert.throws(() => f.run('ack', { actorKey: 'node-b/worker', seq: 2 }), { code: 'EVENT_GAP' });
  f.run('ack', { actorKey: 'node-b/worker', seq: 1 });
  f.run('start', { leaseMs: 90000 });
  f.run('result', { actorKey: 'node-b/worker', seq: 2, result: { status: 'succeeded', summary: 'Built' } });
  assert.throws(() => f.run('progress', { actorKey: 'node-b/worker', seq: 3, note: 'Still running' }), { code: 'INVALID_TRANSITION' });
  assert.equal(f.state().executions['exec-1'].state, 'succeeded');
  assert.equal(f.state().executions['exec-1'].lastEventSeq, 2);
});

test('reserved object keys and invalid identifiers are rejected', () => {
  const f = fixture();
  assert.throws(() => f.run('create-task', { taskId: '__proto__', title: 'Bad', workerKey: 'node-b/worker' }), { code: 'BAD_REQUEST' });
});
