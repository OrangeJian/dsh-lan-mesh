/**
 * HTTP delivery transport for the LAN mesh.
 *
 * Discovery is UDP broadcast; actual messages travel over plain HTTP on the
 * LAN so a payload is acknowledged, size-checked and optionally authenticated
 * with a shared cluster secret.
 *
 * @module dsh-lan-mesh/lib/transport
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { emptyState, normalizeState } from './rooms.mjs';

/** Wire version of every envelope and endpoint response. */
export const PROTOCOL_VERSION = 2;
/** Largest accepted request body, in bytes. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Largest accepted state-exchange body, in bytes. */
export const MAX_STATE_BODY_BYTES = 2 * 1024 * 1024;
/** Largest accepted message text, in characters. */
export const MAX_TEXT_CHARS = 32_000;
/** Shape of a room id as it travels inside an envelope. */
const ROOM_ID_PATTERN = /^room-[a-z0-9-]{4,64}$/;
/** Kinds the room layer assigns a meaning to; every other kind stays a note. */
export const ROOM_KINDS = ['room-message', 'room-task'];

/**
 * Normalize the room a message belongs to. Anything that is not a well-formed
 * room id collapses to '' so a malformed value can never address a room.
 * @param {unknown} value - untrusted room reference.
 * @returns {string}
 */
export function normalizeRoomId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return ROOM_ID_PATTERN.test(trimmed) ? trimmed : '';
}

/**
 * Build the string that both sides sign, so field order can never diverge.
 * @param {object} envelope - message envelope.
 * @returns {string}
 */
export function signingInput(envelope) {
  return [
    String(envelope.v),
    String(envelope.id),
    String(envelope.from?.nodeId ?? ''),
    String(envelope.to ?? ''),
    String(envelope.kind ?? ''),
    String(envelope.topic ?? ''),
    String(envelope.room ?? ''),
    String(envelope.text ?? ''),
    String(envelope.sentAt ?? ''),
  ].join('\n');
}

/**
 * Sign one envelope.
 * @param {object} envelope - envelope to sign.
 * @param {string} secret - shared cluster secret.
 * @returns {string} hex digest.
 */
export function signEnvelope(envelope, secret) {
  return createHmac('sha256', secret).update(signingInput(envelope), 'utf8').digest('hex');
}

/**
 * Constant-time verification of an envelope signature.
 * @param {object} envelope - envelope carrying `sig`.
 * @param {string} secret - shared cluster secret.
 * @returns {boolean}
 */
