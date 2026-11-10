/**
 * M3 final-review regression tests.
 *
 * Each test targets one finding in docs/handoffs/dsh-m3-review-findings.md.
 * They are written to FAIL against the pre-remediation code (RED) and PASS
 * against the fixes, so the mapping from finding -> fix is auditable.
 *
 * Run standalone:  node --test scripts/m3-review-regression.test.mjs
 * Also part of:    npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { MeshNode } from '../lib/service.mjs';
import { MeshServer, deliverToPeer } from '../lib/transport.mjs';
import { RoomAttachmentLedger, receiptRefKey } from '../lib/room-attachment-ledger.mjs';
import { createBlobHandler, sendBlob } from '../lib/room-blob-protocol.mjs';
import { RoomBlobStore } from '../lib/room-blob-store.mjs';
import { emptyState, createRoom, joinRoom } from '../lib/rooms.mjs';
import { meshRootDir, readInbox } from '../lib/store.mjs';

// `newRoomId()` keeps only 12 hex chars of the uuid source, so the fixture's
// deterministic uuid is chosen to yield exactly this room id.
const ROOM_UUID = 'aaaaaaaabbbbccccddddeeeeffff0000';
const ROOM_ID = 'room-aaaaaaaabbbb';
const digest = (body) => createHash('sha256').update(body).digest('hex');
const refOf = (body, name = 'note.txt', ownerNodeId = 'node-a') => ({
  blobId: digest(body), name, mediaType: 'text/plain', size: Buffer.byteLength(body), ownerNodeId,
});

/** A minimal stub of RoomBlobStore for ledger unit tests: node-wide `has` is TRUE. */
function fakeStore(bytes, present = true) {
  return {
    async has() { return present; },
    async openRead() { return Readable.from([bytes]); },
    async pin() {},
  };
}

/** Fresh MeshNode pair wired to an in-memory room, with isolated DSH_HOME. */
async function fixture(t, extra = {}) {
  const home = await mkdtemp(join(tmpdir(), 'm3-regression-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const state = emptyState();
  const room = createRoom(state, { name: 'Files', leader: { nodeId: 'node-b', sessionId: 'human', name: 'B' } }, () => ROOM_UUID);
  joinRoom(state, room.id, { nodeId: 'node-a', sessionId: 'human', name: 'A' });
  const make = (id, port) => {
    const n = new MeshNode({ config: { port, clusterSecret: 'secret', trustedPeers: [], autoWake: false, ...extra } });
    n.started = true;
    n.identity = { nodeId: id, name: id };
    n.roomsDoc = structuredClone(state);
    return n;
  };
  const a = make('node-a', 39101);
  const b = make('node-b', 39102);
  t.after(async () => { for (const n of [a, b]) await n.close(); if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev; await rm(home, { recursive: true, force: true }); });
  return { a, b, room };
}

function envelope(overrides = {}) {
  const body = 'regression bytes';
  const ref = refOf(body);
  return {
    id: 'msg-regression', from: { nodeId: 'node-a', sessionId: 'human' }, to: 'node-b',
    kind: 'room-message', room: ROOM_ID, text: '', sentAt: '2026-11-10T00:00:00.000Z',
    attachments: [ref], attachmentsVersion: 1, attachmentPhase: 'prepare', ...overrides,
  };
}

const upload = (node, room, body = 'hello', name = 'hello.txt') => node.uploadRoomAttachment({
  room: room.id, sessionId: 'human', readable: Readable.from([body]), name,
  mediaType: 'text/plain', size: Buffer.byteLength(body), blobId: digest(body),
});

// ---------------------------------------------------------------- #1 --------
test('#1 cross-room same-digest blob is NOT a read grant; only a per-intent receipt authorizes commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-ledger-'));
  const ledger = await RoomAttachmentLedger.open(dir);
  const bytes = Buffer.from('shared digest bytes');
  const ref = refOf(bytes);
  const e = envelope({ id: 'intent-1', attachments: [ref] });
  // Simulate the exact attack: the bytes are ALREADY present node-wide because
  // some OTHER room stored the same digest. store.has() is true.
  const store = fakeStore(bytes, true);
  await ledger.prepare(e);
  // authorize('put') may pass (prepared intent exists), but commit must not treat
  // the node-wide blob presence as proof of a legal, scoped reception.
  await assert.rejects(ledger.commit(e, store), /bytes were not received for this intent/);

  // A receipt recorded for a DIFFERENT room / sender / immutable ref does not help.
  assert.equal(await ledger.recordReceived({ roomId: 'room-other-00000000000000000000', senderNodeId: 'node-a', ref }), false);
  assert.equal(await ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-z', ref }), false);
  assert.equal(await ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-a', ref: { ...ref, name: 'renamed.txt' } }), false);
  await assert.rejects(ledger.commit(e, store), /bytes were not received for this intent/);

  // Only a fresh, precisely-scoped receipt for THIS intent's exact immutable ref
  // makes the remote commit legal.
  assert.equal(await ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-a', ref }), true);
  const committed = await ledger.commit(e, store);
  assert.equal(committed.status, 'committed');
  // GET authorization now follows from the committed room ref, not the digest.
  assert.equal(ledger.authorize({ operation: 'get', roomId: ROOM_ID, senderNodeId: 'node-x', blobId: ref.blobId }), true);
  assert.equal(ledger.authorize({ operation: 'get', roomId: 'room-other-00000000000000000000', senderNodeId: 'node-x', blobId: ref.blobId }), false);
  await rm(dir, { recursive: true, force: true });
});

test('#1 migration: legacy prepared intent has no proof and fails commit; legal committed history survives reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-migrate-'));
  const bytes = Buffer.from('legacy bytes');
  const ref = refOf(bytes);
  const legacy = envelope({ id: 'legacy-1', attachments: [ref] });
  const legal = envelope({ id: 'legal-1', attachments: [ref] });
  // Write a v1 ledger by hand: one committed (legal) intent and one prepared
  // intent with NO receivedRefs field at all (typical pre-remediation state).
  const committedEntry = { envelope: legal, local: false, expiresAt: Date.now() + 900000, status: 'committed', jobs: {}, receivedAt: '2026-11-10T00:00:01.000Z' };
  const preparedEntry = { envelope: legacy, local: false, expiresAt: Date.now() + 900000, status: 'prepared', jobs: {} };
  await writeFile(join(dir, 'attachments.json'), JSON.stringify({ version: 1, uploads: {}, messages: { [JSON.stringify(['node-a', 'legal-1'])]: committedEntry, [JSON.stringify(['node-a', 'legacy-1'])]: preparedEntry } }));
  const ledger = await RoomAttachmentLedger.open(dir);
  const store = fakeStore(bytes, true);
  // The migrated old prepared intent has no durable proof => it must fail closed,
  // NOT be auto-promoted by migration and NOT authorized by the node-wide blob.
  await assert.rejects(ledger.commit(legacy, store), /bytes were not received for this intent/);
  // Legal committed history is preserved: commit() short-circuits, authorize(get) works.
  assert.equal(ledger.authorize({ operation: 'get', roomId: ROOM_ID, senderNodeId: 'x', blobId: ref.blobId }), true);
  assert.equal((await ledger.commit(legal, store)).status, 'committed');
  assert.equal(Object.keys(ledger.data.messages).length, 2);
  await rm(dir, { recursive: true, force: true });
});

