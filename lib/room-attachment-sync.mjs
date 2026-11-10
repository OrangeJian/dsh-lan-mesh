/**
 * Read-only Leader manifest sync for Room attachment history.
 *
 * A member that joins a room AFTER an attachment message was committed has no
 * attachment reference of its own: `rooms.json` is merged by timestamps and
 * deliberately carries no attachment data, and the original sender may be long
 * offline. The Leader, however, holds the durable committed ledger. This module
 * lets an authorized member page through exactly those committed messages.
 *
 * Design rules (M3 Task 4):
 *  - The manifest is a SEPARATE, explicitly versioned channel. Attachment data
 *    is never pushed into the room-state document and never impersonates a
 *    remote prepare/commit.
 *  - The original author is preserved. The Leader is the relay/attestor, not a
 *    new sender: it never re-signs a message as if it were the author.
 *  - Only committed messages of THAT room are exposed. Prepared intents, other
 *    rooms, local paths, secrets and arbitrary chat data are never returned.
 *  - Requests and responses are authenticated and content-hashed with the same
 *    shared-secret HMAC envelope style used elsewhere, and requests are
 *    time-windowed plus nonce-replayed within that window.
 *  - Everything is bounded: page size (default 50, max 100), response bytes
 *    (1 MiB) and a strict entry normalizer. A page is never silently truncated.
 *
 * @module dsh-lan-mesh/lib/room-attachment-sync
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PROTOCOL_VERSION, normalizeRoomId } from './transport.mjs';
import { normalizeRoomAttachments, normalizeRoomMessageMetadata } from './room-message.mjs';

/** Path of the read-only manifest endpoint. */
export const SYNC_PATH = '/lan-mesh/v1/room-attachment-sync';
/** Wire version of the manifest payloads. */
export const SYNC_VERSION = 1;
/** Capability a Leader advertises in /info. */
export const SYNC_CAPABILITY = 1;
/** Default and maximum page sizes. */
export const SYNC_DEFAULT_PAGE = 50;
export const SYNC_MAX_PAGE = 100;
/** Hard response bound, in bytes. */
export const SYNC_MAX_BODY_BYTES = 1024 * 1024;
/** Request timestamp window; also the nonce-retention window. */
export const SYNC_WINDOW_MS = 120000;
/** Largest accepted request body. */
export const SYNC_MAX_REQUEST_BYTES = 16 * 1024;
const HEX = /^[a-f0-9]{64}$/;

function fail(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  throw error;
}

function value(input) {
  return typeof input === 'function' ? input() : input;
}

function sameDigest(expected, given) {
  if (typeof given !== 'string' || !HEX.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/**
 * Canonical string a Leader and a client both sign for a request.
 * @param {object} payload - request payload.
 * @returns {string}
 */
export function syncRequestInput(payload) {
  return [
    'roomAttachmentSync:1',
    'request',
    String(payload?.v ?? ''),
    String(payload?.id ?? ''),
    String(payload?.from?.nodeId ?? ''),
    String(payload?.to ?? ''),
    String(payload?.room ?? ''),
    String(payload?.cursor ?? ''),
    String(payload?.limit ?? ''),
    String(payload?.sentAt ?? ''),
    String(payload?.nonce ?? ''),
  ].join('\n');
}

/**
 * Canonical string a Leader and a client both sign for a response.
 * The page content is bound through `hash`, so a relay cannot swap entries.
 * @param {object} payload - response payload.
 * @returns {string}
 */
export function syncResponseInput(payload) {
  return [
    'roomAttachmentSync:1',
    'response',
    String(payload?.room ?? ''),
    String(payload?.nextCursor ?? ''),
    String(payload?.hash ?? ''),
    String(payload?.leader ?? ''),
    String(payload?.requestNonce ?? ''),
  ].join('\n');
}

/** Sign (or, with an empty secret, leave unsigned) a canonical string. */
function sign(input, secret) {
  return secret ? createHmac('sha256', secret).update(input).digest('hex') : '';
}

/** Verify a signature; an empty secret means the cluster is open. */
function verify(input, secret, signature) {
  if (!secret) return true;
  return sameDigest(sign(input, secret), String(signature ?? ''));
}

/**
 * Canonical fingerprint of one committed message's immutable content.
 *
 * Deliberately excludes delivery details (`to`, the prepare/commit phase, the
 * relay hop) and uses an explicit field order, so two honest nodes compute the
 * same value without depending on object key order.
 * @param {object} envelope - message envelope.
 * @returns {string}
 */
export function attachmentFingerprint(envelope) {
  return JSON.stringify([
    envelope?.id,
    envelope?.room,
    envelope?.from?.nodeId,
    envelope?.from?.sessionId,
    envelope?.text,
    envelope?.mentions ?? null,
    envelope?.skillRefs ?? null,
    envelope?.attachments ?? null,
  ]);
}

/**
 * Hash of one page: room + cursor + every entry's immutable fields.
 * @param {string} roomId - room the page belongs to.
 * @param {string} nextCursor - cursor this page hands out.
 * @param {object[]} entries - normalized page entries.
 * @returns {string}
 */
export function syncPageHash(roomId, nextCursor, entries) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([
    'roomAttachmentSync:1',
    roomId,
    nextCursor,
    entries.map((entry) => [
      entry.id,
      entry.from.nodeId,
      entry.from.sessionId,
      entry.fingerprint,
      entry.receivedAt,
    ]),
  ]));
  return hash.digest('hex');
}

