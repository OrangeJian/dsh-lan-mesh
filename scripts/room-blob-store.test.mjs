import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import { RoomBlobStore } from '../lib/room-blob-store.mjs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ref = (bytes, extra = {}) => ({ blobId: hash(bytes), name: 'note.txt', mediaType: 'text/plain', size: Buffer.byteLength(bytes), ownerNodeId: 'node-a', ...extra });
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(process.cwd(), '.room-blob-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: await RoomBlobStore.open({ dir, ...options }) };
}
async function contents(store, id) {
  const chunks = [];
  for await (const chunk of await store.openRead(id)) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
const put = (store, bytes, extra) => store.put(Readable.from([Buffer.from(bytes)]), ref(bytes, extra));

test('put/read/restart preserves immutable refs and deduplicates display names', async t => {
  const { dir, store } = await fixture(t);
  const first = await put(store, 'hello');
  assert.deepEqual(first, ref('hello'));
  assert.ok(Object.isFrozen(first));
  const second = await put(store, 'hello', { name: 'other.txt', ownerNodeId: 'node-b' });
  assert.equal(second.name, 'other.txt');
  await store.declareHolder(first.blobId, 'node-c');
  assert.equal(await contents(await RoomBlobStore.open({ dir }), first.blobId), 'hello');
  assert.equal((await readdir(dir)).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 1);
});

test('hash/length mismatch and interrupted streams publish nothing and release quota', async t => {
  const { dir, store } = await fixture(t, { maxTotalBytes: 5 });
  await assert.rejects(store.put(Readable.from(['other']), ref('hello')), /hash/i);
  await assert.rejects(store.put(Readable.from(['hi']), ref('hello')), /size/i);
  await assert.rejects(store.put(Readable.from(['too long']), ref('hello')), /size/i);
  async function* broken() { yield Buffer.from('he'); throw new Error('interrupted'); }
  await assert.rejects(store.put(Readable.from(broken()), ref('hello')), /interrupted/);
  assert.equal(await store.has(hash('hello')), false);
  assert.deepEqual((await readdir(dir)).filter(name => name !== 'metadata.json'), []);
  await put(store, 'hello');
});

test('unsafe digest, filenames, metadata, and file limits reject without writes', async t => {
  const { store } = await fixture(t, { maxFileBytes: 5 });
  for (const extra of [{ blobId: '../escape' }, { blobId: hash('hello').toUpperCase() }, { name: '../x' }, { name: 'a\\b' }, { name: 'C:evil' }, { name: '.' }, { name: 'CON' }, { name: 'x'.repeat(256) }, { mediaType: 'x\nheader' }, { ownerNodeId: '' }, { size: -1 }]) {
    await assert.rejects(put(store, 'hello', extra));
  }
  await assert.rejects(put(store, '123456'), /file|size/i);
  await assert.rejects(store.openRead('../x'));
  await assert.rejects(store.has('../x'));
});

test('corrupt metadata and missing committed bytes fail closed', async t => {
  const { dir, store } = await fixture(t);
  await put(store, 'hello');
  const metadata = await readFile(join(dir, 'metadata.json'));
  for (const invalid of ['{', '{}', '{"version":1,"blobs":{"../x":{}}}']) {
    await writeFile(join(dir, 'metadata.json'), invalid);
    await assert.rejects(RoomBlobStore.open({ dir }), /metadata/i);
  }
  await writeFile(join(dir, 'metadata.json'), metadata);
  await writeFile(join(dir, hash('hello')), 'wrong');
  await assert.rejects(RoomBlobStore.open({ dir }), /corrupt|hash/i);
});

test('concurrent puts reserve quota before consuming streams', async t => {
  const { store } = await fixture(t, { maxTotalBytes: 5 });
  const stream = new PassThrough();
  const pending = store.put(stream, ref('hello'));
  // has is serialized behind reservation, providing a deterministic barrier.
  await store.has(hash('hello'));
  await assert.rejects(put(store, 'world'), /quota/i);
  stream.end('hello');
  await pending;
  await put(store, 'hello', { name: 'dedup.txt' });
});

test('persistent pins and orphan grace protect blobs; unrelated files survive GC', async t => {
  const { dir, store } = await fixture(t, { orphanGraceMs: 1000 });
  const a = await put(store, 'hello');
  await store.pin(a.blobId, 'message-1');
  await writeFile(join(dir, 'user.txt'), 'keep');
  await writeFile(join(dir, hash('unmanaged')), 'unmanaged');
  const reopened = await RoomBlobStore.open({ dir, orphanGraceMs: 1000 });
  assert.deepEqual(await reopened.collectOrphans(Date.now() + 5000), []);
  await reopened.unpin(a.blobId, 'message-1');
  assert.deepEqual(await reopened.collectOrphans(Date.now()), []);
  assert.deepEqual(await reopened.collectOrphans(Date.now() + 5000), [a.blobId]);
  assert.equal(await reopened.has(a.blobId), false);
  assert.equal(await readFile(join(dir, 'user.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(join(dir, hash('unmanaged')), 'utf8'), 'unmanaged');
});

test('GC protects active reads and puts and pin mutations serialize', async t => {
  const { store } = await fixture(t, { orphanGraceMs: 0 });
  const a = await put(store, 'hello');
  const read = await store.openRead(a.blobId);
  assert.deepEqual(await store.collectOrphans(Date.now() + 1000), []);
  read.destroy();
  await new Promise(resolve => read.once('close', resolve));
  const upload = new PassThrough();
  const pending = store.put(upload, ref('hello', { name: 'again.txt' }));
  await store.has(a.blobId);
  assert.deepEqual(await store.collectOrphans(Date.now() + 1000), []);
  upload.end('hello');
  await pending;
  await Promise.all([store.pin(a.blobId, 'one'), store.pin(a.blobId, 'two')]);
  await store.unpin(a.blobId, 'one');
  assert.deepEqual(await store.collectOrphans(Date.now() + 1000), []);
  await store.unpin(a.blobId, 'two');
  assert.deepEqual(await store.collectOrphans(Date.now() + 1000), [a.blobId]);
});

test('metadata write failure does not publish bytes or alter existing pins', async t => {
  const { dir, store } = await fixture(t, { orphanGraceMs: 0 });
  const a = await put(store, 'hello');
  const backup = await readFile(join(dir, 'metadata.json'));
  await rm(join(dir, 'metadata.json'));
  await mkdir(join(dir, 'metadata.json'));
  await assert.rejects(put(store, 'world'));
  assert.equal(await store.has(hash('world')), false);
  assert.ok(!(await readdir(dir)).includes(hash('world')));
  await assert.rejects(store.pin(a.blobId, 'failed-pin'));
  await rm(join(dir, 'metadata.json'), { recursive: true });
  await writeFile(join(dir, 'metadata.json'), backup);
  assert.deepEqual(await store.collectOrphans(Date.now() + 1000), [a.blobId]);
});

test('concurrent same-content uploads preserve one blob and both holder declarations', async t => {
  const { dir, store } = await fixture(t);
  const streams = [new PassThrough(), new PassThrough()];
  const uploads = streams.map((stream, i) => store.put(stream, ref('hello', { ownerNodeId: `node-${i}` })));
  await store.has(hash('hello'));
  streams.forEach(stream => stream.end('hello'));
  await Promise.all(uploads);
  const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'));
  assert.deepEqual(metadata.blobs[hash('hello')].holders.sort(), ['node-0', 'node-1']);
  assert.equal(await contents(store, hash('hello')), 'hello');
  assert.equal((await readdir(dir)).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 1);
});

test('aborted stream releases its reservation and leaves no temporary files', async t => {
  const { dir, store } = await fixture(t, { maxTotalBytes: 5 });
  const stream = new PassThrough();
  const upload = store.put(stream, ref('hello'));
  const rejection = assert.rejects(upload, /aborted/);
  await store.has(hash('hello'));
  stream.write('he');
  stream.destroy(new Error('upload aborted'));
  await rejection;
  assert.deepEqual(await readdir(dir), ['metadata.json']);
  await put(store, 'world');
});

test('an unknown digest collision is never overwritten or collected', async t => {
  const { dir, store } = await fixture(t, { orphanGraceMs: 0 });
  await writeFile(join(dir, hash('hello')), 'other');
  await assert.rejects(put(store, 'hello'), /conflict/i);
  assert.equal(await store.has(hash('hello')), false);
  await store.collectOrphans(Date.now() + 5000);
  assert.equal(await readFile(join(dir, hash('hello')), 'utf8'), 'other');
});

test('GC resumes durable deletion intents after restart before or after unlink', async t => {
  const { dir, store } = await fixture(t);
  await put(store, 'hello');
  await put(store, 'world');
  const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'));
  for (const entry of Object.values(metadata.blobs)) entry.deleting = true;
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata));
  await rm(join(dir, hash('hello')));
  const reopened = await RoomBlobStore.open({ dir });
  assert.equal(await reopened.has(hash('world')), false);
  assert.deepEqual((await reopened.collectOrphans()).sort(), [hash('hello'), hash('world')].sort());
  assert.deepEqual(await readdir(dir), ['metadata.json']);
});

test('restart recovers uncommitted publication intents without exposing or losing unknown files', async t => {
  const { dir, store } = await fixture(t, { orphanGraceMs: 0 });
  await put(store, 'hello');
  const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'));
  // Model a process exit between publication intent, blob rename, and commit.
  metadata.blobs[hash('hello')].staging = true;
  metadata.blobs[hash('world')] = { size: 5, orphanedAt: 0, pins: [], holders: [], staging: true };
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata));
  await writeFile(join(dir, hash('unknown')), 'unknown');
  const reopened = await RoomBlobStore.open({ dir, orphanGraceMs: 0 });
  assert.equal(await reopened.has(hash('hello')), false);
  await assert.rejects(reopened.openRead(hash('hello')), /not found/i);
  assert.deepEqual((await reopened.collectOrphans(Date.now() + 1000)).sort(), [hash('hello'), hash('world')].sort());
  assert.equal(await readFile(join(dir, hash('unknown')), 'utf8'), 'unknown');
});

