/**
 * Shared documents: the pure state layer.
 *
 * A shared document is replicated between nodes, so every rule here has to
 * survive being applied twice, in two orders, on two machines. Three choices
 * follow from that and explain most of the code below:
 *
 * - Revisions are append-only and identified by id, so a retry can be
 *   recognised instead of applied twice. Rewriting a revision would let two
 *   nodes hold different text under one id with no way to tell which is right.
 * - Ordering is `(generation, seq)`, never wall clocks. Clocks disagree across
 *   machines, and a history whose order depends on whose clock is ahead is not
 *   a history the two users agree on.
 * - Every command either produces a new state or is a no-op that returns the
 *   *same* object. Idempotence is decided from what is already stored (ids and
 *   content), never from a caller-supplied "this is a retry" flag: the caller is
 *   exactly the thing that might be retrying.
 *
 * Nothing here touches disk, sockets or the network. The coordinator owns
 * identity and permissions (who may propose, who may confirm), the store owns
 * persistence, and this module only turns one already-validated command into the
 * next state. Keeping it that way is what makes the rules testable in isolation.
 *
 * The frozen contract is `docs/shared-doc-interfaces.md` §1–§4 and §7.
 *
 * @module dsh-lan-mesh/lib/shared-doc-state
 */
import { createHash } from 'node:crypto';
import { TransportError } from './transport.mjs';

/** Version stamp on the replicated shared-document state. */
export const DOC_STATE_VERSION = 1;
/** How many documents one room may hold, archived ones included. */
export const MAX_DOCUMENTS_PER_ROOM = 100;
/** Longest accepted document title, in characters. Titles are a single line. */
export const MAX_DOC_TITLE = 200;
/** Longest accepted revision or proposal message, in characters. */
export const MAX_DOC_MESSAGE = 2_000;
/** Largest accepted document body, in UTF-8 bytes after normalization. */
export const MAX_DOC_CONTENT_BYTES = 256 * 1024;
/** Largest accepted canonical patch, in UTF-8 bytes of its JSON encoding. */
export const MAX_DOC_PATCH_BYTES = 128 * 1024;
/** How many maintainers one document may name. */
export const MAX_MAINTAINERS_PER_DOC = 16;
/** How many unresolved proposals one document may hold before new ones are refused. */
export const MAX_PROPOSALS_PER_DOC = 200;
/** Largest page of history a caller may ask for. */
export const MAX_HISTORY_PAGE = 50;
/** How many documents a context pack may select. */
export const MAX_CONTEXT_DOCUMENTS = 8;
/** How many room messages a context pack may quote. */
export const MAX_CONTEXT_MESSAGES = 20;
/** How large a context pack may grow, in bytes, before it is marked truncated. */
export const MAX_CONTEXT_BYTES = 64 * 1024;
/** Largest free-form `detail` object one audit event may carry, in JSON bytes. */
export const MAX_EVENT_DETAIL_BYTES = 2_000;
/** Longest actor key. Matches the `memberKey` shape of `lib/rooms.mjs`. */
export const MAX_ACTOR_KEY = 129;
/** Longest display name kept on a revision or a maintainer. */
export const MAX_AUTHOR_NAME = 64;
/** Longest node or session id accepted inside an actor key. */
export const MAX_ID_PART = 64;

/** The only body format this state version understands. */
export const DOCUMENT_FORMAT = 'markdown';

/** Where a revision came from. Anything else would be unattributable history. */
export const REVISION_SOURCES = ['human', 'agent', 'import', 'conflict-resolution'];

/** Proposal lifecycle, exactly as frozen in §3. */
export const PROPOSAL_STATUSES = ['pending', 'conflicted', 'accepted', 'auto-merged', 'rejected', 'withdrawn'];

/**
 * Statuses that still hold a slot against `MAX_PROPOSALS_PER_DOC` and still
 * count towards `documents[].conflictCount` when they are `conflicted`.
 */
export const OPEN_PROPOSAL_STATUSES = ['pending', 'conflicted'];

/** Audit event kinds. `document-created` is deliberately absent: see `applyCreate`. */
export const EVENT_TYPES = [
  'proposal-submitted',
  'proposal-accepted',
  'proposal-auto-merged',
  'conflict-detected',
  'conflict-resolved',
  'proposal-rejected',
  'proposal-withdrawn',
  'document-imported',
  'document-exported',
  'document-renamed',
  'document-archived',
  'maintainer-granted',
];

/** Command types accepted by `applyDocumentCommand`. */
export const DOC_COMMAND_TYPES = [
  'document/create',
  'document/rename',
  'document/archive',
  'revision/append',
  'proposal/put',
  'proposal/status',
  'event/append',
  'maintainer/grant',
];

const DOCUMENT_ID_PATTERN = /^doc-[a-z0-9]{12}$/;
const REVISION_ID_PATTERN = /^rev-[a-z0-9]{12}$/;
const PROPOSAL_ID_PATTERN = /^prop-[a-z0-9]{12}$/;
const EVENT_ID_PATTERN = /^evt-[a-z0-9]{12}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
/** Mirrors the private pattern in `lib/rooms.mjs`; room ids are not ours to redefine. */
const ROOM_ID_PATTERN = /^room-[a-z0-9][a-z0-9-]{3,59}$/;
/** `nodeId/sessionId` with no nesting and no whitespace. */
const ACTOR_KEY_PATTERN = /^[^\s/]{1,64}\/[^\s/]{1,64}$/;
/** Control characters would let a title forge lines in any single-line surface. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
/** Maps that make up one state document, in a stable order. */
const STATE_MAPS = ['documents', 'revisions', 'proposals', 'events', 'maintainers', 'outbox', 'idempotency'];

/**
 * Raise a protocol error, the only kind this layer throws.
 *
 * `TransportError(message, code)` is the same class the transport uses, so a
 * document failure reaches `index.js` as a normal error envelope instead of
 * escaping as a raw exception.
 * @param {string} code - §7 error code.
 * @param {string} message - human explanation, safe to log.
 * @returns {never}
 */
