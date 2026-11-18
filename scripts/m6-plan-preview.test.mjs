// Dedicated tests for the pure M6 local dry-run preview + approved-version binding.
// Scope: local pure computation only. No authoritative ledger, protocol, entry
// point, dispatch/start/wake/accept, real Team state or M6 enablement is used.
// Basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.2/§4.3/§4.4/§6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalTeamJson } from '../lib/team-state.mjs';
import { planFingerprint, previewPlanOrchestration } from '../lib/m6-plan-preview.mjs';

const TASKS = [
  { taskId: 'A', roomId: 'team-A', dependsOn: [], requiredCapabilities: ['build'], acceptanceCriteria: 'A done', title: 'A', detail: 'build A' },
  { taskId: 'B', roomId: 'team-A', dependsOn: ['A'], requiredCapabilities: ['test'], acceptanceCriteria: 'B done', title: 'B', detail: 'test B' },
];
const FP = planFingerprint(TASKS);

function trusted(overrides = {}) {
  return {
    roomId: 'team-A',
    generation: 1,
    approvedPlan: { planId: 'plan-1', revision: 7, fingerprint: FP, roomId: 'team-A', generation: 1 },
    authorizations: ['node-b/worker', 'node-c/worker'],
    profiles: [
      { memberKey: 'node-b/worker', capabilities: ['build', 'test'] },
      { memberKey: 'node-c/worker', capabilities: ['build', 'test'] },
    ],
    executions: [],
    knownTasks: [{ taskId: 'A', roomId: 'team-A', status: 'accepted' }],
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    planId: 'plan-1',
    revision: 7,
    fingerprint: FP, // self-declared; MUST be ignored and recomputed
    tasks: structuredClone(TASKS),
    ...overrides,
  };
}

const codes = r => r.explanations.map(e => e.code);
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---- happy path: bound plan -> explanations + candidates only ----

test('bound plan: ok, DAG order, dispatchable tasks and candidates, zero explanations', () => {
  const r = previewPlanOrchestration(proposal(), trusted());
  assert.equal(r.ok, true);
  assert.equal(r.bound, true);
  assert.deepEqual(Object.keys(r).sort(), [
    'approval', 'bound', 'candidates', 'dag', 'explanations', 'ok', 'proposal', 'team',
  ]);
  assert.deepEqual(r.team, { roomId: 'team-A', generation: 1 });
  assert.deepEqual(r.dag.order, ['A', 'B']);
  assert.deepEqual(r.dag.dispatchable, ['A', 'B']);
  assert.deepEqual(r.candidates.A.recommended, ['node-b/worker', 'node-c/worker']);
  assert.deepEqual(r.candidates.B.recommended, ['node-b/worker', 'node-c/worker']);
  // dependency satisfaction and candidate availability are both required
  assert.equal(r.candidates.A.dependencySatisfied, true);
  assert.equal(r.candidates.A.candidateAvailable, true);
  assert.equal(r.candidates.A.dispatchable, true);
  assert.deepEqual(r.explanations, []);
});

test('planFingerprint is deterministic, key-order/set-order invariant, content-sensitive', () => {
  assert.equal(planFingerprint(TASKS), FP);
  const reordered = TASKS.map(t => ({
    ...t,
    dependsOn: [...t.dependsOn].reverse(),
    requiredCapabilities: [...t.requiredCapabilities].reverse(),
  }));
  assert.equal(planFingerprint(reordered), FP, 'set-like fields must not cause false tamper');
  const changed = TASKS.map(t => t.taskId === 'B' ? { ...t, detail: 'changed' } : t);
  assert.notEqual(planFingerprint(changed), FP, 'real content change must change fingerprint');
});

test('planFingerprint reuses canonicalTeamJson serialization', () => {
  const normalized = TASKS.map(t => ({
    taskId: t.taskId,
    roomId: t.roomId,
    dependsOn: t.dependsOn,
    requiredCapabilities: t.requiredCapabilities,
    acceptanceCriteria: t.acceptanceCriteria,
    title: t.title,
    detail: t.detail,
  }));
  const expected = createHash('sha256').update(canonicalTeamJson(normalized)).digest('hex');
  assert.equal(planFingerprint(TASKS), expected);
});

