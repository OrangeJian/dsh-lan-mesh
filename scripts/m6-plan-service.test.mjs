// Regression tests for the local transactional plan-ledger service.
// Scope: local service layer only. No HTTP, tools, real dispatch, result state
// transitions or M6 enablement. Identity/authorization come from a trusted
// context; generation and leader come from the authoritative Team ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTeamStore } from '../lib/team-store.mjs';
import { emptyTeamState, applyTeamCommand } from '../lib/team-state.mjs';
import { planFingerprint } from '../lib/m6-plan-preview.mjs';
import { createPlanLedgerService } from '../lib/m6-plan-service.mjs';

const TASKS = [
  { taskId: 'A', roomId: 'room-1', dependsOn: [], requiredCapabilities: ['build'], title: 'A', detail: 'a' },
  { taskId: 'B', roomId: 'room-1', dependsOn: ['A'], requiredCapabilities: ['test'], title: 'B', detail: 'b' },
];
const TASKS_V2 = [
  { taskId: 'A', roomId: 'room-1', dependsOn: [], requiredCapabilities: ['build'], title: 'A', detail: 'a-v2' },
  { taskId: 'B', roomId: 'room-1', dependsOn: ['A'], requiredCapabilities: ['test'], title: 'B', detail: 'b' },
];
const FP = planFingerprint(TASKS);
const FP2 = planFingerprint(TASKS_V2);

const trusted = (overrides = {}) => ({ actorKey: 'node-a/leader', authorizations: ['node-a/leader'], ...overrides });

async function setup(t, opts = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'm6-plan-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let store;
  if (opts.legacy === true) {
    // An M1 ledger: valid Team state written WITHOUT any `plans` bucket.
    const seeded = applyTeamCommand(emptyTeamState(), { type: 'create-team', roomId: 'room-1', actorKey: 'node-a/leader', leaderKey: 'node-a/leader' }).state;
    await writeFile(join(directory, 'team.json'), `${JSON.stringify(seeded)}\n`);
    store = await openTeamStore({ directory });
  } else {
    store = await openTeamStore({ directory });
    await store.transact(state => {
      const seeded = applyTeamCommand(state, { type: 'create-team', roomId: 'room-1', actorKey: 'node-a/leader', leaderKey: 'node-a/leader' }).state;
      return { state: seeded };
    });
  }
  const service = createPlanLedgerService({ store, now: () => 1_700_000_000_000 });
  return { directory, store, service, reopen: async () => {
    store = await openTeamStore({ directory });
    return createPlanLedgerService({ store, now: () => 1_700_000_000_000 });
  } };
}

function submit(overrides = {}) {
  return {
    requestId: 'req-submit-1', roomId: 'room-1', planId: 'plan-1',
    expectedRevision: 0, expectedGeneration: 1, tasks: structuredClone(TASKS),
    ...overrides,
  };
}

test('submit persists a versioned plan draft with fingerprint and no approval, touching no other bucket', async t => {
  const { store, service } = await setup(t);
  const before = store.read();
  const result = await service.submitPlan(submit(), trusted());
  assert.deepEqual(result, { planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 1, fingerprint: FP, approved: false });
  const plan = store.read().plans['plan-1'];
  assert.equal(plan.revision, 1);
  assert.equal(plan.generation, 1);
  assert.equal(plan.fingerprint, FP);
  assert.equal(plan.approval, null);
  assert.equal(plan.tasks.length, 2);
  // Nothing outside the plans bucket changed.
  assert.deepEqual(store.read().tasks, before.tasks);
  assert.deepEqual(store.read().executions, before.executions);
  assert.deepEqual(store.read().workerExecutions, before.workerExecutions);
  assert.deepEqual(store.read().outbox, before.outbox);
  assert.deepEqual(store.read().teams, before.teams);
});

test('requestId idempotency: replay returns same result without version bump; reused id with new content conflicts', async t => {
  const { store, service } = await setup(t);
  const first = await service.submitPlan(submit(), trusted());
  const replay = await service.submitPlan(submit(), trusted());
  assert.deepEqual(replay, first);
  assert.equal(store.read().plans['plan-1'].revision, 1);
  await assert.rejects(
    service.submitPlan(submit({ tasks: structuredClone(TASKS_V2) }), trusted()),
    e => e.code === 'REQUEST_CONFLICT',
  );
  assert.equal(store.read().plans['plan-1'].revision, 1);
});