function fail(code, message) {
  throw new TransportError(message, code);
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
 * Two nodes that build the same event must hash it identically, and JS object
 * key order is insertion order, which differs per code path. Sorting keys is
 * what makes `hash` a property of the content rather than of the writer.
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
 * Whether two values are the same JSON document, ignoring key order.
 * @param {unknown} left - first value.
 * @param {unknown} right - second value.
 * @returns {boolean}
 */
function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Whether `next` is the same proposal as `stored`, only narrowed by a resolution.
 *
 * A proposal id answers one question: "should this base revision become this
 * text?" (`docs/shared-doc-interfaces.md` §3). Resolving a conflict answers the
 * same question differently — the machine could not merge, so a human supplies
 * the final text — and the record keeps its id so the audit trail shows one
 * pending change being settled rather than a second, unrelated proposal.
 *
 * Everything that identifies the question must stay byte-identical. Only the
 * answer may move: the text, its patch and hash, the commit message, the
 * resolver, and the conflict evidence that led here.
 * @param {object} stored - proposal already in the state.
 * @param {object} next - proposal being written under the same id.
 * @returns {boolean}
 */
function isResolutionRefinement(stored, next) {
  const identity = ['proposalId', 'documentId', 'baseRevisionId', 'authorKey', 'createdAt'];
  for (const field of identity) {
    if ((stored[field] ?? null) !== (next[field] ?? null)) return false;
  }
  // Only a conflicted proposal can be re-answered; a settled one is history.
  if (stored.status !== 'conflicted' || next.status !== 'conflicted') return false;
  return true;
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
 * UTF-8 size of an already-serialized string.
 * Limits in §2 are byte limits because bodies are stored and shipped as bytes,
 * while titles and messages are bounded in characters.
 * @param {string} text - serialized text.
 * @returns {number}
 */
function utf8Bytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Normalize a document body exactly as §1 specifies.
 *
 * `contentHash` must be computed over this form on every node, or the same text
 * would compare unequal depending on which machine's editor produced it. The
 * normalization is exported because the coordinator has to hash bodies too, and
 * a second hand-written copy of "CRLF to LF, then trim" is exactly the kind of
 * detail two modules drift apart on.
 * @param {string} content - raw body.
 * @returns {string}
 */
export function normalizeContent(content) {
  if (typeof content !== 'string') fail('DOC_COMMAND_INVALID', 'content must be a string');
  return content.replace(/\r\n/g, '\n').trim();
}

/**
 * `contentHash` of a body: sha256 hex over the normalized UTF-8 bytes (§1).
 *
 * Stored hashes are never recomputed from stored text — this is the one place
 * the algorithm is written down, so replicas cannot disagree about it.
 * @param {string} content - raw body.
 * @returns {string} 64 lowercase hex characters.
 */
export function hashContent(content) {
  return sha256Hex(normalizeContent(content));
}

/* ------------------------------------------------------------------ ids --- */

/**
 * Whether a value has the frozen `documentId` shape.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isDocumentId(value) {
  return typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value);
}

/**
 * Whether a value has the frozen `revisionId` shape.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isRevisionId(value) {
  return typeof value === 'string' && REVISION_ID_PATTERN.test(value);
}

/**
 * Whether a value has the frozen `proposalId` shape.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isProposalId(value) {
  return typeof value === 'string' && PROPOSAL_ID_PATTERN.test(value);
}

/**
 * Whether a value has the frozen `eventId` shape.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isEventId(value) {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value);
}

/**
 * Whether a value is a `contentHash` / `resultHash`: 64 lowercase hex characters.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isContentHash(value) {
  return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}

/**
 * Whether a value looks like `nodeId/sessionId`.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isActorKey(value) {
  return typeof value === 'string' && value.length <= MAX_ACTOR_KEY && ACTOR_KEY_PATTERN.test(value);
}

/**
 * Whether a value looks like a room id.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isRoomId(value) {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

/**
 * Whether a value is a timestamp string `Date.parse` understands.
 *
 * Timestamps are allowed to be wrong here; they are never used for ordering
 * (§4). They are only display data, so a parseable string is enough.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
export function isIsoTimestamp(value) {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

/**
 * Turn one uuid into the 12-character tail of a frozen id.
 *
 * Ids are generated by whoever creates the record, so this stays a pure
 * function of the uuid source: no state, no uniqueness loop. Collisions are
 * caught by the create commands, which refuse to overwrite an existing id.
 * @param {() => string} randomUuid - uuid source, e.g. `randomUUID`.
 * @param {string} prefix - `doc-`, `rev-`, `prop-` or `evt-`.
 * @returns {string}
 */
function idFromUuid(randomUuid, prefix) {
  const raw = typeof randomUuid === 'function' ? randomUuid() : '';
  const hex = String(raw ?? '').replace(/-/g, '').toLowerCase();
  if (!/^[a-z0-9]{12,}$/.test(hex)) {
    fail('DOC_COMMAND_INVALID', 'the uuid source must yield at least 12 alphanumeric characters');
  }
  return `${prefix}${hex.slice(0, 12)}`;
}

/**
 * Mint a `documentId`.
 * @param {() => string} randomUuid - uuid source.
 * @returns {string}
 */
export function newDocumentId(randomUuid) {
  return idFromUuid(randomUuid, 'doc-');
}

/**
 * Mint a `revisionId`.
 * @param {() => string} randomUuid - uuid source.
 * @returns {string}
 */
export function newRevisionId(randomUuid) {
  return idFromUuid(randomUuid, 'rev-');
}

/**
 * Mint a `proposalId`.
 *
 * The proposal author mints this once and **must reuse it on retry**; that is
 * the only way a resent proposal is recognised instead of duplicated.
 * @param {() => string} randomUuid - uuid source.
 * @returns {string}
 */
export function newProposalId(randomUuid) {
  return idFromUuid(randomUuid, 'prop-');
}

/**
 * Mint an `eventId`.
 * @param {() => string} randomUuid - uuid source.
 * @returns {string}
 */
export function newEventId(randomUuid) {
  return idFromUuid(randomUuid, 'evt-');
}

/* ---------------------------------------------------------- validators --- */

/**
 * Require a document id.
 *
 * A malformed id can never name a document, so `DOC_NOT_FOUND` is the truthful
 * answer to a caller that supplied one.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireDocumentId(value, label = 'documentId') {
  if (!isDocumentId(value)) fail('DOC_NOT_FOUND', `${label} must look like doc- followed by 12 lowercase alphanumerics`);
  return value;
}

/**
 * Require a revision id.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireRevisionId(value, label = 'revisionId') {
  if (!isRevisionId(value)) fail('DOC_COMMAND_INVALID', `${label} must look like rev- followed by 12 lowercase alphanumerics`);
  return value;
}

/**
 * Require a proposal id.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireProposalId(value, label = 'proposalId') {
  if (!isProposalId(value)) fail('DOC_COMMAND_INVALID', `${label} must look like prop- followed by 12 lowercase alphanumerics`);
  return value;
}

/**
 * Require an event id.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireEventId(value, label = 'eventId') {
  if (!isEventId(value)) fail('DOC_COMMAND_INVALID', `${label} must look like evt- followed by 12 lowercase alphanumerics`);
  return value;
}

/**
 * Require a content hash.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireContentHash(value, label = 'contentHash') {
  if (!isContentHash(value)) fail('DOC_COMMAND_INVALID', `${label} must be 64 lowercase hex characters`);
  return value;
}

/**
 * Require an actor key.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireActorKey(value, label = 'actorKey') {
  if (!isActorKey(value)) fail('DOC_COMMAND_INVALID', `${label} must look like nodeId/sessionId`);
  return value;
}

/**
 * Require a room id.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireRoomId(value, label = 'roomId') {
  if (!isRoomId(value)) fail('DOC_COMMAND_INVALID', `${label} must look like room- followed by 4 to 60 lowercase characters`);
  return value;
}

/**
 * Require a node or session id.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireIdPart(value, label) {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID_PART || /[\s/]/.test(value)) {
    fail('DOC_COMMAND_INVALID', `${label} must be 1 to ${MAX_ID_PART} characters without whitespace or slashes`);
  }
  return value;
}

/**
 * Require a timestamp.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireTimestamp(value, label) {
  if (!isIsoTimestamp(value)) fail('DOC_COMMAND_INVALID', `${label} must be an ISO timestamp`);
  return value;
}

/**
 * Require a `(generation, seq)` component.
 *
 * They are the ordering authority of §4, so they are compared, never parsed
 * from a clock and never coerced from a string.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {number}
 */
function requireCounter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('DOC_COMMAND_INVALID', `${label} must be a non-negative safe integer`);
  }
  return value;
}

