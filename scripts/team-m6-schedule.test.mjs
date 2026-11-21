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
import { filterWorkerCandidates } from '../lib/m6-worker-candidates.mjs';
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

/**
 * Free the M1 single slot for a v1 execution WITHOUT accepting the task:
 * expire -> uncertain -> human reconcile -> cancelled/ready. Unlike
 * `driveToAccepted`, this keeps the task queueable (attempt 2), so a second
 * dispatch of the SAME taskId actually reaches the spec path instead of being
 * stopped by CAPACITY_FULL / TASK_NOT_QUEUEABLE.
 */
async function releaseSlotForRework(coordinator, taskId, executionId) {
  await coordinator.command({
    type: 'expire', roomId: ROOM, actorKey: LEADER, taskId, executionId,
    generation: 1, now: Date.now() + 1_000_000,
  });
  await coordinator.command({
    type: 'reconcile', roomId: ROOM, actorKey: LEADER, taskId, executionId,
    generation: 1, stopped: true, reason: 'confirmed stopped on host',
  });
}

/**
 * v1 baseline for "same taskId, re-approved v2" regressions:
 *  - plan-a dispatched once, then reconciled back to `ready` (slot free,
 *    re-queueable with a NEW executionId).
 *  - plan-c dispatched and ACCEPTED through the review ledger, so the fixture
 *    carries a real `task.reviews[].decision === 'accepted'` record AND an
 *    accepted dependency that a v2 `dependsOn` change may legally point at.
 *  - both v1 executions are terminal, so no candidate filter CAPACITY_FULL.
 */
async function prepareV1(t) {
  const ctx = await setup(t);
  const firstA = await ctx.schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-a' });
  await releaseSlotForRework(ctx.coordinator, 'plan-a', firstA.executionId);
  const firstC = await ctx.schedule({ expectedRevision: 1, fingerprint: FP, taskId: 'plan-c' });
  await driveToAccepted(ctx.coordinator, ctx.review, 'plan-c', firstC.executionId);
  return { ...ctx, firstA, firstC };
}

/** Submit + approve a NEW plan revision whose content is exactly `tasks`. */
async function approveV2(ctx, tasks, tag) {
  const fingerprint = planFingerprint(tasks);
  const submitted = await ctx.plans.submitPlan({
    requestId: `req-submit-${tag}`, roomId: ROOM, planId: 'plan-1',
    expectedRevision: ctx.submit.revision, expectedGeneration: 1, tasks,
  }, { actorKey: LEADER });
  await ctx.plans.approvePlan({
    requestId: `req-approve-${tag}`, roomId: ROOM, planId: 'plan-1',
    expectedRevision: submitted.revision, expectedGeneration: 1, fingerprint,
  }, { actorKey: LEADER });
  return { revision: submitted.revision, fingerprint };
}

const V2_CHANGES = [
  { name: 'title', change: { title: 'Plan A v2 (re-approved)' } },
  { name: 'detail', change: { detail: 'a-v2 rewritten detail' } },
  { name: 'dependsOn', change: { dependsOn: ['plan-c'] } },
];

test('regression A: a re-approved v2 spec must not dispatch the v1 task spec for the same taskId', async t => {
  for (const { name, change } of V2_CHANGES) {
    await t.test(`regression A / v2 changes ${name}`, async sub => {
      const ctx = await prepareV1(sub);
      const { store, schedule, sent, firstA, firstC } = ctx;
      const v2Tasks = structuredClone(PLAN_TASKS);
      const v2Spec = { ...PLAN_TASKS[0], ...change };
      Object.assign(v2Tasks.find(task => task.taskId === 'plan-a'), change);
      const approved = await approveV2(ctx, v2Tasks, `v2-${name}`);
      assert.equal(approved.revision, 2, 'v2 必须是重新提交并重新批准的新版本');

      const before = store.read();
      const sentBefore = sent.length;
      // PROOF the assertions hit the SPEC, not M1 capacity: both v1 executions
      // are terminal and the candidate filter still recommends WORKER.
      assert.equal(before.executions[firstA.executionId].state, 'cancelled');
      assert.equal(before.executions[firstC.executionId].state, 'succeeded');
      const filter = filterWorkerCandidates({
        ...deriveCandidateAuthority(authorityConfig()),
        executions: before.executions,
        task: { requiredCapabilities: ['build'] },
      });
      assert.deepEqual(filter.recommended, [WORKER], 'M1 单槽已释放：WORKER 仍在推荐候选内');

      const outcome = await schedule({
        expectedRevision: approved.revision, fingerprint: approved.fingerprint, taskId: 'plan-a',
      }).then(body => ({ dispatched: body }), error => ({ rejected: { code: error.code } }));

      // FUTURE GUARD for acceptance path 1 ("dispatch the approved v2 spec").
      // Path 1 is NOT implemented in this batch. This `if` branch does not run
      // under the current fix: the unconditional refusal assertion below
      // (`assert.deepEqual(outcome, { rejected: ... })`) rejects ANY dispatch
      // result, even if all five guards here would pass. (On the unfixed code
      // these are the assertions that fail and prove the stale v1 spec was
      // dispatched.) If a later batch adopts path 1, this test MUST be
      // rewritten -- especially that unconditional assertion -- or it will
      // report a false regression. This batch implements path 2 only.
      if (outcome.dispatched) {
        const body = outcome.dispatched;
        assert.equal(body.title, v2Spec.title, '派单 body 标题必须绑定 v2 已批准规格');
        assert.equal(body.detail, v2Spec.detail, '派单 body 详情必须绑定 v2 已批准规格');
        assert.deepEqual(body.dependsOn, v2Spec.dependsOn, '派单 body 依赖必须绑定 v2 已批准规格');
        assert.deepEqual(store.read().executions[body.executionId].descriptor, body, 'descriptor 必须使用 v2 规格');
        assert.deepEqual(dispatchOf(sent, body.executionId), body, '实际派出的 body 必须使用 v2 规格');
      }

      // ACCEPTANCE PATH 2 -- the ONLY path implemented in this batch: when a
      // reused taskId's existing spec conflicts with the approved revision,
      // refuse BEFORE enqueue with TASK_SPEC_CONFLICT and zero new executions
      // or outbox entries. The assertion below unconditionally locks this
      // refusal branch: this test does NOT also accept path 1.
      assert.deepEqual(outcome, { rejected: { code: 'TASK_SPEC_CONFLICT' } }, '必须在入队前以明确冲突码拒绝旧规格派发');
      const after = store.read();
      assert.deepEqual(Object.keys(after.executions), Object.keys(before.executions), '拒绝后 executions 键集合不得新增');
      assert.deepEqual(after.executions, before.executions, '拒绝后 executions 内容不得变化');
      assert.deepEqual(Object.keys(after.outbox), Object.keys(before.outbox), '拒绝后 outbox 键集合不得新增');
      assert.deepEqual(after.outbox, before.outbox, '拒绝后 outbox 内容不得变化');
      assert.equal(sent.length, sentBefore, '拒绝后不得向 Worker 发出任何新派单');
      await ctx.coordinator.close();
    });
  }
});