test('planFingerprint strictly type-checks known fields; malformed values never default into a valid digest', () => {
  const badTasks = [
    [{ ...TASKS[0], roomId: 42 }],
    [{ ...TASKS[0], roomId: null }],
    [{ ...TASKS[0], dependsOn: 'A' }],
    [{ ...TASKS[0], dependsOn: [42] }],
    [{ ...TASKS[0], requiredCapabilities: {} }],
    [{ ...TASKS[0], requiredCapabilities: [''] }],
    [{ ...TASKS[0], acceptanceCriteria: 7 }],
    [{ ...TASKS[0], acceptanceCriteria: null }],
    [{ ...TASKS[0], title: [] }],
    [{ ...TASKS[0], detail: {} }],
  ];
  for (const tasks of badTasks) {
    assert.throws(() => planFingerprint(tasks), err => err?.code === 'INVALID_PLAN');
  }
  // A malformed capability declaration must NOT collide with the well-formed
  // empty-list digest that a missing field legitimately defaults to.
  const omitted = [{ taskId: 'A', roomId: 'team-A' }];
  const malformed = [{ taskId: 'A', roomId: 'team-A', requiredCapabilities: {} }];
  assert.notEqual(planFingerprint(omitted), (() => {
    try { return planFingerprint(malformed); } catch { return 'REJECTED'; }
  })(), 'malformed must be rejected, never equal a valid default digest');
});

test('planFingerprint defaults only genuinely absent known fields', () => {
  const minimal = [{ taskId: 'A', roomId: 'team-A' }];
  const explicitListDefaults = [{ taskId: 'A', roomId: 'team-A', dependsOn: [], requiredCapabilities: [] }];
  // Scalar defaults (null) apply only when the field is ABSENT; an explicit
  // null is a type error and must not collapse into the same digest.
  assert.equal(planFingerprint(minimal), planFingerprint(explicitListDefaults));
  assert.throws(() => planFingerprint([{ taskId: 'A', roomId: 'team-A', title: null }]), err => err?.code === 'INVALID_PLAN');
});

// ---- 提案篡改 (proposal tampering) ----

test('tampered content with the approved version claimed is rejected (self-declared fingerprint ignored)', () => {
  const tampered = proposal({
    tasks: TASKS.map(t => t.taskId === 'B' ? { ...t, detail: 'test B (TAMPERED)' } : t),
  });
  assert.equal(tampered.fingerprint, FP, 'proposal still claims the approved fingerprint');
  const r = previewPlanOrchestration(tampered, trusted());
  assert.equal(r.ok, false);
  assert.equal(r.bound, false);
  assert.ok(codes(r).includes('FINGERPRINT_MISMATCH'));
  assert.ok(!codes(r).includes('REVISION_MISMATCH'), 'revision is unchanged');
  // no candidates are surfaced for an unbound proposal
  assert.deepEqual(r.candidates.A.recommended, []);
});

// ---- 改版 (revision change) ----

test('revision change is rejected even when content matches the approved version', () => {
  const r = previewPlanOrchestration(proposal({ revision: 8 }), trusted());
  assert.equal(r.bound, false);
  assert.ok(codes(r).includes('REVISION_MISMATCH'));
  assert.ok(!codes(r).includes('FINGERPRINT_MISMATCH'), 'content still matches');
});

test('a legitimately re-approved revision binds cleanly (new revision + new fingerprint in trusted)', () => {
  const v2 = TASKS.map(t => t.taskId === 'B' ? { ...t, detail: 'test B v2' } : t);
  const fp2 = planFingerprint(v2);
  const t = trusted({ approvedPlan: { planId: 'plan-1', revision: 8, fingerprint: fp2, roomId: 'team-A', generation: 1 } });
  const r = previewPlanOrchestration(proposal({ revision: 8, tasks: structuredClone(v2), fingerprint: fp2 }), t);
  assert.equal(r.bound, true);
  assert.equal(r.ok, true);
  assert.equal(r.approval.revision, 8);
});

// ---- explicit Team / generation fence ----

