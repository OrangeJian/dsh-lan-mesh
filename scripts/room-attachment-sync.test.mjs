/**
 * M3 Task 4: authorized attachment history sync for late members.
 *
 * The decisive scenario is a REAL three-node one:
 *
 *   1. A (ordinary member) uploads a file and posts it; the Leader B persists it.
 *   2. A goes offline for good.
 *   3. C starts, discovers the room, and joins THROUGH THE PRODUCT ENTRY POINT
 *      (`joinRoom`), which triggers the bounded Leader backfill.
 *
 * Nothing is injected into C's ledger by hand: the reference must arrive through
 * the sync channel, and the bytes must be downloaded from B (the only remaining
 * holder) and verified before C may use them.
 *
 * Run standalone:  node --test scripts/room-attachment-sync.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { MeshNode } from '../lib/service.mjs';
import { MeshServer } from '../lib/transport.mjs';
import { meshRootDir } from '../lib/store.mjs';
import {
  createSyncHandler,
  fetchAttachmentManifest,
  normalizeSyncEntry,
  syncPageHash,
} from '../lib/room-attachment-sync.mjs';

const SECRET = 'sync-secret';
const DISCOVERY_PORT = 47_991;
const digest = (body) => createHash('sha256').update(body).digest('hex');

/** Wait until `predicate()` is truthy, or fail with a clear timeout. */
async function until(predicate, label = 'condition', timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Read a whole readable stream into one Buffer. */
async function drain(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * A real node with an isolated DSH_HOME instance directory and its own mesh port.
 * @param {object} context - test context collecting nodes for cleanup.
 * @param {string} name - display name, also the node name.
 * @param {number} port - fixed mesh HTTP port.
 */
function makeNode(context, name, port) {
  const node = new MeshNode({
    config: {
      port,
      discoveryPort: DISCOVERY_PORT,
      clusterSecret: SECRET,
      trustedPeers: [],
      autoWake: false,
      displayName: name,
    },
    log: () => {},
  });
  context.after(() => node.close());
  return node;
}

/** Start a node and wait until it has seen at least `wanted` peers. */
async function startNode(context, name, port, wanted = 1) {
  const node = makeNode(context, name, port);
  await node.start();
  if (wanted > 0) await until(() => node.peers().length >= wanted, `${name} to discover peers`);
  return node;
}

/** Upload one body on a node and return the immutable ref. */
function upload(node, roomId, body, name) {
  return node.uploadRoomAttachment({
    room: roomId,
    sessionId: 'human',
    readable: Readable.from([body]),
    name,
    mediaType: 'text/plain',
    size: Buffer.byteLength(body),
    blobId: digest(body),
  });
}

/** Fresh temporary DSH_HOME, restored after the test. */
async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), 'm3-sync-'));
  const prior = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  t.after(async () => {
    if (prior === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prior;
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * Room with leader B and member A, both real running nodes.
 * @param {object} t - test context.
 */
async function roomWithLeader(t) {
  await home(t);
  const b = await startNode(t, 'Leader', 39_201, 0);
  const { room } = await b.createRoom({ name: 'History', sessionId: 'human' });
  const a = await startNode(t, 'Sender', 39_202);
  await a.syncRooms();
  await until(() => a.listRooms({ all: true }).some((row) => row.id === room.id), 'sender to replicate the room');
  await a.joinRoom({ room: room.id, sessionId: 'human' });
  await b.syncRooms();
  await until(() => b.roomDetail({ room: room.id }).room.members.some((m) => m.nodeId === a.nodeId), 'leader to learn the sender');
  return { a, b, room };
}

// ------------------------------------------------------------------ late C ---
test('a late member obtains committed history through the product join path and downloads the bytes from the Leader', async (t) => {
  const { a, b, room } = await roomWithLeader(t);
  const body = Buffer.from('history bytes that outlive the sender');
  const ref = await upload(a, room.id, body, 'history.txt');
  const sent = await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'earlier upload', attachments: [ref], messageId: 'history-1' });
  assert.deepEqual(sent.durableNodes.sort(), [a.nodeId, b.nodeId].sort());
  assert.equal(b.roomDetail({ room: room.id }).messages.filter((m) => m.id === 'history-1').length, 1);

  // The original sender is gone for good; it never takes part in what follows.
  await a.close();
  await until(() => b.peers().every((peer) => peer.nodeId !== a.nodeId), 'leader to see the sender leave', 20_000).catch(() => {});

  const c = await startNode(t, 'Late', 39_203);
  await c.syncRooms();
  await until(() => c.listRooms({ all: true }).some((row) => row.id === room.id), 'late node to replicate the room');
  // Product entry point only — no ledger is touched by the test.
  await c.joinRoom({ room: room.id, sessionId: 'human' });

  await until(() => c.roomDetail({ room: room.id }).messages.some((m) => m.id === 'history-1'), 'late node to import the committed manifest');
  const shown = c.roomDetail({ room: room.id }).messages.find((m) => m.id === 'history-1');
  // Author stays the original sender; the Leader is only the relay.
  assert.equal(shown.from.nodeId, a.nodeId);
  assert.equal(shown.attachments[0].blobId, ref.blobId);
  assert.equal(shown.attachments[0].name, 'history.txt');

  const imported = c.attachmentService.ledger.data.messages[JSON.stringify([a.nodeId, 'history-1'])];
  assert.equal(imported.status, 'committed');
  assert.equal(imported.imported, true);
  assert.equal(imported.relayNodeId, b.nodeId);
  assert.equal(imported.local, false, 'an imported record must never look like a local draft');
  assert.deepEqual(imported.receivedRefs, [], 'an import must not claim byte receipts');

  // Bytes are fetched from the surviving holder and verified end to end.
  const bytes = await drain(await c.readRoomAttachment({ room: room.id, sessionId: 'human', blobId: ref.blobId }));
  assert.deepEqual(bytes, body);
  const metadata = JSON.parse(await readFile(join(meshRootDir(c.config.port), 'blobs', 'metadata.json'), 'utf8'));
  assert.ok(metadata.blobs[ref.blobId].pins.length > 0, 'after verification the late member pins what it holds');

  // Repeated backfill is idempotent: no duplicate message, no extra wake.
  await c.backfillRoomAttachments(room.id);
  await c.backfillRoomAttachments(room.id);
  assert.equal(c.roomDetail({ room: room.id }).messages.filter((m) => m.id === 'history-1').length, 1);
});

// -------------------------------------------------------------- pagination ---
test('the manifest pages through committed history deterministically without duplicates', async (t) => {
  const { a, b, room } = await roomWithLeader(t);
  const ids = [];
  for (const index of [1, 2, 3]) {
    const body = Buffer.from(`page body ${index}`);
    const ref = await upload(a, room.id, body, `page-${index}.txt`);
    const id = `page-${index}`;
    ids.push(id);
    await a.sayInRoom({ room: room.id, sessionId: 'human', text: `page ${index}`, attachments: [ref], messageId: id });
  }
  const peer = { address: '127.0.0.1', port: b.server.port, nodeId: b.nodeId };
  const seen = [];
  let cursor = '';
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await fetchAttachmentManifest({ peer, nodeId: a.nodeId, secret: SECRET, roomId: room.id, cursor, limit: 1 });
    assert.ok(page.entries.length <= 1);
    for (const entry of page.entries) seen.push(entry.id);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen.sort(), ids.slice().sort());
  assert.equal(new Set(seen).size, seen.length, 'paging must never repeat a message');
});

