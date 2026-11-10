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
test('#8 an old ordinary peer receives readable text (body + filename + cannot-preview hint), never bytes or a broadcast; old Leader still fails', async t => {
  const { a, b, room } = await fixture(t);
  const ref = await upload(a, room, 'legacy peer bytes');
  const received = [];
  // An OLD ordinary node: /info advertises only nodeId (no roomAttachments/roomBlobs),
  // and it accepts plain messages on /send, recording what it saw.
  const old = new MeshServer({ describe: () => ({ nodeId: 'node-b' }), secret: () => 'secret', trustedPeers: () => [], onMessage: async e => { received.push(e); return {}; } });
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
  assert.equal(downgraded.delivered, 'readable-text-only');
  assert.equal(received.length, 1);
  const note = received[0];
  assert.equal(note.to, 'node-b', 'precise target is preserved, no @all / broadcast');
  assert.equal(note.attachments, undefined, 'no new base64 / attachment bytes');
  assert.equal(note.mentions, undefined);
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
