/**
 * M6 local transactional plan-ledger service.
 *
 * Draft basis: docs/architecture/m6-integration-sequence.md (ledger batch),
 * docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.4/§4.6/§9.
 *
 * HARD SCOPE: local service layer only. Every write is one `store.transact`
 * that touches ONLY the `plans` bucket. No HTTP, no tools, no real dispatch,
 * no result/FSM transitions, no M6 enablement.
 *
 * TRUST MODEL:
 *  - Caller identity is resolved by the host and passed in `trusted.actorKey`
 *    (never derived from the request body).
 *  - Authorization is NOT decided from that caller-supplied snapshot. A trusted
 *    host delegate (`authorize({ roomId, operation, actorKey, generation })`)
 *    is consulted for the CURRENT Room/operation authorization. Writes call it
 *    INSIDE the transaction, so a revoked actor whose snapshot was captured
 *    before the write queued is still rejected at commit time. A missing
 *    delegate fails closed. The authoritative leader/generation come from the
 *    Team ledger, never from the request.
 *
 * TOCTOU: submit captures ONE deep snapshot of `request.tasks` synchronously at
 * call time, validates that snapshot (fingerprint + DAG) and persists only that
 * same snapshot. A caller mutating `request.tasks` while the write is queued
 * cannot change what the fingerprint binds or what is stored.
 *
 * INTERNAL READS: `readPlan`/`listPlans` are for internal composition (preview,
 * scheduling) and are NOT transport entry points. They enforce the same trusted
 * delegate authorization so an accidental exposure cannot leak plan data; any
 * host entry point must additionally resolve identity before calling them.
 *
 * CONCURRENCY CONTRACT:
 *  - `requestId`: per-plan idempotency ledger. Replaying the same requestId
 *    with the same intent returns the recorded result; reusing it with changed
 *    intent is REQUEST_CONFLICT. The request ledger survives plan revisions.
 *  - `expectedRevision`: optimistic version fence. Submit 0 creates a plan;
 *    any other value must equal the current revision. A revision bump clears
 *    the prior approval (modifying a plan invalidates old approvals).
 *  - `expectedGeneration`: fence against the authoritative Team generation;
 *    plans and approvals bind to that generation, never to a caller claim.
 */

import { teamId, teamMember } from './team-state.mjs';
import {
  preparePlanContent,
  submitIntent,
  approveIntent,
  buildApproval,
  verifyPlanRecord,
} from './m6-plan-ledger.mjs';

function fail(code, message = code) {
  throw Object.assign(new Error(message), { code });
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInt = value => Number.isSafeInteger(value) && value > 0;
const isNonNegativeInt = value => Number.isSafeInteger(value) && value >= 0;
const isFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function checkRoomId(value) {
  try { return teamId(value); } catch { fail('BAD_REQUEST'); }
}
function checkPlanId(value) {
  try { return teamId(value); } catch { fail('BAD_REQUEST'); }
}
function checkRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) fail('BAD_REQUEST');
  return value;
}

/** Validate the host-resolved caller identity. Authorization is NOT read from here. */
function checkTrusted(trusted) {
  if (!isObject(trusted)) fail('BAD_REQUEST');
  let actorKey;
  try { actorKey = teamMember(trusted.actorKey); } catch { fail('BAD_REQUEST'); }
  return { actorKey };
}

/**
 * Consult the trusted host delegate for the current Room/operation authorization.
 * Fail closed: a missing delegate or a delegate error/denial rejects the call.
 * Called inside the transaction for writes so revocation is observed at commit.
 */
async function authorizeOrThrow(authorize, context) {
  if (typeof authorize !== 'function') fail('AUTHORIZATION_UNAVAILABLE');
  let decision;
  try {
    decision = await authorize(context);
  } catch {
    fail('FORBIDDEN');
  }
  const allowed = decision === true || (isObject(decision) && decision.allowed === true);
  if (!allowed) fail('FORBIDDEN');
}

