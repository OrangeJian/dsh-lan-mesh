/**
 * Shared documents: the wire protocol layer.
 *
 * Contract: `docs/shared-doc-interfaces.md` §1 (identifiers), §2 (limits), §4
 * (ordering authority), §6 (protocol), §7 (codes).
 *
 * This module is **pure**. It builds and validates the pieces a shared-document
 * envelope is made of and applies sync batches to a state object, but it opens
 * no socket and touches no disk: `lib/transport.mjs` owns delivery and
 * `lib/shared-doc-state.mjs` owns the state rules. Everything here either
 * produces a value the transport can sign or refuses a value it must not.
 *
 * Three rules shape the code, all of them about two machines agreeing:
 *
 * - Signing input is canonical. `signingFragment` returns the exact tail that
 *   `signEnvelope` must append, built with recursively sorted object keys, so
 *   the same envelope signed by two nodes yields the same HMAC. Object key order
 *   is insertion order in JS, which differs per code path, so it must never
 *   reach the signature.
 * - Checkpoints are compared, never negotiated. `compareCheckpoint` reports
 *   `diverged` for two hashes under one `(generation, seq)` key and returns no
 *   content at all — not the local one, not the remote one. A caller cannot pick
 *   a winner because it is never handed a winner to pick (§4).
 * - Applying is delegated. `applySyncEvent` validates the wire shape and then
 *   hands the embedded command to `applyDocumentCommand`; no state rule is
 *   restated here, so the two layers cannot drift apart.
 *
 * @module dsh-lan-mesh/lib/shared-doc-protocol
 */
import { createHash } from 'node:crypto';
import { MAX_BODY_BYTES, TransportError } from './transport.mjs';
import { DOC_COMMAND_TYPES, applyDocumentCommand, isContentHash, isDocumentId, isEventId } from './shared-doc-state.mjs';

/** The capability value a peer advertises in `describe()` for shared docs. */
export const SHARED_DOCS_CAPABILITY = 1;
/** The only envelope version this layer understands. */
export const SHARED_DOCS_VERSION = 1;
/** Envelope `kind` that carries a shared-document operation. */
export const SHARED_DOCS_KIND = 'shared-doc';
/** The frozen operation set of §6. */
export const SHARED_DOC_OPS = ['submit', 'status', 'sync'];
/** Marker line `signingFragment` prefixes its tail with; versioned with the rest. */
export const SHARED_DOCS_SIGNING_TAG = `sharedDocs:${SHARED_DOCS_VERSION}`;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Raise a protocol error. `TransportError` is the class `lib/transport.mjs`
 * already puts on the wire, so a document failure reaches the caller as a normal
 * error envelope.
 * @param {string} code - §7 error code.
 * @param {string} message - human explanation, safe to log.
 * @param {number} [status] - HTTP status the transport should answer with.
 * @returns {never}
 */
function fail(code, message, status) {
  throw new TransportError(message, code, status);
}

/**
 * Whether a value is a non-array object.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * JSON with object keys sorted, recursively.
 *
 * This is what makes a signature and a payload digest properties of the content
 * rather than of the writer's code path.
 * @param {unknown} value - JSON-serializable value.
 * @returns {string}
 */
function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => (
    isPlainObject(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item
  ));
}

/**
 * sha256 of a UTF-8 string as lowercase hex.
 * @param {string} text - text to digest.
 * @returns {string}
 */
function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Whether a value is a `(generation, seq)` counter, §4.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/* ------------------------------------------------------------- signing --- */