test('valid unknown digest files are rejected rather than adopted and later collected', async t => {
  const { dir, store } = await fixture(t, { orphanGraceMs: 0 });
  const id = hash('hello');
  await writeFile(join(dir, id), 'hello');
  const before = await readFile(join(dir, 'metadata.json'), 'utf8');
  await assert.rejects(put(store, 'hello'), /conflict/i);
  assert.equal(await store.has(id), false);
  assert.equal(await readFile(join(dir, 'metadata.json'), 'utf8'), before);
  assert.deepEqual(await store.collectOrphans(Date.now() + 1000), []);
  assert.equal(await readFile(join(dir, id), 'utf8'), 'hello');
  assert.deepEqual((await readdir(dir)).sort(), [id, 'metadata.json'].sort());
});

test('concurrent publisher rejects staging left by failed commit and failed rollback unlink', async t => {
  const { dir, store } = await fixture(t, { orphanGraceMs: 0 });
  const id = hash('hello');
  const streams = [new PassThrough(), new PassThrough()];
  const uploads = streams.map((stream, i) => store.put(stream, ref('hello', { ownerNodeId: `node-${i}` })));
  // Both leases must precede A's failed publication, otherwise B fails earlier.
  await store.has(id);
  const originalRename = fsPromises.rename;
  const originalUnlink = fsPromises.unlink;
  let metadataRenames = 0;
  let unlinkFailed = false;
  const renameMock = t.mock.method(fsPromises, 'rename', async (from, to) => {
    if (to === join(dir, 'metadata.json') && ++metadataRenames === 2) throw new Error('injected commit failure');
    return originalRename(from, to);
  });
  const unlinkMock = t.mock.method(fsPromises, 'unlink', async path => {
    if (path === join(dir, id) && !unlinkFailed) {
      unlinkFailed = true;
      throw new Error('injected rollback unlink failure');
    }
    return originalUnlink(path);
  });
  syncBuiltinESMExports();
  try {
    const failedA = assert.rejects(uploads[0], /injected rollback unlink failure/);
    streams[0].end('hello');
    await failedA;
    assert.equal(await store.has(id), false);
    const staged = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8')).blobs[id];
    assert.equal(staged.staging, true);
    // Restore the I/O faults: B must still reject based on the durable state.
    renameMock.mock.restore();
    unlinkMock.mock.restore();
    syncBuiltinESMExports();
    const rejectedB = assert.rejects(uploads[1], /pending collection/i);
    streams[1].end('hello');
    await rejectedB;
    assert.equal(await store.has(id), false);
    await assert.rejects(store.openRead(id), /not found/i);
    await assert.rejects(store.pin(id, 'message'), /not found/i);
    assert.deepEqual(await store.collectOrphans(Date.now() + 1000), [id]);
    const committed = await put(store, 'hello');
    assert.equal(await contents(store, committed.blobId), 'hello');
    await store.pin(id, 'message');
    assert.deepEqual(await store.collectOrphans(Date.now() + 1000), []);
  } finally {
    renameMock.mock.restore();
    unlinkMock.mock.restore();
    syncBuiltinESMExports();
    streams.forEach(stream => stream.destroy());
    await Promise.allSettled(uploads);
  }
});