test('#1 renewal wipes stale receipts so a captured prepare replay cannot revive authorization', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-renew-'));
  const ledger = await RoomAttachmentLedger.open(dir);
  const bytes = Buffer.from('renew bytes');
  const ref = refOf(bytes);
  const e = envelope({ id: 'renew-1', attachments: [ref] });
  await ledger.prepare(e);
  await ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-a', ref });
  // Force expiry, then re-deliver the SAME captured prepare (renewal path).
  await ledger.run(() => ledger.save(d => { d.messages[ledger.key(e)].expiresAt = 1; }));
  await ledger.prepare(e);
  // The renewed intent must require a FRESH authorized PUT, not rely on the old receipt.
  await assert.rejects(ledger.commit(e, fakeStore(bytes, true)), /bytes were not received for this intent/);
  await ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-a', ref });
  assert.equal((await ledger.commit(e, fakeStore(bytes, true))).status, 'committed');
  await rm(dir, { recursive: true, force: true });
});

test('#1 concurrent real PUTs each keep their own durable receipt (queued transaction)', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-race-'));
  const ledger = await RoomAttachmentLedger.open(dir);
  const store = await RoomBlobStore.open({ dir: join(dir, 'blobs') });
  const refA = refOf(Buffer.from('concurrent A'), 'a.txt');
  const refB = refOf(Buffer.from('concurrent B'), 'b.txt');
  const eA = envelope({ id: 'race-a', text: 'A', attachments: [refA] });
  const eB = envelope({ id: 'race-b', text: 'B', attachments: [refB] });
  await ledger.prepare(eA);
  await ledger.prepare(eB);

  // Both PUTs reach the receipt step together. Without a queued transaction each
  // call clones the SAME snapshot, so the second save loses the first receipt.
  // The barrier must never deadlock the suite: it releases when both PUTs have
  // arrived OR after a short bound (the race is still exercised either way).
  let release; const gate = new Promise(resolve => { release = resolve; });
  let arrived = 0;
  const timer = setTimeout(() => release(), 3000);
  timer.unref?.();
  const handler = createBlobHandler({
    store, nodeId: () => 'node-b', secret: () => 'secret', trustedPeers: () => ['node-a'],
    authorize: async () => true,
    onReceived: async r => {
      arrived += 1;
      if (arrived >= 2) release();
      await gate;
      return ledger.run(() => ledger.recordReceived({ roomId: r.roomId, senderNodeId: r.senderNodeId, ref: r.ref }));
    },
  });
  const server = new MeshServer({ describe: () => ({ nodeId: 'node-b' }), secret: () => 'secret', trustedPeers: () => [], onMessage: async () => ({}), onBlob: handler });
  await server.listen(0);
  const peer = { address: '127.0.0.1', port: server.port, nodeId: 'node-b', roomBlobs: 1 };
  t.after(() => server.close());
  const put = (ref, body) => sendBlob({
    peer, nodeId: 'node-a', secret: 'secret', roomId: ROOM_ID, attachment: ref,
    readable: Readable.from([body]),
  });
  await Promise.all([put(refA, 'concurrent A'), put(refB, 'concurrent B')]);
  clearTimeout(timer);

  // Both receipts must survive, in ONE snapshot, and both intents can commit.
  const messages = ledger.data.messages;
  assert.deepEqual(messages[ledger.key(eA)].receivedRefs, [receiptRefKey(refA)], 'receipt for A survived');
  assert.deepEqual(messages[ledger.key(eB)].receivedRefs, [receiptRefKey(refB)], 'receipt for B survived');

  // A receipt may only be recorded for a still-valid prepared intent: an intent
  // that expired while the write was queued must not gain fresh authorization.
  const refC = refOf(Buffer.from('expired C'), 'c.txt');
  const eC = envelope({ id: 'race-c', text: 'C', attachments: [refC] });
  await ledger.prepare(eC);
  await ledger.run(() => ledger.save(d => { d.messages[ledger.key(eC)].expiresAt = 1; }));
  assert.equal(await ledger.run(() => ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-a', ref: refC })), false,
    'expired intent must not accept a late receipt');
  await assert.rejects(ledger.commit(eC, store), /expired/);

  // Reopen: both receipts are durable, so both commits are legal after restart.
  const reopened = await RoomAttachmentLedger.open(dir);
  assert.deepEqual(reopened.data.messages[ledger.key(eA)].receivedRefs, [receiptRefKey(refA)]);
  assert.deepEqual(reopened.data.messages[ledger.key(eB)].receivedRefs, [receiptRefKey(refB)]);
  assert.equal((await reopened.commit(eA, store)).status, 'committed');
  assert.equal((await reopened.commit(eB, store)).status, 'committed');
  await rm(dir, { recursive: true, force: true });
});