/**
 * The tail `signEnvelope` must append to its signing input for a shared-doc
 * envelope.
 *
 * Format (frozen with the transport wiring):
 *
 * ```
 * \nsharedDocs:1\n<sessionId>\n<{documentId, op, payloadDigest}>
 * ```
 *
 * Each JSON piece is produced by `canonicalJson`, so two nodes that built the
 * same envelope in a different field order sign byte-identical input. `payload`
 * is covered by its digest rather than inlined: a submit payload can carry a
 * whole body, and the signature only needs to bind it, not repeat it.
 *
 * Deliberately **never throws**. The transport calls this while verifying an
 * inbound envelope that may be malformed, and a throw there would surface as a
 * server fault instead of a clean rejection. Structural validation is
 * `normalizeSharedDocEnvelope`'s job, and it runs before verification.
 * @param {object} envelope - envelope being signed; only shared-doc fields are read.
 * @returns {string} fragment beginning with `\n`.
 */
export function signingFragment(envelope) {
  const source = isPlainObject(envelope) ? envelope : {};
  const from = isPlainObject(source.from) ? source.from : {};
  const sessionId = typeof from.sessionId === 'string' ? from.sessionId : '';
  const documentId = typeof source.documentId === 'string' ? source.documentId : '';
  const op = typeof source.op === 'string' ? source.op : '';
  const payloadDigest = sha256Hex(canonicalJson(source.payload === undefined ? null : source.payload));
  const signed = canonicalJson({ documentId, op, payloadDigest });
  return `\n${SHARED_DOCS_SIGNING_TAG}\n${JSON.stringify(sessionId)}\n${signed}`;
}

/* ---------------------------------------------------------- capability --- */

/**
 * Whether a peer advertised shared-document support.
 *
 * Strict equality against the capability value: `'1'` from a hand-written peer
 * info block, or a numeric `2` from a future version, is **not** support. A
 * permissive check here would make the protocol degrade instead of failing
 * precisely, which §6 forbids.
 * @param {unknown} info - peer info as returned by the peer's `describe()`.
 * @returns {boolean}
 */
export function peerSupportsSharedDocs(info) {
  return isPlainObject(info) && info.sharedDocs === SHARED_DOCS_CAPABILITY;
}

/**
 * Require a peer that speaks this protocol.
 * @param {unknown} info - peer info.
 * @returns {object} the same info, for chaining.
 */
export function requireSharedDocsPeer(info) {
  if (!peerSupportsSharedDocs(info)) {
    fail(
      'DOC_PEER_UNSUPPORTED',
      `peer does not advertise sharedDocs: ${SHARED_DOCS_CAPABILITY}; refusing to deliver instead of degrading`,
    );
  }
  return info;
}

/* ----------------------------------------------------------- envelopes --- */

/**
 * Validate and normalize a shared-document envelope.
 *
 * Only the shared-document part is returned: the Mesh v2 wrapper (`v`, `id`,
 * `from`, `to`, `sig`, `sentAt`) belongs to `lib/transport.mjs`, which must
 * have already normalized and verified it. Rebuilding it here would give the
 * cluster a second, subtly different definition of an envelope.
 * @param {unknown} raw - decoded envelope (or its shared-doc fields).
 * @returns {{kind: string, sharedDocsVersion: number, documentId: string, op: string, payload: object}}
 */
export function normalizeSharedDocEnvelope(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'a shared-doc envelope must be an object');
  if (raw.kind !== undefined && raw.kind !== SHARED_DOCS_KIND) {
    fail('DOC_COMMAND_INVALID', `a shared-doc envelope must have kind '${SHARED_DOCS_KIND}'`);
  }
  if (raw.sharedDocsVersion === undefined || raw.sharedDocsVersion === null) {
    fail('DOC_COMMAND_INVALID', `sharedDocsVersion is required and must be ${SHARED_DOCS_VERSION}`);
  }
  if (raw.sharedDocsVersion !== SHARED_DOCS_VERSION) {
    // A different version is a peer we cannot talk to, not a malformed message:
    // saying so lets the coordinator stop pairing instead of retrying forever.
    fail(
      'DOC_PEER_UNSUPPORTED',
      `peer speaks sharedDocsVersion ${String(raw.sharedDocsVersion)}; this node speaks ${SHARED_DOCS_VERSION}`,
    );
  }
  if (!isDocumentId(raw.documentId)) {
    fail('DOC_NOT_FOUND', 'documentId must look like doc- followed by 12 lowercase alphanumerics');
  }
  if (typeof raw.op !== 'string' || !SHARED_DOC_OPS.includes(raw.op)) {
    fail('DOC_COMMAND_INVALID', `op must be one of: ${SHARED_DOC_OPS.join(', ')}`);
  }
  const payload = raw.payload === undefined || raw.payload === null ? {} : raw.payload;
  if (!isPlainObject(payload)) fail('DOC_COMMAND_INVALID', 'payload must be a plain object');
  return {
    kind: SHARED_DOCS_KIND,
    sharedDocsVersion: SHARED_DOCS_VERSION,
    documentId: raw.documentId,
    op: raw.op,
    payload: JSON.parse(canonicalJson(payload)),
  };
}

