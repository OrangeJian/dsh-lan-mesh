/**
 * Two MeshServer instances, one process: proves the room-state exchange and the
 * `room` field on the envelope without starting a whole MeshNode.
 *
 * This is the transport-level twin of scripts/smoke.mjs. It covers exactly the
 * contract points a service-side change could break silently:
 *   - push/pull round-trip and the `changed` flag
 *   - signature failure → 401 BAD_SIGNATURE
 *   - allowlist failure → 403 UNTRUSTED
 *   - `room` participates in the envelope signature
 *   - a malformed room id normalizes to ''
 *
 * Run: node scripts/twin-transport-check.mjs
 */
import { mergeStates, emptyState, createRoom } from '../lib/rooms.mjs';
import {
  MeshServer,
  PROTOCOL_VERSION,
  MAX_STATE_BODY_BYTES,
  normalizeEnvelope,
  signingInput,
  signEnvelope,
  verifyEnvelope,
  normalizeRoomId,
  pullStateFromPeer,
  pushStateToPeer,
  signStatePayload,
  verifyStatePayload,
} from '../lib/transport.mjs';

let failures = 0;

/** Report one expectation. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/**
 * Stand up one mesh node that merges pushed state like the service will.
 * @param {object} options - identity and policy knobs.
 * @returns {Promise<{ server: MeshServer, port: number, state: object, pushes: number, close: () => Promise<void> }>}
 */
async function node(options) {
  const holder = {
    state: emptyState(),
    pushes: 0,
  };
  const server = new MeshServer({
    describe: () => ({ nodeId: options.nodeId, name: options.nodeId, unread: 0 }),
    secret: () => options.secret ?? '',
    trustedPeers: () => options.trustedPeers ?? [],
    onError: (error) => console.log(`  [${options.nodeId}] error: ${error?.message ?? error}`),
    onMessage: async (envelope) => ({ receivedAt: new Date().toISOString(), envelope }),
    onState: async (payload) => {
      if (payload.pull === true) return { state: holder.state };
      holder.pushes += 1;
      const merged = mergeStates(holder.state, payload.state);
      holder.state = merged.state;
      return { changed: merged.changed };
    },
  });
  const port = await server.listen(0);
  opened.push(server);
  return {
    server,
    port,
    get state() {
      return holder.state;
    },
    get pushes() {
      return holder.pushes;
    },
    close: () => server.close(),
  };
}

/** A room document to move between the two nodes. */
function sampleState() {
  const state = emptyState();
  const room = createRoom(
    state,
    { name: 'twin project', topic: 'transport check', leader: { nodeId: 'node-aaa', sessionId: 'sess-1', name: 'alpha' } },
    () => 'aaaaaaaa-1111-2222-3333-444444444444',
    '2026-01-01T00:00:00.000Z',
  );
  return { state, room };
}

/** Servers opened by this run, closed in the finally block. */
const opened = [];

