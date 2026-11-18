/**
 * M6 local transactional plan-ledger service.
 *
 * Draft basis: docs/architecture/m6-integration-sequence.md (ledger batch),
 * docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.4/§4.6/§9.
 *
 * HARD SCOPE: local service layer only. Every write is one `store.transact`
 * that touches ONLY the `plans` bucket. No HTTP, no tools, no real dispatch,
 * no result/FSM transitions, no M6 enablement. It never reads identity or
 * authorization from the request payload: callers pass a `trusted` context
 * resolved by the (here absent) host integration point, and the authoritative
 * leader/generation are read from the Team ledger inside the transaction.
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

/** Validate the host-resolved trusted context. Never sourced from `request`. */
function checkTrusted(trusted) {
  if (!isObject(trusted)) fail('BAD_REQUEST');
  let actorKey;
  try { actorKey = teamMember(trusted.actorKey); } catch { fail('BAD_REQUEST'); }
  if (!Array.isArray(trusted.authorizations)) fail('BAD_REQUEST');
  const authorizations = [];
  for (const key of trusted.authorizations) {
    try { authorizations.push(teamMember(key)); } catch { fail('BAD_REQUEST'); }
  }
  return { actorKey, authorizations };
}

/** Only a currently-authorized actor that is also the authoritative Leader may write plans. */
function checkAuthorized(team, { actorKey, authorizations }) {
  if (!authorizations.includes(actorKey)) fail('FORBIDDEN');
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
 * @param {{store: object, now?: () => number}} options  A single-writer TeamStore
 *   instance (openTeamStore). `now` is injectable for deterministic audit stamps;
 *   it is the only clock and is never used as an ordering authority.
 */
export function createPlanLedgerService({ store, now = Date.now } = {}) {
  if (!store || typeof store.transact !== 'function' || typeof store.read !== 'function') fail('BAD_REQUEST');

  return {
    /** Read-only view of one plan; verifies ledger integrity, never mutates. */
    async readPlan({ roomId, planId } = {}) {
      const r = checkRoomId(roomId);
      const p = checkPlanId(planId);
      const state = store.read();
      const plan = state.plans?.[p];
      if (!plan || plan.roomId !== r) fail('NOT_FOUND');
      verifyPlanRecord(plan);
      return structuredClone(plan);
    },

    /** Read-only list of plans in a room; verifies integrity, never mutates. */
    async listPlans({ roomId } = {}) {
      const r = checkRoomId(roomId);
      const state = store.read();
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
     * a plan draft. Recomputes fingerprint + DAG, fences generation, and clears
     * any prior approval on a bump.
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

      const { fingerprint } = preparePlanContent(request.tasks, roomId);
      const intent = submitIntent({ roomId, planId, expectedRevision, expectedGeneration, fingerprint });

      return store.transact(state => {
        const team = state.teams?.[roomId];
        if (!team) fail('NOT_FOUND');
        checkAuthorized(team, caller);
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
        plan.tasks = structuredClone(request.tasks);
        plan.approval = null; // any content/version change invalidates a prior approval
        plan.updatedAt = stamp;
        if (plan.createdAt === undefined) plan.createdAt = stamp;

        const result = { planId, roomId, generation: plan.generation, revision: plan.revision, fingerprint, approved: false };
        plan.requests[requestId] = { op: 'submit', intent, result: structuredClone(result) };
        state.plans[planId] = plan;
        return { state, value: structuredClone(result) };
      });
    },

    /**
     * Approve one exact plan version. The approval binds planId, roomId,
     * authoritative generation, expectedRevision (must equal current) and the
     * recomputed/stored fingerprint in a single transaction.
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

      return store.transact(state => {
        const team = state.teams?.[roomId];
        if (!team) fail('NOT_FOUND');
        checkAuthorized(team, caller);
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