test('#1 a receipt that cannot be made durable never acknowledges the PUT', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-receipt-fail-'));
  const ledger = await RoomAttachmentLedger.open(dir);
  const store = await RoomBlobStore.open({ dir: join(dir, 'blobs') });
  const ref = refOf(Buffer.from('receipt failure bytes'), 'fail.txt');
  const e = envelope({ id: 'receipt-fail', text: 'fail', attachments: [ref] });
  await ledger.prepare(e);
  // Inject one durable-write failure at the ledger file boundary.
  const original = ledger.save.bind(ledger);
  ledger.save = async () => { throw new Error('disk full'); };
  const handler = createBlobHandler({
    store, nodeId: () => 'node-b', secret: () => 'secret', trustedPeers: () => ['node-a'],
    authorize: async () => true,
    onReceived: r => ledger.run(() => ledger.recordReceived({ roomId: r.roomId, senderNodeId: r.senderNodeId, ref: r.ref })),
  });
  const server = new MeshServer({ describe: () => ({ nodeId: 'node-b' }), secret: () => 'secret', trustedPeers: () => [], onMessage: async () => ({}), onBlob: handler });
  await server.listen(0);
  const peer = { address: '127.0.0.1', port: server.port, nodeId: 'node-b', roomBlobs: 1 };
  t.after(() => server.close());
  await assert.rejects(sendBlob({ peer, nodeId: 'node-a', secret: 'secret', roomId: ROOM_ID, attachment: ref, readable: Readable.from(['receipt failure bytes']) }), /RECEIPT_UNAVAILABLE|HTTP_503/);
  ledger.save = original;
  // Nothing was acknowledged, so no receipt exists and commit stays illegal.
  await assert.rejects(ledger.commit(e, store), /bytes were not received for this intent/);
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- #2 --------
test('#2 attachment receive rejects a wrong signed target and a removed receiver before persisting', async t => {
  const { a, b, room } = await fixture(t);
  await b.roomAttachmentHandler();
  const ref = await upload(a, room);
  const e = envelope({ id: 'bad-target', to: 'node-z', attachments: [ref], room: room.id });
  await assert.rejects(b.receive(e), /WRONG_TARGET|target is not this node/);
  // No durable prepare was admitted for the misdirected envelope.
  assert.equal(b.attachmentService.ledger.data.messages[ledgerKey(e)], undefined);

  // Correct target but this node is no longer a member of the room.
  const right = envelope({ id: 'removed-member', to: 'node-b', attachments: [ref], room: room.id });
  b.roomsDoc.rooms[room.id].members = b.roomsDoc.rooms[room.id].members.filter(m => m.nodeId !== 'node-b');
  await assert.rejects(b.receive(right), /no longer a room member|BAD_ATTACHMENTS/);
  assert.equal(b.attachmentService.ledger.data.messages[ledgerKey(right)], undefined);
});
function ledgerKey(e) { return JSON.stringify([e.from.nodeId, e.id]); }

// ---------------------------------------------------------------- #3 --------
test('#3 mark-as-read rewrite and restart keep immutable attachment refs; stripped disk records are repaired', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room);
  // Publish a committed attachment message to b through the real service.
  b.server = new MeshServer({ describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: e => b.receive(e), onBlob: await b.roomAttachmentHandler() });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'File', attachments: [ref], messageId: 'refs-survive-read' });

  // Mark everything read -> #saveInbox() does a full rewrite; attachments must survive.
  await b.markAllRead();
  const inboxPath = join(meshRootDir(b.config.port), 'inbox.jsonl');
  const disk = await readFile(inboxPath, 'utf8');
  assert.match(disk, /"attachments"/);

  // Simulate a legacy disk record that was stripped by the old rewrite (no refs),
  // then restart: startup republish from the trusted committed ledger repairs it.
  // The strip happens AFTER close(), because close() itself rewrites the log.
  await b.close();
  const lines = disk.trim().split('\n').map(line => { const r = JSON.parse(line); if (r.envelope?.id === 'refs-survive-read') delete r.envelope.attachments; return JSON.stringify(r); });
  await writeFile(inboxPath, `${lines.join('\n')}\n`);
  const fresh = new MeshNode({ config: b.config });
  fresh.started = true;
  fresh.identity = b.identity;
  fresh.roomsDoc = structuredClone(b.roomsDoc);
  // Load the (deliberately stripped) log exactly the way #startOnce does, then
  // let the attachment service republish from the trusted committed ledger:
  // publish() must patch the existing same-id record in place, keeping `read`.
  for (const record of await readInbox({ limit: 5000, port: fresh.config.port })) {
    const env = record?.envelope;
    if (!env || typeof env.id !== 'string') continue;
    fresh.messages.push(fresh.record ? fresh.record(env, record.receivedAt, record.read === true) : { ...env, receivedAt: record.receivedAt, read: record.read === true });
  }
  await fresh.roomAttachmentHandler();
  const detail = fresh.roomDetail({ room: room.id, sessionId: 'human' });
  const msg = detail.messages.find(m => m.id === 'refs-survive-read');
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].blobId, ref.blobId);
  assert.equal(msg.read, true, 'read state is preserved, not reset');
  const stream = await fresh.readRoomAttachment({ room: room.id, sessionId: 'human', blobId: ref.blobId });
  let bytes = ''; for await (const part of stream) bytes += part;
  assert.equal(bytes, 'hello');
  await fresh.close();
});

// ---------------------------------------------------------------- #4 --------
test('#4 concurrent same-ID sends are coalesced and network runs outside the ledger queue', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room);
  b.server = new MeshServer({ describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: e => b.receive(e), onBlob: await b.roomAttachmentHandler() });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  const req = { room: room.id, sessionId: 'human', text: 'Concurrent', attachments: [ref], messageId: 'coalesced' };
  // Fire an operator retry and two fresh sends for the SAME id at once.
  const results = await Promise.all([
    a.sayInRoom(req), a.sayInRoom(req), a.retryRoomAttachmentDeliveries(),
  ]);
  assert.equal(results[0].messageId, 'coalesced');
  assert.equal(results[1].messageId, 'coalesced');
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'coalesced').length, 1,
    'the message is published exactly once, not once per concurrent call');

  // The ledger queue must NOT be held during network: while a send is in flight,
  // an inbound receive() (which also needs the queue) must still be serviceable.
  const slow = new MeshServer({ describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: async e => { await new Promise(r => setTimeout(r, 150)); return b.receive(e); }, onBlob: await b.roomAttachmentHandler() });
  await slow.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: slow.port }];
  const ref2 = await upload(a, room, 'second');
  const inflight = a.sayInRoom({ room: room.id, sessionId: 'human', text: 'slow', attachments: [ref2], messageId: 'slow-send' });
  // This inbound prepare uses b's ledger (different node), so use a local probe on a:
  // a.commit of a SECOND prepared intent must not be blocked behind slow-send's network.
  const probe = a.attachmentService.ledger;
  const ok = await Promise.race([
    probe.run(() => 'queue-free').then(v => v),
    new Promise(r => setTimeout(() => r('blocked'), 500)),
  ]);
  assert.equal(ok, 'queue-free', 'ledger.run is not held across network waits');
  await inflight;
  await slow.close();
});