try {
  console.log('\nversion');
  check('PROTOCOL_VERSION is 2', PROTOCOL_VERSION === 2, String(PROTOCOL_VERSION));
  check('MAX_STATE_BODY_BYTES is 2 MiB', MAX_STATE_BODY_BYTES === 2 * 1024 * 1024, String(MAX_STATE_BODY_BYTES));

  console.log('\nroom field on the envelope');
  check('a valid room id survives normalization', normalizeRoomId('room-abcd1234') === 'room-abcd1234', normalizeRoomId('room-abcd1234'));
  check('an illegal room string collapses to empty', normalizeRoomId('not a room!') === '', JSON.stringify(normalizeRoomId('not a room!')));
  check('a missing room collapses to empty', normalizeRoomId(undefined) === '', JSON.stringify(normalizeRoomId(undefined)));

  const envelope = {
    id: 'env-1',
    from: { nodeId: 'node-aaa', name: 'alpha' },
    to: 'node-bbb',
    kind: 'room-message',
    topic: 'twin project',
    room: 'room-abcd1234',
    text: 'hello room',
    sentAt: '2026-01-01T00:00:00.000Z',
  };
  const normalized = normalizeEnvelope({ ...envelope, v: PROTOCOL_VERSION });
  check('normalizeEnvelope keeps the room', normalized.room === 'room-abcd1234', JSON.stringify(normalized.room));
  check(
    'room is part of the signed bytes',
    signingInput(normalized).split('\n')[6] === 'room-abcd1234',
    JSON.stringify(signingInput(normalized).split('\n')),
  );
  const signed = signEnvelope(normalized, 'shared-secret');
  check('a room envelope signs and verifies', verifyEnvelope({ ...normalized, sig: signed }, 'shared-secret'));
  check(
    'tampering with the room breaks the signature',
    verifyEnvelope({ ...normalized, room: 'room-deadbeef', sig: signed }, 'shared-secret') === false,
  );
  const stripped = normalizeEnvelope({ ...envelope, v: PROTOCOL_VERSION, room: 'BAD ROOM' });
  check('an illegal room normalizes to empty on the wire', stripped.room === '', JSON.stringify(stripped.room));

  console.log('\nsigned state is canonical');
  {
    // A peer normalizes before it verifies, so the signed bytes must not depend
    // on key order or on fields the normalizer drops. Otherwise an honest peer
    // gets 401 BAD_SIGNATURE for cosmetically reshaping its own document.
    const base = { v: PROTOCOL_VERSION, id: 'canon-1', from: { nodeId: 'node-aaa', name: 'a' }, sentAt: '2026-01-01T00:00:00.000Z' };
    const { state: canonState, room: canonRoom } = sampleState();
    const straight = { ...base, state: canonState };
    const reordered = {
      ...base,
      state: {
        rooms: { [canonRoom.id]: Object.fromEntries(Object.entries(canonRoom).reverse()) },
        version: canonState.version,
      },
    };
    const withExtra = {
      ...base,
      state: { version: canonState.version, rooms: { [canonRoom.id]: { ...canonRoom, unknownField: 'x' } } },
    };
    const sigFor = (payload) => signStatePayload(payload, 'canonical-secret');
    check('a reordered room document verifies', verifyStatePayload({ ...reordered, sig: sigFor(straight) }, 'canonical-secret'));
    check('an unknown extra field verifies', verifyStatePayload({ ...withExtra, sig: sigFor(straight) }, 'canonical-secret'));
    const tampered = { ...base, state: { version: canonState.version, rooms: { ...canonState.rooms, [canonRoom.id]: { ...canonRoom, name: 'renamed' } } } };
    check(
      'changing a room name still breaks the signature',
      verifyStatePayload({ ...tampered, sig: sigFor(straight) }, 'canonical-secret') === false,
    );
  }

  console.log('\npush');
  const alpha = await node({ nodeId: 'node-aaa' });
  const beta = await node({ nodeId: 'node-bbb' });
  const { state: sample, room } = sampleState();

  const firstPush = await pushStateToPeer({
    address: '127.0.0.1',
    port: beta.port,
    payload: { from: { nodeId: 'node-aaa', name: 'alpha' }, state: sample },
    secret: '',
  });
  check('the first push reports changed=true', firstPush.changed === true, JSON.stringify(firstPush));
  check('the peer now holds the room', beta.state.rooms[room.id] !== undefined, JSON.stringify(Object.keys(beta.state.rooms)));

  const repeatPush = await pushStateToPeer({
    address: '127.0.0.1',
    port: beta.port,
    payload: { from: { nodeId: 'node-aaa', name: 'alpha' }, state: sample },
    secret: '',
  });
  check('re-pushing the same state reports changed=false', repeatPush.changed === false, JSON.stringify(repeatPush));

  console.log('\npull');
  const pulled = await pullStateFromPeer({ address: '127.0.0.1', port: beta.port, secret: '', fromNodeId: 'node-aaa' });
  check('pull returns the peer state', pulled.state.rooms[room.id]?.name === 'twin project', JSON.stringify(Object.keys(pulled.state.rooms)));
  check('the pulled state is normalized', pulled.state.version === sample.version, String(pulled.state.version));
  check('pull does not count as a push', beta.pushes === 2, String(beta.pushes));

  console.log('\nsignature enforcement');
  const guarded = await node({ nodeId: 'node-ccc', secret: 'right-secret' });
  const wrongSecret = await pushStateToPeer({
    address: '127.0.0.1',
    port: guarded.port,
    payload: { from: { nodeId: 'node-aaa', name: 'alpha' }, state: sample },
    secret: 'wrong-secret',
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error.code, status: error.status }),
  );
  check('a wrong secret is refused with 401 BAD_SIGNATURE', wrongSecret.ok === false && wrongSecret.status === 401 && wrongSecret.code === 'BAD_SIGNATURE', JSON.stringify(wrongSecret));

  const unsigned = await fetch(`http://127.0.0.1:${guarded.port}/lan-mesh/v1/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      v: PROTOCOL_VERSION,
      id: 'unsigned-1',
      from: { nodeId: 'node-aaa', name: 'alpha' },
      sentAt: new Date().toISOString(),
      state: sample,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const unsignedBody = await unsigned.json();
  check(
    'an unsigned push is refused with 401 BAD_SIGNATURE',
    unsigned.status === 401 && unsignedBody.error?.code === 'BAD_SIGNATURE',
    JSON.stringify({ status: unsigned.status, body: unsignedBody }),
  );

  const goodPush = await pushStateToPeer({
    address: '127.0.0.1',
    port: guarded.port,
    payload: { from: { nodeId: 'node-aaa', name: 'alpha' }, state: sample },
    secret: 'right-secret',
  });
  check('the right secret is accepted', goodPush.changed === true, JSON.stringify(goodPush));

  console.log('\ntrust allowlist');
  const picky = await node({ nodeId: 'node-ddd', trustedPeers: ['node-aaa'] });
  const listed = await pushStateToPeer({
    address: '127.0.0.1',
    port: picky.port,
    payload: { from: { nodeId: 'node-aaa', name: 'alpha' }, state: sample },
    secret: '',
  });
  check('a listed peer is admitted', listed.changed === true, JSON.stringify(listed));

  const unlisted = await pushStateToPeer({
    address: '127.0.0.1',
    port: picky.port,
    payload: { from: { nodeId: 'node-zzz', name: 'unknown' }, state: sample },
    secret: '',
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error.code, status: error.status }),
  );
  check('an unlisted peer is refused with 403 UNTRUSTED', unlisted.ok === false && unlisted.status === 403 && unlisted.code === 'UNTRUSTED', JSON.stringify(unlisted));

  console.log('\nroom envelope over the wire');
  const roomEnvelope = {
    v: PROTOCOL_VERSION,
    id: 'room-env-1',
    from: { nodeId: 'node-aaa', name: 'alpha' },
    to: 'node-bbb',
    kind: 'room-message',
    topic: 'twin project',
    room: room.id,
    text: 'a message for the room',
    sentAt: new Date().toISOString(),
  };
  const wire = await fetch(`http://127.0.0.1:${beta.port}/lan-mesh/v1/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(roomEnvelope),
    signal: AbortSignal.timeout(5_000),
  });
  const wireBody = await wire.json();
  check('a room envelope is delivered', wire.status === 200 && wireBody.ok === true, JSON.stringify(wireBody));
  check('the room survived the wire', wireBody.receipt?.envelope?.room === room.id, JSON.stringify(wireBody.receipt?.envelope?.room));

  const roomId = room.id;
  check('the room id matches the contract pattern', /^room-[a-z0-9-]{4,64}$/.test(roomId), roomId);

} catch (error) {
  failures += 1;
  console.log(`  FAIL unexpected error — ${error?.stack ?? String(error)}`);
} finally {
  for (const server of opened) await server.close().catch(() => {});
}

console.log(failures === 0 ? '\ntwin transport ok' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