/**
 * Require a value from a frozen enum.
 * @param {unknown} value - candidate.
 * @param {string[]} allowed - enum members.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail('DOC_COMMAND_INVALID', `${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * Require a document title.
 *
 * Titles are refused rather than trimmed down to size: a title the user cannot
 * see in full is worse than an error telling them it is too long.
 * @param {unknown} value - candidate.
 * @returns {string}
 */
function requireTitle(value) {
  if (typeof value !== 'string') fail('DOC_TITLE_INVALID', 'a document title must be a string');
  const title = value.trim();
  if (title === '') fail('DOC_TITLE_INVALID', 'a document title is required');
  if (title.length > MAX_DOC_TITLE) {
    fail('DOC_TITLE_INVALID', `a document title may not exceed ${MAX_DOC_TITLE} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(title)) {
    fail('DOC_TITLE_INVALID', 'a document title must be a single line without control characters');
  }
  return title;
}

/**
 * Normalize a revision or proposal message.
 *
 * A message is a note, not the document, so it is measured in characters. It is
 * still bounded, and an over-long one is refused instead of truncated, because
 * a silently shortened commit message is a fact the history no longer records.
 * §7 has no message-specific code; `DOC_LIMIT_REACHED` is the generic limit code.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string}
 */
function requireMessage(value, label = 'message') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail('DOC_COMMAND_INVALID', `${label} must be a string`);
  const message = value.replace(/\r\n/g, '\n').trim();
  if (message.length > MAX_DOC_MESSAGE) {
    fail('DOC_LIMIT_REACHED', `${label} may not exceed ${MAX_DOC_MESSAGE} characters`);
  }
  return message;
}

/**
 * Normalize a display name that arrives from another machine.
 *
 * It is untrusted text: it is bounded and stored as-is (minus surrounding
 * whitespace), and never used for any decision.
 * @param {unknown} value - candidate.
 * @param {string} fallback - name to use when the caller sent nothing.
 * @returns {string}
 */
function requireDisplayName(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') fail('DOC_COMMAND_INVALID', 'a display name must be a string');
  const name = value.trim();
  return name === '' ? fallback : name.slice(0, MAX_AUTHOR_NAME);
}

/**
 * Require a nullable revision reference.
 * @param {unknown} value - candidate.
 * @param {string} label - field name for the error message.
 * @returns {string | null}
 */
function requireOptionalRevisionId(value, label) {
  if (value === undefined || value === null) return null;
  return requireRevisionId(value, label);
}

/**
 * Require a nullable proposal/revision reference stored inside an event.
 * @param {unknown} value - candidate.
 * @param {(candidate: unknown, label: string) => string} require - the specific id validator.
 * @param {string} label - field name for the error message.
 * @returns {string | null}
 */
function requireOptionalId(value, require, label) {
  if (value === undefined || value === null) return null;
  return require(value, label);
}

/**
 * Refuse a body that would not fit in the store.
 *
 * `content` is optional on commands: the coordinator may pass it so the size is
 * checked before anything is written, while a command that only carries a patch
 * is bounded through `MAX_DOC_PATCH_BYTES`. `contentHash` is never recomputed
 * here — hashing belongs to `lib/shared-doc-merge.mjs`, and two implementations
 * of the same hash would be one too many.
 * @param {unknown} content - candidate body, if supplied.
 * @returns {void}
 */
function requireContentSize(content) {
  if (content === undefined || content === null) return;
  if (typeof content !== 'string') fail('DOC_COMMAND_INVALID', 'content must be a string');
  const bytes = utf8Bytes(normalizeContent(content));
  if (bytes > MAX_DOC_CONTENT_BYTES) {
    fail('DOC_CONTENT_TOO_LARGE', `a document body may not exceed ${MAX_DOC_CONTENT_BYTES} bytes`);
  }
}

/**
 * Normalize one canonical patch (`CleanHunk[]`, §5).
 *
 * The state layer does not apply patches — it only guarantees that what it
 * stores is a JSON round-trippable hunk list of bounded size, so a replica can
 * never be poisoned with a patch the merge layer cannot read back.
 * @param {unknown} value - candidate patch.
 * @param {string} label - field name for the error message.
 * @returns {object[] | null}
 */
function requirePatch(value, label) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) fail('DOC_PATCH_MISMATCH', `${label} must be a canonical patch (an array of hunks)`);
  const patch = value.map((hunk) => {
    if (!isPlainObject(hunk)) fail('DOC_PATCH_MISMATCH', `${label} hunks must be objects`);
    const { baseStart, baseCount, lines } = hunk;
    if (!Number.isSafeInteger(baseStart) || baseStart < 0) {
      fail('DOC_PATCH_MISMATCH', `${label} hunks need a non-negative baseStart`);
    }
    if (!Number.isSafeInteger(baseCount) || baseCount < 0) {
      fail('DOC_PATCH_MISMATCH', `${label} hunks need a non-negative baseCount`);
    }
    if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
      fail('DOC_PATCH_MISMATCH', `${label} hunks need a lines array of strings`);
    }
    return { baseStart, baseCount, lines: [...lines] };
  });
  const encoded = canonicalJson(patch);
  let roundTrip;
  try {
    roundTrip = JSON.parse(encoded);
  } catch {
    fail('DOC_PATCH_MISMATCH', `${label} must be JSON serializable`);
  }
  if (!sameJson(roundTrip, patch)) fail('DOC_PATCH_MISMATCH', `${label} must survive a JSON round trip`);
  if (utf8Bytes(encoded) > MAX_DOC_PATCH_BYTES) {
    fail('DOC_PATCH_TOO_LARGE', `a patch may not exceed ${MAX_DOC_PATCH_BYTES} bytes`);
  }
  return patch;
}

/**
 * Reject values a JSON document cannot carry.
 *
 * `detail` is copied verbatim into the replica, so a function or a `NaN` would
 * either vanish or turn into `null` on the wire and make two nodes hash the same
 * event differently.
 * @param {unknown} value - candidate node of the detail tree.
 * @param {string} path - position inside `detail`, for the error message.
 * @returns {void}
 */
function assertJsonTree(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('DOC_COMMAND_INVALID', `${path} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonTree(item, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) fail('DOC_COMMAND_INVALID', `${path}.${key} must not be undefined`);
      assertJsonTree(item, `${path}.${key}`);
    }
    return;
  }
  fail('DOC_COMMAND_INVALID', `${path} must be a scalar, an array or a plain object`);
}

/**
 * Normalize the free-form `detail` of an audit event.
 * @param {unknown} value - candidate detail.
 * @returns {object}
 */
