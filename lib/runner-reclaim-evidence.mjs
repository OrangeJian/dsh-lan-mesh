/**
 * Host-local evidence adapter for the explicit Runner reclamation service.
 *
 * The reclaim service (lib/runner-resources.mjs) refuses to remove a prepared
 * workspace until a trusted provider separately proves (a) quiescence and
 * (b) retention of the fixed result, bound to executionId, generation, the
 * deterministic resource key and the result hash. This module supplies that
 * provider from an explicit host stop attestation; it is READ-ONLY and never
 * stops, archives, wakes, deletes or dispatches anything.
 *
 * Quiescence requires an explicit stop proof from a host source. The proof is
 * a fixed-shape attestation that names its own source and binds ALL of:
 *   executionId, generation, resource key, result hash, hostInstanceId.
 * The adapter rejects a missing, malformed, unbound or negative attestation.
 * `hostInstanceId` must identify the concrete Host runtime instance that ran
 * the execution (for example a process nonce plus start time), not the durable
 * mesh node id, which survives restarts and is shared by storage slots.
 *
 * The live-agent registry and the workspace archive set are NOT stop proofs:
 *   - an idle or absent agent only observes one point in time;
 *   - archive membership only blocks future agent/pre-step calls and can be
 *     revoked by unarchiving;
 *   - neither observation identifies the execution, its generation or the
 *     resource, and neither proves that spawned child processes have exited.
 * `listLiveAgents` / `listArchivedSessionIds` are accepted only to make a
 * refusal precise (they never produce `stopped: true`). Without an explicit
 * host attestation every request is refused.
 *
 * Fixed result retention is unchanged: the durable TeamStore v1 ledger file
 * is re-read from disk (not the caller's in-memory snapshot) and the retained
 * `workerExecutions[executionId].result` is re-hashed with the same
 * authoritative `resultHash` used by the Team/M6 code. The reference names
 * the exact ledger file and entry so the retention claim can be replayed.
 *
 * Fail-closed gaps this adapter deliberately does NOT paper over:
 *  - The current product has no explicit stop attestation source and no Host
 *    runtime-instance identity. Until an Owner wires a source that can prove
 *    the execution and its descendant processes stopped, every real reclaim
 *    attempt is refused (at construction or at request time).
 *  - No local process identity (PID/start time) is recorded by the current
 *    Runner path, so the adapter cannot independently verify the attestation.
 *  - Only this Host process's observations are used. Another DSH process
 *    sharing the same storage slot is outside this observation.
 *  - The TeamStore writes `team.json` with fsync + atomic rename but does not
 *    fsync the directory after rename; the result is durable against process
 *    crash, not proven against every power-loss/filesystem reorder.
 *  - The product path does not call reclamation for resource-backed workers
 *    (team-coordinator skips them until the isolated Runner is enabled).
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { executionResourceKey } from './runner-resources.mjs';
import { resultHash } from './task-result-context.mjs';const fail = (code, message = code) => {
  throw Object.assign(new Error(message), { code });
};const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const RESOURCE_KEY_RE = /^[a-f0-9]{32}$/;
const RESULT_HASH_RE = /^[a-f0-9]{64}$/;
const REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const BASE_COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const WORKER_KEY_RE = /^([A-Za-z0-9][A-Za-z0-9-]{0,63})\/([^\s/]{1,128})$/;
const HOST_INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_SOURCE = 200;
const MAX_REFERENCE = 400;
// Exactly the attestation fields the adapter binds. Extra keys are refused so
// a caller cannot smuggle a different meaning past the fixed shape.
const PROOF_KEYS = Object.freeze([
  'executionId', 'generation', 'key', 'resultHash', 'hostInstanceId', 'stopped', 'source',
]);

/** Validate the provider's immutable local configuration once. */
function validateConfig({ nodeId, ledgerFile, hostInstanceId, readStopProof, listLiveAgents, listArchivedSessionIds, io }) {
  if (typeof nodeId !== 'string' || nodeId === '' || nodeId.length > 64 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(nodeId)) fail('BAD_CONFIG');
  if (typeof ledgerFile !== 'string' || !isAbsolute(ledgerFile) || ledgerFile.includes('\0')) fail('BAD_CONFIG');
  // A durable mesh node id is not a runtime-instance identity; the caller must
  // supply a concrete per-instance value.
  if (typeof hostInstanceId !== 'string' || !HOST_INSTANCE_RE.test(hostInstanceId)) fail('BAD_CONFIG');
  if (typeof readStopProof !== 'function') fail('BAD_CONFIG');
  if (typeof listLiveAgents !== 'function') fail('BAD_CONFIG');
  if (typeof listArchivedSessionIds !== 'function') fail('BAD_CONFIG');
  if (typeof io?.readFile !== 'function') fail('BAD_CONFIG');
}

