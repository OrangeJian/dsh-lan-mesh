import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { RoomBlobStore } from '../lib/room-blob-store.mjs';
import { MeshServer } from '../lib/transport.mjs';
import { createBlobHandler, sendBlob, readPeerBlob, encodeBlobRequest } from '../lib/room-blob-protocol.mjs';

const bytes = Buffer.from('streamed attachment bytes');
const ref = { blobId: createHash('sha256').update(bytes).digest('hex'), name: 'note.txt', mediaType: 'text/plain', size: bytes.length, ownerNodeId: 'alice' };
const base = { nodeId: 'alice', secret: 'shared', roomId: 'room-test', attachment: ref };
async function setup(t, policy = {}) {
  const dir = await mkdtemp(join(process.cwd(), '.blob-protocol-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await RoomBlobStore.open({ dir, maxFileBytes: policy.maxFileBytes ?? 100 });
  const handler = createBlobHandler({ store, nodeId: 'bob', secret: 'shared', trustedPeers: ['alice'], authorize: async () => true, maxFileBytes: 100, ...policy });
  const server = new MeshServer({ describe: () => ({ nodeId: 'bob' }), secret: () => 'shared', trustedPeers: () => [], onMessage: async () => ({}), onBlob: handler });
  await server.listen(0);
  t.after(() => server.close());
  const peer = { address: '127.0.0.1', port: server.port, nodeId: 'bob', roomBlobs: 1 };
  return { store, server, peer, dir, options: { ...base, peer } };
}
function raw(peer, signed, body = bytes) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: peer.address, port: peer.port, method: signed.method, path: signed.path, headers: signed.headers }, res => {
      const parts = []; res.on('data', b => parts.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
    });
    req.on('error', reject); req.end(signed.method === 'PUT' ? body : undefined);
  });
}
function signed(options, extra = {}) { return encodeBlobRequest({ ...options, method: 'PUT', ...extra }); }

test('real HTTP PUT and GET stream into verified stores; hook alone advertises capability', async t => {
  const f = await setup(t);
  assert.equal((await (await fetch(`http://127.0.0.1:${f.peer.port}/lan-mesh/v1/info`)).json()).node.roomBlobs, 1);
  await sendBlob({ ...f.options, readable: Readable.from([bytes]) });
  assert.equal(await f.store.has(ref.blobId), true);
  const dest = await RoomBlobStore.open({ dir: join(f.dir, 'destination') });
  await readPeerBlob({ ...f.options, store: dest });
  const parts = []; for await (const b of await dest.openRead(ref.blobId)) parts.push(b);
  assert.deepEqual(Buffer.concat(parts), bytes);
});
test('tampering every signed field, replay and expired requests fail before publication', async t => {
  const f = await setup(t);
  for (const [key, value] of Object.entries({ 'x-room-blob-room': 'room-other', 'x-room-blob-sender': 'eve', 'x-room-blob-target': 'eve', 'x-room-blob-size': '3', 'x-room-blob-time': String(Date.now()+500), 'x-room-blob-nonce': 'changed', 'x-room-blob-metadata': Buffer.from(JSON.stringify({ name: 'other.txt', mediaType: 'text/plain' })).toString('base64url') })) {
    const req = signed(f.options); req.headers[key] = value;
    assert.ok((await raw(f.peer, req)).status >= 400, key);
  }
  const expired = signed(f.options, { now: Date.now()-121000 });
  assert.equal((await raw(f.peer, expired)).status, 401);
  const once = signed(f.options);
  assert.equal((await raw(f.peer, once)).status, 201);
  assert.equal((await raw(f.peer, once)).status, 409);
});
test('membership absent, false or throwing, target and allowlist reject without store writes', async t => {
  for (const policy of [{ authorize: undefined }, { authorize: () => false }, { authorize: () => { throw Error('offline'); } }, { trustedPeers: ['eve'] }, { nodeId: 'eve' }]) {
    const f = await setup(t, policy);
    assert.ok((await raw(f.peer, signed(f.options))).status >= 400);
    assert.equal(await f.store.has(ref.blobId), false);
    assert.deepEqual(await readdir(f.dir), ['metadata.json']);
  }
});
test('digest, length, oversized declaration/stream, range and unknown digest are rejected', async t => {
  const f = await setup(t);
  assert.ok((await raw(f.peer, signed(f.options), Buffer.alloc(bytes.length, 1))).status >= 400);
  const short = signed(f.options); delete short.headers['content-length'];
  assert.ok((await raw(f.peer, short, bytes.subarray(1))).status >= 400);
  const large = signed({ ...f.options, attachment: { ...ref, size: 101 } });
  assert.equal((await raw(f.peer, large)).status, 413);
  const overflow = signed(f.options); delete overflow.headers['content-length'];
  assert.ok((await raw(f.peer, overflow, Buffer.alloc(101))).status >= 400);
  const get = signed(f.options, { method: 'GET' });
  assert.equal((await raw(f.peer, get)).status, 404);
  const range = signed(f.options, { method: 'GET' }); range.headers.range = 'bytes=0-2';
  assert.equal((await raw(f.peer, range)).status, 416);
  assert.equal(await f.store.has(ref.blobId), false);
});
test('unsupported capability prevents consuming source; abort destroys upload source', async t => {
  const f = await setup(t);
  const source = new Readable({ read() {} });
  await assert.rejects(async () => sendBlob({ ...f.options, peer: { ...f.peer, roomBlobs: undefined }, readable: source }), /UNSUPPORTED/);
  const controller = new AbortController();
  const upload = sendBlob({ ...f.options, readable: source, signal: controller.signal });
  controller.abort();
  await assert.rejects(upload);
  assert.equal(source.destroyed, true);
});