function requireDetail(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) fail('DOC_COMMAND_INVALID', 'event.detail must be a plain object');
  assertJsonTree(value, 'event.detail');
  const detail = JSON.parse(canonicalJson(value));
  if (utf8Bytes(canonicalJson(detail)) > MAX_EVENT_DETAIL_BYTES) {
    fail('DOC_COMMAND_INVALID', `event.detail may not exceed ${MAX_EVENT_DETAIL_BYTES} bytes of JSON`);
  }
  return detail;
}

/* ------------------------------------------------------- record shapes --- */

/**
 * Normalize a `documents[]` record.
 *
 * Fields the state derives (`conflictCount`) are not taken from the caller: the
 * proposal log is the only truth about unresolved conflicts, and letting a
 * command assert a count would let one node claim zero conflicts the other node
 * can see. `deletedAt` is kept when the caller supplies it so a tombstone can
 * travel between nodes.
 * @param {unknown} raw - candidate document record.
 * @returns {object}
 */
function normalizeDocumentView(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'document must be an object');
  const format = raw.format === undefined || raw.format === null ? DOCUMENT_FORMAT : raw.format;
  if (format !== DOCUMENT_FORMAT) {
    fail('DOC_COMMAND_INVALID', `document.format must be '${DOCUMENT_FORMAT}'`);
  }
  const deletedAt = raw.deletedAt === undefined || raw.deletedAt === null
    ? null
    : requireTimestamp(raw.deletedAt, 'document.deletedAt');
  return {
    documentId: requireDocumentId(raw.documentId, 'document.documentId'),
    roomId: requireRoomId(raw.roomId, 'document.roomId'),
    title: requireTitle(raw.title),
    format,
    headRevisionId: requireRevisionId(raw.headRevisionId, 'document.headRevisionId'),
    contentHash: requireContentHash(raw.contentHash, 'document.contentHash'),
    createdBy: requireActorKey(raw.createdBy, 'document.createdBy'),
    createdAt: requireTimestamp(raw.createdAt, 'document.createdAt'),
    deletedAt,
    generation: requireCounter(raw.generation, 'document.generation'),
    seq: requireCounter(raw.seq, 'document.seq'),
    conflictCount: 0,
  };
}

/**
 * Normalize a `revisions[]` record.
 * @param {unknown} raw - candidate revision record.
 * @returns {object}
 */
function normalizeRevision(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'revision must be an object');
  return {
    revisionId: requireRevisionId(raw.revisionId, 'revision.revisionId'),
    proposalId: requireOptionalId(raw.proposalId, requireProposalId, 'revision.proposalId'),
    documentId: requireDocumentId(raw.documentId, 'revision.documentId'),
    parentRevisionId: requireOptionalRevisionId(raw.parentRevisionId, 'revision.parentRevisionId'),
    baseRevisionId: requireOptionalRevisionId(raw.baseRevisionId, 'revision.baseRevisionId'),
    authorKey: requireActorKey(raw.authorKey, 'revision.authorKey'),
    authorNodeName: requireDisplayName(raw.authorNodeName, ''),
    createdAt: requireTimestamp(raw.createdAt, 'revision.createdAt'),
    message: requireMessage(raw.message, 'revision.message'),
    patch: requirePatch(raw.patch, 'revision.patch'),
    resultHash: requireContentHash(raw.resultHash, 'revision.resultHash'),
    source: requireEnum(raw.source, REVISION_SOURCES, 'revision.source'),
    relatedTaskId: requireOptionalId(raw.relatedTaskId, requireIdPart, 'revision.relatedTaskId'),
    relatedMessageId: requireOptionalId(raw.relatedMessageId, requireIdPart, 'revision.relatedMessageId'),
    generation: requireCounter(raw.generation, 'revision.generation'),
    seq: requireCounter(raw.seq, 'revision.seq'),
  };
}

/**
 * Normalize one `ConflictHunk[]` block stored on a conflicted proposal.
 * @param {unknown} value - candidate conflict block.
 * @returns {object | null}
 */
function normalizeConflict(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) fail('DOC_COMMAND_INVALID', 'proposal.conflict must be an object or null');
  const { hunks, baseContentHash, currentContentHash } = value;
  if (!Array.isArray(hunks)) fail('DOC_COMMAND_INVALID', 'proposal.conflict.hunks must be an array');
  const normalizedHunks = hunks.map((hunk, index) => {
    if (!isPlainObject(hunk)) fail('DOC_COMMAND_INVALID', `proposal.conflict.hunks[${index}] must be an object`);
    const { baseStart, baseCount, currentLines, proposedLines } = hunk;
    if (!Number.isSafeInteger(baseStart) || baseStart < 0) {
      fail('DOC_COMMAND_INVALID', `proposal.conflict.hunks[${index}].baseStart must be a non-negative integer`);
    }
    if (!Number.isSafeInteger(baseCount) || baseCount < 0) {
      fail('DOC_COMMAND_INVALID', `proposal.conflict.hunks[${index}].baseCount must be a non-negative integer`);
    }
    for (const [field, lines] of [['currentLines', currentLines], ['proposedLines', proposedLines]]) {
      if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
        fail('DOC_COMMAND_INVALID', `proposal.conflict.hunks[${index}].${field} must be an array of strings`);
      }
    }
    return {
      baseStart,
      baseCount,
      currentLines: [...currentLines],
      proposedLines: [...proposedLines],
    };
  });
  return {
    hunks: normalizedHunks,
    baseContentHash: requireContentHash(baseContentHash, 'proposal.conflict.baseContentHash'),
    currentContentHash: requireContentHash(currentContentHash, 'proposal.conflict.currentContentHash'),
  };
}

/**
 * Normalize a `proposals[]` record.
 * @param {unknown} raw - candidate proposal record.
 * @returns {object}
 */
function normalizeProposal(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'proposal must be an object');
  const resolvedAt = raw.resolvedAt === undefined || raw.resolvedAt === null
    ? null
    : requireTimestamp(raw.resolvedAt, 'proposal.resolvedAt');
  return {
    proposalId: requireProposalId(raw.proposalId, 'proposal.proposalId'),
    documentId: requireDocumentId(raw.documentId, 'proposal.documentId'),
    baseRevisionId: requireOptionalRevisionId(raw.baseRevisionId, 'proposal.baseRevisionId'),
    authorKey: requireActorKey(raw.authorKey, 'proposal.authorKey'),
    authorNodeName: requireDisplayName(raw.authorNodeName, ''),
    createdAt: requireTimestamp(raw.createdAt, 'proposal.createdAt'),
    message: requireMessage(raw.message, 'proposal.message'),
    status: requireEnum(raw.status, PROPOSAL_STATUSES, 'proposal.status'),
    patch: requirePatch(raw.patch, 'proposal.patch'),
    resultHash: requireContentHash(raw.resultHash, 'proposal.resultHash'),
    conflict: normalizeConflict(raw.conflict),
    resolvedBy: raw.resolvedBy === undefined || raw.resolvedBy === null
      ? null
      : requireActorKey(raw.resolvedBy, 'proposal.resolvedBy'),
    resolvedAt,
  };
}

/**
 * Normalize a `maintainers[]` holder record.
 *
 * `actorKey` must agree with the node and session it claims: a holder whose key
 * names one session while its parts name another would grant rights to an
 * identity nobody can resolve.
 * @param {unknown} raw - candidate holder record.
 * @returns {object}
 */