function bounded(value, limit, code = 'BAD_FIELD') {
  if (typeof value !== 'string' || value === '' || Buffer.byteLength(value) > limit || /[\x00-\x1f\x7f]/.test(value)) fail(code);
  return value;
}

/**
 * Normalize one manifest entry received from a Leader. The author identity is
 * the original sender and is what the client trusts; the Leader only attests it.
 * @param {unknown} raw - untrusted entry.
 * @returns {object}
 */
export function normalizeSyncEntry(raw) {
  if (!raw || typeof raw !== 'object') fail('BAD_ENTRY');
  const from = raw.from;
  if (!from || typeof from.nodeId !== 'string' || !from.nodeId || from.nodeId.length > 64) fail('BAD_ENTRY');
  if (typeof from.sessionId !== 'string' || !from.sessionId || from.sessionId.length > 64) fail('BAD_ENTRY');
  const envelope = {
    id: bounded(raw.id, 64, 'BAD_ENTRY'),
    room: normalizeRoomId(raw.room),
    from: {
      nodeId: from.nodeId,
      sessionId: from.sessionId,
      ...(typeof from.name === 'string' && from.name ? { name: bounded(from.name, 128, 'BAD_ENTRY') } : {}),
      ...(typeof from.title === 'string' && from.title ? { title: bounded(from.title, 128, 'BAD_ENTRY') } : {}),
    },
    kind: raw.kind === 'room-message' ? 'room-message' : (fail('BAD_ENTRY'), ''),
    topic: typeof raw.topic === 'string' ? raw.topic.slice(0, 128) : '',
    text: typeof raw.text === 'string' ? raw.text.slice(0, 32000) : '',
    sentAt: bounded(raw.sentAt, 64, 'BAD_ENTRY'),
    attachmentsVersion: 1,
    attachmentPhase: 'prepare',
    attachments: normalizeRoomAttachments(raw.attachments),
  };
  if (!envelope.room) fail('BAD_ENTRY');
  Object.assign(envelope, normalizeRoomMessageMetadata(raw));
  if (envelope.attachments.some((ref) => ref.ownerNodeId !== envelope.from.nodeId)) fail('BAD_ENTRY');
  const receivedAt = bounded(raw.receivedAt, 64, 'BAD_ENTRY');
  if (!Number.isFinite(Date.parse(receivedAt))) fail('BAD_ENTRY');
  const fingerprint = attachmentFingerprint(envelope);
  // A Leader that sends a fingerprint inconsistent with its own content is
  // broken or hostile; the client drops the page rather than importing it.
  if (typeof raw.fingerprint === 'string' && raw.fingerprint !== fingerprint) fail('BAD_ENTRY');
  return { ...envelope, receivedAt, fingerprint };
}

/**
 * Build a signed request.
 * @param {object} options - target and page parameters.
 * @returns {{ body: string, headers: object }}
 */
