/**
 * Host-local evidence adapter for the explicit Runner reclamation service.
 *
 * The reclaim service (lib/runner-resources.mjs) refuses to remove a prepared
 * workspace until a trusted provider separately proves (a) quiescence and
 * (b) retention of the fixed result, bound to executionId, generation, the
 * deterministic resource key and the result hash. This module supplies that
 * provider from observations the installed Host already exposes; it is
 * READ-ONLY and never stops, archives, wakes, deletes or dispatches anything.
 *
 * Sources (both are existing, local and read-only):
 *
 *  - Quiescence: `agents.list()` (the live agent registry already used by
 *    MeshNode.#liveSessions/teamStatus) plus
 *    `workspaceRegistry.archivedSessionIds` (already used by
 *    catalogueAgents). The adapter requires:
 *      1. the Worker session is owned by THIS node (descriptor.workerKey is
 *         `<localNodeId>/<sessionId>`);
 *      2. no live agent with that exact id, or exactly one live agent that is
 *         idle -- never a prefix/trim match and never a running turn;
 *      3. the session id is in the durable archive set. The installed
 *         ArchivedSessionGate (dsh-api-session-controller) rejects every
 *         `agent/pre-step` for an archived session, so an archived session
 *         cannot start a new turn even if a queued follow-up arrives.
 *    Requiring the archive membership is what turns a point-in-time "idle"
 *    reading into a durable no-wake proof.
 *
 *  - Fixed result retention: the durable TeamStore v1 ledger file is re-read
 *    from disk (not the caller's in-memory snapshot) and the retained
 *    `workerExecutions[executionId].result` is re-hashed with the same
 *    authoritative `resultHash` used by the Team/M6 code. The reference names
 *    the exact ledger file and entry so the retention claim can be replayed.
 *
 * Fail-closed gaps this adapter deliberately does NOT paper over:
 *  - "No running turn + archived" does not prove that OS child processes or
 *    tool side effects spawned by the execution have terminated. No local
 *    process identity (PID/start time) is recorded by the current Runner path.
 *  - Only this Host process's agent registry is observed. Another DSH process
 *    sharing the same storage slot is outside this observation.
 *  - The archive set is only a wake gate while the installed
 *    ArchivedSessionGate plugin is composed; the adapter reads the durable set
 *    and cannot prove that composition at runtime.
 *  - The TeamStore writes `team.json` with fsync + atomic rename but does not
 *    fsync the directory after rename; the result is durable against process
 *    crash, not proven against every power-loss/filesystem reorder.
 *  - The product path does not call reclamation for resource-backed workers
 *    (team-coordinator skips them until the isolated Runner is enabled), and
 *    no production caller archives worker sessions first. Until the Owner
 *    wires those entries, this adapter refuses every real reclaim attempt with
 *    QUIESCENCE_NOT_ARCHIVED; that refusal is the intended safe outcome.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { executionResourceKey } from './runner-resources.mjs';
import { resultHash } from './task-result-context.mjs';

const fail = (code, message = code) => {
  throw Object.assign(new Error(message), { code });
};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const RESOURCE_KEY_RE = /^[a-f0-9]{32}$/;
const RESULT_HASH_RE = /^[a-f0-9]{64}$/;
const REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const BASE_COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const WORKER_KEY_RE = /^([A-Za-z0-9][A-Za-z0-9-]{0,63})\/([^\s/]{1,128})$/;
const MAX_SOURCE = 200;
const MAX_REFERENCE = 400;

/** Validate the provider's immutable local configuration once. */
function validateConfig({ nodeId, ledgerFile, listLiveAgents, listArchivedSessionIds, io }) {
  if (typeof nodeId !== 'string' || nodeId === '' || nodeId.length > 64 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(nodeId)) fail('BAD_CONFIG');
  if (typeof ledgerFile !== 'string' || !isAbsolute(ledgerFile) || ledgerFile.includes('\0')) fail('BAD_CONFIG');
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
 * Prove quiescence from the live agent registry and the durable archive set.
 * Prefix/trim matching is never attempted: a workerKey that lost its exact
 * session id cannot be tied to a live or archived session and is refused.
 */
async function observeQuiescence({ descriptor, nodeId, listLiveAgents, listArchivedSessionIds }) {
  const workerKey = descriptor.workerKey;
  if (typeof workerKey !== 'string') fail('QUIESCENCE_UNPROVEN');
  const match = WORKER_KEY_RE.exec(workerKey);
  if (!match) fail('QUIESCENCE_UNPROVEN');
  const workerNode = match[1];
  const sessionId = match[2];
  if (workerNode !== nodeId) fail('QUIESCENCE_REMOTE');

  let live;
  try {
    live = await listLiveAgents();
  } catch {
    fail('QUIESCENCE_UNAVAILABLE');
  }
  if (!Array.isArray(live)) fail('QUIESCENCE_UNAVAILABLE');
  const exact = live.filter(row => isObject(row) && row.id === sessionId);
  if (exact.length > 1) fail('QUIESCENCE_AMBIGUOUS');
  if (exact.length === 1 && exact[0].status !== 'idle') fail('QUIESCENCE_RUNNING');

  let archived;
  try {
    archived = await listArchivedSessionIds();
  } catch {
    fail('QUIESCENCE_UNAVAILABLE');
  }
  if (!Array.isArray(archived)) fail('QUIESCENCE_UNAVAILABLE');
  if (!archived.includes(sessionId)) fail('QUIESCENCE_NOT_ARCHIVED');

  const liveState = exact.length === 1 ? 'idle' : 'absent';
  return { source: `host:live-agent-registry=${liveState};workspace-archive=yes`, sessionId, liveState };
}

/**
 * Build a trusted local evidence provider for `reclaimExecutionWorkspace`.
 *
 * @param {object} config
 * @param {string} config.nodeId - this Host's node id; the Worker must be local.
 * @param {string} config.ledgerFile - absolute path of the durable TeamStore file.
 * @param {() => Array<{id: string, status: string}>} config.listLiveAgents -
 *   the existing `agents.list()` observation (exact ids + status).
 * @param {() => string[]} config.listArchivedSessionIds - the existing
 *   `workspaceRegistry.archivedSessionIds` read-only observation.
 * @param {{readFile: Function}} [config.io] - injectable read-only filesystem.
 * @returns {(request: object) => Promise<{quiescence: object, retention: object}>}
 */
export function createHostReclaimEvidenceProvider({ nodeId, ledgerFile, listLiveAgents, listArchivedSessionIds, io = { readFile } } = {}) {
  validateConfig({ nodeId, ledgerFile, listLiveAgents, listArchivedSessionIds, io });
  return async function hostReclaimEvidenceProvider(request) {
    if (!isObject(request)) fail('BAD_REQUEST');
    const { executionId, generation, key, resultHash: expectedHash, repoId, baseCommit } = request;
    const expectedKey = validateRequest({ executionId, generation, key, resultHash: expectedHash, repoId, baseCommit });

    const { descriptor } = await readRetainedExecution({
      io, ledgerFile, executionId, generation, expectedKey,
      expectedHash, repoId, baseCommit,
    });
    const quiescence = await observeQuiescence({
      descriptor, nodeId, listLiveAgents, listArchivedSessionIds,
    });

    const reference = `${ledgerFile}#workerExecutions/${executionId}/result`;
    if (reference.length > MAX_REFERENCE) fail('RETENTION_REFERENCE_TOO_LONG');
    const source = 'host:durable-team-ledger';
    if (source.length > MAX_SOURCE || quiescence.source.length > MAX_SOURCE) fail('QUIESCENCE_UNPROVEN');

    return {
      quiescence: { stopped: true, source: quiescence.source },
      retention: { retained: true, source, reference, resultHash: expectedHash },
    };
  };
}