function normalizeHolder(raw) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'holder must be an object');
  const nodeId = requireIdPart(raw.nodeId, 'holder.nodeId');
  const sessionId = requireIdPart(raw.sessionId, 'holder.sessionId');
  const actorKey = requireActorKey(raw.actorKey, 'holder.actorKey');
  if (actorKey !== `${nodeId}/${sessionId}`) {
    fail('DOC_COMMAND_INVALID', 'holder.actorKey must equal `${holder.nodeId}/${holder.sessionId}`');
  }
  return {
    actorKey,
    nodeId,
    sessionId,
    name: requireDisplayName(raw.name, sessionId),
    grantedBy: requireActorKey(raw.grantedBy, 'holder.grantedBy'),
    grantedAt: requireTimestamp(raw.grantedAt, 'holder.grantedAt'),
  };
}

/**
 * Normalize an audit event supplied by a command.
 *
 * `prevHash` and `hash` are computed by this module, because a chain only means
 * something if every node derives the same links. A caller that supplies them
 * anyway is checked rather than trusted.
 * @param {unknown} raw - candidate event.
 * @param {string} documentId - document the event must belong to.
 * @returns {object}
 */
function normalizeEvent(raw, documentId) {
  if (!isPlainObject(raw)) fail('DOC_COMMAND_INVALID', 'event must be an object');
  const claimedDocument = raw.documentId === undefined || raw.documentId === null
    ? documentId
    : requireDocumentId(raw.documentId, 'event.documentId');
  if (claimedDocument !== documentId) {
    fail('DOC_COMMAND_INVALID', `event.documentId must match the document being changed (${documentId})`);
  }
  const event = {
    eventId: requireEventId(raw.eventId, 'event.eventId'),
    documentId,
    generation: requireCounter(raw.generation, 'event.generation'),
    seq: requireCounter(raw.seq, 'event.seq'),
    type: requireEnum(raw.type, EVENT_TYPES, 'event.type'),
    actorKey: requireActorKey(raw.actorKey, 'event.actorKey'),
    nodeId: requireIdPart(raw.nodeId, 'event.nodeId'),
    at: requireTimestamp(raw.at, 'event.at'),
    baseRevisionId: requireOptionalRevisionId(raw.baseRevisionId, 'event.baseRevisionId'),
    headRevisionId: requireOptionalRevisionId(raw.headRevisionId, 'event.headRevisionId'),
    proposalId: requireOptionalId(raw.proposalId, requireProposalId, 'event.proposalId'),
    revisionId: requireOptionalRevisionId(raw.revisionId, 'event.revisionId'),
    detail: requireDetail(raw.detail),
  };
  if (event.actorKey.startsWith(`${event.nodeId}/`) === false) {
    fail('DOC_COMMAND_INVALID', 'event.actorKey must belong to event.nodeId');
  }
  return event;
}

/* --------------------------------------------------------------- state --- */

/**
 * The empty replicated state.
 * @returns {{ version: number, documents: object, revisions: object, proposals: object, events: object, maintainers: object }}
 */
export function emptyDocumentState() {
  return {
    version: DOC_STATE_VERSION,
    documents: {},
    revisions: {},
    proposals: {},
    events: {},
    maintainers: {},
    outbox: {},
    idempotency: {},
  };
}

/**
 * Refuse a state document this module cannot reason about.
 *
 * A missing map is tolerated (an older checkpoint may not have one yet), but a
 * non-object one means the caller is holding something else entirely, and
 * silently starting from empty would throw away a whole room's documents.
 * @param {unknown} state - candidate state.
 * @returns {object}
 */
function requireStateShape(state) {
  if (!isPlainObject(state)) fail('DOC_STORE_CORRUPT', 'shared document state must be an object');
  for (const key of STATE_MAPS) {
    const map = state[key];
    if (map !== undefined && !isPlainObject(map)) {
      fail('DOC_STORE_CORRUPT', `shared document state.${key} must be an object map`);
    }
  }
  return state;
}

/**
 * Copy the state one level deep.
 *
 * The maps are replaced wholesale and every record that changes is replaced by a
 * new object, so the caller's state — and every record it still references —
 * stays untouched. Deeper structural sharing is safe because nothing in this
 * module mutates a record it read.
 * @param {object} state - validated current state.
 * @returns {object} new state with copied maps.
 */
function cloneState(state) {
  const next = { version: DOC_STATE_VERSION };
  for (const key of STATE_MAPS) next[key] = { ...(state[key] ?? {}) };
  return next;
}

/**
 * Recompute the derived conflict count of one document.
 *
 * `conflictCount` is a projection of the proposal log, never an independently
 * stored truth: one counter that two commands can bump is one counter that two
 * nodes can disagree about. `documents[]` stays the cheap field the document
 * list needs, and this is the only place that writes it.
 * @param {object} state - state being built, mutated in place.
 * @param {string} documentId - document whose projection is refreshed.
 * @returns {void}
 */
function refreshConflictCount(state, documentId) {
  const document = state.documents[documentId];
  if (document === undefined) return;
  let count = 0;
  for (const proposal of Object.values(state.proposals)) {
    if (proposal.documentId === documentId && proposal.status === 'conflicted') count += 1;
  }
  if (document.conflictCount === count) return;
  state.documents[documentId] = { ...document, conflictCount: count };
}

/**
 * Load one document or explain why it cannot be read.
 * @param {object} state - current state.
 * @param {string} documentId - document to load.
 * @param {{ live?: boolean }} [options] - `live: false` also returns tombstones.
 * @returns {object}
 */
function requireDocument(state, documentId, { live = true } = {}) {
  const document = state.documents[documentId];
  if (document === undefined) fail('DOC_NOT_FOUND', `unknown document ${documentId}`);
  if (live && document.deletedAt !== null && document.deletedAt !== undefined) {
    fail('DOC_NOT_FOUND', `document ${documentId} is archived and can no longer be read or changed`);
  }
  return document;
}

/**
 * Load one revision that belongs to the given document.
 * @param {object} state - current state.
 * @param {string} revisionId - revision to load.
 * @param {string} documentId - document the caller expects it to belong to.
 * @param {string} code - error code to raise when it is not there.
 * @returns {object}
 */
function requireRevisionOf(state, revisionId, documentId, code) {
  const revision = state.revisions[revisionId];
  if (revision === undefined || revision.documentId !== documentId) {
    fail(code, `revision ${revisionId} is not part of document ${documentId}`);
  }
  return revision;
}

/**
 * Compare two `(generation, seq)` keys, §4.
 * @param {{ generation: number, seq: number }} left - first key.
 * @param {{ generation: number, seq: number }} right - second key.
 * @returns {number} negative when left sorts first.
 */
function compareKeys(left, right) {
  if (left.generation !== right.generation) return left.generation - right.generation;
  if (left.seq !== right.seq) return left.seq - right.seq;
  return 0;
}

/**
 * Refuse a head that does not sort after the one it claims to replace.
 *
 * A stale or forked head is not something the state layer can resolve: picking
 * one would make the document depend on arrival order, which §4 forbids, so the
 * conflict is surfaced and the coordinator pauses that document.
 * @param {object} previous - current document record.
 * @param {object} next - claimed new document record.
 * @returns {void}
 */
