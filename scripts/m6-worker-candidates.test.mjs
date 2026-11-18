import test from 'node:test';
import assert from 'node:assert/strict';
import { filterWorkerCandidates } from '../lib/m6-worker-candidates.mjs';

// Synthetic inputs only. No authoritative state, ledger, protocol, dispatch,
// start, wake, ACL, generation or identity semantics are exercised here.
function input(overrides = {}) {
  return {
    authorizations: ['node-b/worker', 'node-c/worker'],
    profiles: [
      { memberKey: 'node-b/worker', capabilities: ['build', 'test'] },
      { memberKey: 'node-c/worker', capabilities: ['build'] },
    ],
    executions: [],
    task: { requiredCapabilities: ['build'] },
    ...overrides,
  };
}

test('recommends an authorized, capable, free worker', () => {
  const result = filterWorkerCandidates(input());
  assert.deepEqual(result.recommended, ['node-b/worker', 'node-c/worker']);
  assert.deepEqual(result.excluded, []);
});

test('capability declarations never grant permission: matching but unauthorized worker is excluded', () => {
  const result = filterWorkerCandidates(input({
    authorizations: ['node-b/worker'],
    profiles: [
      { memberKey: 'node-b/worker', capabilities: ['build'] },
      { memberKey: 'node-d/intruder', capabilities: ['build'] },
    ],
  }));
  assert.deepEqual(result.recommended, ['node-b/worker']);
  assert.deepEqual(result.excluded, [{ memberKey: 'node-d/intruder', reason: 'UNAUTHORIZED' }]);
});

test('capability mismatch excludes even an authorized worker', () => {
  const result = filterWorkerCandidates(input({
    task: { requiredCapabilities: ['deploy'] },
  }));
  assert.deepEqual(result.recommended, []);
  assert.deepEqual(result.excluded, [
    { memberKey: 'node-b/worker', reason: 'CAPABILITY_MISMATCH' },
    { memberKey: 'node-c/worker', reason: 'CAPABILITY_MISMATCH' },
  ]);
});

test('missing capability profile for an authorized worker is fail-closed', () => {
  const result = filterWorkerCandidates(input({ profiles: [] }));
  assert.deepEqual(result.recommended, []);
  assert.deepEqual(result.excluded, [
    { memberKey: 'node-b/worker', reason: 'NO_PROFILE' },
    { memberKey: 'node-c/worker', reason: 'NO_PROFILE' },
  ]);
});

test('M1 single slot: every unresolved state (including uncertain) occupies the worker', () => {
  for (const state of ['queued', 'acknowledged', 'running', 'uncertain']) {
    const result = filterWorkerCandidates(input({
      executions: [{ workerKey: 'node-b/worker', state }],
    }));
    assert.deepEqual(result.recommended, ['node-c/worker'], `state=${state}`);
    assert.deepEqual(result.excluded, [{ memberKey: 'node-b/worker', reason: 'CAPACITY_FULL' }], `state=${state}`);
  }
});

test('terminal execution states do not occupy capacity', () => {
  for (const state of ['succeeded', 'failed', 'cancelled']) {
    const result = filterWorkerCandidates(input({
      executions: [{ workerKey: 'node-b/worker', state }],
    }));
    assert.deepEqual(result.recommended, ['node-b/worker', 'node-c/worker'], `state=${state}`);
    assert.deepEqual(result.excluded, [], `state=${state}`);
  }
});

test('executions may be supplied as the M1 keyed snapshot object', () => {
  const result = filterWorkerCandidates(input({
    executions: {
      'exec-1': { workerKey: 'node-b/worker', state: 'uncertain' },
    },
  }));
  assert.deepEqual(result.recommended, ['node-c/worker']);
  assert.deepEqual(result.excluded, [{ memberKey: 'node-b/worker', reason: 'CAPACITY_FULL' }]);
});