test('proposal claiming a different generation or Team cannot bind', () => {
  const g = previewPlanOrchestration(proposal({ generation: 2 }), trusted());
  assert.ok(codes(g).includes('GENERATION_MISMATCH'));
  assert.equal(g.bound, false);

  const t = previewPlanOrchestration(proposal({ roomId: 'team-B' }), trusted());
  assert.ok(codes(t).includes('TEAM_MISMATCH'));
  assert.equal(t.bound, false);
});

// ---- approval record binding: planId / roomId / generation / positive ints ----

test('approval requires a non-empty planId on both sides, and they must match', () => {
  const emptyApproval = previewPlanOrchestration(proposal(), trusted({
    approvedPlan: { planId: '', revision: 7, fingerprint: FP, roomId: 'team-A', generation: 1 },
  }));
  assert.equal(emptyApproval.bound, false);
  assert.ok(codes(emptyApproval).includes('INVALID_APPROVAL_CONTEXT'));

  const emptyProposal = previewPlanOrchestration(proposal({ planId: '' }), trusted());
  assert.equal(emptyProposal.bound, false);
  assert.ok(codes(emptyProposal).includes('PLAN_ID_MISMATCH'));

  const mismatch = previewPlanOrchestration(proposal({ planId: 'other-plan' }), trusted());
  assert.equal(mismatch.bound, false);
  assert.ok(codes(mismatch).includes('PLAN_ID_MISMATCH'));
});

test('approval must bind to the same Team and generation as the trusted context', () => {
  const wrongTeam = previewPlanOrchestration(proposal(), trusted({
    approvedPlan: { planId: 'plan-1', revision: 7, fingerprint: FP, roomId: 'team-B', generation: 1 },
  }));
  assert.equal(wrongTeam.bound, false);
  assert.ok(codes(wrongTeam).includes('APPROVAL_TEAM_MISMATCH'));

  const wrongGeneration = previewPlanOrchestration(proposal(), trusted({
    approvedPlan: { planId: 'plan-1', revision: 7, fingerprint: FP, roomId: 'team-A', generation: 2 },
  }));
  assert.equal(wrongGeneration.bound, false);
  assert.ok(codes(wrongGeneration).includes('APPROVAL_GENERATION_MISMATCH'));

  const missingBinding = previewPlanOrchestration(proposal(), trusted({
    approvedPlan: { planId: 'plan-1', revision: 7, fingerprint: FP },
  }));
  assert.equal(missingBinding.bound, false);
  assert.ok(codes(missingBinding).includes('INVALID_APPROVAL_CONTEXT'));
});

test('revision and generation must be positive safe integers', () => {
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '7', null]) {
    const badRevision = previewPlanOrchestration(proposal(), trusted({ approvedPlan: {
      planId: 'plan-1', revision: bad, fingerprint: FP, roomId: 'team-A', generation: 1,
    } }));
    assert.equal(badRevision.bound, false, `revision=${String(bad)}`);
    assert.ok(codes(badRevision).includes('INVALID_APPROVAL_CONTEXT'));

    const badGeneration = previewPlanOrchestration(proposal(), trusted({ generation: bad }));
    assert.equal(badGeneration.bound, false, `generation=${String(bad)}`);
    assert.ok(codes(badGeneration).includes('INVALID_APPROVAL_CONTEXT'));
  }
});

test('null or undefined proposal is reported as missing tasks, never thrown on', () => {
  for (const bad of [null, undefined, 42, 'plan']) {
    let r;
    assert.doesNotThrow(() => { r = previewPlanOrchestration(bad, trusted()); }, `proposal=${String(bad)}`);
    assert.equal(r.ok, false);
    assert.equal(r.bound, false);
    assert.ok(codes(r).includes('MISSING_PLAN_TASKS'));
    assert.deepEqual(r.dag.dispatchable, []);
  }
});

// ---- 撤权 (ACL revocation) ----

const DEPLOY = [{ taskId: 'X', roomId: 'team-A', dependsOn: [], requiredCapabilities: ['deploy'], acceptanceCriteria: 'x', title: 'X', detail: 'x' }];
const DEPLOY_FP = planFingerprint(DEPLOY);
const deployProposal = () => ({ planId: 'plan-x', revision: 7, fingerprint: DEPLOY_FP, tasks: structuredClone(DEPLOY) });
const deployTrusted = authorizations => trusted({
  authorizations,
  approvedPlan: { planId: 'plan-x', revision: 7, fingerprint: DEPLOY_FP, roomId: 'team-A', generation: 1 },
  knownTasks: [],
  profiles: [
    { memberKey: 'node-b/worker', capabilities: ['deploy'] },
    { memberKey: 'node-c/worker', capabilities: ['build'] },
  ],
});