function requireHeadAdvance(previous, next) {
  if (compareKeys(previous, next) < 0) return;
  fail(
    'CONFLICTING_CHECKPOINT',
    `new head (generation ${next.generation}, seq ${next.seq}) must sort after the current head `
      + `(generation ${previous.generation}, seq ${previous.seq})`,
  );
}

/**
 * Refuse a document view that does not describe the revision it claims.
 *
 * The head pointer, the hash and the ordering key all have to agree, otherwise
 * the stored document would point at a revision whose text is not the text the
 * document claims to hold.
 * @param {object} document - claimed document record.
 * @param {object} revision - revision the document claims as head.
 * @returns {void}
 */
function requireHeadMatchesRevision(document, revision) {
  if (document.headRevisionId !== revision.revisionId) {
    fail('DOC_PATCH_MISMATCH', 'document.headRevisionId must name the revision being applied');
  }
  if (document.documentId !== revision.documentId) {
    fail('DOC_PATCH_MISMATCH', 'document.documentId must match revision.documentId');
  }
  if (document.contentHash !== revision.resultHash) {
    fail('DOC_PATCH_MISMATCH', 'document.contentHash must equal the head revision resultHash');
  }
  if (document.generation !== revision.generation || document.seq !== revision.seq) {
    fail('DOC_PATCH_MISMATCH', 'document (generation, seq) must equal the head revision (generation, seq)');
  }
}

/**
 * Whether a stored event carries exactly what the command asked to append.
 * @param {object} stored - event already in the log.
 * @param {object} event - normalized incoming event.
 * @returns {boolean}
 */
function eventMatches(stored, event) {
  return stored.eventId === event.eventId
    && stored.documentId === event.documentId
    && stored.generation === event.generation
    && stored.seq === event.seq
    && stored.type === event.type
    && stored.actorKey === event.actorKey
    && stored.nodeId === event.nodeId
    && stored.at === event.at
    && (stored.baseRevisionId ?? null) === (event.baseRevisionId ?? null)
    && (stored.headRevisionId ?? null) === (event.headRevisionId ?? null)
    && (stored.proposalId ?? null) === (event.proposalId ?? null)
    && (stored.revisionId ?? null) === (event.revisionId ?? null)
    && sameJson(stored.detail ?? {}, event.detail ?? {});
}

/**
 * The hashed content of one event: everything except `hash` itself, including
 * the link to its predecessor.
 * @param {object} event - normalized event.
 * @param {string} prevHash - hash of the previous event, or `''` for the first.
 * @returns {object}
 */
function eventBody(event, prevHash) {
  return {
    eventId: event.eventId,
    documentId: event.documentId,
    generation: event.generation,
    seq: event.seq,
    prevHash,
    type: event.type,
    actorKey: event.actorKey,
    nodeId: event.nodeId,
    at: event.at,
    baseRevisionId: event.baseRevisionId,
    headRevisionId: event.headRevisionId,
    proposalId: event.proposalId,
    revisionId: event.revisionId,
    detail: event.detail,
  };
}

/**
 * Extend one document's event log, sealing the new event with the chain hash.
 *
 * The log is the audit trail the two users will be shown, so a gap, a rewrite or
 * a silent reordering would be invisible damage. Appending is therefore the only
 * operation, an `eventId` may appear once, and a link that does not match the
 * tail is an error rather than a reason to start a new chain.
 * @param {object} state - state the log is read from; never mutated.
 * @param {string} documentId - document whose log grows.
 * @param {object} event - normalized event to append.
 * @returns {object[] | undefined} the new log, or `undefined` when it is already recorded.
 */
function appendEvent(state, documentId, event) {
  const existing = state.events[documentId];
  const log = Array.isArray(existing) ? existing : [];
  const known = log.find((item) => item.eventId === event.eventId);
  if (known !== undefined) {
    if (!eventMatches(known, event)) {
      fail('CONFLICTING_CHECKPOINT', `event ${event.eventId} is already recorded with different content`);
    }
    return undefined;
  }
  const prevHash = log.length === 0 ? '' : log[log.length - 1].hash;
  const body = eventBody(event, prevHash);
  const hash = sha256Hex(canonicalJson(body));
  return [...log, { ...body, hash }];
}

/* ------------------------------------------------------------ commands --- */

/**
 * `document/create` — a document and its first revision, in one step.
 *
 * There is no `document-created` audit type in §3, so the event type is left to
 * the coordinator (`document-imported` for an import, `proposal-accepted` for a
 * first edit accepted from the panel). Inventing a type here would put a value
 * in the replica that the frozen enum does not list.
 * @param {object} state - current state.
 * @param {object} command - the create command.
 * @returns {object} new state, or `state` itself when this is a replay.
 */
function applyCreate(state, command) {
  const document = normalizeDocumentView(command.document);
  const revision = normalizeRevision(command.revision);
  const event = normalizeEvent(command.event, document.documentId);
  requireHeadMatchesRevision(document, revision);
  requireContentSize(command.content);
  if (revision.parentRevisionId !== null) {
    fail('DOC_COMMAND_INVALID', 'the first revision of a document cannot have a parent');
  }
  const existing = state.documents[document.documentId];
  if (existing !== undefined) {
    // A retried create must be recognised from stored content. Anything else
    // reusing the id is a fork the state layer refuses to resolve (§4).
    const storedRevision = state.revisions[revision.revisionId];
    const storedEvent = (state.events[document.documentId] ?? []).find((item) => item.eventId === event.eventId);
    if (storedRevision !== undefined && storedEvent !== undefined
      && sameJson(existing, document) && sameJson(storedRevision, revision)
      && eventMatches(storedEvent, event)) {
      return state;
    }
    fail('CONFLICTING_CHECKPOINT', `document ${document.documentId} already exists with different content`);
  }
  const roomDocuments = Object.values(state.documents)
    .filter((item) => item.roomId === document.roomId).length;
  if (roomDocuments >= MAX_DOCUMENTS_PER_ROOM) {
    fail('DOC_LIMIT_REACHED', `room ${document.roomId} already holds ${MAX_DOCUMENTS_PER_ROOM} documents`);
  }
  const next = cloneState(state);
  const log = appendEvent(state, document.documentId, event);
  next.documents[document.documentId] = document;
  next.revisions[revision.revisionId] = revision;
  if (log !== undefined) next.events[document.documentId] = log;
  if (next.maintainers[document.documentId] === undefined) next.maintainers[document.documentId] = {};
  refreshConflictCount(next, document.documentId);
  return next;
}

/**
 * `document/rename` — change the title without touching the head.
 *
 * The audit event, not the title field, is what makes the rename replayable: a
 * second delivery of the same event is recognised and changes nothing.
 * @param {object} state - current state.
 * @param {object} command - the rename command.
 * @returns {object} new state, or `state` itself when already applied.
 */
function applyRename(state, command) {
  const documentId = requireDocumentId(command.documentId);
  const title = requireTitle(command.title);
  const document = requireDocument(state, documentId);
  const event = normalizeEvent(command.event, documentId);
  const log = appendEvent(state, documentId, event);
  if (log === undefined) {
    if (document.title !== title) {
      fail('CONFLICTING_CHECKPOINT', `event ${event.eventId} is recorded but did not produce title "${title}"`);
    }
    return state;
  }
  const next = cloneState(state);
  next.documents[documentId] = { ...document, title };
  next.events[documentId] = log;
  refreshConflictCount(next, documentId);
  return next;
}