test('GET verifies headers, full body digest/size and refuses redirects without destination commit', async t => {
  const f = await setup(t);
  const dest = await RoomBlobStore.open({ dir: join(f.dir, 'destination') });
  for (const kind of ['type', 'length', 'hash-header', 'hash-body', 'truncated', 'redirect', 'large-error']) {
    const server = http.createServer((req, res) => {
      const headers = { 'content-type': ref.mediaType, 'content-length': String(ref.size), 'x-room-blob-digest': ref.blobId };
      if (kind === 'type') headers['content-type'] = 'image/png';
      if (kind === 'length') headers['content-length'] = '1';
      if (kind === 'hash-header') headers['x-room-blob-digest'] = 'a'.repeat(64);
      if (kind === 'redirect') { res.writeHead(302, { location: 'http://untrusted.invalid/', 'content-length': '0' }); res.end(); return; }
      if (kind === 'large-error') { res.writeHead(500); res.end(Buffer.alloc(5000)); return; }
      res.writeHead(200, headers);
      if (kind === 'truncated') { res.write(bytes.subarray(1)); setImmediate(() => res.destroy()); }
      else res.end(kind === 'hash-body' ? Buffer.alloc(bytes.length, 1) : bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await assert.rejects(readPeerBlob({ ...f.options, peer: { ...f.peer, port: server.address().port }, store: dest, timeoutMs: 500 })); }
    finally { await new Promise(resolve => server.close(resolve)); }
    assert.equal(await dest.has(ref.blobId), false, kind);
    assert.deepEqual(await readdir(join(f.dir, 'destination')), ['metadata.json']);
  }
});

test('abort and server close interrupt an active upload and release store reservation/temp files', async t => {
  for (const operation of ['abort', 'close', 'timeout']) {
    let admitted;
    const admission = new Promise(resolve => { admitted = resolve; });
    const f = await setup(t, { authorize: () => { admitted(); return true; } });
    const source = new Readable({ read() {} }); source.push(bytes.subarray(0, 2));
    const controller = new AbortController();
    const sending = sendBlob({ ...f.options, readable: source, signal: controller.signal, timeoutMs: operation === 'timeout' ? 200 : 2000 });
    const rejection = assert.rejects(sending);
    await admission;
    if (operation === 'abort') controller.abort();
    if (operation === 'close') await f.server.close();
    await rejection;
    assert.equal(source.destroyed, true);
    // Wait for the server's finally cleanup, then prove the reservation is reusable.
    for (let attempt = 0; attempt < 100 && (await readdir(f.dir)).some(n => n.startsWith('.blob-')); attempt++) await new Promise(r => setTimeout(r, 10));
    assert.equal(await f.store.has(ref.blobId), false);
    await f.store.put(Readable.from([bytes]), ref);
    assert.equal(await f.store.has(ref.blobId), true);
    assert.deepEqual(await readdir(f.dir), ['metadata.json', ref.blobId].sort());
  }
});

test('method, exact path, digest and query tampering reject; disabled hook suppresses capability', async t => {
  const f = await setup(t);
  for (const mutate of [r => { r.method = 'GET'; delete r.headers['content-length']; }, r => { r.path += '?room=other'; }, r => { r.path = r.path.replace(ref.blobId, 'a'.repeat(64)); }, r => { r.headers['x-room-blob-digest'] = 'a'.repeat(64); }]) {
    const request = signed(f.options); mutate(request);
    assert.ok((await raw(f.peer, request)).status >= 400);
  }
  const server = new MeshServer({ describe: () => ({ nodeId: 'bob', roomBlobs: 1 }), secret: () => '', trustedPeers: () => [], onMessage: async () => ({}) });
  await server.listen(0); t.after(() => server.close());
  const info = await (await fetch(`http://127.0.0.1:${server.port}/lan-mesh/v1/info`)).json();
  assert.equal(info.node.roomBlobs, undefined);
  assert.equal((await raw({ ...f.peer, port: server.port }, signed(f.options))).status, 404);
});

test('open cluster warns and keeps membership authorization enforced', async t => {
  const warnings = [];
  const f = await setup(t, { secret: '', warn: message => warnings.push(message) });
  await sendBlob({ ...f.options, secret: '', readable: Readable.from([bytes]) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WARNING: lan-mesh is open/);
  assert.doesNotMatch(warnings[0], /no trustedPeers/);
  const denied = await setup(t, { secret: '', authorize: () => false, warn: () => {} });
  await assert.rejects(sendBlob({ ...denied.options, secret: '', readable: Readable.from([bytes]) }), /403/);
});

test('server close interrupts a backpressured GET and releases the read lease for GC', async t => {
  const f = await setup(t, { maxFileBytes: 16 * 1024 * 1024 });
  const content = Buffer.alloc(16 * 1024 * 1024, 97);
  const attachment = { ...ref, size: content.length, blobId: createHash('sha256').update(content).digest('hex') };
  await f.store.put(Readable.from([content]), attachment);
  const request = signed({ ...f.options, attachment }, { method: 'GET' });
  const response = await new Promise((resolve, reject) => {
    const req = http.request({ host: f.peer.address, port: f.peer.port, ...request }, resolve);
    req.on('error', reject); req.end();
  });
  response.on('error', () => {});
  assert.equal(response.statusCode, 200);
  // IncomingMessage remains paused: the server cannot complete this large read.
  assert.deepEqual(await f.store.collectOrphans(Date.now() + 86400001), []);
  await f.server.close(); response.destroy();
  let collected = [];
  for (let attempt = 0; attempt < 100 && !collected.length; attempt++) {
    collected = await f.store.collectOrphans(Date.now() + 86400001);
    if (!collected.length) await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(collected, [attachment.blobId]);
});
