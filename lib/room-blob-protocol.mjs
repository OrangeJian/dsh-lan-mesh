import http from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { normalizeRoomId } from './transport.mjs';

const PREFIX = '/lan-mesh/v1/room-blobs/';
const HEX = /^[a-f0-9]{64}$/;
const H = 'x-room-blob-';
const FIELDS = ['room', 'sender', 'target', 'time', 'nonce', 'digest', 'size', 'metadata'];
const OPEN_WARNING = 'WARNING: lan-mesh is open (no clusterSecret, no trustedPeers) — any machine on this LAN can read and send mesh traffic';
function fail(code, status = 400) { const error = new Error(code); error.status = status; throw error; }
function bounded(value, limit = 256) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > limit || /[\x00-\x1f\x7f]/.test(value)) fail('BAD_HEADER');
  return value;
}
function metadata(ref) {
  const name = bounded(ref.name, 255), mediaType = bounded(ref.mediaType);
  if (/[\\/:*?"<>|]/.test(name) || /^[. ]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) fail('BAD_FILENAME');
  if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[\x20-\x7e]+)?$/.test(mediaType)) fail('BAD_MEDIA_TYPE');
  return Buffer.from(JSON.stringify({ name, mediaType })).toString('base64url');
}
function canonical(method, path, headers) { return JSON.stringify(['roomBlobs:1', method, path, ...FIELDS.map(k => headers[H+k])]); }
function signature(method, path, headers, secret) { return createHmac('sha256', secret).update(canonical(method, path, headers)).digest('hex'); }
function same(a, b) { return typeof b === 'string' && HEX.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function value(input) { return typeof input === 'function' ? input() : input; }

/** Canonical request builder, also useful for non-helper peer implementations. */
export function encodeBlobRequest({ method, nodeId, peer, secret = '', roomId, attachment, now = Date.now(), nonce = randomUUID() }) {
  if (!['GET', 'PUT'].includes(method) || normalizeRoomId(roomId) !== roomId || !roomId || !HEX.test(attachment.blobId) || !Number.isSafeInteger(attachment.size) || attachment.size < 0) fail('BAD_REQUEST');
  const path = PREFIX + attachment.blobId;
  const headers = Object.fromEntries(Object.entries({ room: roomId, sender: bounded(nodeId), target: bounded(peer.nodeId), time: String(now), nonce: bounded(nonce, 128), digest: attachment.blobId, size: String(attachment.size), metadata: metadata(attachment) }).map(([k,v]) => [H+k,v]));
  headers[H+'signature'] = secret ? signature(method, path, headers, secret) : '';
  if (method === 'PUT') { headers['content-length'] = String(attachment.size); headers['content-type'] = attachment.mediaType; }
  return { method, path, headers };
}

/** Optional MeshServer onBlob hook; authorize must affirm membership AND access. */
export function createBlobHandler({ store, nodeId, secret = '', trustedPeers = [], authorize, onReceived, clock = Date.now, requestWindowMs = 120000, maxFileBytes = 20971520, warn = console.warn }) {
  const nonces = new Map(), active = new Set();
  let closed = false, warned = false;
  const handler = async (req, res) => {
    active.add(req); active.add(res);
    const cleanup = () => { active.delete(req); active.delete(res); };
    res.once('close', cleanup);
    try {
      if (closed) fail('CLOSED', 503);
      const path = req.url;
      if (!['GET', 'PUT'].includes(req.method)) fail('METHOD_NOT_ALLOWED', 405);
      if (!path?.startsWith(PREFIX) || !HEX.test(path.slice(PREFIX.length))) fail('BAD_PATH');
      if (req.headers.range !== undefined) fail('RANGE_UNSUPPORTED', 416);
      const h = req.headers;
      for (const field of FIELDS) bounded(h[H+field], field === 'metadata' ? 2048 : 256);
      // Reject ambiguous repeated headers even if Node has folded their values.
      for (const field of [...FIELDS, 'signature']) if (req.rawHeaders.filter((v,i) => i % 2 === 0 && v.toLowerCase() === H+field).length > 1) fail('BAD_HEADER');
      const roomId = h[H+'room'], senderNodeId = h[H+'sender'], blobId = h[H+'digest'];
      if (!roomId || normalizeRoomId(roomId) !== roomId || blobId !== path.slice(PREFIX.length)) fail('BAD_REQUEST');
      if (h[H+'target'] !== value(nodeId)) fail('WRONG_TARGET', 403);
      const trusted = value(trustedPeers);
      if (!Array.isArray(trusted) || (trusted.length && !trusted.includes(senderNodeId))) fail('UNTRUSTED', 403);
      const key = value(secret);
      if (typeof key !== 'string') fail('BAD_POLICY', 503);
      if (key && !same(signature(req.method, path, h, key), h[H+'signature'])) fail('BAD_SIGNATURE', 401);
      if (!key && !warned) {
        warned = true;
        warn(trusted.length ? 'WARNING: lan-mesh is open (no clusterSecret) — peer identities are unauthenticated' : OPEN_WARNING);
      }
      const time = Number(h[H+'time']), size = Number(h[H+'size']), now = clock();
      if (!Number.isSafeInteger(time) || String(time) !== h[H+'time'] || Math.abs(now-time) > requestWindowMs) fail('EXPIRED', 401);
      if (!Number.isSafeInteger(size) || size < 0 || String(size) !== h[H+'size']) fail('BAD_SIZE');
      if (size > maxFileBytes) fail('TOO_LARGE', 413);
      let meta;
      try { meta = JSON.parse(Buffer.from(h[H+'metadata'], 'base64url').toString('utf8')); } catch { fail('BAD_METADATA'); }
      if (metadata(meta) !== h[H+'metadata']) fail('BAD_METADATA');
      if (req.method === 'PUT' && (h['content-type'] !== meta.mediaType || (h['content-length'] !== undefined && h['content-length'] !== String(size)))) fail('BAD_CONTENT_HEADERS');
      if (req.method === 'GET' && (h['transfer-encoding'] || (h['content-length'] && h['content-length'] !== '0'))) fail('GET_BODY_UNSUPPORTED');
      for (const [k, expires] of nonces) if (expires < now) nonces.delete(k);
      const nonceKey = JSON.stringify([senderNodeId, h[H+'nonce']]);
      if (nonces.has(nonceKey)) fail('REPLAY', 409);
      if (nonces.size >= 10000) fail('REPLAY_LEDGER_FULL', 503);
      nonces.set(nonceKey, time + requestWindowMs);
      let allowed = false;
      try { allowed = typeof authorize === 'function' && await authorize({ operation: req.method === 'PUT' ? 'put' : 'get', roomId, senderNodeId, blobId }) === true; } catch { /* Fail closed. */ }
      if (!allowed) fail('FORBIDDEN', 403);
      if (closed || req.destroyed || res.destroyed) fail('CLOSED', 503);
      if (req.method === 'PUT') {
        const ref = await store.put(req, { ...meta, blobId, size, ownerNodeId: senderNodeId });
        // Persist a narrowly-scoped receipt BEFORE acknowledging the bytes. A
        // commit may only succeed for this exact prepared intent when this
        // durable proof exists; node-wide dedup / store.has() is never proof.
        // If the receipt cannot be made durable, the PUT fails closed.
        if (typeof onReceived === 'function') {
          let recorded = false;
          try { recorded = await onReceived({ operation: 'put', roomId, senderNodeId, ref }) === true; }
          catch { recorded = false; }
          if (!recorded) fail('RECEIPT_UNAVAILABLE', 503);
        }
        res.writeHead(201, { 'content-length': '0' }); res.end();
      } else {
        if (!await store.has(blobId)) fail('NOT_FOUND', 404);
        const stream = await store.openRead(blobId);
        active.add(stream);
        const abort = () => stream.destroy();
        res.once('close', abort);
        try {
          if (closed || res.destroyed) fail('CLOSED', 503);
          res.writeHead(200, { 'content-type': meta.mediaType, 'content-length': String(size), [H+'digest']: blobId, 'cache-control': 'no-store' });
          await pipeline(stream, res);
        } finally { stream.destroy(); active.delete(stream); res.off('close', abort); }
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) res.destroy();
      else { const body = Buffer.from(error.status ? error.message : 'BLOB_TRANSFER_FAILED'); res.writeHead(error.status ?? 400, { 'content-type': 'text/plain', 'content-length': String(body.length), connection: 'close' }); res.end(body); }
    }
  };
  handler.close = () => { closed = true; for (const stream of active) stream.destroy(); active.clear(); };
  return handler;
}

async function boundedBody(res) {
  let size = 0; const parts = [];
  for await (const b of res) { size += b.length; if (size > 4096) { res.destroy(); fail('RESPONSE_TOO_LARGE'); } parts.push(b); }
  return Buffer.concat(parts).toString('utf8');
}
async function transfer(options, method) {
  const { peer, readable, store, signal, timeoutMs = 15000 } = options;
  if (peer?.roomBlobs !== 1) fail('UNSUPPORTED');
  const signed = encodeBlobRequest({ ...options, method });
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let req, response;
  const abort = () => { readable?.destroy(); req?.destroy(new Error('ABORTED')); response?.destroy(new Error('ABORTED')); };
  combined.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (combined.aborted) { abort(); fail('ABORTED'); }
    const responsePromise = new Promise((resolve, reject) => {
      req = http.request({ hostname: peer.address, port: peer.port, method, path: signed.path, headers: signed.headers, agent: false }, resolve);
      req.on('error', reject);
    });
    let upload;
    if (method === 'PUT') { upload = pipeline(readable, req); upload.catch(() => {}); }
    else req.end();
    response = await responsePromise;
    if (response.statusCode !== (method === 'PUT' ? 201 : 200)) fail(`HTTP_${response.statusCode}: ${await boundedBody(response)}`);
    if (method === 'PUT') { await boundedBody(response); await upload; return options.attachment; }
    const ref = options.attachment;
    if (response.headers['content-length'] !== String(ref.size) || response.headers['content-type'] !== ref.mediaType || response.headers[H+'digest'] !== ref.blobId || response.headers['transfer-encoding']) fail('BAD_RESPONSE_HEADERS');
    return await store.put(response, { ...ref, ownerNodeId: peer.nodeId });
  } finally {
    clearTimeout(timer); combined.removeEventListener('abort', abort);
    readable?.destroy(); response?.destroy(); req?.destroy();
  }
}
/** Upload a Node readable, without JSON buffering or redirect handling. */
export async function sendBlob(options) { return transfer(options, 'PUT'); }
/** Download to a store; put publishes only after digest and length verification. */
export async function readPeerBlob(options) { return transfer(options, 'GET'); }