/** Validate the service's request identity before touching any source. */
function validateRequest({ executionId, generation, key, resultHash: expected, repoId, baseCommit }) {
  if (typeof executionId !== 'string' || executionId === '') fail('BAD_REQUEST');
  if (!Number.isSafeInteger(generation) || generation < 1) fail('BAD_REQUEST');
  if (typeof key !== 'string' || !RESOURCE_KEY_RE.test(key)) fail('BAD_REQUEST');
  if (typeof expected !== 'string' || !RESULT_HASH_RE.test(expected)) fail('BAD_REQUEST');
  if (typeof repoId !== 'string' || !REPO_ID_RE.test(repoId)) fail('BAD_REQUEST');
  if (typeof baseCommit !== 'string' || !BASE_COMMIT_RE.test(baseCommit)) fail('BAD_REQUEST');
  // The service derives the key from (executionId, generation). A request that
  // carries a different key is an identity swap, not a valid reservation.
  const derived = executionResourceKey(executionId, generation);
  if (key !== derived) fail('RESOURCE_MISMATCH');
  return derived;
}

/**
 * Read the durable Worker ledger from disk and re-derive every identity the
 * evidence will be bound to. Any unreadable or inconsistent byte fails closed;
 * there is no fallback to the caller's in-memory snapshot.
 */
async function readRetainedExecution({ io, ledgerFile, executionId, generation, expectedKey, expectedHash, repoId, baseCommit }) {
  let raw;
  try {
    raw = await io.readFile(ledgerFile, 'utf8');
  } catch {
    fail('RETENTION_UNAVAILABLE');
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    fail('RETENTION_UNAVAILABLE');
  }
  if (!isObject(state) || state.version !== 1 || !isObject(state.workerExecutions)) fail('RETENTION_UNAVAILABLE');
  if (!Object.hasOwn(state.workerExecutions, executionId)) fail('RETENTION_MISSING');
  const entry = state.workerExecutions[executionId];
  if (!isObject(entry)) fail('RETENTION_MISSING');

  const descriptor = entry.descriptor;
  if (!isObject(descriptor) || descriptor.executionId !== executionId ||
      descriptor.generation !== generation) fail('STALE_EXECUTION');

  // A terminal ledger state alone is not retention evidence; the fixed result
  // must still be present in the durable bytes and hash to the requested value.
  if (entry.state !== 'succeeded' && entry.state !== 'failed') fail('NOT_STOPPED');
  if (entry.started !== true) fail('NOT_STOPPED');
  if (!isObject(entry.result)) fail('RESULT_EVIDENCE_MISSING');
  let actual;
  try {
    actual = resultHash(entry.result);
  } catch {
    fail('RESULT_EVIDENCE_MISSING');
  }
  if (entry.result.status !== entry.state) fail('EVIDENCE_BINDING_MISMATCH');
  if (actual !== expectedHash) fail('EVIDENCE_BINDING_MISMATCH');

  const resource = entry.workspaceResource;
  if (!isObject(resource)) fail('RESOURCE_NOT_PREPARED');
  if (resource.reclaim !== undefined) fail('RECLAIM_IN_PROGRESS');
  if (resource.phase !== 'prepared') fail('RESOURCE_NOT_PREPARED');
  if (resource.generation !== generation) fail('STALE_EXECUTION');
  if (resource.key !== expectedKey) fail('RESOURCE_MISMATCH');
  if (resource.repoId !== repoId || resource.baseCommit !== baseCommit) fail('RESOURCE_MISMATCH');

  return { descriptor, result: entry.result };
}

/**
 * Report what the legacy observations saw, only to make a refusal specific.
 * This value NEVER becomes evidence and never implies `stopped`.
 */
async function observeLegacyContext({ descriptor, listLiveAgents, listArchivedSessionIds }) {
  const match = typeof descriptor.workerKey === 'string' ? WORKER_KEY_RE.exec(descriptor.workerKey) : null;
  if (!match) return null;
  const sessionId = match[2];
  let live = 'unknown';
  try {
    const rows = await listLiveAgents();
    if (Array.isArray(rows)) {
      const exact = rows.filter(row => isObject(row) && row.id === sessionId);
      live = exact.length === 0 ? 'absent'
        : exact.length === 1 ? (exact[0].status === 'idle' ? 'idle' : String(exact[0].status ?? 'unknown'))
        : 'ambiguous';
    }
  } catch { /* diagnostics only */ }
  let archived = null;
  try {
    const ids = await listArchivedSessionIds();
    if (Array.isArray(ids)) archived = ids.includes(sessionId);
  } catch { /* diagnostics only */ }
  if (archived === true && (live === 'idle' || live === 'absent')) return `${live}+archived`;
  return null;
}