test('a revision bump changes content, requires expectedRevision and clears the prior approval', async t => {
  const { store, service } = await setup(t);
  await service.submitPlan(submit(), trusted());
  await service.approvePlan({ requestId: 'req-approve-1', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted());
  assert.notEqual(store.read().plans['plan-1'].approval, null);

  // stale expectedRevision is rejected
  await assert.rejects(
    service.submitPlan(submit({ requestId: 'req-submit-2', expectedRevision: 0, tasks: structuredClone(TASKS_V2) }), trusted()),
    e => e.code === 'REVISION_CONFLICT',
  );

  const bumped = await service.submitPlan(submit({ requestId: 'req-submit-3', expectedRevision: 1, tasks: structuredClone(TASKS_V2) }), trusted());
  assert.equal(bumped.revision, 2);
  assert.equal(bumped.fingerprint, FP2);
  const plan = store.read().plans['plan-1'];
  assert.equal(plan.revision, 2);
  assert.equal(plan.approval, null, 'modifying the plan must invalidate the old approval');

  // Approving the old version now fails: the binding no longer matches.
  await assert.rejects(
    service.approvePlan({ requestId: 'req-approve-old', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted()),
    e => e.code === 'APPROVAL_BINDING_MISMATCH',
  );
});

test('approval atomically binds planId/roomId/generation/revision/fingerprint and is idempotent', async t => {
  const { store, service } = await setup(t);
  await service.submitPlan(submit(), trusted());
  const req = { requestId: 'req-approve-1', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP };
  const approved = await service.approvePlan(req, trusted());
  assert.deepEqual(approved, {
    planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 1,
    fingerprint: FP, actorKey: 'node-a/leader', approvedAt: new Date(1_700_000_000_000).toISOString(), requestId: 'req-approve-1',
  });
  assert.deepEqual(store.read().plans['plan-1'].approval, approved);
  assert.deepEqual(await service.approvePlan(req, trusted()), approved, 'approve replay is idempotent');

  await assert.rejects(
    service.approvePlan({ ...req, requestId: 'req-approve-wrong-rev', expectedRevision: 2 }, trusted()),
    e => e.code === 'APPROVAL_BINDING_MISMATCH',
  );
  await assert.rejects(
    service.approvePlan({ ...req, requestId: 'req-approve-wrong-fp', fingerprint: FP2 }, trusted()),
    e => e.code === 'APPROVAL_BINDING_MISMATCH',
  );
  await assert.rejects(
    service.approvePlan({ ...req, requestId: 'req-approve-1', fingerprint: FP2 }, trusted()),
    e => e.code === 'REQUEST_CONFLICT',
  );
});

test('trusted identity/authorization and Team generation are enforced', async t => {
  const { store, service } = await setup(t);
  await service.submitPlan(submit(), trusted());

  // Non-leader and revoked callers cannot submit or approve.
  await assert.rejects(service.submitPlan(submit({ requestId: 'x1' }), trusted({ actorKey: 'node-b/worker', authorizations: ['node-b/worker'] })), e => e.code === 'FORBIDDEN');
  await assert.rejects(service.approvePlan({ requestId: 'x2', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted({ authorizations: [] })), e => e.code === 'FORBIDDEN');

  // Generation fence: caller must pin the authoritative generation.
  await assert.rejects(service.submitPlan(submit({ requestId: 'x3', expectedGeneration: 2 }), trusted()), e => e.code === 'STALE_GENERATION');
  await assert.rejects(service.approvePlan({ requestId: 'x4', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 2, fingerprint: FP }, trusted()), e => e.code === 'STALE_GENERATION');

  // A plan anchored to an old generation cannot be approved after generation moves on.
  await store.transact(state => { state.teams['room-1'].generation = 2; return { state }; });
  await assert.rejects(service.approvePlan({ requestId: 'x5', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 2, fingerprint: FP }, trusted()), e => e.code === 'STALE_GENERATION');
});

test('old M1 ledger (no plans bucket) opens and plan service works; corrupt plans fail closed', async t => {
  const { store, service, reopen } = await setup(t, { legacy: true });
  assert.deepEqual(store.read().plans, {});
  const result = await service.submitPlan(submit(), trusted());
  assert.equal(result.revision, 1);
  const reopened = await reopen();
  assert.equal((await reopened.readPlan({ roomId: 'room-1', planId: 'plan-1' })).revision, 1);

  const bad = await mkdtemp(join(tmpdir(), 'm6-plan-bad-'));
  t.after(() => rm(bad, { recursive: true, force: true }));
  const state = emptyTeamState();
  state.plans = { 'plan-x': { planId: 'plan-x' } }; // structurally invalid
  await writeFile(join(bad, 'team.json'), JSON.stringify(state));
  await assert.rejects(openTeamStore({ directory: bad }), e => e.code === 'TEAM_STORAGE');
});

test('readPlan/listPlans verify integrity and never mutate state', async t => {
  const { store, service } = await setup(t);
  await service.submitPlan(submit(), trusted());
  await service.approvePlan({ requestId: 'req-approve-1', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted());
  const before = store.read();
  const view = await service.readPlan({ roomId: 'room-1', planId: 'plan-1' });
  assert.equal(view.approval.revision, 1);
  assert.equal((await service.listPlans({ roomId: 'room-1' })).length, 1);
  assert.equal((await service.listPlans({ roomId: 'other' })).length, 0);
  assert.deepEqual(store.read(), before, 'reads must not mutate the ledger');
  const returned = await service.readPlan({ roomId: 'room-1', planId: 'plan-1' });
  returned.tasks[0].detail = 'mutated copy';
  assert.notEqual(store.read().plans['plan-1'].tasks[0].detail, 'mutated copy');
});