export function encodeSyncRequest({ nodeId, peer, secret = '', roomId, cursor = '', limit = SYNC_DEFAULT_PAGE, now = Date.now(), nonce = randomUUID() }) {
  if (!normalizeRoomId(roomId) || roomId !== normalizeRoomId(roomId)) fail('BAD_REQUEST');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SYNC_MAX_PAGE) fail('BAD_REQUEST');
  const payload = {
    v: PROTOCOL_VERSION,
    syncVersion: SYNC_VERSION,
    id: randomUUID(),
    from: { nodeId: bounded(nodeId, 64) },
    to: bounded(peer.nodeId, 64),
    room: roomId,
    cursor: typeof cursor === 'string' ? cursor : '',
    limit,
    sentAt: String(now),
    nonce: bounded(nonce, 128),
  };
  payload.sig = sign(syncRequestInput(payload), secret);
  return { body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } };
}

/**
 * Fetch one page from a Leader.
 * @param {object} options - peer, OUR node id, secret and page parameters.
 * @returns {Promise<{ entries: object[], nextCursor: string, leader: string }>}
 */
export async function fetchAttachmentManifest(options) {
  const { peer, nodeId, secret = '', roomId, cursor = '', limit = SYNC_DEFAULT_PAGE, timeoutMs = 8000 } = options;
  // The requester identity is signed and is what the Leader authorizes against
  // current membership, so it is required rather than inferred.
  if (typeof nodeId !== 'string' || nodeId === '') fail('BAD_REQUEST');
  // Discovery records carry `httpPort`; direct callers may pass `port`.
  const httpPort = peer?.httpPort ?? peer?.port;
  if (!Number.isSafeInteger(httpPort) || httpPort <= 0) fail('BAD_REQUEST');
  const signed = encodeSyncRequest({ ...options, cursor, limit });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`http://${peer.address}:${httpPort}${SYNC_PATH}`, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal,
    });
    const chunks = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > SYNC_MAX_BODY_BYTES) {
            await reader.cancel();
            fail('SYNC_PAGE_TOO_LARGE', 413);
          }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    }
    const text = Buffer.concat(chunks, total).toString('utf8');
    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed?.code === 'string') code = parsed.code;
        else if (typeof parsed?.error === 'string') code = parsed.error;
      } catch { /* keep the HTTP status */ }
      fail(code, response.status);
    }
    let page;
    try { page = JSON.parse(text); } catch { fail('BAD_RESPONSE'); }
    if (!page || page.ok !== true || page.syncVersion !== SYNC_VERSION) fail('BAD_RESPONSE');
    if (page.room !== roomId || page.leader !== peer.nodeId) fail('BAD_RESPONSE');
    if (!Array.isArray(page.entries) || page.entries.length > limit || page.entries.length > SYNC_MAX_PAGE) fail('BAD_RESPONSE');
    const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor : (fail('BAD_RESPONSE'), '');
    const entries = page.entries.map(normalizeSyncEntry);
    // The page hash binds room + cursor + every entry, so a relay cannot drop,
    // reorder or substitute a message without the client noticing.
    if (page.hash !== syncPageHash(roomId, nextCursor, entries)) fail('BAD_PAGE_HASH');
    const signatureInput = syncResponseInput({ room: roomId, nextCursor, hash: page.hash, leader: peer.nodeId, requestNonce: signedNonce(signed.body) });
    if (!verify(signatureInput, secret, page.sig)) fail('BAD_SIGNATURE', 401);
    return { entries, nextCursor, leader: page.leader };
  } finally {
    clearTimeout(timer);
  }
}

/** Nonce echoed back by the Leader, so an old page cannot be replayed as new. */
function signedNonce(body) {
  try { return String(JSON.parse(body)?.nonce ?? ''); } catch { return ''; }
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error('REQUEST_TOO_LARGE'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(bytes.length), 'cache-control': 'no-store' });
  response.end(bytes);
}

/**
 * Leader-side handler for the read-only manifest endpoint.
 *
 * `serve` owns the authorization and the page read: it receives
 * `{ roomId, fromNodeId, cursor, limit }` and returns `{ entries, nextCursor }`
 * or throws an error carrying `status`/`code`. It must only ever expose
 * committed messages of that room.
 * @param {object} options - identity, secret and page source.
 * @returns {((request: object, response: object) => Promise<void>) & { close: () => void }}
 */