/**
 * Validate the explicit attestation against the exact execution identity.
 * Returns its self-named source; every mismatch is a refusal.
 */
function acceptStopProof(proof, expected) {
  if (!isObject(proof)) fail('QUIESCENCE_UNPROVEN');
  const keys = Object.keys(proof);
  if (keys.length !== PROOF_KEYS.length || !PROOF_KEYS.every(key => Object.hasOwn(proof, key))) {
    fail('QUIESCENCE_UNPROVEN');
  }
  if (proof.executionId !== expected.executionId ||
      proof.generation !== expected.generation ||
      proof.key !== expected.key ||
      proof.resultHash !== expected.resultHash ||
      proof.hostInstanceId !== expected.hostInstanceId) fail('QUIESCENCE_BINDING_MISMATCH');
  if (proof.stopped !== true) fail('QUIESCENCE_UNPROVEN');
  if (typeof proof.source !== 'string' || !proof.source.trim() || proof.source.length > MAX_SOURCE) fail('QUIESCENCE_UNPROVEN');
  return proof.source;
}

/**
 * Build a trusted local evidence provider for `reclaimExecutionWorkspace`.
 *
 * @param {object} config
 * @param {string} config.nodeId - this Host's node id; the Worker must be local.
 * @param {string} config.ledgerFile - absolute path of the durable TeamStore file.
 * @param {string} config.hostInstanceId - concrete Host runtime instance identity
 *   (not the durable mesh node id). The attestation must echo it exactly.
 * @param {(request: object) => object|Promise<object>} config.readStopProof -
 *   trusted host source of the explicit stop attestation. It must return the
 *   fixed shape {executionId, generation, key, resultHash, hostInstanceId,
 *   stopped:true, source}. There is no default: a missing source refuses.
 * @param {() => Array<{id: string, status: string}>} [config.listLiveAgents] -
 *   diagnostics only; idle/absent can never produce evidence.
 * @param {() => string[]} [config.listArchivedSessionIds] - diagnostics only;
 *   archive is revocable and can never produce evidence.
 * @param {{readFile: Function}} [config.io] - injectable read-only filesystem.
 * @returns {(request: object) => Promise<{quiescence: object, retention: object}>}
 */
export function createHostReclaimEvidenceProvider({
  nodeId,
  ledgerFile,
  hostInstanceId,
  readStopProof,
  listLiveAgents = () => [],
  listArchivedSessionIds = () => [],
  io = { readFile },
} = {}) {
  validateConfig({ nodeId, ledgerFile, hostInstanceId, readStopProof, listLiveAgents, listArchivedSessionIds, io });
  return async function hostReclaimEvidenceProvider(request) {
    if (!isObject(request)) fail('BAD_REQUEST');
    const { executionId, generation, key, resultHash: expectedHash, repoId, baseCommit } = request;
    const expectedKey = validateRequest({ executionId, generation, key, resultHash: expectedHash, repoId, baseCommit });

    const { descriptor } = await readRetainedExecution({
      io, ledgerFile, executionId, generation, expectedKey,
      expectedHash, repoId, baseCommit,
    });

    // Scope check only: a Worker on another node cannot be proven stopped by
    // this Host's runtime-instance attestation.
    const workerMatch = typeof descriptor.workerKey === 'string' ? WORKER_KEY_RE.exec(descriptor.workerKey) : null;
    if (!workerMatch) fail('QUIESCENCE_UNPROVEN');
    if (workerMatch[1] !== nodeId) fail('QUIESCENCE_REMOTE');

    const expected = { executionId, generation, key, resultHash: expectedHash, hostInstanceId };
    let proof;
    try {
      proof = await readStopProof({ ...expected });
    } catch {
      fail('QUIESCENCE_UNAVAILABLE');
    }

    let source;
    try {
      source = acceptStopProof(proof, expected);
    } catch (error) {
      // Enrich, never weaken: the observations explain why a refusal is still
      // correct, but cannot turn it into evidence.
      const observed = await observeLegacyContext({ descriptor, listLiveAgents, listArchivedSessionIds });
      if (observed) error.observed = observed;
      throw error;
    }

    const reference = `${ledgerFile}#workerExecutions/${executionId}/result`;
    if (reference.length > MAX_REFERENCE) fail('RETENTION_REFERENCE_TOO_LONG');
    if (source.length > MAX_SOURCE) fail('QUIESCENCE_UNPROVEN');

    return {
      quiescence: { stopped: true, source },
      retention: {
        retained: true,
        source: 'host:durable-team-ledger',
        reference,
        resultHash: expectedHash,
      },
    };
  };
}