// ---------------------------------------------------------------- security ---
test('the manifest endpoint rejects bad signatures, wrong targets, foreign rooms and non-members', async (t) => {
  const { a, room, b } = await roomWithLeader(t);
  const peer = { address: '127.0.0.1', port: b.server.port, nodeId: b.nodeId };
  const ask = (extra) => fetchAttachmentManifest({ peer, nodeId: a.nodeId, secret: SECRET, roomId: room.id, ...extra });

  // A signature made with the wrong shared secret.
  await assert.rejects(ask({ secret: 'wrong-secret' }), /BAD_SIGNATURE|401/);
  // A request addressed to a different node id (the signature covers `to`).
  await assert.rejects(ask({ peer: { ...peer, nodeId: 'node-someone-else' } }), /WRONG_TARGET|403/);
  // A room this Leader does not know.
  await assert.rejects(ask({ roomId: 'room-unknown-000000000000' }), /UNKNOWN_ROOM|400/);

  // A node that never joined the room may not read its history, even though it
  // knows the secret and can sign correctly.
  const outsider = await startNode(t, 'Outsider', 39_204);
  await assert.rejects(
    fetchAttachmentManifest({ peer, nodeId: outsider.nodeId, secret: SECRET, roomId: room.id }),
    /FORBIDDEN|403/,
  );
});

