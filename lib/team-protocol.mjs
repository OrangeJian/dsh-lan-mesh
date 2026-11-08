import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { teamId, teamMember } from './team-state.mjs';

export const TEAM_PATH = '/lan-mesh/v1/team';
export const TEAM_BODY_LIMIT = 256 * 1024;
const operations = new Set(['dispatch', 'start', 'progress', 'heartbeat', 'result', 'status-query', 'cancel', 'reconcile', 'event-ack']);
function error(code) { throw Object.assign(new Error(code), { code }); }
function signature(method, path, headers, bytes, secret) {
  const fields = [method, path, headers['x-team-sender'], headers['x-team-target'], headers['x-team-time'], headers['x-team-nonce'], createHash('sha256').update(bytes).digest('hex')];
  return createHmac('sha256', secret).update(JSON.stringify(fields)).digest('hex');
}

export function encodeTeamRequest({ operation, body, identity, target, secret, now = Date.now(), nonce = randomUUID() }) {
  const bytes = Buffer.from(JSON.stringify({ teamProtocolVersion: 1, operation, body }));
  const headers = { 'content-type': 'application/json', 'x-team-sender': identity, 'x-team-target': target, 'x-team-time': String(now), 'x-team-nonce': nonce };
  headers['x-team-signature'] = signature('POST', TEAM_PATH, headers, bytes, secret);
  return { headers, bytes };
}

export async function verifyTeamRequest({ method, path, headers, bytes, policy, now = Date.now(), store }) {
  if (bytes.length > TEAM_BODY_LIMIT) error('TOO_LARGE');
  if (!policy.secret) error('AUTH_REQUIRED');
  const sender = headers['x-team-sender'];
  if (!policy.trustedPeers?.includes(sender)) error('UNTRUSTED');
  const expected = signature(method, path, headers, bytes, policy.secret);
  const received = headers['x-team-signature'];
  if (typeof received !== 'string' || received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) error('AUTH_FAILED');
  if (method !== 'POST' || path !== TEAM_PATH || headers['x-team-target'] !== policy.nodeId) error('AUTH_FAILED');
  const sentAt = Number(headers['x-team-time']);
  const windowMs = policy.windowMs ?? 120000;
  if (!Number.isFinite(sentAt) || !Number.isFinite(windowMs) || windowMs <= 0 || Math.abs(now - sentAt) > windowMs) error('EXPIRED');
  const nonce = headers['x-team-nonce'];
  if (typeof nonce !== 'string' || !/^[a-zA-Z0-9-]{12,100}$/.test(nonce)) error('BAD_REQUEST');
  let request;
  try { request = JSON.parse(bytes.toString('utf8')); } catch { error('BAD_REQUEST'); }
  if (request?.teamProtocolVersion !== 1) error('UNSUPPORTED');
  if (!operations.has(request.operation) || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) error('BAD_REQUEST');
  for (const key of ['roomId', 'taskId', 'executionId']) teamId(request.body[key]);
  for (const key of ['actorKey', 'leaderKey', 'workerKey']) teamMember(request.body[key]);
  if (!Number.isSafeInteger(request.body.generation) || request.body.generation < 1) error('BAD_REQUEST');
  if (typeof request.body.actorKey !== 'string' || !request.body.actorKey.startsWith(`${sender}/`)) error('FORBIDDEN');
  if (!await policy.authorize?.(request)) error('FORBIDDEN');
  await store.transact(state => {
    const key = `${sender}:${nonce}`;
    if (Object.hasOwn(state.nonces, key) && state.nonces[key] >= now) error('REPLAY');
    for (const [old, expiry] of Object.entries(state.nonces)) if (expiry < now) delete state.nonces[old];
    state.nonces[key] = sentAt + windowMs;
    return { state };
  });
  return { ...request, senderNodeId: sender };
}

/** Responses are signed too: a network intermediary must not forge start permission. */
export function encodeTeamResponse(value, secret, nonce) {
  const bytes = Buffer.from(JSON.stringify({ teamProtocolVersion: 1, ...value }));
  const sig = createHmac('sha256', secret).update(nonce).update(bytes).digest('hex');
  return { bytes, headers: { 'content-type': 'application/json', 'x-team-signature': sig } };
}

export async function sendTeamRequest({ peer, request, secret, signal }) {
  const url = new URL(TEAM_PATH, `http://${peer.address.includes(':') ? `[${peer.address}]` : peer.address}:${peer.httpPort}`);
  // Advisory feature discovery cannot grant permission; only the signed response can.
  if (JSON.parse(request.bytes.toString('utf8')).operation === 'dispatch') {
    const infoResponse = await fetch(new URL('/lan-mesh/v1/info', url), { signal: signal ?? AbortSignal.timeout(8000) });
    const info = await infoResponse.json();
    if (info.node?.nodeId !== request.headers['x-team-target'] || info.node?.teamProtocolVersion !== 1) error('UNSUPPORTED');
  }
  const response = await fetch(url, { method: 'POST', headers: request.headers, body: request.bytes, signal: signal ?? AbortSignal.timeout(8000) });
  if (response.status === 404) { await response.body?.cancel(); error('UNSUPPORTED'); }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > TEAM_BODY_LIMIT) { await reader.cancel(); error('TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const expected = createHmac('sha256', secret).update(request.headers['x-team-nonce']).update(bytes).digest('hex');
  if (response.headers.get('x-team-signature') !== expected) error('AUTH_FAILED');
  let result;
  try { result = JSON.parse(bytes); } catch { error('BAD_RESPONSE'); }
  if (result.teamProtocolVersion !== 1) error('UNSUPPORTED');
  if (!result.ok) error(result.error?.code ?? 'REMOTE_ERROR');
  return result.value;
}
