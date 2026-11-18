/**
 * M6 pure plan-record helpers for the versioned `plans` bucket.
 *
 * Draft basis: docs/architecture/m6-integration-sequence.md (ledger batch),
 * docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.4/§4.6/§9.
 *
 * HARD SCOPE: pure computation only. No I/O, no clock, no ledger writes, no
 * protocol, no entry point. Does not enable M6 and never dispatches / starts /
 * accepts or touches result state. It reuses the authoritative content
 * fingerprint and DAG validator from the prior pure helpers verbatim.
 *
 * TRUST MODEL: plan content is never trusted. `preparePlanContent` recomputes
 * the fingerprint from real content (a self-declared fingerprint is irrelevant)
 * and re-runs the dependency validator; `verifyPlanRecord` re-derives the
 * fingerprint from stored tasks and re-checks the five-field approval binding
 * so a tampered ledger is detected before any approval is honored.
 */

import { createHash } from 'node:crypto';
import { canonicalTeamJson, teamId, teamMember } from './team-state.mjs';
import { planFingerprint } from './m6-plan-preview.mjs';
import { validatePlanDeps } from './m6-plan-dag.mjs';

function fail(code, message = code, extra = {}) {
  throw Object.assign(new Error(message), { code, ...extra });
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isPositiveInt = value => Number.isSafeInteger(value) && value > 0;
const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

/**
 * Recompute a plan's content fingerprint and structurally validate its DAG.
 * Reuses `planFingerprint` (content SHA-256) and `validatePlanDeps` (acyclicity,
 * same-Team references, bad-dependency checks). No knownTasks are supplied at
 * submit time, so `dispatchable` is empty; only structural validity gates a
 * draft being persisted. Dispatch gating stays a scheduling-time concern.
 *
 * @returns {{fingerprint:string, order:string[], dispatchable:string[]}}
 */
export function preparePlanContent(tasks, roomId) {
  // planFingerprint strictly type-checks known fields and throws INVALID_PLAN.
  const fingerprint = planFingerprint(tasks);
  const dag = validatePlanDeps(tasks, { roomId });
  if (!dag.ok) fail('INVALID_PLAN_GRAPH', 'INVALID_PLAN_GRAPH', { errors: dag.errors });
  return { fingerprint, order: dag.order, dispatchable: dag.dispatchable };
}

/**
 * Canonical intent hash for requestId idempotency. `op` is included so the same
 * requestId cannot be replayed across a submit and an approve. Field order is
 * irrelevant (canonicalTeamJson).
 */
export function requestIntent(op, fields) {
  return createHash('sha256').update(canonicalTeamJson({ op, ...fields })).digest('hex');
}

export function submitIntent({ roomId, planId, expectedRevision, expectedGeneration, fingerprint }) {
  return requestIntent('submit', { roomId, planId, expectedRevision, expectedGeneration, fingerprint });
}

export function approveIntent({ roomId, planId, expectedRevision, expectedGeneration, fingerprint }) {
  return requestIntent('approve', { roomId, planId, expectedRevision, expectedGeneration, fingerprint });
}

/**
 * Build an approval record that atomically binds all five authoritative fields:
 * planId, roomId, generation, revision and fingerprint. Caller identity and
 * timestamp are included for audit but never sourced from the plan itself.
 */
export function buildApproval({ planId, roomId, generation, revision, fingerprint, actorKey, approvedAt, requestId }) {
  teamId(planId);
  teamId(roomId);
  teamMember(actorKey);
  if (!isPositiveInt(generation) || !isPositiveInt(revision) || !isFingerprint(fingerprint)) fail('BAD_REQUEST');
  if (!isNonEmptyString(approvedAt) || !isNonEmptyString(requestId)) fail('BAD_REQUEST');
  return { planId, roomId, generation, revision, fingerprint, actorKey, approvedAt, requestId };
}

/**
 * Fail-closed integrity check of a stored plan record. Re-derives the content
 * fingerprint from the stored tasks (tamper detection) and verifies that an
 * active approval still binds to the exact current plan version.
 */
export function verifyPlanRecord(plan) {
  if (!isObject(plan) || !Array.isArray(plan.tasks)) fail('PLAN_TAMPER');
  let actual;
  try {
    actual = planFingerprint(plan.tasks);
  } catch {
    fail('PLAN_TAMPER');
  }
  if (actual !== plan.fingerprint) fail('PLAN_TAMPER');
  if (plan.approval !== null && plan.approval !== undefined) {
    const a = plan.approval;
    if (!isObject(a)) fail('APPROVAL_BINDING_MISMATCH');
    if (a.planId !== plan.planId || a.roomId !== plan.roomId ||
        a.generation !== plan.generation || a.revision !== plan.revision ||
        a.fingerprint !== plan.fingerprint) {
      fail('APPROVAL_BINDING_MISMATCH');
    }
  }
  return plan;
}
