// Regression tests for the standalone M6 plan-DAG dependency validator.
// Scope: local pure computation only -- no entry points, protocol, store,
// dispatch/start/wake, real Team state, or M6 enablement are involved.
// Draft basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.2/§4.4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanDeps } from '../lib/m6-plan-dag.mjs';

const task = (taskId, dependsOn = [], status = 'planned', roomId = 'team-A') => ({ taskId, roomId, dependsOn, status });
const codes = result => result.errors.map(e => e.code).sort();

test('valid DAG: ok, deterministic topological order, no errors', () => {
  // Edges (dep -> task): A->B, B->C ; D independent.
  const plan = [task('C', ['B']), task('D'), task('B', ['A']), task('A')];
  const r = validatePlanDeps(plan);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  // prerequisites must precede dependents; ties broken deterministically (lexical)
  assert.deepEqual(r.order, ['A', 'B', 'C', 'D']);
});

test('ordering is deterministic regardless of input order', () => {
  const plan = [task('C', ['B']), task('B', ['A']), task('A'), task('D', ['B'])];
  const shuffled = [task('D', ['B']), task('A'), task('C', ['B']), task('B', ['A'])];
  const r1 = validatePlanDeps(plan);
  const r2 = validatePlanDeps(shuffled);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.order, r2.order);
  // repeated calls on the same input are identical
  assert.deepEqual(validatePlanDeps(plan), r1);
});

test('duplicate taskId in the plan is rejected', () => {
  const plan = [task('A'), task('A')];
  const r = validatePlanDeps(plan);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('DUPLICATE_TASK'));
  assert.deepEqual(r.order, []);
  assert.deepEqual(r.dispatchable, []);
});

test('duplicate dependency entry is rejected', () => {
  const plan = [task('A'), task('B', ['A', 'A'])];
  const r = validatePlanDeps(plan);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('DUPLICATE_DEPENDENCY'));
});

test('unknown dependency (no such taskId anywhere) is rejected', () => {
  const plan = [task('A', ['GHOST'])];
  const r = validatePlanDeps(plan);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('UNKNOWN_DEPENDENCY'));
});

test('cross-Team dependency (dependency belongs to another team) is rejected', () => {
  const plan = [task('A', ['B'], 'planned', 'team-A')];
  const knownTasks = [task('B', [], 'accepted', 'team-B')];
  const r = validatePlanDeps(plan, { roomId: 'team-A', knownTasks });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('CROSS_TEAM_DEPENDENCY'));
});

test('self reference is rejected', () => {
  const plan = [task('A', ['A'])];
  const r = validatePlanDeps(plan);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('SELF_DEPENDENCY'));
});

test('cycles are rejected (two-node and three-node)', () => {
  const two = validatePlanDeps([task('A', ['B']), task('B', ['A'])]);
  assert.equal(two.ok, false);
  assert.ok(codes(two).includes('CYCLE'));

  const three = validatePlanDeps([task('A', ['C']), task('B', ['A']), task('C', ['B'])]);
  assert.equal(three.ok, false);
  assert.ok(codes(three).includes('CYCLE'));
  assert.deepEqual(three.order, []);
});