/**
 * Refuse a body that would not fit the transport frame.
 *
 * The bound is the transport's own, because the thing that will fail is the
 * transport: a document response that exceeds it can never be delivered, so it
 * must be refused here rather than silently truncated (§2 forbids truncation).
 * @param {unknown} body - value about to be serialized.
 * @returns {string} its canonical JSON, for callers that want to send it.
 */
export function assertSharedDocBody(body) {
  let encoded;
  try {
    encoded = canonicalJson(body);
  } catch {
    fail('DOC_COMMAND_INVALID', 'a shared-doc body must be JSON serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BODY_BYTES) {
    fail('DOC_BODY_TOO_LARGE', `a shared-doc body may not exceed ${MAX_BODY_BYTES} bytes`, 413);
  }
  return encoded;
}

/* --------------------------------------------------------------- sync ---- */

/**
 * Normalize one checkpoint `{generation, seq, hash}`, §4.
 * @param {unknown} raw - candidate checkpoint.
 * @param {string} label - field name for the error message.
 * @returns {{generation: number, seq: number, hash: string}}
 */
function requireCheckpoint(raw, label) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', `${label} must be an object`);
  if (!isCounter(raw.generation)) fail('DOC_COMMAND_INVALID', `${label}.generation must be a non-negative safe integer`);
  if (!isCounter(raw.seq)) fail('DOC_COMMAND_INVALID', `${label}.seq must be a non-negative safe integer`);
  if (!isContentHash(raw.hash)) fail('DOC_COMMAND_INVALID', `${label}.hash must be 64 lowercase hex characters`);
  return { generation: raw.generation, seq: raw.seq, hash: raw.hash };
}

/**
 * Normalize one sync event: the idempotency key, the ordering key and the
 * command that produced the change.
 * @param {unknown} raw - candidate event.
 * @param {string} label - field name for the error message.
 * @returns {{documentId: string, eventId: string, generation: number, seq: number, hash: string | null, command: object}}
 */
function requireSyncEvent(raw, label = 'event') {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', `${label} must be an object`);
  if (!isDocumentId(raw.documentId)) {
    fail('DOC_NOT_FOUND', `${label}.documentId must look like doc- followed by 12 lowercase alphanumerics`);
  }
  if (!isEventId(raw.eventId)) {
    fail('DOC_COMMAND_INVALID', `${label}.eventId must look like evt- followed by 12 lowercase alphanumerics`);
  }
  if (!isCounter(raw.generation)) fail('DOC_COMMAND_INVALID', `${label}.generation must be a non-negative safe integer`);
  if (!isCounter(raw.seq)) fail('DOC_COMMAND_INVALID', `${label}.seq must be a non-negative safe integer`);
  const hash = raw.hash === undefined || raw.hash === null
    ? null
    : (isContentHash(raw.hash) ? raw.hash : fail('DOC_COMMAND_INVALID', `${label}.hash must be 64 lowercase hex characters`));
  if (!isPlainObject(raw.command)) fail('DOC_COMMAND_INVALID', `${label}.command must be an object`);
  if (typeof raw.command.type !== 'string' || !DOC_COMMAND_TYPES.includes(raw.command.type)) {
    fail('DOC_COMMAND_INVALID', `${label}.command.type must be one of: ${DOC_COMMAND_TYPES.join(', ')}`);
  }
  return {
    documentId: raw.documentId,
    eventId: raw.eventId,
    generation: raw.generation,
    seq: raw.seq,
    hash,
    command: raw.command,
  };
}

