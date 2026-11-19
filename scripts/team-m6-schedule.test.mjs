import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTeamCommand } from '../lib/team-state.mjs';
import { openTeamStore } from '../lib/team-store.mjs';
import { TeamCoordinator } from '../lib/team-coordinator.mjs';
import { createPlanLedgerService } from '../lib/m6-plan-service.mjs';
import { createResultReviewLedger } from '../lib/m6-review-ledger.mjs';
import { planFingerprint } from '../lib/m6-plan-preview.mjs';
import { deriveCandidateAuthority } from '../lib/m6-candidate-authority.mjs';
import { resultHash } from '../lib/task-result-context.mjs';

const ROOM = 'room-m6';
const LEADER = 'node-a/human';
const WORKER = 'node-b/w1';

const PLAN_TASKS = [
  { taskId: 'plan-a', roomId: ROOM, dependsOn: [], requiredCapabilities: ['build'], title: 'Plan A', detail: 'a' },
  { taskId: 'plan-b', roomId: ROOM, dependsOn: ['plan-a'], requiredCapabilities: ['build'], title: 'Plan B', detail: 'b' },
  { taskId: 'plan-c', roomId: ROOM, dependsOn: [], requiredCapabilities: ['build'], title: 'Plan C', detail: 'c' },
];
const FP = planFingerprint(PLAN_TASKS);

const ROOM_VIEW = () => ({
  id: ROOM, deleted: false,
  leader: { key: LEADER },
  members: [{ key: LEADER }, { key: WORKER }],
  lifecycle: { status: 'active' },
});

function authorityConfig() {
  return {
    roomId: ROOM, leaderKey: LEADER, nodeId: 'node-a', trustedPeers: ['node-b'],
    teamAuthorizations: [{ roomId: ROOM, leaderKey: LEADER, workerSessionId: '', workspaceRoot: 'C:/work/project' }],
    teamCapabilities: [{ roomId: ROOM, memberKey: WORKER, capabilities: ['build'] }],
    roomMembers: ROOM_VIEW().members,
  };
}

async function setup(t, { authority = authorityConfig(), approved = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'team-m6-schedule-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openTeamStore({ directory });
  await store.transact(state => ({
    state: applyTeamCommand(state, {
      type: 'create-team', roomId: ROOM, actorKey: LEADER, leaderKey: LEADER,
    }, { now: 1000 }).state,
  }));
  const sent = [];
  const woken = [];
  const coordinator = new TeamCoordinator({
    nodeId: 'node-a', store,
    authorize: async () => true,
    getRoom: () => ROOM_VIEW(),
    candidateAuthority: () => deriveCandidateAuthority(authority),
    send: async (target, request) => { sent.push({ target, request }); return { acknowledged: true, state: 'received' }; },
    wake: async ({ executionId }) => { woken.push(executionId); return true; },
    leaseMs: 90000, heartbeatMs: 20000,
  });
  const plans = createPlanLedgerService({ store, authorize: async () => true, now: () => 1_700_000_000_000 });
  const review = createResultReviewLedger({
    store, nodeId: 'node-a',
    getRoom: () => ROOM_VIEW(),
    authorize: async () => true,
  });
  const submit = await plans.submitPlan({
    requestId: 'req-submit', roomId: ROOM, planId: 'plan-1',
    expectedRevision: 0, expectedGeneration: 1, tasks: structuredClone(PLAN_TASKS),
  }, { actorKey: LEADER });
  const approval = approved ? await plans.approvePlan({
    requestId: 'req-approve', roomId: ROOM, planId: 'plan-1',
    expectedRevision: submit.revision, expectedGeneration: 1, fingerprint: FP,
  }, { actorKey: LEADER }) : null;
  const schedule = input => coordinator.dispatchPlanTask({ roomId: ROOM, actorKey: LEADER, planId: 'plan-1', ...input });
  return { directory, store, coordinator, plans, review, sent, woken, submit, approval, schedule };
}

function dispatchOf(sent, executionId) {
  return sent.map(row => row.request.body).find(body => body.executionId === executionId);
}

async function driveToAccepted(coordinator, review, taskId, executionId) {
  // The dispatch tick already recorded the Worker ACK (seq 1); start is the
  // Leader's permission grant, then the Worker reports its result (seq 2).
  await coordinator.command({ type: 'start', roomId: ROOM, actorKey: LEADER, taskId, executionId, generation: 1, leaseMs: 90000 });
  const result = { status: 'succeeded', summary: 'done' };
  await coordinator.command({ type: 'result', roomId: ROOM, actorKey: WORKER, taskId, executionId, generation: 1, seq: 2, result });
  await review.review({
    requestId: `accept-${taskId}`, actorKey: LEADER, roomId: ROOM, taskId,
    intent: { decision: 'accepted', generation: 1, reviewedExecutionId: executionId, resultHash: resultHash(result) },
  });
}

test('refusals persist nothing: unknown task and unapproved plan', async t => {
  const { store, schedule } = await setup(t, { approved: false });
  // The approval fence precedes task lookup, so both are PLAN_NOT_APPROVED.
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-z' }), { code: 'PLAN_NOT_APPROVED' });
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' }), { code: 'PLAN_NOT_APPROVED' });
  const state = store.read();
  assert.equal(Object.keys(state.executions).length, 0);
  assert.equal(state.tasks['plan-a'], undefined);
});

test('an approved plan task is dispatched through the existing chain', async t => {
  const { store, coordinator, sent, schedule } = await setup(t);
  const body = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  assert.equal(body.workerKey, WORKER);
  assert.equal(body.generation, 1);
  assert.equal(body.taskId, 'plan-a');
  assert.equal(body.leaderKey, LEADER);

  const state = store.read();
  const executionId = body.executionId;
  const execution = state.executions[executionId];
  // The post-dispatch tick delivered the dispatch and recorded the ACK: the
  // unchanged chain is fully in play.
  assert.equal(execution.state, 'acknowledged');
  assert.equal(execution.attempt, 1);
  assert.equal(execution.workerKey, WORKER);
  assert.equal(state.tasks['plan-a'].status, 'active');
  assert.equal(state.tasks['plan-a'].currentExecutionId, executionId);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].target, 'node-b');
  assert.equal(sent[0].request.operation, 'dispatch');
  assert.deepEqual(dispatchOf(sent, executionId), body);
  await coordinator.close();
});