test('ACL revocation removes the only eligible worker and reports no candidate', () => {
  const before = previewPlanOrchestration(deployProposal(), deployTrusted(['node-b/worker', 'node-c/worker']));
  assert.deepEqual(before.candidates.X.recommended, ['node-b/worker']);

  const after = previewPlanOrchestration(deployProposal(), deployTrusted(['node-c/worker']));
  assert.equal(after.bound, true, 'the approved version is still valid');
  assert.deepEqual(after.candidates.X.recommended, [], 'revoked worker is no longer recommended');
  assert.ok(after.candidates.X.excluded.some(e => e.memberKey === 'node-b/worker' && e.reason === 'UNAUTHORIZED'));
  assert.ok(codes(after).includes('NO_CANDIDATE'));
  assert.ok(after.explanations.some(e => e.detail === 'node-b/worker:UNAUTHORIZED'));
  // dependency is satisfied but no worker is available -> NOT dispatchable
  assert.equal(after.candidates.X.dependencySatisfied, true);
  assert.equal(after.candidates.X.candidateAvailable, false);
  assert.equal(after.candidates.X.dispatchable, false);
});

// ---- 依赖未验收 (dependency not accepted) ----

test('a dependency only in review (not accepted) blocks dispatch; snapshot acceptance unlocks it', () => {
  const blocked = previewPlanOrchestration(proposal(), trusted({
    knownTasks: [{ taskId: 'A', roomId: 'team-A', status: 'review' }],
  }));
  assert.equal(blocked.ok, true, 'structurally valid + bound');
  assert.deepEqual(blocked.dag.dispatchable, ['A']);
  assert.equal(blocked.candidates.B.dispatchable, false);
  assert.equal(blocked.candidates.B.dependencySatisfied, false, 'the dependency gate itself is unsatisfied');
  assert.equal(blocked.candidates.B.candidateAvailable, false);
  assert.ok(blocked.explanations.some(e => e.code === 'DEPENDENCY_NOT_ACCEPTED' && e.taskId === 'B'));
  assert.deepEqual(blocked.candidates.B.recommended, []);

  const unblocked = previewPlanOrchestration(proposal(), trusted({
    knownTasks: [{ taskId: 'A', roomId: 'team-A', status: 'accepted' }],
  }));
  assert.deepEqual(unblocked.dag.dispatchable, ['A', 'B']);
  assert.equal(unblocked.candidates.B.dispatchable, true);
});

test("a proposal's self-declared 'accepted' status cannot fabricate acceptance over the Team snapshot", () => {
  const forged = proposal({
    tasks: TASKS.map(t => t.taskId === 'A' ? { ...t, status: 'accepted' } : t),
  });
  assert.equal(planFingerprint(forged.tasks), FP, 'status is runtime state, not approved content');
  const r = previewPlanOrchestration(forged, trusted({
    knownTasks: [{ taskId: 'A', roomId: 'team-A', status: 'review' }],
  }));
  assert.ok(!r.dag.dispatchable.includes('B'), 'snapshot review must block B');
  assert.ok(codes(r).includes('DEPENDENCY_NOT_ACCEPTED'));
});

// ---- 容量不足 (insufficient capacity) ----

test('occupied workers (including uncertain) leave a dispatchable task with no candidate', () => {
  const r = previewPlanOrchestration(proposal(), trusted({
    executions: [
      { workerKey: 'node-b/worker', state: 'uncertain' },
      { workerKey: 'node-c/worker', state: 'queued' },
    ],
  }));
  assert.equal(r.bound, true);
  assert.deepEqual(r.candidates.A.recommended, []);
  assert.ok(codes(r).includes('NO_CANDIDATE'));
  assert.ok(r.explanations.some(e => e.detail === 'node-b/worker:CAPACITY_FULL'));
  assert.ok(r.explanations.some(e => e.detail === 'node-c/worker:CAPACITY_FULL'));
  assert.equal(r.candidates.A.dependencySatisfied, true, 'deps are fine; capacity is the problem');
  assert.equal(r.candidates.A.candidateAvailable, false);
  assert.equal(r.candidates.A.dispatchable, false, 'no candidate must never be marked dispatchable');
});