/**
 * Normalize one `since` map: `{ [documentId]: {generation, seq} }`.
 *
 * The map is keyed by document so one request can catch up several documents,
 * and `seq` alone would be meaningless: it is only ordered *within* a
 * generation, so a checkpoint without its generation cannot be compared at all.
 * @param {unknown} raw - candidate map.
 * @returns {object}
 */
function requireSinceMap(raw) {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'since must be an object keyed by documentId');
  const since = {};
  for (const [documentId, checkpoint] of Object.entries(raw)) {
    if (!isDocumentId(documentId)) {
      fail('DOC_NOT_FOUND', 'since keys must look like doc- followed by 12 lowercase alphanumerics');
    }
    if (!isPlainObject(checkpoint)) fail('DOC_COMMAND_INVALID', `since.${documentId} must be an object`);
    if (!isCounter(checkpoint.generation)) {
      fail('DOC_COMMAND_INVALID', `since.${documentId}.generation must be a non-negative safe integer`);
    }
    if (!isCounter(checkpoint.seq)) {
      fail('DOC_COMMAND_INVALID', `since.${documentId}.seq must be a non-negative safe integer`);
    }
    since[documentId] = { generation: checkpoint.generation, seq: checkpoint.seq };
  }
  return since;
}

/**
 * Build and validate an `op: 'sync'` request body.
 *
 * §6 carries the caller's checkpoints as `{ since: {documentId: {generation,
 * seq}} }`. A checkpoint that carries a `hash` is downgraded to its key: the
 * request asks for everything after a point, and a hash there would be a second,
 * unverifiable claim about a revision the peer has not sent yet.
 * @param {unknown} raw - `{ since }`.
 * @returns {{sharedDocsVersion: number, since: object}}
 */
export function sharedDocRequest(raw) {
  const body = raw === undefined || raw === null ? {} : raw;
  if (!isPlainObject(body)) fail('DOC_COMMAND_INVALID', 'a sync request body must be an object');
  const request = {
    sharedDocsVersion: SHARED_DOCS_VERSION,
    since: requireSinceMap(body.since),
  };
  assertSharedDocBody(request);
  return request;
}

/**
 * Build and validate an `op: 'sync'` response body.
 *
 * `gaps` are first-class: a peer that cannot serve a contiguous run says so
 * instead of sending a partial tail, because applying a tail silently would make
 * the two replicas disagree about what happened in between.
 * @param {unknown} raw - `{ events, gaps }`.
 * @returns {{sharedDocsVersion: number, events: object[], gaps: object[]}}
 */
export function sharedDocResponse(raw) {
  const body = raw === undefined || raw === null ? {} : raw;
  if (!isPlainObject(body)) fail('DOC_COMMAND_INVALID', 'a sync response body must be an object');
  const events = body.events === undefined || body.events === null ? [] : body.events;
  const gaps = body.gaps === undefined || body.gaps === null ? [] : body.gaps;
  if (!Array.isArray(events)) fail('DOC_COMMAND_INVALID', 'events must be an array');
  if (!Array.isArray(gaps)) fail('DOC_COMMAND_INVALID', 'gaps must be an array');
  const response = {
    sharedDocsVersion: SHARED_DOCS_VERSION,
    events: events.map((event, index) => requireSyncEvent(event, `events[${index}]`)),
    gaps: gaps.map((gap, index) => normalizeGap(gap, `gaps[${index}]`)),
  };
  assertSharedDocBody(response);
  return response;
}

/**
 * Normalize one gap descriptor.
 * @param {unknown} raw - candidate gap.
 * @param {string} label - field name for the error message.
 * @returns {object}
 */