// ------------------------------------------------------------- Task 2 --------
// docs/superpowers/plans/2026-11-10-m3-completion-remediation.md Task 2:
// coalescing used to key ONLY on sender+messageId, so a second request with
// different content resolved with the first request's result before the ledger
// fingerprint check could ever run. Content must be validated FIRST.
test('#2 a same-ID send with different canonical content conflicts instead of borrowing the result', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room);
  const other = await upload(a, room, 'different bytes', 'other.txt');
  b.server = new MeshServer({
    describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [],
    onMessage: async e => { await new Promise(r => setTimeout(r, 60)); return b.receive(e); },
    onBlob: await b.roomAttachmentHandler(),
  });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];

  const base = { room: room.id, sessionId: 'human', text: 'Original body', attachments: [ref], messageId: 'plan-conflict' };
  const first = a.sayInRoom(base);
  // Let the first request enter the in-flight map before the variants race it.
  await new Promise(r => setTimeout(r, 20));

  // Each variant differs in canonical content and MUST be rejected as a conflict,
  // never resolved with the first send's result.
  await assert.rejects(a.sayInRoom({ ...base, text: 'Rewritten body' }), /conflict|different content/i);
  await assert.rejects(a.sayInRoom({ ...base, attachments: [other] }), /conflict|different content/i);
  await assert.rejects(a.sayInRoom({ ...base, mentions: [{ memberKey: 'node-a/human', label: 'A' }] }), /conflict|different content/i);
  await assert.rejects(a.sayInRoom({ ...base, sessionId: 'agent-1' }), /conflict|different content|not a room member/i);

  // Identical canonical content shares ONE operation: no second replication, no
  // second published message, and both callers get the same message id.
  const second = a.sayInRoom({ ...base, text: 'Original body' });
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.messageId, 'plan-conflict');
  assert.equal(r2.messageId, 'plan-conflict');
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'plan-conflict').length, 1);

  // Mutating the caller's objects after the call must not change what was sent:
  // the immutable envelope is copied and normalized before it enters the map.
  const mutated = { room: room.id, sessionId: 'human', text: 'Mutable body', attachments: [ref], messageId: 'plan-mutate' };
  const sent = a.sayInRoom(mutated);
  mutated.text = 'Changed after the call';
  mutated.attachments[0] = { ...other };
  mutated.attachments.push({ ...other });
  assert.equal((await sent).messageId, 'plan-mutate');
  const stored = a.attachmentService.ledger.data.messages[ledgerKey({ from: { nodeId: a.nodeId }, id: 'plan-mutate' })].envelope;
  assert.equal(stored.text, 'Mutable body', 'the sent body is the body at call time, not a later mutation');
  assert.equal(stored.attachments.length, 1, 'the sent ref list is the ref list at call time');
  assert.equal(stored.attachments[0].blobId, ref.blobId);
});

test('#2 a failed send releases its coalescing entry so the same id can be retried', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room);
  const req = { room: room.id, sessionId: 'human', text: 'Offline first', attachments: [ref], messageId: 'plan-retry' };
  a.resolvePeers = () => [];
  await assert.rejects(a.sayInRoom(req), /LEADER_UNAVAILABLE|unavailable|replication failed/i);
  // The entry must not survive the rejection: this would hang on a settled promise.
  b.server = new MeshServer({ describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: e => b.receive(e), onBlob: await b.roomAttachmentHandler() });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  assert.equal((await a.sayInRoom(req)).messageId, 'plan-retry');
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'plan-retry').length, 1);
});