test('an unaccepted dependency refuses to schedule', async t => {
  const { schedule } = await setup(t);
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-b' }), { code: 'DEPENDENCY_NOT_ACCEPTED' });
});

test('a stale revision or fingerprint is refused against the approved version', async t => {
  const { schedule } = await setup(t);
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-z' }), { code: 'NOT_FOUND' });
  await assert.rejects(schedule({ expectedRevision: 2, fingerprint: FP, taskId: 'plan-a' }), { code: 'APPROVAL_BINDING_MISMATCH' });
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: 'f'.repeat(64), taskId: 'plan-a' }), { code: 'APPROVAL_BINDING_MISMATCH' });
});

test('revocation inside the transaction fails closed and persists nothing', async t => {
  // A delegate that reports the scope revoked at schedule time must block the
  // dispatch: authorization is re-derived INSIDE the transaction, never cached.
  const { store, schedule } = await setup(t, {
    authority: { ...authorityConfig(), teamAuthorizations: [] },
  });
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' }), { code: 'NO_DISPATCHABLE_CANDIDATE' });
  assert.equal(Object.keys(store.read().executions).length, 0);
  assert.equal(store.read().tasks['plan-a'], undefined);
});

test('a capability mismatch refuses to schedule', async t => {
  const { schedule } = await setup(t, {
    authority: {
      ...authorityConfig(),
      teamCapabilities: [{ roomId: ROOM, memberKey: WORKER, capabilities: ['deploy'] }],
    },
  });
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' }), { code: 'NO_DISPATCHABLE_CANDIDATE' });
});

test('a missing candidate delegate fails closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'team-m6-schedule-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openTeamStore({ directory });
  await store.transact(state => ({
    state: applyTeamCommand(state, { type: 'create-team', roomId: ROOM, actorKey: LEADER, leaderKey: LEADER }, { now: 1000 }).state,
  }));
  const coordinator = new TeamCoordinator({
    nodeId: 'node-a', store, authorize: async () => true, getRoom: () => ROOM_VIEW(),
    send: async () => ({ acknowledged: true }), wake: async () => true,
  });
  await assert.rejects(coordinator.dispatchPlanTask({
    roomId: ROOM, actorKey: LEADER, planId: 'plan-1', expectedRevision: 1,
    fingerprint: FP, taskId: 'plan-a',
  }), { code: 'CANDIDATES_UNAVAILABLE' });
  await coordinator.close();
});