function normalizeGap(raw, label) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', `${label} must be an object`);
  if (!isDocumentId(raw.documentId)) {
    fail('DOC_NOT_FOUND', `${label}.documentId must look like doc- followed by 12 lowercase alphanumerics`);
  }
  const gap = {
    documentId: raw.documentId,
    reason: typeof raw.reason === 'string' && raw.reason !== '' ? raw.reason : 'missing-range',
    generation: isCounter(raw.generation) ? raw.generation : null,
    fromSeq: isCounter(raw.fromSeq) ? raw.fromSeq : null,
    toSeq: isCounter(raw.toSeq) ? raw.toSeq : null,
    needsFullSync: raw.needsFullSync === true,
  };
  return gap;
}

/* --------------------------------------------------------- checkpoints --- */

/**
 * Compare two `(generation, seq)` checkpoints, §4.
 *
 * `diverged` means the two nodes hold different content under the same ordering
 * key. The caller must pause that document and report `CONFLICTING_CHECKPOINT`;
 * it is never offered a side to prefer, because preferring one is exactly the
 * silent fork §4 forbids. That is why a diverged result carries a `reason` and
 * nothing else — no hashes to break a tie with, no content, no `winner`.
 * @param {{generation: number, seq: number, hash: string}} local - this node's checkpoint.
 * @param {{generation: number, seq: number, hash: string}} remote - the peer's checkpoint.
 * @returns {{status: 'equal'|'behind'|'ahead'|'diverged', reason?: string}}
 */
export function compareCheckpoint(local, remote) {
  const mine = requireCheckpoint(local, 'local checkpoint');
  const theirs = requireCheckpoint(remote, 'remote checkpoint');
  if (mine.generation === theirs.generation && mine.seq === theirs.seq) {
    if (mine.hash === theirs.hash) return { status: 'equal' };
    return {
      status: 'diverged',
      reason: `both nodes claim (generation ${mine.generation}, seq ${mine.seq}) but the content hashes differ`
        + '; pause this document and report CONFLICTING_CHECKPOINT rather than choosing a side',
    };
  }
  const localFirst = mine.generation < theirs.generation
    || (mine.generation === theirs.generation && mine.seq < theirs.seq);
  return localFirst
    ? {
      status: 'behind',
      reason: `local (generation ${mine.generation}, seq ${mine.seq}) sorts before `
        + `remote (generation ${theirs.generation}, seq ${theirs.seq})`,
    }
    : {
      status: 'ahead',
      reason: `local (generation ${mine.generation}, seq ${mine.seq}) sorts after `
        + `remote (generation ${theirs.generation}, seq ${theirs.seq})`,
    };
}

/**
 * Ordering comparator for two sync events, §4: `(generation, seq)`, then the
 * event id so a batch of events sharing one key still sorts stably.
 * @param {object} left - first event.
 * @param {object} right - second event.
 * @returns {number} negative when left sorts first.
 */
function compareEvents(left, right) {
  if (left.generation !== right.generation) return left.generation - right.generation;
  if (left.seq !== right.seq) return left.seq - right.seq;
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? -1 : 1;
}

/**
 * Find the ranges a batch of events does not cover.
 *
 * Only events strictly after `since` are considered. Within one generation the
 * batch must be contiguous from `since.seq + 1`: a hole means the peer's log is
 * short, and applying the tail would leave this replica missing an event it can
 * never reconstruct. A generation change is reported as a gap too, because
 * nothing here can prove the two generations are related — a full sync is the
 * only safe answer.
 * @param {{generation: number, seq: number} | null} since - last known key, or `null` for a full sync.
 * @param {object[]} events - normalized events, any order.
 * @param {string} documentId - document the batch belongs to.
 * @returns {object[]} gaps, empty when the batch is contiguous.
 */
