/**
 * Standalone, PURE result-review decision evaluator (M6 preparation batch).
 *
 * Draft basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.5
 * (accept/reject, Leader-only, generation fence, fixed reviewed execution,
 * reject-with-reason, redo via a new executionId) and the frozen architecture
 * docs/agent-team-v0.2-design.md:41,43,51 (Task FSM, Execution FSM, generation
 * fence: "only the Leader accepts; a Worker success only reaches review" and
 * "rejection must record a reason; redo creates a new executionId").
 *
 * Hard scope limits (by task): local, deterministic computation only. No I/O,
 * no network, no clock, no state mutation. The Team/Task/Execution snapshots
 * are READ-ONLY inputs supplied by a trusted caller. This module does NOT wire
 * into the reducer, store, protocol, tools, coordinator, or any
 * dispatch/start/wake path; it NEVER produces an execution or an executionId;
 * it does not change approval / ACL / identity semantics and does not enable
 * M6. Integration is deferred to the chief reviewer after approval.
 *
 * Trust boundary: the reviewing identity is a SEPARATE trusted-caller input
 * (`input.actorKey`), validated with team-state's teamMember. Any `actorKey`
 * self-reported inside the proposal `intent` is ignored -- it is not identity.
 *
 * Reuse of authoritative helpers (no duplicated algorithm): result hashes are
 * computed with lib/task-result-context.mjs `resultHash`, and ids/members are
 * validated with lib/team-state.mjs `teamId`/`teamMember`. No free-form
 * `checks` are accepted or recorded, so arbitrary caller objects cannot flow
 * into a future ledger; the audit record is a fixed-shape object.
 *
 * PENDING DECISIONS (recorded, not resolved here):
 *  - D8 (OPEN): whether an extra human second confirmation (double-sign) is
 *    required is NOT decided. This module records only the Leader's review
 *    intent; it never gates on, requires, or forbids a second signature.
 *  - D4 (OPEN): generation is read from the trusted snapshot as the current
 *    fence; no bump / recovery semantics are encoded.
 */

import { resultHash } from './task-result-context.mjs';
import { teamId, teamMember } from './team-state.mjs';

// Deferred decisions are surfaced, never resolved by this function.
const PENDING_DECISIONS = [
  'D8: extra human double-sign is OPEN; not gated here (leader intent only).',
  'D4: generation is the current fence from the snapshot; no bump encoded.',
];

const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_REASON = 4000;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isHash = v => typeof v === 'string' && HASH_RE.test(v);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Reuse team-state's authoritative validators instead of local regex copies.
const validId = v => { try { teamId(v); return true; } catch { return false; } };
const validMember = v => { try { teamMember(v); return true; } catch { return false; } };

function denied(codes) {
  const sorted = [...new Set(codes)].sort(compare);
  return {
    ok: false,
    decision: null,
    codes: sorted,
    reason: null,
    record: null,
    producesExecution: false,
    redoRequiresNewExecutionId: false,
    pendingDecisions: [...PENDING_DECISIONS],
  };
}

/**
 * Evaluate a Leader's fixed-reference review intent against authoritative
 * snapshots. Reads only; never mutates inputs and never creates an execution.
 *
 * @param {object} input
 * @param {string} input.actorKey     Identity of the reviewer, supplied by the
 *                                    TRUSTED caller (not from the intent).
 * @param {object} input.team         Authoritative Team snapshot { roomId, leaderKey, generation }.
 * @param {object} input.task         Authoritative Task snapshot { taskId, roomId, status, currentExecutionId }.
 * @param {object|object[]} input.executions  Authoritative Execution snapshot (keyed or array).
 * @param {object} input.intent       Proposal { decision:'accepted'|'rejected', generation,
 *                                    reviewedExecutionId, resultHash, reason? }. A self-reported
 *                                    `actorKey` or `checks` here carries no authority and is ignored.
 * @returns {{ok:boolean, decision:(string|null), codes:string[], reason:(string|null),
 *            record:(object|null), producesExecution:false,
 *            redoRequiresNewExecutionId:boolean, pendingDecisions:string[]}}
 *   `ok` is true only when the current Leader (per trusted actorKey), at the
 *   current generation, decides on the task's current review execution at its
 *   exact fixed hash. `codes` holds every deterministic rejection reason
 *   (empty when ok). `record` is the fixed-shape, timestamp-free audit record;
 *   it carries no new executionId.
 */
