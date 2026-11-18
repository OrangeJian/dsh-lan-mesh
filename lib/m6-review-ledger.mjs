/**
 * M6 result-review LEDGER integration (baseline 9f41030).
 *
 * Reuses the PURE evaluator `evaluateResultReview` (lib/m6-result-review.mjs)
 * inside the EXISTING TeamStore transaction: every authoritative input is
 * re-read from the current `state` and re-validated before the decision and the
 * task status are atomically persisted. No separate approval cache is trusted.
 *
 * Hard scope limits (by task): NO HTTP wiring, NO real dispatch, NO external
 * processes, and NO change to M1 permissions. `authorize` and `getRoom` are
 * injected by the trusted host and are re-run (not weakened) inside the
 * transaction; they are ordinary callbacks, not network calls made here.
 * The plans bucket belongs to the planning group and is never touched.
 *
 * Audit is stored on the task itself (`task.reviews`, a fixed-shape array),
 * using existing task storage rather than a new store bucket. Rejection keeps
 * the original fixed execution/result; rework must queue a NEW executionId
 * through the unchanged reducer rules.
 *
 * requestId semantics: a replay of an already-applied request returns its
 * stored decision unchanged; the SAME requestId with changed content is a
 * CONFLICT; both survive a store restart because the record is persisted.
 */

import { createHash } from 'node:crypto';
import { evaluateResultReview } from './m6-result-review.mjs';
import { canonicalTeamJson, teamId } from './team-state.mjs';

function fail(code, extra = {}) {
  throw Object.assign(new Error(code), { code, ...extra });
}

const nodeOf = key => String(key).split('/')[0];
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deterministic fingerprint of exactly the content that determines a decision. */
function requestFingerprint({ requestId, roomId, taskId, actorKey, intent }) {
  const material = {
    requestId,
    roomId,
    taskId,
    actorKey,
    decision: intent.decision,
    generation: intent.generation,
    reviewedExecutionId: intent.reviewedExecutionId,
    resultHash: intent.resultHash,
    reason: intent.reason ?? null,
  };
  return createHash('sha256').update(canonicalTeamJson(material)).digest('hex');
}

/**
 * Commit a decision from the PURE evaluator's already-validated record only.
 * There is no generic reducer command for review: the record's execution id,
 * result hash, scope, generation and state were all checked by
 * evaluateResultReview against the current state in the same transaction, so
 * no caller-supplied raw reference can reach the ledger. Private to this
 * module; the evaluated record is the sole input to the state change.
 */
function commitReview(state, task, record, requestId, fingerprint) {
  const stored = {
    requestId,
    fingerprint,
    roomId: record.roomId,
    taskId: record.taskId,
    leaderKey: record.leaderKey,
    actorKey: record.actorKey,
    generation: record.generation,
    reviewedExecutionId: record.reviewedExecutionId,
    resultHash: record.resultHash,
    decision: record.decision,
    reason: record.reason,
    producesExecution: false,
  };
  task.reviews = [...(task.reviews ?? []), stored];
  task.status = stored.decision === 'accepted' ? 'accepted' : 'ready';
  task.revision++;
  return stored;
}

/**
 * @param {object} config
 * @param {object} config.store       openTeamStore instance (read + transact).
 * @param {string} config.nodeId       local node id; review is Leader-local only.
 * @param {function} config.getRoom    (roomId) => authoritative room/ACL view.
 * @param {function} config.authorize  ({ body, operation }) => boolean|Promise<boolean>,
 *                                     the unchanged M1 authorization gate.
 * @returns {{ review: (input: object) => Promise<object> }}
 */
export function createResultReviewLedger({ store, nodeId, getRoom, authorize }) {
  if (!store || typeof store.transact !== 'function' || typeof store.read !== 'function') fail('BAD_CONFIG');
  if (typeof nodeId !== 'string' || !nodeId) fail('BAD_CONFIG');
  if (typeof getRoom !== 'function' || typeof authorize !== 'function') fail('BAD_CONFIG');

  return {
    async review(input) {
      if (!isPlainObject(input)) fail('BAD_REQUEST');
      const { requestId, actorKey, roomId, taskId, intent } = input;
      if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) fail('BAD_REQUEST');
      if (typeof actorKey !== 'string' || !actorKey.trim()) fail('BAD_REQUEST');
      if (!isPlainObject(intent)) fail('BAD_REQUEST');
      teamId(roomId);
      teamId(taskId);
      const fingerprint = requestFingerprint({ requestId, roomId, taskId, actorKey, intent });

      // transact() commits the returned state and resolves to the value only.
      const applied = await store.transact(async state => {
        const team = state.teams[roomId];
        if (!team) fail('NOT_FOUND');
        const task = state.tasks[taskId];
        if (!task || task.roomId !== roomId) fail('NOT_FOUND');

        // --- Trusted, LOCAL Leader identity, re-derived from current state ---
        if (actorKey !== team.leaderKey) fail('FORBIDDEN');
        if (!team.leaderKey.startsWith(`${nodeId}/`) || nodeOf(actorKey) !== nodeId) fail('NOT_LOCAL_LEADER');

        // --- Current ACL / room membership re-checked at transaction time ---
        const room = getRoom(roomId);
        if (!room || room.deleted || room.leader?.key !== team.leaderKey) fail('ROOM_CHANGED');
        const allowed = await authorize({ body: { roomId, actorKey, leaderKey: team.leaderKey }, operation: 'review' });
        if (allowed !== true) fail('FORBIDDEN');

        // --- Replay must still bind to the CURRENT generation ---
        // A replay skips the evaluator (the task is no longer in review), so
        // the generation fence has to be enforced here explicitly.
        if (intent.generation !== team.generation) fail('STALE_GENERATION', { codes: ['STALE_GENERATION'] });

        // --- Idempotency before the status fence (a replay is no longer in review) ---
        const prior = (task.reviews ?? []).find(r => r.requestId === requestId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) fail('CONFLICT');
          return { state, value: { record: prior, replayed: true } };
        }

        // --- Re-run the pure evaluator against the CURRENT snapshots ---
        const outcome = evaluateResultReview({ actorKey, team, task, executions: state.executions, intent });
        if (!outcome.ok) fail(outcome.codes[0], { codes: outcome.codes });

        // --- Commit ONLY the evaluator's validated record to state ---
        const stored = commitReview(state, task, outcome.record, requestId, fingerprint);
        return { state, value: { record: stored, replayed: false } };
      });

      return {
        ok: true,
        decision: applied.record.decision,
        reason: applied.record.reason,
        replayed: applied.replayed,
        record: applied.record,
        requestId,
        codes: [],
      };
    },
  };
}