test('ordering is deterministic regardless of input insertion order', () => {
  const a = input({
    authorizations: ['node-c/worker', 'node-b/worker'],
    profiles: [
      { memberKey: 'node-c/worker', capabilities: ['build'] },
      { memberKey: 'node-b/worker', capabilities: ['build'] },
    ],
  });
  const b = input();
  assert.deepEqual(filterWorkerCandidates(a), filterWorkerCandidates(b));
});

test('function is pure: inputs are not mutated and repeated calls are identical', () => {
  const value = input();
  const snapshot = structuredClone(value);
  const first = filterWorkerCandidates(value);
  const second = filterWorkerCandidates(value);
  assert.deepEqual(value, snapshot, 'input must not be mutated');
  assert.deepEqual(first, second, 'result must be stable');
});

test('no concurrency expansion: never recommends a worker with an unresolved execution even when several are free', () => {
  const result = filterWorkerCandidates(input({
    executions: [
      { workerKey: 'node-b/worker', state: 'running' },
      { workerKey: 'node-c/worker', state: 'uncertain' },
    ],
  }));
  assert.deepEqual(result.recommended, []);
  assert.deepEqual(result.excluded, [
    { memberKey: 'node-b/worker', reason: 'CAPACITY_FULL' },
    { memberKey: 'node-c/worker', reason: 'CAPACITY_FULL' },
  ]);
});

test('empty requiredCapabilities is explicit and allows all free authorized workers', () => {
  const result = filterWorkerCandidates(input({ task: { requiredCapabilities: [] } }));
  assert.deepEqual(result.recommended, ['node-b/worker', 'node-c/worker']);
  assert.deepEqual(result.excluded, []);
});

test('no authorizations means no recommendation, without throwing', () => {
  const result = filterWorkerCandidates(input({ authorizations: [] }));
  assert.deepEqual(result.recommended, []);
  // Capability declarations alone never authorize: profile members are rejected.
  assert.deepEqual(result.excluded, [
    { memberKey: 'node-b/worker', reason: 'UNAUTHORIZED' },
    { memberKey: 'node-c/worker', reason: 'UNAUTHORIZED' },
  ]);
});

test('fail-closed: missing top-level information refuses to recommend', () => {
  const cases = [
    [{ profiles: [], executions: [], task: { requiredCapabilities: [] } }, 'MISSING_AUTHORIZATIONS'],
    [{ authorizations: [], executions: [], task: { requiredCapabilities: [] } }, 'MISSING_PROFILES'],
    [{ authorizations: [], profiles: [], task: { requiredCapabilities: [] } }, 'MISSING_EXECUTIONS'],
    [{ authorizations: [], profiles: [], executions: [] }, 'MISSING_TASK'],
  ];
  for (const [overrides, code] of cases) {
    assert.throws(() => filterWorkerCandidates(overrides), (err) => err?.code === code, `expected ${code}`);
  }
});

test('fail-closed: malformed task capability declaration refuses to recommend', () => {
  assert.throws(() => filterWorkerCandidates(input({ task: {} })), (err) => err?.code === 'MISSING_REQUIRED_CAPABILITIES');
  assert.throws(() => filterWorkerCandidates(input({ task: { requiredCapabilities: 'build' } })), (err) => err?.code === 'INVALID_REQUIRED_CAPABILITIES');
});

test('fail-closed: unrecognized execution state refuses to recommend', () => {
  assert.throws(
    () => filterWorkerCandidates(input({ executions: [{ workerKey: 'node-b/worker', state: 'ghost' }] })),
    (err) => err?.code === 'INVALID_EXECUTION_STATE',
  );
});

test('fail-closed: duplicate profile for one member refuses to recommend', () => {
  assert.throws(() => filterWorkerCandidates(input({
    profiles: [
      { memberKey: 'node-b/worker', capabilities: ['build'] },
      { memberKey: 'node-b/worker', capabilities: ['test'] },
    ],
  })), (err) => err?.code === 'DUPLICATE_PROFILE');
});