test('dependency gate: only explicit accepted satisfies; review does not', () => {
  // Acceptance must come from the trusted snapshot, not the proposal's status.
  // Snapshot A accepted -> B dispatchable ; B only 'review' -> C blocked.
  const plan = [task('A', [], 'accepted'), task('B', ['A'], 'review'), task('C', ['B'], 'planned')];
  const r = validatePlanDeps(plan, {
    roomId: 'team-A',
    knownTasks: [task('A', [], 'accepted', 'team-A')],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.order, ['A', 'B', 'C']);
  assert.deepEqual(r.dispatchable, ['A', 'B']);
  assert.ok(!r.dispatchable.includes('C'));
});

test('dependency gate: every non-accepted status fails to satisfy', () => {
  for (const status of ['planned', 'ready', 'active', 'review', 'blocked', 'failed', 'cancelled', undefined]) {
    const plan = [task('DEP', [], status), task('MAIN', ['DEP'])];
    // Snapshot carries the same non-accepted status: still must not satisfy.
    const r = validatePlanDeps(plan, {
      roomId: 'team-A',
      knownTasks: [task('DEP', [], status, 'team-A')],
    });
    assert.equal(r.ok, true, `status ${status} should be structurally valid`);
    assert.ok(!r.dispatchable.includes('MAIN'), `status ${String(status)} must NOT satisfy the gate`);
    assert.ok(r.dispatchable.includes('DEP'), 'a task with no dependencies is dispatchable');
  }
  // accepted (from the snapshot) satisfies
  const ok = validatePlanDeps(
    [task('DEP', [], 'accepted'), task('MAIN', ['DEP'])],
    { roomId: 'team-A', knownTasks: [task('DEP', [], 'accepted', 'team-A')] },
  );
  assert.deepEqual(ok.dispatchable, ['DEP', 'MAIN']);
});

test('purity: input is never mutated and errors are deterministically ordered', () => {
  const plan = [task('B', ['GHOST', 'A', 'A']), task('A', ['A']), task('B')];
  const knownTasks = [task('X', [], 'accepted', 'team-Z')];
  const before = structuredClone({ plan, knownTasks });
  const r1 = validatePlanDeps(plan, { roomId: 'team-A', knownTasks });
  const r2 = validatePlanDeps(plan, { roomId: 'team-A', knownTasks });
  assert.deepEqual({ plan, knownTasks }, before, 'inputs must not be mutated');
  assert.deepEqual(r1, r2, 'output must be deterministic');
  // errors sorted by (taskId, code, dependency) regardless of insertion order
  const keys = r1.errors.map(e => `${e.taskId}|${e.code}|${e.dependency ?? ''}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('empty plan is valid with empty order and dispatchable', () => {
  const r = validatePlanDeps([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.order, []);
  assert.deepEqual(r.dispatchable, []);
});

test('external knownTasks gate: cross-team accepted task still cannot satisfy', () => {
  const plan = [task('MAIN', ['EXT'], 'planned', 'team-A')];
  const knownTasks = [task('EXT', [], 'accepted', 'team-B')];
  const r = validatePlanDeps(plan, { roomId: 'team-A', knownTasks });
  // cross-team reference is a structural error -> nothing dispatchable
  assert.equal(r.ok, false);
  assert.deepEqual(r.dispatchable, []);
});

// ---- Regressions: out-of-plan knownTasks must not poison Kahn in-degree ----

test('out-of-plan accepted dependency is NOT a false cycle and still satisfies the gate', () => {
  // EXT exists only in the trusted snapshot (same Team, accepted), never a plan
  // vertex, so it must not be counted as an in-degree that can never drain.
  const plan = [task('A', ['EXT'], 'planned', 'team-A')];
  const knownTasks = [task('EXT', [], 'accepted', 'team-A')];
  const r = validatePlanDeps(plan, { roomId: 'team-A', knownTasks });
  assert.equal(r.ok, true, 'an external same-Team accepted dep must not report CYCLE');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.order, ['A']);
  assert.deepEqual(r.dispatchable, ['A'], 'external accepted dep still gates A');
});

test('cycle detection and order use only in-plan edges', () => {
  // An external dep on a cyclic-looking external node must not create a cycle;
  // a real in-plan cycle must still be detected.
  const noCycle = validatePlanDeps(
    [task('A', ['EXT1'], 'planned', 'team-A'), task('B', ['EXT2'], 'planned', 'team-A')],
    { roomId: 'team-A', knownTasks: [task('EXT1', [], 'accepted', 'team-A'), task('EXT2', [], 'accepted', 'team-A')] },
  );
  assert.equal(noCycle.ok, true);
  assert.deepEqual(noCycle.order, ['A', 'B']);
  assert.deepEqual(noCycle.dispatchable, ['A', 'B']);

  const realCycle = validatePlanDeps(
    [task('A', ['B'], 'planned', 'team-A'), task('B', ['A'], 'planned', 'team-A')],
    { roomId: 'team-A', knownTasks: [task('EXT', [], 'accepted', 'team-A')] },
  );
  assert.equal(realCycle.ok, false);
  assert.ok(codes(realCycle).includes('CYCLE'));
});

// ---- Regressions: explicit non-array dependsOn ----

test('explicit non-array dependsOn is rejected', () => {
  for (const dependsOn of ['A', 42, {}, null]) {
    const r = validatePlanDeps([{ taskId: 'MAIN', roomId: 'team-A', dependsOn, status: 'planned' }]);
    assert.equal(r.ok, false, `dependsOn=${JSON.stringify(dependsOn)} must be rejected`);
    assert.ok(codes(r).includes('BAD_DEPENDS_ON'));
  }
  // absent dependsOn is still a valid empty dependency list
  const absent = validatePlanDeps([{ taskId: 'MAIN', roomId: 'team-A', status: 'planned' }]);
  assert.equal(absent.ok, true);
  assert.deepEqual(absent.dispatchable, ['MAIN']);
});

// ---- Regressions: proposal status must not override trusted snapshot ----

test('proposal status cannot override a trusted snapshot accepted (no downgrade)', () => {
  // Snapshot says EXT accepted; proposal claims 'planned' for the same id.
  // The accepted gate must use the snapshot, so B stays dispatchable.
  const plan = [task('EXT', [], 'planned', 'team-A'), task('B', ['EXT'], 'planned', 'team-A')];
  const r = validatePlanDeps(plan, { roomId: 'team-A', knownTasks: [task('EXT', [], 'accepted', 'team-A')] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.order, ['EXT', 'B']);
  assert.ok(r.dispatchable.includes('B'), 'snapshot accepted must win over proposal downgrade');
});

test('proposal status cannot fabricate acceptance over a trusted snapshot', () => {
  // Snapshot says EXT only 'review'; proposal claims 'accepted'. The gate must
  // use the snapshot, so B must NOT be dispatchable.
  const plan = [task('EXT', [], 'accepted', 'team-A'), task('B', ['EXT'], 'planned', 'team-A')];
  const r = validatePlanDeps(plan, { roomId: 'team-A', knownTasks: [task('EXT', [], 'review', 'team-A')] });
  assert.equal(r.ok, true);
  assert.ok(!r.dispatchable.includes('B'), 'snapshot non-accepted must block fabricated proposal acceptance');
});

// ---- Regressions: same-Team evidence required for external deps ----

test('external dependency without same-Team evidence is not accepted', () => {
  const noRoom = [{ taskId: 'EXT', dependsOn: [], status: 'accepted' }]; // no roomId
  const r = validatePlanDeps([task('A', ['EXT'], 'planned', 'team-A')], { roomId: 'team-A', knownTasks: noRoom });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('NO_TEAM_EVIDENCE'));
  assert.deepEqual(r.dispatchable, []);

  // No plan room can be established at all -> still not accepted.
  const r2 = validatePlanDeps([{ taskId: 'A', dependsOn: ['EXT'], status: 'planned' }], {
    knownTasks: [{ taskId: 'EXT', dependsOn: [], status: 'accepted' }],
  });
  assert.equal(r2.ok, false);
  assert.ok(codes(r2).includes('NO_TEAM_EVIDENCE'));
});

// ---- Regressions: trust boundary (main-reviewer findings) ----

test('in-plan dependency with no trusted snapshot cannot self-declare accepted', () => {
  // DEP is in the plan and says 'accepted', but there is NO snapshot entry.
  // statusOf must not fall back to the proposal status -> MAIN stays blocked.
  const plan = [task('DEP', [], 'accepted', 'team-A'), task('MAIN', ['DEP'], 'planned', 'team-A')];
  const r = validatePlanDeps(plan, { roomId: 'team-A' });
  assert.equal(r.ok, true, 'a proposal-only status is not a structural error');
  assert.deepEqual(r.order, ['DEP', 'MAIN']);
  assert.deepEqual(r.dispatchable, ['DEP']); // DEP has no prerequisites
  assert.ok(!r.dispatchable.includes('MAIN'), 'proposal accepted alone must not unlock MAIN');
});

test('trusted snapshot roomId of a same-ID task wins; conflicting proposal is rejected', () => {
  // Snapshot says X belongs to Team B; proposal self-declares Team A.
  // The plan node must not override the trusted roomId; the conflict must fail.
  const plan = [task('X', [], 'planned', 'team-A')];
  const r = validatePlanDeps(plan, {
    roomId: 'team-A',
    knownTasks: [task('X', [], 'accepted', 'team-B')],
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('SNAPSHOT_TEAM_CONFLICT'));
  assert.deepEqual(r.dispatchable, []);
});

test('null or empty Team evidence is rejected on both snapshot and plan sides', () => {
  for (const bad of [null, '']) {
    // Snapshot side: a dependency backed by an accepted record with no Team.
    const a = validatePlanDeps([task('MAIN', ['EXT'], 'planned', 'team-A')], {
      roomId: 'team-A',
      knownTasks: [{ taskId: 'EXT', dependsOn: [], status: 'accepted', roomId: bad }],
    });
    assert.equal(a.ok, false, `snapshot roomId=${JSON.stringify(bad)}`);
    assert.ok(codes(a).includes('NO_TEAM_EVIDENCE'));
    assert.deepEqual(a.dispatchable, []);

    // Plan side: a plan node self-declares a null/empty Team.
    const b = validatePlanDeps([{ taskId: 'MAIN', roomId: bad, dependsOn: [], status: 'planned' }]);
    assert.equal(b.ok, false, `plan roomId=${JSON.stringify(bad)}`);
    assert.ok(codes(b).includes('BAD_TEAM'));
  }
});

// ---- Regression: trusted ownership cannot be bypassed by an absent proposal room ----

test('trusted same-ID ownership in another Team is not bypassed by a missing proposal roomId', () => {
  // Exactly the main-reviewer counterexample: the plan node omits roomId, but
  // the trusted snapshot assigns x to Team b while planRoom is Team a.
  const r = validatePlanDeps(
    [{ taskId: 'x' }],
    { roomId: 'a', knownTasks: { x: { roomId: 'b', status: 'accepted' } } },
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('SNAPSHOT_TEAM_CONFLICT'));
  assert.deepEqual(r.dispatchable, []);

  // Same trusted ownership as planRoom is fine and does not over-reject.
  const ok = validatePlanDeps(
    [{ taskId: 'x' }],
    { roomId: 'a', knownTasks: { x: { roomId: 'a', status: 'accepted' } } },
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.dispatchable, ['x']);
});

test('edge check source uses trusted ownership, not a conflicting proposal roomId', () => {
  // Proposal lies that A is in Team b; trusted snapshot says A is in Team a,
  // same as B. The A->B edge must be treated as in-Team (no cross-Team error).
  const plan = [
    { taskId: 'A', roomId: 'b', dependsOn: ['B'], status: 'planned' },
    { taskId: 'B', roomId: 'a', dependsOn: [], status: 'planned' },
  ];
  const r = validatePlanDeps(plan, {
    roomId: 'a',
    knownTasks: {
      A: { roomId: 'a', status: 'accepted' },
      B: { roomId: 'a', status: 'accepted' },
    },
  });
  assert.equal(r.ok, false, 'the proposal room contradicts trusted ownership');
  assert.ok(codes(r).includes('SNAPSHOT_TEAM_CONFLICT'));
  assert.ok(!codes(r).includes('CROSS_TEAM_DEPENDENCY'), 'edge source must use effective ownership');
});