test('M1 single-slot capacity still binds: an unresolved worker blocks scheduling', async t => {
  const { store, schedule } = await setup(t);
  await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  // plan-c has no dependency but targets the same occupied worker. The
  // candidate filter reports the occupied slot before the reducer would.
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-c' }), { code: 'NO_DISPATCHABLE_CANDIDATE' });
  // The failed schedule rolled back atomically: no plan-c task, no extra execution.
  const state = store.read();
  assert.equal(state.tasks['plan-c'], undefined);
  assert.equal(Object.keys(state.executions).length, 1);
});

test('duplicate scheduling while active is refused; rework gets a NEW executionId after reconcile', async t => {
  const { store, coordinator, schedule } = await setup(t);
  const first = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  // The candidate filter sees the occupied slot (CAPACITY_FULL) and refuses;
  // the reducer's own UNRESOLVED_EXECUTION/CAPACITY stay as defense in depth.
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' }), { code: 'NO_DISPATCHABLE_CANDIDATE' });
  await assert.rejects(coordinator.command({
    type: 'queue', roomId: ROOM, actorKey: LEADER, taskId: 'plan-a',
    executionId: 'duplicate-direct', generation: 1,
  }), { code: 'UNRESOLVED_EXECUTION' });

  // Lease expiry -> uncertain (occupies, no auto re-dispatch).
  await coordinator.command({
    type: 'expire', roomId: ROOM, actorKey: LEADER, taskId: 'plan-a',
    executionId: first.executionId, generation: 1, now: Date.now() + 1_000_000,
  });
  assert.equal(store.read().executions[first.executionId].state, 'uncertain');
  await assert.rejects(schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' }), { code: 'NO_DISPATCHABLE_CANDIDATE' });

  // Human reconciliation (stopped=true) frees the slot; rework uses a new id.
  await coordinator.command({
    type: 'reconcile', roomId: ROOM, actorKey: LEADER, taskId: 'plan-a',
    executionId: first.executionId, generation: 1, stopped: true, reason: 'confirmed stopped on host',
  });
  const second = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  assert.notEqual(second.executionId, first.executionId);
  assert.equal(store.read().executions[second.executionId].attempt, 2);
  await coordinator.close();
});

test('dependency acceptance unlocks the dependent task end-to-end', async t => {
  const { store, coordinator, review, schedule } = await setup(t);
  const first = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  await driveToAccepted(coordinator, review, 'plan-a', first.executionId);
  assert.equal(store.read().tasks['plan-a'].status, 'accepted');
  assert.equal(store.read().tasks['plan-a'].reviews.length, 1);

  const second = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-b' });
  const state = store.read();
  assert.equal(state.tasks['plan-b'].status, 'active');
  assert.deepEqual(state.tasks['plan-b'].dependsOn, ['plan-a']);
  assert.equal(state.executions[second.executionId].attempt, 1);
  await coordinator.close();
});

test('an explicit workerKey must be within the recommended candidate set', async t => {
  const { schedule } = await setup(t);
  await assert.rejects(schedule({
    expectedRevision: 1, fingerprint: FP, taskId: 'plan-a', workerKey: 'node-c/elsewhere',
  }), { code: 'NO_DISPATCHABLE_CANDIDATE' });
  await assert.rejects(schedule({
    expectedRevision: 1, fingerprint: FP, taskId: 'plan-a', workerKey: 'node-a/local',
  }), { code: 'NO_DISPATCHABLE_CANDIDATE' });
});

test('scheduled state survives a store reopen (non-empty dependsOn validates)', async t => {
  const { store, coordinator, review, schedule, directory } = await setup(t);
  const first = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  await driveToAccepted(coordinator, review, 'plan-a', first.executionId);
  const second = await schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-b' });
  await coordinator.close();

  const reopened = await openTeamStore({ directory });
  const state = reopened.read();
  assert.deepEqual(state.tasks['plan-b'].dependsOn, ['plan-a']);
  assert.equal(state.executions[second.executionId].state, 'acknowledged');
});

test('deriveCandidateAuthority feeds the same shape the coordinator filter expects', async () => {
  const authority = deriveCandidateAuthority(authorityConfig());
  assert.equal(authority.leaderScope, true);
  assert.deepEqual(authority.authorizations, [WORKER]);
  assert.deepEqual(authority.profiles, [{ memberKey: WORKER, capabilities: ['build'] }]);
});