test('regression B: v1 executions, descriptors and the accepted review stay intact across a v2 refusal and rework', async t => {
  const ctx = await prepareV1(t);
  const { store, schedule, coordinator, firstA, firstC } = ctx;

  const before = store.read();
  const v1Executions = structuredClone(before.executions);
  const v1Outbox = structuredClone(before.outbox);
  const v1TaskA = structuredClone(before.tasks['plan-a']);
  const v1TaskC = structuredClone(before.tasks['plan-c']);
  const v1Reviews = structuredClone(before.tasks['plan-c'].reviews);
  assert.equal(v1Reviews.length, 1, '夹具必须真的产生一条评审记录');
  assert.equal(v1Reviews[0].decision, 'accepted', '评审记录必须是 accepted');
  assert.equal(v1Reviews[0].reviewedExecutionId, firstC.executionId, '评审必须绑定 v1 的那次执行');
  assert.equal(before.executions[firstA.executionId].descriptor.title, 'Plan A', 'v1 descriptor 必须在');
  assert.equal(before.executions[firstC.executionId].descriptor.title, 'Plan C', 'v1 descriptor 必须在');

  // v2 changes title + detail + dependsOn at once, and is re-approved.
  const v2Tasks = structuredClone(PLAN_TASKS);
  Object.assign(v2Tasks.find(task => task.taskId === 'plan-a'), {
    title: 'Plan A v2 (re-approved)', detail: 'a-v2 rewritten detail', dependsOn: ['plan-c'],
  });
  const approved = await approveV2(ctx, v2Tasks, 'v2-regression-b');
  await assert.rejects(schedule({
    expectedRevision: approved.revision, fingerprint: approved.fingerprint, taskId: 'plan-a',
  }), { code: 'TASK_SPEC_CONFLICT' });

  const afterRefusal = store.read();
  assert.deepEqual(afterRefusal.executions, v1Executions, '拒绝后 v1 执行记录（含 descriptor）不得被覆盖/删除/改写');
  assert.deepEqual(afterRefusal.outbox, v1Outbox, '拒绝后 outbox 不得新增');
  assert.deepEqual(afterRefusal.tasks['plan-a'], v1TaskA, '拒绝后 plan-a 仍是 v1 规格');
  assert.deepEqual(afterRefusal.tasks['plan-c'], v1TaskC, '拒绝后 plan-c 任务记录不得改写');
  assert.deepEqual(afterRefusal.tasks['plan-c'].reviews, v1Reviews, '拒绝后 accepted 评审记录不得被覆盖/删除/改写');

  // Rework after the refusal: re-submit + re-approve a version whose spec
  // MATCHES the existing task (revision 3). The unchanged reducer must still
  // accept it with a NEW executionId, leaving all v1 evidence traceable.
  const v3Tasks = structuredClone(PLAN_TASKS);
  const v3Fingerprint = planFingerprint(v3Tasks);
  const v3 = await ctx.plans.submitPlan({
    requestId: 'req-submit-v3-rework', roomId: ROOM, planId: 'plan-1',
    expectedRevision: approved.revision, expectedGeneration: 1, tasks: v3Tasks,
  }, { actorKey: LEADER });
  await ctx.plans.approvePlan({
    requestId: 'req-approve-v3-rework', roomId: ROOM, planId: 'plan-1',
    expectedRevision: v3.revision, expectedGeneration: 1, fingerprint: v3Fingerprint,
  }, { actorKey: LEADER });
  const rework = await schedule({
    expectedRevision: v3.revision, fingerprint: v3Fingerprint, taskId: 'plan-a',
  });
  assert.notEqual(rework.executionId, firstA.executionId, '重做必须使用全新 executionId');
  assert.equal(rework.title, 'Plan A', '重做派单绑定与既有 task 一致的批准规格');
  const final = store.read();
  assert.equal(final.executions[rework.executionId].attempt, 2, '重做沿用既有 reducer 的 attempt 递增');
  assert.deepEqual(final.executions[firstA.executionId], v1Executions[firstA.executionId], '重做后 v1 执行记录仍完整');
  assert.deepEqual(final.executions[firstC.executionId], v1Executions[firstC.executionId], '重做后评审所绑定的 v1 执行仍完整');
  assert.deepEqual(final.tasks['plan-c'].reviews, v1Reviews, '重做后 accepted 评审记录仍完整');
  await coordinator.close();
});
