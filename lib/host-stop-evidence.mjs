/**
 * REAL Host runtime-instance identity + stop-evidence source (R2).
 *
 * Draft basis: docs/architecture/codebuddy-handoff.md (R2 宿主停止证明) and
 * lib/runner-reclaim-evidence.mjs, which refuses every reclaim until a
 * trusted source proves the execution AND its descendant processes stopped,
 * bound to executionId, generation, resource key and result hash.
 *
 * What this module can prove TODAY, from the host's own lifecycle facts:
 *  - `hostInstanceId`: a concrete per-process runtime identity (start time +
 *    process nonce). It is NOT the durable mesh node id, which survives
 *    restarts and is shared by storage slots.
 *  - The host instance that WOKE the execution records a durable-per-process
 *    start binding {executionId, generation, sessionId} at wake time and a
 *    completion record when the wake followup for that execution RESOLVED.
 *    This is a host-observed lifecycle fact about the execution, not an
 *    idle/absent/archived point-in-time observation (those stay diagnostics
 *    only, per lib/runner-reclaim-evidence.mjs).
 *
 * What this module deliberately does NOT pretend to prove:
 *  - Descendant (child) process exit. The product path cannot observe the
 *    agent's tool subprocesses, so `confirmDescendantsStopped` MUST be
 *    supplied by an Owner-provided backend (e.g. an OS process audit).
 *    Without it every stop proof is refused (`DESCENDANTS_UNPROVEN`) and the
 *    reclaim adapter keeps failing closed. `listLiveAgents` is accepted for
 *    the adapter's diagnostics only and can never produce `stopped: true`.
 *  - Proof across a Host process restart. Bindings live in this process only;
 *    after a restart the instance id changes and old bindings are gone, so
 *    old executions can no longer be attested by this instance (fail closed).
 *
 * All identity fields echoed by `readStopProof` are re-checked by the reclaim
 * adapter's `acceptStopProof` against the request; nothing here widens it.
 */

import { randomUUID } from 'node:crypto';

const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * A concrete Host runtime-instance identity for THIS process. Deterministic
 * shape so the reclaim adapter's `HOST_INSTANCE_RE` accepts it.
 *
 * @param {{now?: () => number, nonce?: () => string}} [options]
 * @returns {{id: string, startedAt: string}}
 */
export function createHostRuntimeInstance({ now = Date.now, nonce = randomUUID } = {}) {
  const stamp = Number.isFinite(now()) ? Math.floor(now()) : fail('BAD_CONFIG');
  const id = `${stamp}:${nonce()}`;
  if (!INSTANCE_ID_RE.test(id)) fail('BAD_CONFIG');
  return { id, startedAt: new Date(stamp).toISOString() };
}

/**
 * Build the trusted host stop-proof source consumed by
 * `createHostReclaimEvidenceProvider` (its `readStopProof` slot).
 *
 * @param {object} config
 * @param {{id: string, startedAt: string}} config.instance - THIS process's
 *   runtime instance identity (createHostRuntimeInstance).
 * @param {(request: {executionId: string, generation: number, key: string,
 *   resultHash: string, hostInstanceId: string, sessionId: string,
 *   startedAt: string}) => boolean|Promise<boolean>} [config.confirmDescendantsStopped]
 *   - Owner-provided backend that proves the execution's descendant processes
 *     exited. REQUIRED for any proof; a truthy return is recorded as part of
 *     the source string. Missing/falsy/refusing -> refused, fail closed.
 * @param {() => Array<{id: string, status: string}>} [config.listLiveAgents]
 *   - diagnostics only, forwarded context for refusal precision; NEVER part
 *     of the proof.
 * @returns {{
 *   instance: {id: string, startedAt: string},
 *   recordStart: (binding: {executionId: string, generation: number, sessionId: string}) => void,
 *   recordEnd: (end: {executionId: string}) => void,
 *   readStopProof: (request: object) => Promise<object>,
 * }}
 */
export function createHostStopProofSource({
  instance,
  confirmDescendantsStopped,
  listLiveAgents = () => [],
} = {}) {
  if (!isObject(instance) || typeof instance.id !== 'string' || !INSTANCE_ID_RE.test(instance.id)) fail('BAD_CONFIG');
  // Fail closed by design: the descendant-process backend may be absent at
  // wiring time (the product wires this source unconditionally), in which
  // case EVERY proof request is refused `DESCENDANTS_UNPROVEN` below and the
  // reclaim adapter keeps failing closed (handoff R2).
  if (listLiveAgents !== undefined && typeof listLiveAgents !== 'function') fail('BAD_CONFIG');

  /** executionId -> { executionId, generation, sessionId, hostInstanceId, startedAt, endedAt? } */
  const bindings = new Map();

  return {
    instance,

    /**
     * The host instance started working on this execution (wake time).
     * A later start for the same executionId overwrites the binding: only the
     * LATEST lifecycle is attestable, and an execution started on an earlier
     * binding generation is refused below.
     */
    recordStart({ executionId, generation, sessionId }) {
      if (typeof executionId !== 'string' || executionId === '') fail('BAD_REQUEST');
      if (!Number.isSafeInteger(generation) || generation < 1) fail('BAD_REQUEST');
      if (typeof sessionId !== 'string' || sessionId === '') fail('BAD_REQUEST');
      bindings.set(executionId, {
        executionId, generation, sessionId,
        hostInstanceId: instance.id,
        startedAt: new Date().toISOString(),
      });
    },

    /**
     * The wake followup for this execution resolved (completed, failed or was
     * refused by the host). A binding without an end never proves a stop.
     */
    recordEnd({ executionId }) {
      const binding = bindings.get(executionId);
      if (!binding || binding.endedAt !== undefined) return;
      binding.endedAt = new Date().toISOString();
    },

    /**
     * The reclaim adapter's stop-proof slot. Returns the fixed attestation
     * shape only when EVERY binding fact holds; otherwise it throws (the
     * adapter turns that into a precise fail-closed refusal).
     */
    async readStopProof({ executionId, generation, key, resultHash, hostInstanceId }) {
      const binding = bindings.get(executionId);
      if (!binding) fail('NOT_STARTED_ON_THIS_HOST');
      if (binding.generation !== generation) fail('STALE_EXECUTION');
      if (hostInstanceId !== instance.id) fail('INSTANCE_MISMATCH');
      if (binding.hostInstanceId !== instance.id) fail('INSTANCE_MISMATCH');
      if (binding.endedAt === undefined) fail('SESSION_LIVE');
      if (!binding.endedAt) fail('SESSION_LIVE');

      let confirmed;
      if (typeof confirmDescendantsStopped !== 'function') fail('DESCENDANTS_UNPROVEN');
      try {
        confirmed = await confirmDescendantsStopped({
          executionId, generation, key, resultHash,
          hostInstanceId: instance.id,
          sessionId: binding.sessionId,
          startedAt: binding.startedAt,
          endedAt: binding.endedAt,
          liveAgents: listLiveAgents(),
        });
      } catch (error) {
        fail('DESCENDANTS_UNPROVEN', `DESCENDANTS_UNPROVEN: ${String(error?.message ?? error)}`);
      }
      if (confirmed !== true) fail('DESCENDANTS_UNPROVEN');

      return {
        executionId, generation, key, resultHash,
        hostInstanceId: instance.id,
        stopped: true,
        // Bounded length: keeps the adapter's MAX_SOURCE (200) guarantee for
        // any conforming instance id.
        source: `host:agent-lifecycle:${instance.id}`,
      };
    },
  };
}
