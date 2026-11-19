// Regression tests for the local transactional plan-ledger service.
// Scope: local service layer only. No HTTP, tools, real dispatch, result state
// transitions or M6 enablement. Caller identity comes from the host-resolved
// trusted context; authorization is decided by a trusted host delegate that is
// consulted INSIDE the transaction; generation/leader come from the ledger.
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

const trusted = (overrides = {}) => ({ actorKey: 'node-a/leader', ...overrides });

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
  // Trusted host delegate: current Room/operation authorization, evaluated at
  // call time by the service. Mutable so tests can revoke while a write queues.
  const auth = { allowed: true, deniedOps: new Set(), calls: [] };
  const authorize = context => {
    auth.calls.push(context);
    if (!auth.allowed) return false;
    if (auth.deniedOps.has(context.operation)) return false;
    return context.actorKey === 'node-a/leader';
  };
  const make = () => createPlanLedgerService({ store, now: () => 1_700_000_000_000, authorize: opts.noDelegate ? undefined : authorize });
  return {
    directory, store, auth, service: make(),
    reopen: async () => { store = await openTeamStore({ directory }); return make(); },
  };
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
  assert.deepEqual(store.read().tasks, before.tasks);
  assert.deepEqual(store.read().executions, before.executions);
  assert.deepEqual(store.read().workerExecutions, before.workerExecutions);
  assert.deepEqual(store.read().outbox, before.outbox);
  assert.deepEqual(store.read().teams, before.teams);
});