export function verifyEnvelope(envelope, secret) {
  if (typeof envelope.sig !== 'string') return false;
  const expected = signEnvelope(envelope, secret);
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(envelope.sig, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Reject a payload the caller cannot handle, with a machine-readable code. */
export class TransportError extends Error {
  /**
   * @param {string} message - human-readable text.
   * @param {string} code - machine-readable code.
   * @param {number} [status] - HTTP status to answer with.
   */
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Normalize and validate an inbound envelope.
 * @param {unknown} raw - decoded request body.
 * @returns {object} normalized envelope.
 */
export function normalizeEnvelope(raw) {
  if (!raw || typeof raw !== 'object') throw new TransportError('body must be a JSON object', 'BAD_BODY');
  const envelope = raw;
  if (envelope.v !== PROTOCOL_VERSION) throw new TransportError('unsupported protocol version', 'BAD_VERSION');
  if (typeof envelope.id !== 'string' || envelope.id.length === 0 || envelope.id.length > 64) {
    throw new TransportError('id must be a non-empty string', 'BAD_ID');
  }
  const from = envelope.from;
  if (!from || typeof from !== 'object' || typeof from.nodeId !== 'string' || from.nodeId.length === 0) {
    throw new TransportError('from.nodeId is required', 'BAD_SENDER');
  }
  if (typeof envelope.text !== 'string' || envelope.text.trim().length === 0) {
    throw new TransportError('text must be a non-empty string', 'BAD_TEXT');
  }
  if (envelope.text.length > MAX_TEXT_CHARS) {
    throw new TransportError(`text exceeds ${MAX_TEXT_CHARS} characters`, 'TEXT_TOO_LARGE', 413);
  }
  return {
    v: PROTOCOL_VERSION,
    id: envelope.id.slice(0, 64),
    from: {
      nodeId: from.nodeId.slice(0, 64),
      name: typeof from.name === 'string' ? from.name.slice(0, 64) : from.nodeId.slice(0, 64),
      // Which session on that node sent it, and that session's title. Two agents
      // on one machine are otherwise indistinguishable from the node name alone.
      // Neither field is signed: `from.name` was already transport metadata, and
      // the signature covers who speaks (`from.nodeId`), not their display label.
      sessionId: typeof from.sessionId === 'string' ? from.sessionId.slice(0, 64) : '',
      title: typeof from.title === 'string' ? from.title.slice(0, 128) : '',
    },
    to: typeof envelope.to === 'string' && envelope.to.length > 0 ? envelope.to.slice(0, 64) : '*',
    kind: typeof envelope.kind === 'string' && envelope.kind.length > 0 ? envelope.kind.slice(0, 32) : 'note',
    topic: typeof envelope.topic === 'string' ? envelope.topic.slice(0, 128) : '',
    room: normalizeRoomId(envelope.room),
    text: envelope.text,
    replyTo: typeof envelope.replyTo === 'string' ? envelope.replyTo.slice(0, 64) : undefined,
    sentAt: typeof envelope.sentAt === 'string' ? envelope.sentAt.slice(0, 40) : new Date().toISOString(),
    sig: typeof envelope.sig === 'string' ? envelope.sig : undefined,
  };
}

/**
 * Read a bounded request body.
 * @param {http.IncomingMessage} request - inbound request.
 * @param {number} [limit] - largest accepted body, in bytes.
 * @returns {Promise<string>}
 */
function readBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new TransportError(`body exceeds ${limit} bytes`, 'BODY_TOO_LARGE', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** Reply with one JSON document. */
function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  response.end(body);
}

/** Constant-time comparison of two hex digests, tolerant of length mismatch. */
function sameDigest(expected, given) {
  if (typeof given !== 'string') return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(given, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Reduce a room document to the exact bytes both sides sign.
 *
 * A signature over the raw `JSON.stringify(state)` would not be stable: the
 * receiver normalizes a payload before verifying it, so an honest peer that
 * reordered one room's keys or carried an unknown field would produce different
 * bytes and be rejected as BAD_SIGNATURE. Signing the normalized document
 * removes that whole class of false rejection. Room ids are sorted as well,
 * because object key order follows insertion order rather than anything both
 * sides agree on.
 * @param {unknown} state - untrusted room document.
 * @returns {string} canonical JSON.
 */
function canonicalStateJson(state) {
  if (state === undefined || state === null) return 'null';
  const normalized = normalizeState(state);
  const rooms = {};
  for (const id of Object.keys(normalized.rooms).sort()) rooms[id] = normalized.rooms[id];
  return JSON.stringify({ version: normalized.version, rooms });
}

/**
 * Build the string both sides sign during a state exchange.
 *
 * The state is signed in canonical form, so the bytes do not depend on how the
 * sender happened to lay the document out. A pull signs `null`, which keeps
 * both directions on one code path.
 * @param {object} payload - state payload.
 * @returns {string}
 */
export function signingInputState(payload) {
  return [
    'state',
    String(payload?.v ?? ''),
    String(payload?.id ?? ''),
    String(payload?.from?.nodeId ?? ''),
    String(payload?.sentAt ?? ''),
    canonicalStateJson(payload?.state),
  ].join('\n');
}

/**
 * Sign one state payload.
 * @param {object} payload - state payload.
 * @param {string} secret - shared cluster secret; '' signs nothing.
 * @returns {string} hex digest, or '' when the mesh is open.
 */
export function signStatePayload(payload, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return '';
  return createHmac('sha256', secret).update(signingInputState(payload), 'utf8').digest('hex');
}

/**
 * Verify a state payload's signature. An open mesh (empty secret) accepts all.
 * @param {object} payload - state payload carrying `sig`.
 * @param {string} secret - shared cluster secret.
 * @returns {boolean}
 */
export function verifyStatePayload(payload, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return true;
  return sameDigest(signStatePayload(payload, secret), payload?.sig);
}

/**
 * Normalize and validate a state-exchange payload.
 *
 * A pull request carries `pull:true` and no state; a push carries a state
 * document. Room documents arrive from the network, so they are run through
 * `normalizeState()` before anyone merges them.
 * @param {unknown} raw - decoded request body.
 * @returns {{ v: number, id: string, from: { nodeId: string, name: string }, sentAt: string, pull: boolean, state: object | undefined, sig: string | undefined }}
 */
export function normalizeStatePayload(raw) {
  if (!raw || typeof raw !== 'object') throw new TransportError('body must be a JSON object', 'BAD_BODY');
  const payload = raw;
  if (payload.v !== PROTOCOL_VERSION) throw new TransportError('unsupported protocol version', 'BAD_VERSION');
  if (typeof payload.id !== 'string' || payload.id.length === 0 || payload.id.length > 64) {
    throw new TransportError('id must be a non-empty string', 'BAD_ID');
  }
  const from = payload.from;
  if (!from || typeof from !== 'object' || typeof from.nodeId !== 'string' || from.nodeId.length === 0) {
    throw new TransportError('from.nodeId is required', 'BAD_SENDER');
  }
  let state;
  if (payload.state !== undefined && payload.state !== null) {
    if (typeof payload.state !== 'object') throw new TransportError('state must be an object', 'BAD_STATE');
    state = normalizeState(payload.state);
  }
  return {
    v: PROTOCOL_VERSION,
    id: payload.id.slice(0, 64),
    from: {
      nodeId: from.nodeId.slice(0, 64),
      name: typeof from.name === 'string' ? from.name.slice(0, 64) : from.nodeId.slice(0, 64),
    },
    sentAt: typeof payload.sentAt === 'string' ? payload.sentAt.slice(0, 40) : new Date().toISOString(),
    pull: payload.pull === true || state === undefined,
    state,
    sig: typeof payload.sig === 'string' ? payload.sig : undefined,
  };
}

/**
 * Normalize an agent-listing request.
 *
 * It rides the same signed envelope shape as a state pull (`state: null`), so a
 * cluster that already authenticates state exchange authenticates this too.
 * @param {unknown} raw - decoded request body.
 * @returns {{ v: number, id: string, from: { nodeId: string, name: string }, sentAt: string, sig: string | undefined }}
 */
export function normalizeAgentsRequest(raw) {
  const payload = normalizeStatePayload({ ...raw, pull: true, state: null });
  return { v: payload.v, id: payload.id, from: payload.from, sentAt: payload.sentAt, sig: payload.sig };
}

/**
 * Ask one peer which agents it hosts.
 * @param {object} options - target and payload.
 * @param {string} options.address - peer host.
 * @param {number} options.port - peer HTTP port.
 * @param {string} options.secret - shared cluster secret, '' when open.
 * @param {string} [options.fromNodeId] - this node's id, for the signed payload.
 * @param {string} [options.fromName] - this node's display name.
 * @param {number} [options.timeoutMs] - request timeout.
 * @returns {Promise<object>} the peer's answer: `{ node, agents }`.
 */
export async function fetchAgentsFromPeer(options) {
  const body = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    from: { nodeId: options.fromNodeId ?? 'unknown', name: options.fromName ?? '' },
    sentAt: new Date().toISOString(),
    pull: true,
    state: null,
  };
  if (typeof options.secret === 'string' && options.secret.length > 0) {
    body.sig = signStatePayload(body, options.secret);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  timeout.unref?.();
  try {
    const response = await fetch(`http://${options.address}:${options.port}/lan-mesh/v1/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TransportError(`peer answered ${response.status} with a non-JSON body`, 'BAD_RESPONSE');
    }
    if (!response.ok || !parsed.ok) {
      throw new TransportError(
        typeof parsed.error === 'string' ? parsed.error : `peer answered ${response.status}`,
        typeof parsed.code === 'string' ? parsed.code : 'REMOTE_ERROR',
        response.status,
      );
    }
    return { node: parsed.node ?? {}, agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch (error) {
    if (error instanceof TransportError) throw error;
    const cause = error?.name === 'AbortError' ? 'timed out' : String(error?.cause?.code ?? error?.message ?? error);
    throw new TransportError(`cannot reach ${options.address}:${options.port} (${cause})`, 'UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the current room state from one peer.
 * @param {object} options - target and payload.
 * @param {string} options.address - peer host.
 * @param {number} options.port - peer HTTP port.
 * @param {string} options.secret - shared cluster secret, '' when open.
 * @param {string} [options.fromNodeId] - this node's id, for the signed payload.
 * @param {string} [options.fromName] - this node's display name.
 * @param {number} [options.timeoutMs] - request timeout.
 * @returns {Promise<{ state: object, node: object }>} the peer's state, normalized.
 */
export async function pullStateFromPeer(options) {
  const from = { nodeId: options.fromNodeId ?? 'unknown', name: options.fromName ?? '' };
  const payload = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    from,
    sentAt: new Date().toISOString(),
    pull: true,
  };
  const answer = await postState(options, payload);
  return { state: normalizeState(answer.state ?? emptyState()), node: answer.node ?? {} };
}

/**
 * Push this node's room state to one peer.
 * @param {object} options - target and payload.
 * @param {string} options.address - peer host.
 * @param {number} options.port - peer HTTP port.
 * @param {object} options.payload - state payload; `v`, `id`, `sentAt` are filled in when absent.
 * @param {string} options.secret - shared cluster secret, '' when open.
 * @param {number} [options.timeoutMs] - request timeout.
 * @returns {Promise<{ changed: boolean, node: object }>} whether the peer's state moved.
 */
export async function pushStateToPeer(options) {
  const payload = {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    sentAt: new Date().toISOString(),
    ...options.payload,
  };
  delete payload.sig;
  const answer = await postState(options, payload);
  return { changed: answer.changed === true, node: answer.node ?? {} };
}

/**
 * POST one state payload to a peer and decode its answer.
 * @param {object} options - target.
 * @param {string} options.address - peer host.
 * @param {number} options.port - peer HTTP port.
 * @param {string} options.secret - shared cluster secret, '' when open.
 * @param {number} [options.timeoutMs] - request timeout.
 * @param {object} payload - state payload to send.
 * @returns {Promise<object>} the decoded response body.
 */
async function postState(options, payload) {
  const body = { ...payload, v: PROTOCOL_VERSION };
  if (typeof options.secret === 'string' && options.secret.length > 0) {
    body.sig = signStatePayload(body, options.secret);
  } else {
    delete body.sig;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  timeout.unref?.();
  try {
    const response = await fetch(`http://${options.address}:${options.port}/lan-mesh/v1/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TransportError(`peer answered ${response.status} with a non-JSON body`, 'BAD_RESPONSE');
    }
    if (!response.ok || !parsed.ok) {
      const error = parsed.error;
      throw new TransportError(
        typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : `peer answered ${response.status}`,
        typeof error?.code === 'string' ? error.code : typeof parsed.code === 'string' ? parsed.code : 'REMOTE_ERROR',
        response.status,
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof TransportError) throw error;
    const cause = error?.name === 'AbortError' ? 'timed out' : String(error?.cause?.code ?? error?.message ?? error);
    throw new TransportError(`cannot reach ${options.address}:${options.port} (${cause})`, 'UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The HTTP half of one mesh node.
 */
export class MeshServer {
  /**
   * @param {object} options - server identity and delivery hooks.
   * @param {() => object} options.describe - current identity snapshot.
   * @param {(envelope: object, remote: {address: string}) => Promise<object>} options.onMessage - delivery.
   * @param {((payload: object) => Promise<{ state?: object, changed?: boolean } | void>)} [options.onState] - room-state exchange;
   *   receives a normalized payload and answers a pull with `{state}` or a push with `{changed}`.
   * @param {((payload: object) => Promise<object[]>) } [options.onAgents] - agent listing;
   *   returns this node's agent rows.
   * @param {() => string} options.secret - current cluster secret ('' when open).
   * @param {() => string[]} options.trustedPeers - optional node allowlist.
   * @param {(error: Error) => void} [options.onError] - diagnostics hook.
   */
  constructor(options) {
    this.options = options;
    this.server = undefined;
    this.boundPort = 0;
  }

  /**
   * Load the bound port.
   * @returns {number}
   */
  get port() {
    return this.boundPort;
  }

  /**
   * Start listening on all interfaces.
   * @param {number} requestedPort - configured port; 0 asks the OS.
   * @returns {Promise<number>} the bound port.
   */
  async listen(requestedPort) {
    const server = http.createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        this.options.onError?.(error);
        try {
          sendJson(response, 500, { ok: false, error: 'internal error' });
        } catch {
          // The socket may already be gone.
        }
      });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.keepAliveTimeout = 2_000;
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(requestedPort, '0.0.0.0', () => {
        server.off('error', onError);
        resolve();
      });
    });
    server.on('error', (error) => this.options.onError?.(error));
    this.server = server;
    const address = server.address();
    this.boundPort = typeof address === 'object' && address !== null ? address.port : requestedPort;
    return this.boundPort;
  }

  /** Stop listening. */
  async close() {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  /**
   * Authenticate and admit one request.
   * @param {string} path - request path.
   * @param {http.IncomingMessage} request - inbound request.
   * @returns {Promise<object>} a JSON response body.
   */
  async #handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://mesh.invalid');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'GET' && path === '/lan-mesh/v1/info') {
      sendJson(response, 200, { ok: true, node: this.options.describe(), protocol: PROTOCOL_VERSION });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (path === '/lan-mesh/v1/state') {
      await this.#handleState(request, response);
      return;
    }
    if (path === '/lan-mesh/v1/agents') {
      await this.#handleAgents(request, response);
      return;
    }
    if (path !== '/lan-mesh/v1/send' && path !== '/lan-mesh/v1/hello') {
      sendJson(response, 404, { ok: false, error: 'unknown endpoint' });
      return;
    }

    let envelope;
    try {
      const raw = await readBody(request);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new TransportError('body must be valid JSON', 'BAD_JSON');
      }
      envelope = normalizeEnvelope(parsed);
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError(String(error), 'BAD_BODY');
      sendJson(response, failure.status, { ok: false, error: failure.message, code: failure.code });
      return;
    }

    const guard = this.#admit(envelope.from.nodeId, () => verifyEnvelope(envelope, this.options.secret()));
    if (guard !== undefined) {
      sendJson(response, guard.status, { ok: false, error: guard.message, code: guard.code });
      return;
    }

    if (path === '/lan-mesh/v1/hello') {
      sendJson(response, 200, { ok: true, node: this.options.describe(), protocol: PROTOCOL_VERSION });
      return;
    }

    try {
      const receipt = await this.options.onMessage(envelope, { address: request.socket.remoteAddress ?? '' });
      sendJson(response, 200, { ok: true, receipt });
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError(String(error), 'DELIVERY_FAILED', 500);
      sendJson(response, failure.status, { ok: false, error: failure.message, code: failure.code });
    }
  }

  /**
   * Shared admission policy: signature first, then the peer allowlist.
   * @param {string} senderNodeId - claimed sender.
   * @param {() => boolean} verify - signature check.
   * @returns {{ status: number, code: string, message: string } | undefined} rejection, or undefined when admitted.
   */
  #admit(senderNodeId, verify) {
    const secret = this.options.secret();
    if (secret.length > 0 && !verify()) {
      return { status: 401, code: 'BAD_SIGNATURE', message: 'invalid or missing signature' };
    }
    const trusted = this.options.trustedPeers();
    if (trusted.length > 0 && !trusted.includes(senderNodeId)) {
      return { status: 403, code: 'UNTRUSTED', message: 'sender is not in trustedPeers' };
    }
    return undefined;
  }

  /**
   * Serve one room-state exchange: a push merges the peer's document, a pull
   * answers with ours.
   * @param {http.IncomingMessage} request - inbound request.
   * @param {http.ServerResponse} response - reply channel.
   * @returns {Promise<void>}
   */
  async #handleState(request, response) {
    let payload;
    try {
      const raw = await readBody(request, MAX_STATE_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new TransportError('body must be valid JSON', 'BAD_JSON');
      }
      payload = normalizeStatePayload(parsed);
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError(String(error), 'BAD_BODY');
      sendJson(response, failure.status, {
        ok: false,
        error: { code: failure.code, message: failure.message },
      });
      return;
    }

    const guard = this.#admit(payload.from.nodeId, () => verifyStatePayload(payload, this.options.secret()));
    if (guard !== undefined) {
      sendJson(response, guard.status, {
        ok: false,
        error: { code: guard.code, message: guard.message },
      });
      return;
    }

    if (typeof this.options.onState !== 'function') {
      sendJson(response, 501, {
        ok: false,
        error: { code: 'NOT_SUPPORTED', message: 'this node does not replicate room state' },
      });
      return;
    }

    try {
      if (payload.pull) {
        const local = await this.options.onState({ ...payload, pull: true });
        sendJson(response, 200, { ok: true, state: normalizeState(local?.state ?? emptyState()), node: this.options.describe() });
        return;
      }
      const result = await this.options.onState({ ...payload, pull: false });
      sendJson(response, 200, { ok: true, changed: result?.changed === true, node: this.options.describe() });
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError(String(error), 'STATE_FAILED', 500);
      sendJson(response, failure.status, { ok: false, error: { code: failure.code, message: failure.message } });
    }
  }

  /**
   * Answer one agent-listing request.
   *
   * The listing is discovery, not authority: it tells a peer which sessions this
   * node hosts so a human there can dial one. Sending a message to a listed agent
   * still goes through `/v1/send` and its admission rules.
   * @param {http.IncomingMessage} request - inbound request.
   * @param {http.ServerResponse} response - reply channel.
   * @returns {Promise<void>}
   */
  async #handleAgents(request, response) {
    let payload;
    try {
      const raw = await readBody(request, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new TransportError('body must be valid JSON', 'BAD_JSON');
      }
      payload = normalizeAgentsRequest(parsed);
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError(String(error), 'BAD_BODY');
      sendJson(response, failure.status, {
        ok: false,
        error: { code: failure.code, message: failure.message },
      });
      return;
    }

    const guard = this.#admit(payload.from.nodeId, () => verifyStatePayload(payload, this.options.secret()));
    if (guard !== undefined) {
      sendJson(response, guard.status, {
        ok: false,
        error: { code: guard.code, message: guard.message },
      });
      return;
    }

    if (typeof this.options.onAgents !== 'function') {
      sendJson(response, 501, {
        ok: false,
        error: { code: 'NOT_SUPPORTED', message: 'this node does not list agents' },
      });
      return;
    }

    try {
      const agents = await this.options.onAgents(payload);
      sendJson(response, 200, { ok: true, node: this.options.describe(), agents: Array.isArray(agents) ? agents : [] });
    } catch (error) {
      const failure = error instanceof TransportError ? error : new TransportError(String(error), 'AGENTS_FAILED', 500);
      sendJson(response, failure.status, { ok: false, error: { code: failure.code, message: failure.message } });
    }
  }
}

/**
 * Deliver one envelope to a peer's HTTP endpoint.
 * @param {object} options - target and payload.
 * @param {string} options.address - peer host.
 * @param {number} options.port - peer HTTP port.
 * @param {object} options.envelope - envelope to deliver.
 * @param {string} options.secret - shared cluster secret, '' when open.
 * @param {number} [options.timeoutMs] - request timeout.
 * @returns {Promise<{ receipt: object, node: object }>}
 */
export async function deliverToPeer(options) {
  const envelope = { ...options.envelope, v: PROTOCOL_VERSION };
  if (options.secret.length > 0) envelope.sig = signEnvelope(envelope, options.secret);
  else delete envelope.sig;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  timeout.unref?.();
  try {
    const response = await fetch(`http://${options.address}:${options.port}/lan-mesh/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TransportError(`peer answered ${response.status} with a non-JSON body`, 'BAD_RESPONSE');
    }
    if (!response.ok || !parsed.ok) {
      // Older peers answer `{error:'text', code}`; current ones nest the code in
      // `error`. Accept both so an upgrade never hides the real reason.
      const detail = parsed.error;
      const message =
        typeof detail === 'string'
          ? detail
          : typeof detail?.message === 'string'
            ? detail.message
            : `peer answered ${response.status}`;
      const code =
        (typeof detail?.code === 'string' ? detail.code : undefined) ??
        (typeof parsed.code === 'string' ? parsed.code : undefined) ??
        'REMOTE_ERROR';
      throw new TransportError(message, code, response.status);
    }
    return { receipt: parsed.receipt ?? {}, node: parsed.node ?? {} };
  } catch (error) {
    if (error instanceof TransportError) throw error;
    const cause = error?.name === 'AbortError' ? 'timed out' : String(error?.cause?.code ?? error?.message ?? error);
    throw new TransportError(`cannot reach ${options.address}:${options.port} (${cause})`, 'UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}