/** Defense in depth: the authoritative leader fence from the ledger. */
function checkLeader(team, actorKey) {
  if (actorKey !== team.leaderKey) fail('FORBIDDEN');
}

function findRequest(state, requestId) {
  const plans = state.plans ?? {};
  for (const plan of Object.values(plans)) {
    const record = plan?.requests?.[requestId];
    if (record) return { plan, record };
  }
  return null;
}

function replay(record, intent) {
  if (record.intent !== intent) fail('REQUEST_CONFLICT');
  return structuredClone(record.result);
}

/**
 * @param {{store: object, authorize?: Function, now?: () => number}} options
 *   `store`: single-writer TeamStore (openTeamStore). `authorize`: trusted host
 *   delegate returning the CURRENT Room/operation authorization; required for
 *   every write and read (missing -> fail closed). `now`: injectable audit clock.
 */
export function createPlanLedgerService({ store, authorize, now = Date.now } = {}) {
  if (!store || typeof store.transact !== 'function' || typeof store.read !== 'function') fail('BAD_REQUEST');

  return {
    /** INTERNAL: read one plan; enforces the trusted authorization boundary. */
    async readPlan({ roomId, planId } = {}, trusted) {
      const r = checkRoomId(roomId);
      const p = checkPlanId(planId);
      const { actorKey } = checkTrusted(trusted);
      const state = store.read();
      const team = state.teams?.[r];
      await authorizeOrThrow(authorize, { roomId: r, operation: 'read', actorKey, generation: team?.generation });
      const plan = state.plans?.[p];
      if (!plan || plan.roomId !== r) fail('NOT_FOUND');
      verifyPlanRecord(plan);
      return structuredClone(plan);
    },

    /** INTERNAL: list plans in a room; enforces the trusted authorization boundary. */
    async listPlans({ roomId } = {}, trusted) {
      const r = checkRoomId(roomId);
      const { actorKey } = checkTrusted(trusted);
      const state = store.read();
      const team = state.teams?.[r];
      await authorizeOrThrow(authorize, { roomId: r, operation: 'read', actorKey, generation: team?.generation });
      const result = [];
      for (const plan of Object.values(state.plans ?? {})) {
        if (plan?.roomId !== r) continue;
        verifyPlanRecord(plan);
        result.push(structuredClone(plan));
      }
      return result;
    },

    /**
     * Create (expectedRevision 0) or version-bump (expectedRevision = current)
     * a plan draft. Captures one task snapshot before queueing, and fences
     * authorization + generation inside the transaction.
     */
    async submitPlan(request, trusted) {
      if (!isObject(request)) fail('BAD_REQUEST');
      const requestId = checkRequestId(request.requestId);
      const roomId = checkRoomId(request.roomId);
      const planId = checkPlanId(request.planId);
      const expectedRevision = request.expectedRevision;
      if (!isNonNegativeInt(expectedRevision)) fail('BAD_REQUEST');
      const expectedGeneration = request.expectedGeneration;
      if (!isPositiveInt(expectedGeneration)) fail('BAD_REQUEST');
      if (!Array.isArray(request.tasks)) fail('BAD_REQUEST');
      const caller = checkTrusted(trusted);

      // Capture and validate ONE snapshot synchronously, before the transaction
      // is queued. Only this snapshot is fingerprinted and persisted.
      const tasks = structuredClone(request.tasks);
      const { fingerprint } = preparePlanContent(tasks, roomId);
      const intent = submitIntent({ roomId, planId, expectedRevision, expectedGeneration, fingerprint });

      return store.transact(async state => {
        const team = state.teams?.[roomId];
        if (!team) fail('NOT_FOUND');
        await authorizeOrThrow(authorize, { roomId, operation: 'submit', actorKey: caller.actorKey, generation: team.generation });
        checkLeader(team, caller.actorKey);
        if (team.generation !== expectedGeneration) fail('STALE_GENERATION');

        const prior = findRequest(state, requestId);
        if (prior) return { state, value: replay(prior.record, intent) };

        let plan = state.plans?.[planId];
        if (plan) {
          verifyPlanRecord(plan);
          if (plan.roomId !== roomId) fail('PLAN_ID_CONFLICT');
          if (plan.generation !== team.generation) fail('STALE_GENERATION');
          if (plan.revision !== expectedRevision) fail('REVISION_CONFLICT');
          plan = structuredClone(plan);
        } else {
          if (expectedRevision !== 0) fail('REVISION_CONFLICT');
          plan = {
            planId, roomId, generation: team.generation, revision: 0,
            fingerprint: '', tasks: [], approval: null, requests: {},
          };
        }

        const stamp = new Date(now()).toISOString();
        plan.revision = (plan.revision ?? 0) + 1;
        plan.generation = team.generation;
        plan.fingerprint = fingerprint;
        plan.tasks = structuredClone(tasks); // the exact fingerprinted snapshot
        plan.approval = null; // any content/version change invalidates a prior approval
        plan.updatedAt = stamp;
        if (plan.createdAt === undefined) plan.createdAt = stamp;
        verifyPlanRecord(plan); // persisted content must still bind to the fingerprint

        const result = { planId, roomId, generation: plan.generation, revision: plan.revision, fingerprint, approved: false };
        plan.requests[requestId] = { op: 'submit', intent, result: structuredClone(result) };
        state.plans[planId] = plan;
        return { state, value: structuredClone(result) };
      });
    },

    /**
     * Approve one exact plan version. Authorization, the leader fence and the
     * generation fence are all re-evaluated inside the transaction; the
     * approval binds planId/roomId/generation/revision/fingerprint atomically.
     */
    async approvePlan(request, trusted) {
      if (!isObject(request)) fail('BAD_REQUEST');
      const requestId = checkRequestId(request.requestId);
      const roomId = checkRoomId(request.roomId);
      const planId = checkPlanId(request.planId);
      const expectedRevision = request.expectedRevision;
      if (!isPositiveInt(expectedRevision)) fail('BAD_REQUEST');
      const expectedGeneration = request.expectedGeneration;
      if (!isPositiveInt(expectedGeneration)) fail('BAD_REQUEST');
      const fingerprint = request.fingerprint;
      if (!isFingerprint(fingerprint)) fail('BAD_REQUEST');
      const caller = checkTrusted(trusted);

      const intent = approveIntent({ roomId, planId, expectedRevision, expectedGeneration, fingerprint });

      return store.transact(async state => {
        const team = state.teams?.[roomId];
        if (!team) fail('NOT_FOUND');
        await authorizeOrThrow(authorize, { roomId, operation: 'approve', actorKey: caller.actorKey, generation: team.generation });
        checkLeader(team, caller.actorKey);
        if (team.generation !== expectedGeneration) fail('STALE_GENERATION');

        const prior = findRequest(state, requestId);
        if (prior) return { state, value: replay(prior.record, intent) };

        const plan = state.plans?.[planId];
        if (!plan || plan.roomId !== roomId) fail('NOT_FOUND');
        verifyPlanRecord(plan);
        if (plan.generation !== team.generation) fail('STALE_GENERATION');
        if (plan.revision !== expectedRevision || plan.fingerprint !== fingerprint) fail('APPROVAL_BINDING_MISMATCH');

        const approval = buildApproval({
          planId, roomId, generation: team.generation, revision: plan.revision,
          fingerprint: plan.fingerprint, actorKey: caller.actorKey,
          approvedAt: new Date(now()).toISOString(), requestId,
        });
        plan.approval = approval;
        const result = structuredClone(approval);
        plan.requests[requestId] = { op: 'approve', intent, result: structuredClone(result) };
        state.plans[planId] = plan;
        return { state, value: result };
      });
    },
  };
}