// ---------------------------------------------------------------- #5 --------
test('#5 background retry never silently publishes an editable failed draft; operator retry still can', async t => {
  const { a, room } = await fixture(t);
  const ref = await upload(a, room);
  a.resolvePeers = () => [];
  await assert.rejects(a.sayInRoom({ room: room.id, sessionId: 'human', attachments: [ref], messageId: 'draft' }), /Leader|leader/);
  assert.equal(a.roomDetail({ room: room.id }).messages.length, 0);
  const key = JSON.stringify([a.nodeId, 'draft']);
  assert.equal(a.attachmentService.ledger.data.messages[key].status, 'prepared');

  // Background sweep (timer/startup path) must NOT publish the draft.
  const bg = await a.retryRoomAttachmentDeliveries({ background: true });
  assert.equal(bg.length, 0, 'background retry skips uncommitted drafts');
  assert.equal(a.roomDetail({ room: room.id }).messages.length, 0);

  // An explicit operator retry (no background flag) still sees every draft, and
  // once the Leader is back it publishes exactly once.
  b_server_setup: {
    // bring up a real Leader on b
  }
  const b = new MeshNode({ config: { port: 39103, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  b.started = true; b.identity = { nodeId: 'node-b', name: 'b' }; b.roomsDoc = structuredClone(a.roomsDoc);
  b.server = new MeshServer({ describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: e => b.receive(e), onBlob: await b.roomAttachmentHandler() });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  const op = await a.retryRoomAttachmentDeliveries();
  assert.equal(op.length, 1);
  assert.equal(a.roomDetail({ room: room.id }).messages.filter(m => m.id === 'draft').length, 1);
  // A second operator retry is idempotent (lost-ACK style recovery).
  await a.retryRoomAttachmentDeliveries();
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'draft').length, 1);
  await b.close();
});

// ---------------------------------------------------------------- #6 --------
test('#6 production orphan cleanup frees abandoned upload quota and prunes stale upload records', async t => {
  const { a, room } = await fixture(t);
  const ref = await upload(a, room, 'abandoned bytes');
  const svc = a.attachmentService;
  assert.equal(await svc.store.has(ref.blobId), true);
  // Abandon: unpin so the blob becomes an orphan, then cross the configured grace.
  await svc.store.unpin(ref.blobId, 'probe');
  const uploadKey = JSON.stringify([room.id, 'human', ref.blobId, ref.name, ref.mediaType]);
  assert.equal(svc.ledger.data.uploads[uploadKey] !== undefined, true);
  const collected = await a.collectRoomAttachmentGarbage(Date.now() + 86400001);
  assert.ok(collected.includes(ref.blobId), 'abandoned blob is collected');
  assert.equal(await svc.store.has(ref.blobId), false);
  assert.equal(svc.ledger.data.uploads[uploadKey], undefined, 'matching stale upload record is pruned');

  // Committed pins are protected: a pinned blob survives the same cleanup.
  const pinned = await upload(a, room, 'committed bytes', 'keep.txt');
  await svc.store.pin(pinned.blobId, 'pinned-ref');
  const kept = await a.collectRoomAttachmentGarbage(Date.now() + 86400001);
  assert.ok(!kept.includes(pinned.blobId), 'committed pin is not collected');
  assert.equal(await svc.store.has(pinned.blobId), true);
});

// ---------------------------------------------------------------- #7 --------
test('#7 a node missing local bytes fetches them on demand from a room holder and becomes a holder only after full verification', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room, 'holder bytes');
  // Committed ref on BOTH ledgers (deliver through real HTTP once).
  b.server = new MeshServer({ describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: e => b.receive(e), onBlob: await b.roomAttachmentHandler() });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'Holder', attachments: [ref], messageId: 'holder-msg' });
  // b holds the bytes (Leader). Simulate a reader node that has the committed ref
  // in its ledger but lost its local bytes (e.g. after GC / disk loss).
  const c = new MeshNode({ config: { port: 39104, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  c.started = true; c.identity = { nodeId: 'node-c', name: 'c' }; c.roomsDoc = structuredClone(b.roomsDoc);
  joinRoom(c.roomsDoc, room.id, { nodeId: 'node-c', sessionId: 'human', name: 'C' });
  // Room membership anti-entropy: the Leader also learns C joined. Without that
  // the holder's own GET authorize would (correctly) refuse an unknown sender.
  joinRoom(b.roomsDoc, room.id, { nodeId: 'node-c', sessionId: 'human', name: 'C' });
  await c.roomAttachmentHandler();
  // Seed c's ledger with the same committed intent (as if it had received it earlier).
  const ce = envelope({ id: 'holder-msg', attachments: [ref] });
  await c.attachmentService.ledger.prepare({ ...ce, attachmentPhase: 'commit' });
  await c.attachmentService.ledger.run(() => c.attachmentService.ledger.save(d => {
    const m = d.messages[c.attachmentService.ledger.key(ce)];
    m.status = 'committed'; m.receivedAt = new Date().toISOString();
  }));
  assert.equal(await c.blobStore.has(ref.blobId), false, 'reader has no local bytes');
  // Only B is reachable as a holder.
  c.resolvePeers = (id) => id === 'node-b' ? [{ nodeId: 'node-b', name: 'B', address: '127.0.0.1', httpPort: b.server.port }] : [];
  const stream = await c.readRoomAttachment({ room: room.id, sessionId: 'human', blobId: ref.blobId });
  let bytes = ''; for await (const part of stream) bytes += part;
  assert.equal(bytes, 'holder bytes');
  assert.equal(await c.blobStore.has(ref.blobId), true, 'reader became a holder after full-byte verification');

  // No reachable holder -> explicit unavailable error, never a silent digest claim.
  const d = new MeshNode({ config: { port: 39105, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  d.started = true; d.identity = { nodeId: 'node-d', name: 'd' }; d.roomsDoc = structuredClone(b.roomsDoc);
  joinRoom(d.roomsDoc, room.id, { nodeId: 'node-d', sessionId: 'human', name: 'D' });
  await d.roomAttachmentHandler();
  await d.attachmentService.ledger.prepare({ ...ce, attachmentPhase: 'commit' });
  await d.attachmentService.ledger.run(() => d.attachmentService.ledger.save(x => {
    const m = x.messages[d.attachmentService.ledger.key(ce)];
    m.status = 'committed'; m.receivedAt = new Date().toISOString();
  }));
  d.resolvePeers = () => [];
  await assert.rejects(d.readRoomAttachment({ room: room.id, sessionId: 'human', blobId: ref.blobId }), /no reachable holder|temporarily unavailable/);
  await c.close(); await d.close();
});

// ---------------------------------------------------------------- #8 --------
test('#8 an old ordinary peer that still supports exact references gets readable text, never bytes or a broadcast; old Leader still fails', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room, 'legacy peer bytes');
  const received = [];
  // An OLD ordinary node: /info advertises nodeId and roomReferences (it can carry
  // exact structured mentions) but NO roomAttachments/roomBlobs. It records what
  // it actually received. This is the only legacy shape that may get a notice at
  // all: with no exact-reference support the sender fails closed instead.
  const old = new MeshServer({ describe: () => ({ nodeId: 'node-b', roomReferences: 1 }), secret: () => 'secret', trustedPeers: () => [], onMessage: async e => { received.push(e); return {}; } });
  await old.listen(0);
  a.resolvePeers = () => [{ nodeId: 'node-b', name: 'old', address: '127.0.0.1', httpPort: old.port }];
  // A modern Leader must still exist for the send to commit; make a 3rd node the Leader.
  const leader = new MeshNode({ config: { port: 39106, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  leader.started = true; leader.identity = { nodeId: 'node-leader', name: 'leader' }; leader.roomsDoc = structuredClone(a.roomsDoc);
  // The Leader must be a current member of its own room, otherwise it would
  // (correctly) refuse to persist the prepare/commit intent.
  const seatLeader = (doc) => {
    const target = doc.rooms[room.id];
    target.leader = { ...target.leader, nodeId: 'node-leader', key: 'node-leader/human' };
    if (!target.members.some(m => m.nodeId === 'node-leader')) {
      target.members.push({ nodeId: 'node-leader', sessionId: 'human', name: 'leader', key: 'node-leader/human', role: 'leader' });
    }
  };
  seatLeader(a.roomsDoc); seatLeader(leader.roomsDoc); seatLeader(b.roomsDoc);
  room.leader.nodeId = 'node-leader';
  leader.server = new MeshServer({ describe: () => leader.describe(), secret: () => 'secret', trustedPeers: () => [], onMessage: e => leader.receive(e), onBlob: await leader.roomAttachmentHandler() });
  await leader.server.listen(0);
  // resolvePeers returns Leader for replication and old node for fan-out.
  a.resolvePeers = (id) => id === 'node-leader'
    ? [{ nodeId: 'node-leader', name: 'Leader', address: '127.0.0.1', httpPort: leader.server.port }]
    : [{ nodeId: 'node-b', name: 'old', address: '127.0.0.1', httpPort: old.port }];
  const result = await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'Body text', attachments: [ref], messageId: 'old-peer' });
  const downgraded = result.delivered.find(d => d.nodeId === 'node-b');
  assert.equal(downgraded.downgraded, true);
  assert.equal(downgraded.delivered, 'readable-text-with-exact-references');
  // The two delivery facts are reported separately: the notice reached the node,
  // its bytes did not. A bare ok:true must not blur that difference.
  assert.equal(downgraded.metadataDelivered, true);
  assert.equal(downgraded.blobDelivered, false);
  assert.equal(received.length, 1);
  const note = received[0];
  assert.equal(note.to, 'node-b', 'precise target is preserved, no @all / broadcast');
  assert.equal(note.attachments, undefined, 'no new base64 / attachment bytes');
  assert.deepEqual(note.mentions, [], 'mentions stays DEFINED so the receiver never derives targets from body/file-name tokens');
  assert.equal(note.referencesVersion, 1, 'the notice travels on the signed exact-reference channel');
  assert.match(note.text, /Body text/);
  assert.match(note.text, /hello\.txt/);
  assert.match(note.text, /不支持附件预览/);

  // Old Leader (no roomAttachments) must still FAIL the attachment commit and keep the draft.
  const ref2 = await upload(a, room, 'second', 'second.txt');
  a.resolvePeers = () => [{ nodeId: 'node-b', name: 'old', address: '127.0.0.1', httpPort: old.port }];
  a.roomsDoc.rooms[room.id].leader.nodeId = 'node-b';
  await assert.rejects(a.sayInRoom({ room: room.id, sessionId: 'human', attachments: [ref2], messageId: 'old-leader' }), /Leader|support|leader/i);
  assert.equal(a.roomDetail({ room: room.id }).messages.filter(m => m.id === 'old-leader').length, 0, 'draft retained, not published');
  await old.close(); await leader.close();
});

// ------------------------------------------------------- Task 3 (M3 #8) ----
// The old "readable downgrade" note stripped structured mentions and kept only
// the node-level `to`. On an old ordinary node with more than one agent, the
// receiving service then re-derives targets from the plain body — so an `@` in
// the body or in a FILE NAME (including `@all`) can wake agents that were never
// addressed. These tests observe the real receiving service's wake calls.

/** Old ordinary peer: a real MeshNode (so its real receive()/#wakeRoom runs). */
async function oldPeer(t, { nodeId, sessions, advertise }) {
  const woke = [];
  const agents = {
    get: (id) => (sessions.includes(id) ? { session: { id, title: 'Same' }, followup: () => woke.push(id) } : undefined),
    list: () => sessions.map((id) => ({ id })),
  };
  const node = new MeshNode({ config: { port: 0, autoWake: true, clusterSecret: 'secret', trustedPeers: [] }, agents });
  node.started = true;
  node.identity = { nodeId, name: nodeId };
  node.roomsDoc = structuredClone(advertise.roomsDoc);
  node.server = new MeshServer({
    describe: () => ({ ...node.describe(), ...(advertise.references ? {} : { roomReferences: undefined }) }),
    secret: () => 'secret', trustedPeers: () => [], onMessage: (e) => node.receive(e),
  });
  await node.server.listen(0);
  t.after(() => node.close());
  return { node, woke, port: node.server.port };
}

/** Room where node-a is the Leader/sender and node-b hosts two same-named agents. */
function twoAgentRoom() {
  const state = emptyState();
  const room = createRoom(state, { name: 'Files', leader: { nodeId: 'node-a', sessionId: 'human', name: 'A' } }, () => ROOM_UUID);
  joinRoom(state, room.id, { nodeId: 'node-b', sessionId: 'b-one', name: 'Same' });
  joinRoom(state, room.id, { nodeId: 'node-b', sessionId: 'b-two', name: 'Same' });
  return { state, room };
}

test('Task 3 an exact mention on an old reference-capable node wakes ONLY the addressed agent', async (t) => {
  const { state, room } = twoAgentRoom();
  const home = await mkdtemp(join(tmpdir(), 'm3-task3-'));
  const prev = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(async () => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev; await rm(home, { recursive: true, force: true }); });
  // Sender/Leader: modern, has attachments.
  const a = new MeshNode({ config: { port: 39111, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  a.started = true; a.identity = { nodeId: 'node-a', name: 'A' }; a.roomsDoc = structuredClone(state);
  t.after(() => a.close());
  const old = await oldPeer(t, { nodeId: 'node-b', sessions: ['b-one', 'b-two'], advertise: { roomsDoc: state, references: true } });
  a.resolvePeers = () => [{ nodeId: 'node-b', name: 'old', address: '127.0.0.1', httpPort: old.port }];
  const ref = await upload(a, room, 'targeted bytes');
  const result = await a.sayInRoom({
    room: room.id, sessionId: 'human', text: 'please look @Same',
    mentions: [{ memberKey: 'node-b/b-one', label: 'Same' }],
    attachments: [ref], messageId: 'legacy-exact',
  });
  const legacy = result.delivered.find((d) => d.nodeId === 'node-b');
  assert.equal(legacy.blobDelivered, false, 'bytes never reach an old node');
  assert.deepEqual(old.woke, ['b-one'], 'only the explicitly addressed member is woken');
});

test('Task 3 a file name containing @all on an old node never wakes unmentioned agents', async (t) => {
  const { state, room } = twoAgentRoom();
  const home = await mkdtemp(join(tmpdir(), 'm3-task3-all-'));
  const prev = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(async () => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev; await rm(home, { recursive: true, force: true }); });
  const a = new MeshNode({ config: { port: 39112, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  a.started = true; a.identity = { nodeId: 'node-a', name: 'A' }; a.roomsDoc = structuredClone(state);
  t.after(() => a.close());
  const old = await oldPeer(t, { nodeId: 'node-b', sessions: ['b-one', 'b-two'], advertise: { roomsDoc: state, references: true } });
  a.resolvePeers = () => [{ nodeId: 'node-b', name: 'old', address: '127.0.0.1', httpPort: old.port }];
  const ref = await upload(a, room, 'all-named bytes', '@all.txt');
  await a.sayInRoom({
    room: room.id, sessionId: 'human', text: 'one file for @Same',
    mentions: [{ memberKey: 'node-b/b-one', label: 'Same' }],
    attachments: [ref], messageId: 'legacy-all',
  });
  assert.deepEqual(old.woke, ['b-one'], 'the @all inside a file name must not widen the wake set');
});

test('Task 3 a node without exact-reference support gets nothing rather than a broadcast wake', async (t) => {
  const { state, room } = twoAgentRoom();
  const home = await mkdtemp(join(tmpdir(), 'm3-task3-none-'));
  const prev = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(async () => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev; await rm(home, { recursive: true, force: true }); });
  const a = new MeshNode({ config: { port: 39113, clusterSecret: 'secret', trustedPeers: [], autoWake: false } });
  a.started = true; a.identity = { nodeId: 'node-a', name: 'A' }; a.roomsDoc = structuredClone(state);
  t.after(() => a.close());
  const received = [];
  const old = new MeshServer({
    describe: () => ({ nodeId: 'node-b' }), secret: () => 'secret', trustedPeers: () => [],
    onMessage: async (e) => { received.push(e); return {}; },
  });
  await old.listen(0);
  t.after(() => old.close());
  a.resolvePeers = () => [{ nodeId: 'node-b', name: 'old', address: '127.0.0.1', httpPort: old.port }];
  const ref = await upload(a, room, 'nosupport bytes');
  const result = await a.sayInRoom({
    room: room.id, sessionId: 'human', text: 'please look @Same',
    mentions: [{ memberKey: 'node-b/b-one', label: 'Same' }],
    attachments: [ref], messageId: 'legacy-nosupport',
  });
  const legacy = result.delivered.find((d) => d.nodeId === 'node-b');
  assert.equal(legacy.ok, false, 'fail closed instead of guessing a target');
  assert.equal(legacy.incompatible, true);
  assert.equal(legacy.metadataDelivered, false);
  assert.equal(legacy.blobDelivered, false);
  assert.equal(received.length, 0, 'no broadcast-capable room message is sent to that node');
});

// ---------------------------------------------------------------- #9 --------
test('#9 two attachments with identical bytes but different names get distinct stable per-item keys', async () => {
  // client.js is CRLF; normalise so the slice boundaries are stable.
  const source = (await readFile(new URL('../client.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('function ChatBubble(props) {');
  assert.ok(start > 0, 'ChatBubble is present in client.js');
  // Brace-match to the end of the function so the slice is a complete expression.
  let end = source.indexOf('{', start);
  let depth = 0;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') { depth -= 1; if (depth === 0) { end += 1; break; } }
  }
  const slice = source.slice(start, end);
  assert.ok(slice.trimEnd().endsWith('}'), 'ChatBubble slice ends at its closing brace');
  // Run the function body in a sandbox with stubbed rendering helpers.
  const keys = [];
  const h = (type, propsArg) => {
    if (typeof type === 'function' && propsArg?.key !== undefined) keys.push(propsArg.key);
    if (type === 'function' || (typeof type === 'object' && type !== null)) return { type, props: propsArg };
    return { type, props: propsArg };
  };
  const context = vm.createContext({
    h,
    COPY: { me: 'me', download: 'download', skillRefsAria: 'skills', skillRefsLabel: 'Skills', skillMissing: 'missing', skillNamesake: 'namesake', skillSourceOf: 'from', skillRefBadge: '' },
    MarkdownText: undefined,
    AttachmentCard: function AttachmentCard() {},
    senderOf: () => 'sender',
    messageStamp: () => '',
    markdownLabels: () => ({}),
    skillRefsOf: () => [],
    skillRefState: () => 'missing',
    formatFileSize: (n) => String(n),
    fileIcon: () => '',
    file: null,
  });
  const run = vm.runInContext(`(${slice.trim()})`, context);
  const message = { text: 'dup', attachments: [
    { blobId: 'a'.repeat(64), name: 'one.txt', mediaType: 'text/plain', size: 1, ownerNodeId: 'node-a' },
    { blobId: 'a'.repeat(64), name: 'two.txt', mediaType: 'text/plain', size: 1, ownerNodeId: 'node-a' },
  ] };
  run({ message, roomId: ROOM_ID, mine: false, selfLabel: '', senderLabel: '', skills: [], kind: 'human' });
  assert.equal(keys.length, 2, 'both cards are rendered');
  assert.notEqual(keys[0], keys[1], 'per-item keys are distinct even with the same blobId');
  assert.match(keys[0], /\/0$/);
  assert.match(keys[1], /\/1$/);
});

// -------------------------------------------------- Task 5a (lost ACK) --------
test('#5a a lost Leader ACK is reconciled read-only: the attested commit is adopted and nothing is re-sent', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room);
  // The Leader commits and then its response is lost on the way back, so the
  // sender can never learn the outcome from the send call itself.
  let lost = false;
  b.server = new MeshServer({
    describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [],
    onMessage: async (e) => {
      const result = await b.receive(e);
      if (!lost && e.attachmentPhase === 'commit') { lost = true; throw new Error('lost ACK'); }
      return result;
    },
    onBlob: await b.roomAttachmentHandler(),
    onSync: await b.roomAttachmentSyncHandler(),
  });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  await assert.rejects(
    a.sayInRoom({ room: room.id, sessionId: 'human', text: 'lost', attachments: [ref], messageId: 'lost-ack' }),
    /lost ACK|Leader|leader/,
  );
  assert.equal(lost, true, 'the Leader did answer and commit before the ACK was lost');
  assert.equal(a.roomDetail({ room: room.id }).messages.length, 0, 'the sender never learned the outcome');
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'lost-ack').length, 1, 'the Leader really committed');
  const key = JSON.stringify([a.nodeId, 'lost-ack']);
  assert.equal(a.attachmentService.ledger.data.messages[key].status, 'prepared', 'sender side is still an unresolved intent');
  // The background sweep deliberately skips uncommitted drafts, so without a
  // read-only reconciliation this legitimate message would stay stranded forever.
  const bg = await a.retryRoomAttachmentDeliveries({ background: true });
  assert.equal(bg.length, 0);
  assert.equal(a.roomDetail({ room: room.id }).messages.length, 0);

  const summary = await a.reconcileRoomAttachmentDeliveries(room.id);
  assert.deepEqual(summary.committed, ['lost-ack']);
  assert.deepEqual(summary.absent, []);
  assert.deepEqual(summary.unknown, []);
  assert.equal(a.roomDetail({ room: room.id }).messages.filter(m => m.id === 'lost-ack').length, 1, 'adopted exactly once');
  assert.equal(a.attachmentService.ledger.data.messages[key].status, 'committed');
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'lost-ack').length, 1,
    'reconciliation never re-sends: the Leader keeps exactly one copy');
  // A second reconcile has nothing left to check and publishes nothing new.
  const again = await a.reconcileRoomAttachmentDeliveries(room.id);
  assert.equal(again.checked, 0);
  assert.equal(again.committed.length, 0);
  assert.equal(a.roomDetail({ room: room.id }).messages.filter(m => m.id === 'lost-ack').length, 1);
});

test('#5a a draft the Leader never received is recorded as a definite failure and stays retryable', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room);
  // The Leader was unreachable, so nothing was ever transmitted to it.
  a.resolvePeers = () => [];
  await assert.rejects(
    a.sayInRoom({ room: room.id, sessionId: 'human', text: 'never sent', attachments: [ref], messageId: 'never-sent' }),
    /Leader|leader|unavailable/,
  );
  const key = JSON.stringify([a.nodeId, 'never-sent']);
  assert.equal(a.attachmentService.ledger.data.messages[key].status, 'prepared');

  // The Leader comes up for the first time: it has no such committed message.
  b.server = new MeshServer({
    describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [],
    onMessage: (e) => b.receive(e), onBlob: await b.roomAttachmentHandler(),
    onSync: await b.roomAttachmentSyncHandler(),
  });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];

  const summary = await a.reconcileRoomAttachmentDeliveries(room.id);
  assert.deepEqual(summary.absent, ['never-sent']);
  assert.deepEqual(summary.committed, []);
  assert.equal(a.attachmentService.ledger.data.messages[key].reconcile.decision, 'absent',
    'the undelivered draft becomes a definite failure instead of an eternal unknown');
  assert.equal(a.roomDetail({ room: room.id }).messages.length, 0,
    'reconciliation never publishes a message the Leader does not have');

  // A definite failure is still an operator decision, not a silent resend.
  const retried = await a.retryRoomAttachmentDeliveries();
  assert.equal(retried.length, 1);
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'never-sent').length, 1);
});