test('a candidate-filter failure is explained and never marked dispatchable', () => {
  // requiredCapabilities is a known field that defaults to [] for the digest,
  // but the worker filter requires it explicitly -> fail closed in the filter.
  const noCaps = [{ taskId: 'A', roomId: 'team-A', dependsOn: [] }];
  const fp = planFingerprint(noCaps);
  const t = trusted({ approvedPlan: { planId: 'plan-nocaps', revision: 7, fingerprint: fp, roomId: 'team-A', generation: 1 } });
  const r = previewPlanOrchestration({ planId: 'plan-nocaps', revision: 7, fingerprint: fp, tasks: noCaps }, t);
  assert.equal(r.bound, true);
  assert.ok(codes(r).includes('CANDIDATE_FILTER_FAILED'));
  assert.equal(r.candidates.A.dependencySatisfied, true);
  assert.equal(r.candidates.A.candidateAvailable, false);
  assert.equal(r.candidates.A.dispatchable, false);
  assert.ok(!codes(r).includes('NO_CANDIDATE'), 'the failure is already explained');
});

// ---- fail-closed on malformed trusted context / plan ----

test('malformed trusted context fails closed with an explanation, never throws', () => {
  const noContext = previewPlanOrchestration(proposal(), null);
  assert.equal(noContext.ok, false);
  assert.ok(codes(noContext).includes('INVALID_CONTEXT'));

  const noApproval = previewPlanOrchestration(proposal(), trusted({ approvedPlan: null }));
  assert.equal(noApproval.bound, false);
  assert.ok(codes(noApproval).includes('INVALID_APPROVAL_CONTEXT'));

  const missingTasks = previewPlanOrchestration({ revision: 7 }, trusted());
  assert.equal(missingTasks.ok, false);
  assert.ok(codes(missingTasks).includes('MISSING_PLAN_TASKS'));
});

// ---- purity, determinism, no side effects ----

test('pure: frozen inputs are not mutated and repeated calls are identical', () => {
  const p = deepFreeze(proposal());
  const t = deepFreeze(trusted());
  const first = previewPlanOrchestration(p, t);
  const second = previewPlanOrchestration(p, t);
  assert.deepEqual(first, second, 'output must be deterministic');
  assert.equal(first.bound, true, 'frozen (read-only) inputs still work');
});

test('a structurally invalid DAG explains the cycle without misleading dependency noise', () => {
  const cyclic = [
    { taskId: 'A', roomId: 'team-A', dependsOn: ['B'], requiredCapabilities: ['build'], title: 'A', detail: 'a' },
    { taskId: 'B', roomId: 'team-A', dependsOn: ['A'], requiredCapabilities: ['test'], title: 'B', detail: 'b' },
  ];
  const fp = planFingerprint(cyclic);
  const t = trusted({ approvedPlan: { planId: 'plan-c', revision: 7, fingerprint: fp, roomId: 'team-A', generation: 1 } });
  const r = previewPlanOrchestration({ planId: 'plan-c', revision: 7, fingerprint: fp, tasks: structuredClone(cyclic) }, t);
  assert.equal(r.bound, true, 'content matches the approved version');
  assert.equal(r.dag.ok, false);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('CYCLE'));
  assert.ok(!codes(r).includes('DEPENDENCY_NOT_ACCEPTED'), 'the cycle is the cause, not acceptance');
});

test('explanations are deterministically ordered regardless of issue order', () => {
  const r = previewPlanOrchestration(
    proposal({ revision: 9, generation: 3 }),
    trusted({ executions: [{ workerKey: 'node-b/worker', state: 'uncertain' }] }),
  );
  const keys = r.explanations.map(e => `${e.taskId ?? ''}|${e.code}|${e.detail ?? ''}`);
  assert.deepEqual(keys, [...keys].sort());
});