/**
 * `document/archive` — write the tombstone, keep everything else.
 *
 * Archiving is a tombstone, never a delete: revisions and events stay readable
 * for history, and a peer that has not heard about the archive yet can still
 * catch up. The first `deletedAt` wins, so two nodes archiving at once converge
 * instead of flipping the timestamp back and forth.
 * @param {object} state - current state.
 * @param {object} command - the archive command.
 * @returns {object} new state, or `state` itself when already applied.
 */
function applyArchive(state, command) {
  const documentId = requireDocumentId(command.documentId);
  const document = requireDocument(state, documentId, { live: false });
  const at = requireTimestamp(command.at, 'at');
  const event = normalizeEvent(command.event, documentId);
  const log = appendEvent(state, documentId, event);
  if (log === undefined) return state;
  const next = cloneState(state);
  next.documents[documentId] = {
    ...document,
    deletedAt: document.deletedAt ?? at,
  };
  next.events[documentId] = log;
  refreshConflictCount(next, documentId);
  return next;
}

/**
 * `revision/append` — append an immutable revision and move the head.
 *
 * The revision is validated against the history it claims to extend: its parent
 * must be the current head, its base must exist, and the new head must sort
 * after the old one. A revision that fails those checks is either a stale
 * delivery or a fork, and §4 says the state layer must not guess which.
 * @param {object} state - current state.
 * @param {object} command - the append command.
 * @returns {object} new state, or `state` itself when this is a replay.
 */
function applyRevisionAppend(state, command) {
  const revision = normalizeRevision(command.revision);
  const documentId = revision.documentId;
  const document = normalizeDocumentView(command.document);
  const event = normalizeEvent(command.event, documentId);
  requireContentSize(command.content);
  const stored = state.revisions[revision.revisionId];
  if (stored !== undefined) {
    // The revision is already in history — either this is a retry, or it is a
    // replay that arrived after later revisions landed. Either way the head has
    // already moved and this command must not move it again; at most it still
    // owes the log its event.
    if (!sameJson(stored, revision)) {
      fail('CONFLICTING_CHECKPOINT', `revision ${revision.revisionId} is immutable and already exists`);
    }
    const log = appendEvent(state, documentId, event);
    if (log === undefined) return state;
    const next = cloneState(state);
    next.events[documentId] = log;
    return next;
  }
  requireHeadMatchesRevision(document, revision);
  // Only now is the document required to be live: a replay of an already
  // stored revision is still accepted for an archived document, because
  // dropping it would leave the peer's log short of an event it can prove.
  const current = requireDocument(state, documentId);
  if (document.roomId !== current.roomId
    || document.createdBy !== current.createdBy
    || document.createdAt !== current.createdAt) {
    fail('DOC_PATCH_MISMATCH', 'a new revision may not change the room or the creator of the document');
  }
  if (revision.parentRevisionId !== current.headRevisionId) {
    fail(
      'CONFLICTING_CHECKPOINT',
      `revision ${revision.revisionId} claims parent ${revision.parentRevisionId ?? 'none'} `
        + `but the head is ${current.headRevisionId}`,
    );
  }
  if (revision.baseRevisionId !== null) {
    requireRevisionOf(state, revision.baseRevisionId, documentId, 'DOC_BASE_NOT_FOUND');
  }
  requireHeadAdvance(current, document);
  const log = appendEvent(state, documentId, event);
  const next = cloneState(state);
  next.revisions[revision.revisionId] = revision;
  next.documents[documentId] = {
    ...document,
    // A revision never resurrects a tombstone: the stored tombstone wins.
    deletedAt: current.deletedAt ?? null,
    conflictCount: 0,
  };
  if (log !== undefined) next.events[documentId] = log;
  refreshConflictCount(next, documentId);
  return next;
}

/**
 * `proposal/put` — record a proposal, or recognise its retry.
 *
 * A proposal id is minted once by its author (§1), so the same id can only ever
 * mean the same proposal. Anything else reusing it is refused, which is what
 * stops one machine from quietly overwriting another machine's pending edit.
 * @param {object} state - current state.
 * @param {object} command - the put command.
 * @returns {object} new state, or `state` itself when this is a replay.
 */
function applyProposalPut(state, command) {
  const proposal = normalizeProposal(command.proposal);
  const documentId = proposal.documentId;
  requireDocument(state, documentId);
  if (proposal.baseRevisionId !== null) {
    requireRevisionOf(state, proposal.baseRevisionId, documentId, 'DOC_BASE_NOT_FOUND');
  }
  const stored = state.proposals[proposal.proposalId];
  if (stored !== undefined) {
    if (sameJson(stored, proposal)) return state;
    // One narrowing exception: resolving a conflict rewrites the conflicting
    // proposal in place, because the resolution is the same question ("what
    // should this pending change become?") answered differently. Everything that
    // identifies the proposal — document, base, author, creation time — must stay
    // byte-identical; only the proposed text, its patch/hash, the message and the
    // resolver may move. Any other reuse is still refused.
    if (isResolutionRefinement(stored, proposal)) {
      const next = cloneState(state);
      next.proposals[proposal.proposalId] = proposal;
      refreshConflictCount(next, documentId);
      return next;
    }
    fail(
      'DOC_PROPOSAL_ID_REUSED',
      `proposal ${proposal.proposalId} already exists with different content`
        + ' (a retry must reuse the id only for the same proposal)',
    );
  }
  if (openProposalCount(state, documentId) >= MAX_PROPOSALS_PER_DOC) {
    fail('DOC_LIMIT_REACHED', `document ${documentId} already holds ${MAX_PROPOSALS_PER_DOC} unresolved proposals`);
  }
  const next = cloneState(state);
  next.proposals[proposal.proposalId] = proposal;
  refreshConflictCount(next, documentId);
  return next;
}

/**
 * `proposal/status` — move one proposal along its lifecycle.
 *
 * The state layer does not police which status may follow which: the merge
 * layer decides the outcome and the coordinator decides who may announce it.
 * What it does enforce is that the status change and its audit event arrive
 * together, so the log can never describe a transition that did not happen.
 * @param {object} state - current state.
 * @param {object} command - the status command.
 * @returns {object} new state, or `state` itself when already applied.
 */
function applyProposalStatus(state, command) {
  const proposalId = requireProposalId(command.proposalId);
  const stored = state.proposals[proposalId];
  if (stored === undefined) fail('DOC_NOT_FOUND', `unknown proposal ${proposalId}`);
  const documentId = stored.documentId;
  requireDocument(state, documentId);
  const status = requireEnum(command.status, PROPOSAL_STATUSES, 'status');
  const resolvedBy = command.resolvedBy === undefined || command.resolvedBy === null
    ? null
    : requireActorKey(command.resolvedBy, 'resolvedBy');
  const resolvedAt = command.resolvedAt === undefined || command.resolvedAt === null
    ? null
    : requireTimestamp(command.resolvedAt, 'resolvedAt');
  const event = normalizeEvent(command.event, documentId);
  const log = appendEvent(state, documentId, event);
  if (log === undefined) {
    if (stored.status !== status) {
      fail('CONFLICTING_CHECKPOINT', `event ${event.eventId} is recorded but did not produce status ${status}`);
    }
    return state;
  }
  const next = cloneState(state);
  next.proposals[proposalId] = { ...stored, status, resolvedBy, resolvedAt };
  next.events[documentId] = log;
  refreshConflictCount(next, documentId);
  return next;
}