test('#5a an unreachable Leader stays unknown and never becomes durable history', async t => {
  const { a, room } = await fixture(t);
  const ref = await upload(a, room);
  a.resolvePeers = () => [];
  await assert.rejects(
    a.sayInRoom({ room: room.id, sessionId: 'human', text: 'unknown', attachments: [ref], messageId: 'unknown-state' }),
    /Leader|leader|unavailable/,
  );
  const key = JSON.stringify([a.nodeId, 'unknown-state']);

  // (1) No route to the Leader at all.
  const noPeer = await a.reconcileRoomAttachmentDeliveries(room.id);
  assert.deepEqual(noPeer.unknown, ['unknown-state']);
  assert.equal(a.attachmentService.ledger.data.messages[key].reconcile, undefined);

  // (2) A route exists but the Leader cannot be reached.
  a.resolvePeers = () => [{ nodeId: 'node-b', name: 'B', address: '127.0.0.1', httpPort: 1 }];
  const unreachable = await a.reconcileRoomAttachmentDeliveries(room.id);
  assert.deepEqual(unreachable.unknown, ['unknown-state']);
  assert.equal(a.attachmentService.ledger.data.messages[key].reconcile, undefined,
    'an undetermined outcome is never recorded as a decision');
  assert.equal(a.attachmentService.ledger.data.messages[key].status, 'prepared');
  assert.equal(a.roomDetail({ room: room.id }).messages.length, 0);
});