test('a page whose content does not match its hash is rejected instead of imported', async (t) => {
  await home(t);
  const roomId = 'room-tamper-0000000000';
  const body = Buffer.from('x');
  const entry = {
    id: 'tampered-1',
    room: roomId,
    from: { nodeId: 'node-a', sessionId: 'human' },
    kind: 'room-message',
    topic: 'History',
    text: 'original',
    sentAt: '2026-11-10T00:00:00.000Z',
    attachments: [{ blobId: digest(body), name: 'x.txt', mediaType: 'text/plain', size: body.length, ownerNodeId: 'node-a' }],
    receivedAt: '2026-11-10T00:00:01.000Z',
  };
  const server = new MeshServer({
    describe: () => ({ nodeId: 'node-b' }),
    secret: () => SECRET,
    trustedPeers: () => [],
    onMessage: async () => ({}),
    onSync: createSyncHandler({ nodeId: () => 'node-b', secret: () => SECRET, trustedPeers: () => [], serve: async () => ({ entries: [entry], nextCursor: '' }) }),
  });
  await server.listen(0);
  t.after(async () => { await server.close(); });
  const peer = { address: '127.0.0.1', port: server.port, nodeId: 'node-b' };

  // The honest page verifies and normalizes.
  const page = await fetchAttachmentManifest({ peer, nodeId: 'node-c', secret: SECRET, roomId });
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].id, 'tampered-1');

  // A content substitution that is not covered by the page hash must fail: the
  // client recomputes both the entry fingerprint and the page hash.
  const honest = normalizeSyncEntry(entry);
  assert.throws(
    () => normalizeSyncEntry({ ...entry, fingerprint: honest.fingerprint, text: 'swapped in transit' }),
    /BAD_ENTRY/,
  );
  const recomputed = syncPageHash(roomId, page.nextCursor, [{ ...page.entries[0], text: 'swapped in transit' }].map((item) => ({ ...item, fingerprint: 'forged' })));
  assert.notEqual(recomputed, syncPageHash(roomId, page.nextCursor, page.entries), 'the page hash must cover every immutable field');
});

// ------------------------------------------------------------ no holder yet ---
test('a synced reference with no reachable holder fails clearly instead of pretending the bytes exist', async (t) => {
  const { a, b, room } = await roomWithLeader(t);
  const body = Buffer.from('bytes only the leader holds');
  const ref = await upload(a, room.id, body, 'leader-only.txt');
  await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'leader holds this', attachments: [ref], messageId: 'leader-only' });
  await a.close();

  const c = await startNode(t, 'Late', 39_205, 1);
  await c.syncRooms();
  await until(() => c.listRooms({ all: true }).some((row) => row.id === room.id), 'late node to replicate the room');
  await c.joinRoom({ room: room.id, sessionId: 'human' });
  await until(() => c.roomDetail({ room: room.id }).messages.some((m) => m.id === 'leader-only'), 'late node to import history');

  // Now the Leader is gone too: the reference is known, the bytes are not.
  await b.close();
  await assert.rejects(
    c.readRoomAttachment({ room: room.id, sessionId: 'human', blobId: ref.blobId }),
    /temporarily unavailable|no reachable holder/,
  );
});

// -------------------------------------------------------------- read state ---
test('importing history keeps read state and never wakes an agent', async (t) => {
  const { a, b, room } = await roomWithLeader(t);
  const body = Buffer.from('read state bytes');
  const ref = await upload(a, room.id, body, 'state.txt');
  await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'state', attachments: [ref], messageId: 'state-1' });

  const c = await startNode(t, 'Late', 39_206);
  await c.syncRooms();
  await until(() => c.listRooms({ all: true }).some((row) => row.id === room.id), 'late node to replicate the room');
  await c.joinRoom({ room: room.id, sessionId: 'human' });
  await until(() => c.roomDetail({ room: room.id }).messages.some((m) => m.id === 'state-1'), 'history import');

  const wakes = [];
  // `agents` is a late-bound getter on MeshNode, so install the probe as a
  // property override rather than assigning through the accessor.
  Object.defineProperty(c, 'agents', {
    configurable: true,
    enumerable: true,
    value: { get: (id) => ({ session: { id, title: id }, followup: () => wakes.push(id) }), list: () => [] },
  });
  await c.backfillRoomAttachments(room.id);
  assert.deepEqual(wakes, [], 'importing history must never wake an agent');

  const before = c.roomDetail({ room: room.id }).messages.find((m) => m.id === 'state-1').read;
  c.markAllRead('');
  await c.inbox({ limit: 200, markRead: true });
  const after = c.roomDetail({ room: room.id }).messages.find((m) => m.id === 'state-1').read;
  assert.equal(after, true, 'an imported message is readable and markable like any other');
  assert.equal(before !== undefined, true);
});