test('TOCTOU: submit binds one pre-queued snapshot; caller mutation while queued cannot change persisted content', async t => {
  const { store, service } = await setup(t);
  const request = submit();
  const pending = service.submitPlan(request, trusted()); // snapshot captured synchronously
  // Mutate AFTER the call but BEFORE the queued transaction runs.
  request.tasks[0].detail = 'MUTATED';
  request.tasks.push({ taskId: 'C', roomId: 'room-1', dependsOn: [], title: 'C', detail: 'injected' });
  const result = await pending;
  assert.equal(result.fingerprint, FP, 'result must bind the pre-queued snapshot');
  const plan = store.read().plans['plan-1'];
  assert.equal(plan.fingerprint, FP);
  assert.equal(plan.tasks[0].detail, 'a', 'mutated detail must not be persisted');
  assert.equal(plan.tasks.length, 2, 'injected task must not be persisted');
  assert.equal(planFingerprint(plan.tasks), FP, 'persisted content must match the bound fingerprint');
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

test('caller identity is independently trusted; the host delegate is consulted per room/operation', async t => {
  const { store, service, auth } = await setup(t);
  await service.submitPlan(submit(), trusted());
  const call = auth.calls.find(c => c.operation === 'submit');
  assert.ok(call, 'delegate must be consulted on submit');
  assert.equal(call.roomId, 'room-1');
  assert.equal(call.actorKey, 'node-a/leader');
  assert.equal(call.generation, 1);

  // A non-leader is rejected even if it claims to be trusted.
  await assert.rejects(service.submitPlan(submit({ requestId: 'x1' }), trusted({ actorKey: 'node-b/worker' })), e => e.code === 'FORBIDDEN');
  // Missing identity is a malformed request, never inferred.
  await assert.rejects(service.submitPlan(submit({ requestId: 'x1b' }), {}), e => e.code === 'BAD_REQUEST');
  // Delegate can deny a specific operation for the room.
  auth.deniedOps.add('approve');
  await assert.rejects(
    service.approvePlan({ requestId: 'x2', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted()),
    e => e.code === 'FORBIDDEN',
  );
  auth.deniedOps.delete('approve');
  assert.equal(store.read().plans['plan-1'].approval, null);

  // Generation fence: caller must pin the authoritative generation.
  await assert.rejects(service.submitPlan(submit({ requestId: 'x3', expectedGeneration: 2 }), trusted()), e => e.code === 'STALE_GENERATION');
  await assert.rejects(service.approvePlan({ requestId: 'x4', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 2, fingerprint: FP }, trusted()), e => e.code === 'STALE_GENERATION');
  await store.transact(state => { state.teams['room-1'].generation = 2; return { state }; });
  await assert.rejects(service.approvePlan({ requestId: 'x5', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 2, fingerprint: FP }, trusted()), e => e.code === 'STALE_GENERATION');
});

test('revocation while queued rejects the write: authorization is evaluated inside the transaction', async t => {
  const { store, service, auth } = await setup(t);
  const pending = service.submitPlan(submit(), trusted());
  auth.allowed = false; // revoked before the queued transaction runs
  await assert.rejects(pending, e => e.code === 'FORBIDDEN');
  assert.equal(Object.keys(store.read().plans).length, 0, 'a revoked write must not persist');
});

test('revocation blocks approval even when the plan was submitted while authorized', async t => {
  const { store, service, auth } = await setup(t);
  await service.submitPlan(submit(), trusted());
  auth.allowed = false;
  await assert.rejects(
    service.approvePlan({ requestId: 'req-approve-1', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted()),
    e => e.code === 'FORBIDDEN',
  );
  assert.equal(store.read().plans['plan-1'].approval, null);
});

test('a service without a trusted host authorizer fails closed for writes and reads', async t => {
  const { service } = await setup(t, { noDelegate: true });
  await assert.rejects(service.submitPlan(submit(), trusted()), e => e.code === 'AUTHORIZATION_UNAVAILABLE');
  await assert.rejects(service.readPlan({ roomId: 'room-1', planId: 'plan-1' }, trusted()), e => e.code === 'AUTHORIZATION_UNAVAILABLE');
  await assert.rejects(service.listPlans({ roomId: 'room-1' }, trusted()), e => e.code === 'AUTHORIZATION_UNAVAILABLE');
});

test('read/list are internal-only and enforce the same trusted authorization boundary', async t => {
  const { store, service, auth } = await setup(t);
  await service.submitPlan(submit(), trusted());
  await service.approvePlan({ requestId: 'req-approve-1', roomId: 'room-1', planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP }, trusted());
  const before = store.read();
  const view = await service.readPlan({ roomId: 'room-1', planId: 'plan-1' }, trusted());
  assert.equal(view.approval.revision, 1);
  assert.equal((await service.listPlans({ roomId: 'room-1' }, trusted())).length, 1);
  assert.equal((await service.listPlans({ roomId: 'other' }, trusted())).length, 0);
  assert.deepEqual(store.read(), before, 'reads must not mutate the ledger');
  const returned = await service.readPlan({ roomId: 'room-1', planId: 'plan-1' }, trusted());
  returned.tasks[0].detail = 'mutated copy';
  assert.notEqual(store.read().plans['plan-1'].tasks[0].detail, 'mutated copy');
  // An unauthorized caller cannot read; missing context is rejected.
  auth.allowed = false;
  await assert.rejects(service.readPlan({ roomId: 'room-1', planId: 'plan-1' }, trusted()), e => e.code === 'FORBIDDEN');
  await assert.rejects(service.listPlans({ roomId: 'room-1' }, trusted()), e => e.code === 'FORBIDDEN');
  auth.allowed = true;
  await assert.rejects(service.readPlan({ roomId: 'room-1', planId: 'plan-1' }), e => e.code === 'BAD_REQUEST');
});

test('old M1 ledger (no plans bucket) opens and plan service works; corrupt plans fail closed', async t => {
  const { store, service, reopen } = await setup(t, { legacy: true });
  assert.deepEqual(store.read().plans, {});
  const result = await service.submitPlan(submit(), trusted());
  assert.equal(result.revision, 1);
  const reopened = await reopen();
  assert.equal((await reopened.readPlan({ roomId: 'room-1', planId: 'plan-1' }, trusted())).revision, 1);

  const bad = await mkdtemp(join(tmpdir(), 'm6-plan-bad-'));
  t.after(() => rm(bad, { recursive: true, force: true }));
  const state = emptyTeamState();
  state.plans = { 'plan-x': { planId: 'plan-x' } }; // structurally invalid
  await writeFile(join(bad, 'team.json'), JSON.stringify(state));
  await assert.rejects(openTeamStore({ directory: bad }), e => e.code === 'TEAM_STORAGE');
});