// -------------------------------------- Task 5b (renewal + GC safety) --------
test('#5b renewing a stale prepare only re-arms a fresh PUT; a captured prepare replay still cannot commit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-renew-'));
  const ledger = await RoomAttachmentLedger.open(dir);
  const store = await RoomBlobStore.open({ dir: join(dir, 'blobs') });
  const bytes = Buffer.from('expired prepare bytes');
  const ref = refOf(bytes, 'renew.txt');
  const e = envelope({ id: 'renew-1', text: 'renew', attachments: [ref] });

  // An intent that was legitimately received once, then expired.
  await ledger.prepare(e);
  await ledger.run(() => ledger.recordReceived({ roomId: ROOM_ID, senderNodeId: 'node-a', ref }));
  assert.deepEqual(ledger.data.messages[ledger.key(e)].receivedRefs, [receiptRefKey(ref)]);
  await ledger.run(() => ledger.save(d => { d.messages[ledger.key(e)].expiresAt = 1; }));
  await store.put(Readable.from([bytes]), { ...ref, ownerNodeId: 'node-a' });

  // The sender replays the CAPTURED prepare envelope. Renewal re-arms the intent
  // but wipes the old receipts, so the previously-captured bytes are not proof.
  const renewed = await ledger.prepare(e);
  assert.equal(renewed.status, 'prepared');
  assert.ok(renewed.expiresAt > Date.now(), 'renewal extends the deadline');
  assert.deepEqual(renewed.receivedRefs, [], 'renewal clears receipts: a replay cannot revive authorization');
  assert.equal(await ledger.authorize({ operation: 'put', roomId: ROOM_ID, senderNodeId: 'node-a', blobId: ref.blobId }), true,
    'a fresh authorized PUT is allowed again, and only that PUT can mint a new receipt');
  await assert.rejects(ledger.commit(e, store), /bytes were not received for this intent/,
    'clearing receipts is not the same as making a replay safe: commit stays illegal');

  // A genuinely fresh PUT (new nonce, inside the window) restores legality.
  const handler = createBlobHandler({
    store, nodeId: () => 'node-b', secret: () => 'secret', trustedPeers: () => ['node-a'],
    authorize: (...args) => ledger.authorize({ ...args[0], operation: 'put' }),
    onReceived: r => ledger.run(() => ledger.recordReceived({ roomId: r.roomId, senderNodeId: r.senderNodeId, ref: r.ref })),
  });
  const server = new MeshServer({ describe: () => ({ nodeId: 'node-b' }), secret: () => 'secret', trustedPeers: () => [], onMessage: async () => ({}), onBlob: handler });
  await server.listen(0);
  t.after(() => server.close());
  const peer = { address: '127.0.0.1', port: server.port, nodeId: 'node-b', roomBlobs: 1 };
  await sendBlob({ peer, nodeId: 'node-a', secret: 'secret', roomId: ROOM_ID, attachment: ref, readable: Readable.from([bytes]) });
  assert.deepEqual(ledger.data.messages[ledger.key(e)].receivedRefs, [receiptRefKey(ref)]);
  assert.equal((await ledger.commit(e, store)).status, 'committed');
  // Committed history survives reopen.
  const reopened = await RoomAttachmentLedger.open(dir);
  assert.equal(reopened.data.messages[ledger.key(e)].status, 'committed');
  await rm(dir, { recursive: true, force: true });
});