export function createSyncHandler({ nodeId, secret = '', trustedPeers = [], clock = Date.now, requestWindowMs = SYNC_WINDOW_MS, serve, warn = console.warn }) {
  const nonces = new Map();
  let closed = false;
  let warned = false;
  const handler = async (request, response) => {
    try {
      if (closed) fail('CLOSED', 503);
      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 405);
      const raw = await readBody(request, SYNC_MAX_REQUEST_BYTES);
      let payload;
      try { payload = JSON.parse(raw); } catch { fail('BAD_JSON'); }
      if (!payload || typeof payload !== 'object') fail('BAD_JSON');
      if (payload.syncVersion !== SYNC_VERSION) fail('UNSUPPORTED_SYNC_VERSION', 400);
      if (payload.to !== value(nodeId)) fail('WRONG_TARGET', 403);
      const roomId = normalizeRoomId(payload.room);
      if (!roomId || roomId !== payload.room) fail('BAD_ROOM');
      const fromNodeId = typeof payload.from?.nodeId === 'string' ? payload.from.nodeId : '';
      if (!fromNodeId || fromNodeId.length > 64) fail('BAD_SENDER');
      if (!Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > SYNC_MAX_PAGE) fail('BAD_LIMIT');
      const cursor = typeof payload.cursor === 'string' ? payload.cursor : '';
      const sentAt = Number(payload.sentAt);
      if (!Number.isSafeInteger(sentAt) || String(sentAt) !== payload.sentAt) fail('BAD_TIME');
      if (typeof payload.nonce !== 'string' || !payload.nonce || payload.nonce.length > 128) fail('BAD_NONCE');
      const key = value(secret);
      if (typeof key !== 'string') fail('BAD_POLICY', 503);
      if (key && !verify(syncRequestInput(payload), key, payload.sig)) fail('BAD_SIGNATURE', 401);
      if (!key && !warned) {
        warned = true;
        warn('WARNING: lan-mesh is open (no clusterSecret) — attachment history sync is unauthenticated');
      }
      const trusted = value(trustedPeers);
      if (!Array.isArray(trusted) || (trusted.length && !trusted.includes(fromNodeId))) fail('UNTRUSTED', 403);
      const now = clock();
      if (Math.abs(now - sentAt) > requestWindowMs) fail('EXPIRED', 401);
      // Replay state is in-memory and therefore per-process. Requests are time
      // windowed, so after a restart the protection degrades to "not older than
      // requestWindowMs" rather than silently accepting arbitrary replays.
      for (const [nonceKey, expires] of nonces) if (expires < now) nonces.delete(nonceKey);
      const nonceKey = JSON.stringify([fromNodeId, payload.nonce]);
      if (nonces.has(nonceKey)) fail('REPLAY', 409);
      if (nonces.size >= 10000) fail('REPLAY_LEDGER_FULL', 503);
      nonces.set(nonceKey, sentAt + requestWindowMs);

      const served = await serve({ roomId, fromNodeId, cursor, limit: payload.limit });
      const entries = (served?.entries ?? []).map(normalizeSyncEntry);
      const nextCursor = typeof served?.nextCursor === 'string' ? served.nextCursor : '';
      const hash = syncPageHash(roomId, nextCursor, entries);
      const body = {
        ok: true,
        syncVersion: SYNC_VERSION,
        room: roomId,
        leader: value(nodeId),
        entries,
        nextCursor,
        hash,
        requestNonce: payload.nonce,
      };
      body.sig = sign(syncResponseInput(body), key);
      const bytes = Buffer.byteLength(JSON.stringify(body));
      // A page that would exceed the response budget is an explicit error, never
      // a truncated list that would look like a complete (but wrong) manifest.
      if (bytes > SYNC_MAX_BODY_BYTES) fail('SYNC_PAGE_TOO_LARGE', 413);
      if (closed || response.destroyed) return;
      sendJson(response, 200, body);
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy();
      else {
        // Surface the policy code (NOT_LEADER / FORBIDDEN / UNKNOWN_ROOM ...) so
        // a caller can tell an authorization refusal from a transient failure.
        const status = error?.status ?? 500;
        const code = status === 500 ? 'SYNC_FAILED' : (error?.code ?? error?.message ?? 'SYNC_FAILED');
        sendJson(response, status, { ok: false, code, error: code });
      }
    }
  };
  handler.close = () => { closed = true; nonces.clear(); };
  return handler;
}