export function evaluateResultReview(input) {
  if (!isPlainObject(input)) return denied(['BAD_INPUT']);

  const { actorKey, team, task, executions, intent } = input;
  const codes = [];
  const add = code => { codes.push(code); };

  // Fail closed when any authoritative input is absent.
  if (actorKey === undefined) add('MISSING_ACTOR');
  if (!isPlainObject(team)) add('MISSING_TEAM');
  if (!isPlainObject(task)) add('MISSING_TASK');
  if (!isPlainObject(executions) && !Array.isArray(executions)) add('MISSING_EXECUTIONS');
  if (!isPlainObject(intent)) add('MISSING_INTENT');
  if (codes.length) return denied(codes);

  // --- Snapshot shape checks (authoritative team-state validators) ---
  if (!validMember(actorKey)) add('BAD_ACTOR');
  if (!validId(team.roomId) || !validMember(team.leaderKey)
      || !Number.isSafeInteger(team.generation) || team.generation < 1) add('BAD_TEAM');
  if (!validId(task.taskId) || !validId(task.roomId) || typeof task.status !== 'string') add('BAD_TASK');
  if (validId(team.roomId) && validId(task.roomId) && team.roomId !== task.roomId) add('TASK_TEAM_MISMATCH');

  // Normalize the execution snapshot. In keyed form the entry key is the
  // snapshot's identity: an explicit executionId that disagrees with it is an
  // inconsistent snapshot and is rejected (never silently overridden).
  const keyed = !Array.isArray(executions);
  const entries = keyed ? Object.entries(executions) : executions.map(e => [undefined, e]);
  const execById = new Map();
  let badExecutions = false;
  for (const [key, ex] of entries) {
    if (!isPlainObject(ex)) { badExecutions = true; continue; }
    const explicit = typeof ex.executionId === 'string' ? ex.executionId : undefined;
    if (keyed && explicit !== undefined && explicit !== key) { badExecutions = true; continue; }
    const id = keyed ? (explicit ?? key) : explicit;
    if (id === undefined || !validId(id) || execById.has(id)) { badExecutions = true; continue; }
    execById.set(id, ex);
  }
  if (badExecutions) add('BAD_EXECUTIONS');

  // --- Proposal checks (self-reported identity is deliberately NOT read) ---
  const decision = intent.decision;
  if (decision !== 'accepted' && decision !== 'rejected') add('BAD_DECISION');

  const reviewedId = intent.reviewedExecutionId;
  if (!validId(reviewedId)) add('UNFIXED_EXECUTION_REF');
  if (!isHash(intent.resultHash)) add('UNFIXED_HASH_REF');

  const hasReason = intent.reason !== undefined;
  if (hasReason && (typeof intent.reason !== 'string' || intent.reason.length > MAX_REASON)) add('BAD_REASON');
  if (decision === 'rejected'
      && (!hasReason || typeof intent.reason !== 'string' || intent.reason.trim() === '')) add('MISSING_REASON');

  // --- Authority / generation / current-execution fences ---
  // Only the TRUSTED caller's actorKey is compared to the Team's leaderKey.
  if (validMember(actorKey) && validMember(team.leaderKey) && actorKey !== team.leaderKey) {
    add('NOT_CURRENT_LEADER');
  }
  if (intent.generation !== team.generation) add('STALE_GENERATION');
  if (task.status !== 'review') add('NOT_IN_REVIEW');

  // --- Fixed-reference validation against the authoritative execution ---
  if (validId(reviewedId)) {
    const execution = execById.get(reviewedId);
    if (!execution) {
      add('EXECUTION_NOT_FOUND');
    } else {
      if (execution.taskId !== task.taskId || execution.roomId !== team.roomId) add('EXECUTION_SCOPE_MISMATCH');
      // An old-generation execution is an old result and cannot decide now.
      if (execution.generation !== team.generation) add('STALE_GENERATION');
      // The reviewed execution must be the task's current one, not an old run.
      if (task.currentExecutionId !== reviewedId) add('STALE_RESULT');
      // Only a Worker 'succeeded' result reaches 'review' (frozen arch :41/:43).
      if (execution.state !== 'succeeded') add('RESULT_NOT_REVIEWABLE');
      // Tampering check: pinned hash must equal the authoritative resultHash
      // of the execution's result, computed by task-result-context (no copy).
      if (!isPlainObject(execution.result)) {
        add('RESULT_MISSING');
      } else {
        let computed;
        try { computed = resultHash(execution.result); }
        catch { add('BAD_RESULT'); }
        if (computed !== undefined && isHash(intent.resultHash) && computed !== intent.resultHash) {
          add('RESULT_HASH_MISMATCH');
        }
      }
    }
  }

  const sortedCodes = [...new Set(codes)].sort(compare);
  if (sortedCodes.length) return denied(sortedCodes);

  // Admitted: record the trusted-caller's review intent + deterministic
  // outcome. Fixed shape, no clock, no execution id, no state mutation.
  const reason = decision === 'rejected' ? intent.reason : (intent.reason ?? null);
  const record = {
    roomId: team.roomId,
    taskId: task.taskId,
    leaderKey: team.leaderKey,
    actorKey,
    generation: team.generation,
    reviewedExecutionId: reviewedId,
    resultHash: intent.resultHash,
    decision,
    reason,
    producesExecution: false,
  };

  return {
    ok: true,
    decision,
    codes: [],
    reason,
    record,
    producesExecution: false,
    redoRequiresNewExecutionId: decision === 'rejected',
    pendingDecisions: [...PENDING_DECISIONS],
  };
}