function detectGaps(since, events, documentId) {
  if (since === null) return [];
  const pending = events
    .filter((event) => event.generation > since.generation
      || (event.generation === since.generation && event.seq > since.seq))
    .sort(compareEvents);
  const gaps = [];
  let generation = since.generation;
  let seq = since.seq;
  for (const event of pending) {
    if (event.generation !== generation) {
      gaps.push({
        documentId,
        reason: 'generation-changed',
        generation: event.generation,
        fromSeq: null,
        toSeq: null,
        needsFullSync: true,
      });
      // Stop at the first generation boundary: everything after it depends on
      // a generation this node has never seen, so no later event is applicable.
      break;
    }
    if (event.seq > seq + 1) {
      gaps.push({
        documentId,
        reason: 'missing-range',
        generation,
        fromSeq: seq + 1,
        toSeq: event.seq - 1,
        needsFullSync: false,
      });
    }
    if (event.seq > seq) seq = event.seq;
  }
  return gaps;
}

/**
 * Plan the application of a sync batch without touching the state.
 *
 * Kept separate from `applySyncResponse` so the coordinator can ask "what would
 * this do" — and so gap detection is testable without a state.
 * @param {{documentId: string, since?: object|null, events: object[]}} input - batch to plan.
 * @returns {{applicable: object[], gaps: object[]}}
 */
export function planSyncEvents({ documentId, since = null, events = [] } = {}) {
  if (!isDocumentId(documentId)) {
    fail('DOC_NOT_FOUND', 'documentId must look like doc- followed by 12 lowercase alphanumerics');
  }
  const batch = (Array.isArray(events) ? events : fail('DOC_COMMAND_INVALID', 'events must be an array'))
    .map((event, index) => requireSyncEvent(event, `events[${index}]`));
  for (const event of batch) {
    if (event.documentId !== documentId) {
      fail('DOC_COMMAND_INVALID', `event ${event.eventId} belongs to ${event.documentId}, not ${documentId}`);
    }
  }
  const checkpoint = since === null || since === undefined ? null : requireSinceMap({
    [documentId]: since,
  })[documentId];
  const gaps = detectGaps(checkpoint, batch, documentId);
  if (gaps.length) return { applicable: [], gaps };
  const applicable = checkpoint === null
    ? [...batch].sort(compareEvents)
    : batch
      .filter((event) => event.generation > checkpoint.generation
        || (event.generation === checkpoint.generation && event.seq > checkpoint.seq))
      .sort(compareEvents);
  return { applicable, gaps: [] };
}

/**
 * Apply one sync event to the state.
 *
 * Two distinct meanings of "already have it" are handled separately, because
 * conflating them is how a replica drifts:
 *
 * - the same `eventId` with the same content is a retry, and returns the very
 *   same state object, so a store can skip the write;
 * - the same `eventId` with a different hash is a fork the state layer must not
 *   resolve, so it raises `CONFLICTING_CHECKPOINT` (§4).
 *
 * Everything else is delegated to `applyDocumentCommand`: the state rules live
 * there, and a second copy of them here would eventually disagree with the
 * first.
 * @param {object} state - current replicated state.
 * @param {object} event - normalized (or raw) sync event.
 * @returns {object} the next state, or `state` itself when the event is a retry.
 */
export function applySyncEvent(state, event) {
  const normalized = requireSyncEvent(event);
  const log = state?.events?.[normalized.documentId];
  const known = Array.isArray(log) ? log.find((entry) => entry.eventId === normalized.eventId) : undefined;
  if (known !== undefined) {
    if (normalized.hash !== null && typeof known.hash === 'string' && known.hash !== normalized.hash) {
      fail(
        'CONFLICTING_CHECKPOINT',
        `event ${normalized.eventId} is already recorded with a different hash; `
          + 'pause this document and report CONFLICTING_CHECKPOINT',
      );
    }
    return state;
  }
  return applyDocumentCommand(state, normalized.command);
}