/**
 * `event/append` — add an audit event without touching the document.
 *
 * Exports and imports end up here: they change nothing about the content, but
 * both users need to see that they happened.
 * @param {object} state - current state.
 * @param {object} command - the append command.
 * @returns {object} new state, or `state` itself when already applied.
 */
function applyEventAppend(state, command) {
  const documentId = requireDocumentId(command.documentId);
  requireDocument(state, documentId, { live: false });
  const event = normalizeEvent(command.event, documentId);
  const log = appendEvent(state, documentId, event);
  if (log === undefined) return state;
  const next = cloneState(state);
  next.events[documentId] = log;
  return next;
}

/**
 * `maintainer/grant` — name one more session that may confirm resolutions.
 *
 * Grants are additive and the first one wins: re-sending a grant must not let a
 * later payload rewrite who was authorised earlier, and the extra delivery is
 * still recorded as an audit event.
 * @param {object} state - current state.
 * @param {object} command - the grant command.
 * @returns {object} new state, or `state` itself when already applied.
 */
function applyMaintainerGrant(state, command) {
  const documentId = requireDocumentId(command.documentId);
  requireDocument(state, documentId, { live: false });
  const holder = normalizeHolder(command.holder);
  const event = normalizeEvent(command.event, documentId);
  const log = appendEvent(state, documentId, event);
  const current = state.maintainers[documentId] ?? {};
  const known = current[holder.actorKey];
  if (known !== undefined && sameJson(known, holder) && log === undefined) return state;
  if (known === undefined && Object.keys(current).length >= MAX_MAINTAINERS_PER_DOC) {
    fail('DOC_LIMIT_REACHED', `document ${documentId} already names ${MAX_MAINTAINERS_PER_DOC} maintainers`);
  }
  if (log === undefined && known !== undefined) return state;
  const next = cloneState(state);
  if (known === undefined) next.maintainers[documentId] = { ...current, [holder.actorKey]: holder };
  if (log !== undefined) next.events[documentId] = log;
  return next;
}

/**
 * Apply one document command to the replicated state.
 *
 * Pure: the argument is never modified, and a command that changes nothing
 * returns that same object, so callers can cheaply detect a no-op (and a store
 * can skip a write).
 * @param {object} state - current state, as returned by `emptyDocumentState`.
 * @param {object} command - `{ type, ... }`, see `DOC_COMMAND_TYPES`.
 * @returns {object} the next state, or `state` unchanged for a replay.
 */
export function applyDocumentCommand(state, command) {
  requireStateShape(state);
  if (!isPlainObject(command)) fail('DOC_COMMAND_INVALID', 'a document command must be an object');
  switch (command.type) {
    case 'document/create':
      return applyCreate(state, command);
    case 'document/rename':
      return applyRename(state, command);
    case 'document/archive':
      return applyArchive(state, command);
    case 'revision/append':
      return applyRevisionAppend(state, command);
    case 'proposal/put':
      return applyProposalPut(state, command);
    case 'proposal/status':
      return applyProposalStatus(state, command);
    case 'event/append':
      return applyEventAppend(state, command);
    case 'maintainer/grant':
      return applyMaintainerGrant(state, command);
    default:
      return fail('DOC_COMMAND_INVALID', `unknown document command: ${String(command.type)}`);
  }
}

/* --------------------------------------------------------------- reads --- */

/**
 * Whether a document record is a tombstone.
 * @param {object | undefined} document - document record.
 * @returns {boolean}
 */
export function isDocumentArchived(document) {
  return document !== undefined && document.deletedAt !== null && document.deletedAt !== undefined;
}

/**
 * The live documents of one room, in a stable order.
 *
 * Sorted by title then id so the panel does not reshuffle when a document is
 * merely re-read; the request order of an object map is not an order anyone
 * agreed on.
 * @param {object} state - current state.
 * @param {string} roomId - room to list.
 * @param {{ includeArchived?: boolean }} [options] - tombstones are hidden by default.
 * @returns {object[]}
 */
export function documentsForRoom(state, roomId, { includeArchived = false } = {}) {
  const id = requireRoomId(roomId);
  return Object.values(state.documents ?? {})
    .filter((document) => document.roomId === id && (includeArchived || !isDocumentArchived(document)))
    .sort((left, right) => {
      if (left.title !== right.title) return left.title < right.title ? -1 : 1;
      if (left.documentId === right.documentId) return 0;
      return left.documentId < right.documentId ? -1 : 1;
    });
}

/**
 * The revisions of one document, oldest first by `(generation, seq)`.
 * @param {object} state - current state.
 * @param {string} documentId - document to walk.
 * @returns {object[]}
 */
export function revisionsForDocument(state, documentId) {
  const id = requireDocumentId(documentId);
  return Object.values(state.revisions ?? {})
    .filter((revision) => revision.documentId === id)
    .sort((left, right) => compareKeys(left, right)
      || (left.revisionId < right.revisionId ? -1 : left.revisionId > right.revisionId ? 1 : 0));
}

/**
 * The audit log of one document, oldest first. A copy, so callers cannot append
 * to the replica by mutating the returned array.
 * @param {object} state - current state.
 * @param {string} documentId - document to walk.
 * @returns {object[]}
 */
export function eventsForDocument(state, documentId) {
  const id = requireDocumentId(documentId);
  const log = state.events?.[id];
  return Array.isArray(log) ? [...log] : [];
}

/**
 * The proposals of one document, oldest first.
 * @param {object} state - current state.
 * @param {string} documentId - document to walk.
 * @returns {object[]}
 */
export function proposalsForDocument(state, documentId) {
  const id = requireDocumentId(documentId);
  return Object.values(state.proposals ?? {})
    .filter((proposal) => proposal.documentId === id)
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
      if (left.proposalId === right.proposalId) return 0;
      return left.proposalId < right.proposalId ? -1 : 1;
    });
}

/**
 * How many proposals of one document are still unresolved.
 * @param {object} state - current state.
 * @param {string} documentId - document to count.
 * @returns {number}
 */
export function openProposalCount(state, documentId) {
  const id = requireDocumentId(documentId);
  let count = 0;
  for (const proposal of Object.values(state.proposals ?? {})) {
    if (proposal.documentId === id && OPEN_PROPOSAL_STATUSES.includes(proposal.status)) count += 1;
  }
  return count;
}

/**
 * The maintainers of one document, keyed by actor key.
 * @param {object} state - current state.
 * @param {string} documentId - document to inspect.
 * @returns {object}
 */
export function maintainersOfDocument(state, documentId) {
  const id = requireDocumentId(documentId);
  return { ...(state.maintainers?.[id] ?? {}) };
}