test('#5b orphan GC never reclaims verified committed bytes and never races the ledger queue', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room, 'gc guarded bytes');
  b.server = new MeshServer({
    describe: () => b.describe(), secret: () => 'secret', trustedPeers: () => [],
    onMessage: (e) => b.receive(e), onBlob: await b.roomAttachmentHandler(),
  });
  await b.server.listen(0);
  a.resolvePeers = () => [{ nodeId: b.nodeId, name: 'B', address: '127.0.0.1', httpPort: b.server.port }];
  await a.sayInRoom({ room: room.id, sessionId: 'human', text: 'gc', attachments: [ref], messageId: 'gc-guard' });

  // A far-future sweep (well past the orphan grace) must not touch committed pins.
  const collected = await a.collectRoomAttachmentGarbage(Date.now() + 86400000 * 30);
  assert.ok(!collected.includes(ref.blobId), 'committed content is pinned, so GC skips it');
  assert.equal(await a.attachmentService.store.has(ref.blobId), true);

  // Deleting the upload record must not orphan a still-committed message either:
  // the uploads entry is removed only for blobs GC actually collected.
  const uploadKey = JSON.stringify([room.id, 'human', ref.blobId, ref.name, ref.mediaType]);
  assert.notEqual(a.attachmentService.ledger.data.uploads[uploadKey], undefined,
    'committed upload records are retained while the bytes are pinned');

  // GC runs concurrently with an in-flight send: the queue stays consistent and
  // the message that was sent during the sweep is still committed exactly once.
  const ref2 = await upload(a, room, 'concurrent gc bytes', 'gc2.txt');
  const [sent] = await Promise.all([
    a.sayInRoom({ room: room.id, sessionId: 'human', text: 'during gc', attachments: [ref2], messageId: 'gc-concurrent' }),
    a.collectRoomAttachmentGarbage(Date.now() + 1000),
    a.collectRoomAttachmentGarbage(Date.now() + 2000),
  ]);
  assert.equal(sent.messageId, 'gc-concurrent');
  assert.equal(a.roomDetail({ room: room.id }).messages.filter(m => m.id === 'gc-concurrent').length, 1);
  assert.equal(b.roomDetail({ room: room.id }).messages.filter(m => m.id === 'gc-concurrent').length, 1);
  assert.equal(await a.attachmentService.store.has(ref2.blobId), true, 'an in-flight/completed send is not collected');
  // The ledger is still readable and valid after the interleaving.
  const reopened = await RoomAttachmentLedger.open(meshRootDir(a.config.port));
  assert.equal(reopened.data.messages[JSON.stringify([a.nodeId, 'gc-concurrent'])].status, 'committed');
});