/**
 * Apply a whole sync response, or nothing at all.
 *
 * All-or-nothing is the point: a response is either a contiguous run that moves
 * the replica forward, or it is a hole that must be refilled first. Applying the
 * events before a hole and then stopping would leave a replica that looks
 * current while permanently missing history.
 * @param {object} state - current replicated state.
 * @param {{documentId: string, since?: object|null, events?: object[], gaps?: object[]}} batch - response plus the request's checkpoint.
 * @returns {{state: object, applied: string[], gaps: object[]}} new state, applied event ids, and any gaps.
 */
export function applySyncResponse(state, batch = {}) {
  const { documentId, since = null, events = [], gaps = [] } = isPlainObject(batch) ? batch : {};
  const response = sharedDocResponse({ events, gaps });
  if (response.gaps.length) return { state, applied: [], gaps: response.gaps };
  const plan = planSyncEvents({ documentId, since, events: response.events });
  if (plan.gaps.length) return { state, applied: [], gaps: plan.gaps };
  let next = state;
  const applied = [];
  for (const event of plan.applicable) {
    const before = next;
    next = applySyncEvent(next, event);
    if (next !== before) applied.push(event.eventId);
  }
  return { state: next, applied, gaps: [] };
}

/* ------------------------------------------------------------ payloads --- */

/**
 * Validate the payload of an `op: 'submit'` envelope.
 *
 * Payload fields are bounded and typed here so a malformed submission is refused
 * before it reaches the coordinator, but nothing about *permission* is decided
 * here: who may propose comes from the calling surface (§8), never from the
 * payload.
 * @param {unknown} raw - candidate payload.
 * @returns {{proposalId: string, baseRevisionId: string | null, resultHash: string, message: string}}
 */
export function submitPayload(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'a submit payload must be an object');
  const proposalId = requirePattern(raw.proposalId, /^prop-[a-z0-9]{12}$/, 'proposalId', 'prop- followed by 12 lowercase alphanumerics');
  const baseRevisionId = raw.baseRevisionId === undefined || raw.baseRevisionId === null
    ? null
    : requirePattern(raw.baseRevisionId, /^rev-[a-z0-9]{12}$/, 'baseRevisionId', 'rev- followed by 12 lowercase alphanumerics');
  if (!isContentHash(raw.resultHash)) fail('DOC_COMMAND_INVALID', 'resultHash must be 64 lowercase hex characters');
  const message = raw.message === undefined || raw.message === null ? '' : raw.message;
  if (typeof message !== 'string') fail('DOC_COMMAND_INVALID', 'message must be a string');
  if (CONTROL_CHARACTER_PATTERN.test(message.replace(/[\n\t]/g, ''))) {
    fail('DOC_COMMAND_INVALID', 'message must not contain control characters');
  }
  return { proposalId, baseRevisionId, resultHash: raw.resultHash, message: message.replace(/\r\n/g, '\n').trim() };
}

/**
 * Require a string matching a frozen id pattern.
 * @param {unknown} value - candidate.
 * @param {RegExp} pattern - id pattern.
 * @param {string} label - field name for the error message.
 * @param {string} shape - human description of the pattern.
 * @returns {string}
 */
function requirePattern(value, pattern, label, shape) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('DOC_COMMAND_INVALID', `${label} must look like ${shape}`);
  }
  return value;
}

/**
 * Validate the payload of an `op: 'status'` envelope.
 *
 * A status payload is a checkpoint for anti-entropy: `(generation, seq, hash)`
 * of the head the sender believes in, plus the head revision id so the receiver
 * can name it in a resync request.
 * @param {unknown} raw - candidate payload.
 * @returns {{headRevisionId: string, generation: number, seq: number, hash: string}}
 */
export function statusPayload(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'a status payload must be an object');
  const headRevisionId = requirePattern(
    raw.headRevisionId,
    /^rev-[a-z0-9]{12}$/,
    'headRevisionId',
    'rev- followed by 12 lowercase alphanumerics',
  );
  const checkpoint = requireCheckpoint({ generation: raw.generation, seq: raw.seq, hash: raw.hash }, 'status payload');
  return { headRevisionId, ...checkpoint };
}
