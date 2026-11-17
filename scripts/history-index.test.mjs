import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Transform } from 'node:stream';
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Paging a long Room history must not re-read the whole inbox log per page.
 *
 * The observable proof is deterministic I/O: `createReadStream` is metered
 * before the store is loaded, so every byte the history reader pulls through it
 * is counted. Wall-clock time is never asserted; a byte budget is.
 *
 * The index is only a cache. Every case here also proves the fallback path: a
 * deleted, truncated, wrong-room or stale sidecar must produce the very same
 * pages, and the two documented cursor errors must keep their exact text.
 *
 * @module dsh-lan-mesh/scripts/history-index.test
 */

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const realCreateReadStream = fs.createReadStream;
const meter = { calls: 0, bytes: 0, starts: [] };

fs.createReadStream = function meteredCreateReadStream(...args) {
  const options = args[1];
  meter.calls += 1;
  meter.starts.push(options !== null && typeof options === 'object' && Number.isInteger(options.start) ? options.start : 0);
  const source = realCreateReadStream.apply(this, args);
  const through = new Transform({
    transform(chunk, _encoding, callback) {
      meter.bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      callback(null, chunk);
    },
  });
  source.on('error', (error) => { through.destroy(error); });
  through.on('close', () => { source.destroy(); });
  source.pipe(through);
  return through;
};

const store = await import('../lib/store.mjs');

const INDEX_NAME = 'inbox.room-index.json';
const ROOMS = ['a', 'b', 'c'];
const TOTAL = 3000;
const LIMIT = 50;

async function fixture(t) {
  const previous = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), 'mesh-history-index-'));
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });
  const root = store.meshRootDir(0);
  return { home, root, inbox: join(root, 'inbox.jsonl'), index: join(root, INDEX_NAME) };
}

const record = (id, room, node = 'origin') => ({
  envelope: { id, room, kind: 'room-message', from: { nodeId: node, sessionId: 'human' }, text: id, sentAt: '2026-11-16T00:00:00.000Z' },
  receivedAt: '2026-11-16T00:00:00.000Z',
  read: false,
});

/** Interleave `total` records across `ROOMS` so every room has a sparse slice. */
async function seed(total = TOTAL) {
  for (let i = 0; i < total; i++) await store.appendInbox(record(`m${i}`, ROOMS[i % ROOMS.length]), { port: 0 });
}

/** The ids room `name` must yield, oldest first, computed without touching the store. */
function expectedIds(name = 'a', total = TOTAL) {
  const ids = [];
  for (let i = 0; i < total; i++) if (ROOMS[i % ROOMS.length] === name) ids.push(`m${i}`);
  return ids;
}

async function pageThrough(name = 'a', limit = LIMIT) {
  const pages = [];
  let cursor = '';
  for (;;) {
    const page = await store.readRoomHistory({ port: 0, room: name, cursor, limit });
    assert.equal(page.scope, 'local');
    pages.push({ ids: page.records.map((row) => row.envelope.id), cursor: page.cursor });
    if (page.cursor === '') return pages;
    cursor = page.cursor;
    assert.ok(pages.length < 200, 'paging must terminate');
  }
}

/**
 * Pages arrive newest block first and oldest-last; inside a page the log order
 * is kept. Reverse the pages (never the rows) to get the log order back.
 */
const oldestFirst = (pages) => [...pages].reverse().flatMap((page) => page.ids);

function metered(body) {
  meter.calls = 0;
  meter.bytes = 0;
  meter.starts = [];
  return body().then((value) => ({ value, calls: meter.calls, bytes: meter.bytes, starts: [...meter.starts] }));
}

test('a long history pages identically with an offset index and reads a fraction of the log', async (t) => {
  const files = await fixture(t);
  await seed();
  const fileSize = (await stat(files.inbox)).size;

  const pages = await pageThrough('a');
  assert.deepEqual(oldestFirst(pages), expectedIds());
  assert.equal(pages.at(-1).cursor, '', 'the oldest page must end with an empty cursor');

  const index = JSON.parse(await readFile(files.index, 'utf8'));
  assert.equal(index.v, 1, 'the sidecar carries a layout version');
  assert.equal(index.size, fileSize, 'the sidecar pins the file size it describes');

  const first = await metered(() => store.readRoomHistory({ port: 0, room: 'a', limit: LIMIT }));
  assert.deepEqual(first.value.records.map((row) => row.envelope.id), expectedIds().slice(-LIMIT));
  const second = await metered(() => store.readRoomHistory({ port: 0, room: 'a', cursor: first.value.cursor, limit: LIMIT }));
  assert.deepEqual(second.value.records.map((row) => row.envelope.id), expectedIds().slice(-2 * LIMIT, -LIMIT));

  assert.ok(first.bytes > 0, 'the first page still reads real bytes');
  assert.ok(first.bytes < fileSize / 4, `warm first page read ${first.bytes} of ${fileSize} bytes`);
  assert.ok(second.bytes < fileSize / 4, `warm second page read ${second.bytes} of ${fileSize} bytes`);
  assert.ok(second.starts.some((start) => start > 0), 'the warm page seeks instead of restarting at byte 0');
});

test('a deleted or unusable index falls back to the full scan with identical pages', async (t) => {
  const files = await fixture(t);
  await seed(900);
  const expected = expectedIds('a', 900);
  const warm = await pageThrough('a');
  assert.deepEqual(oldestFirst(warm), expected);

  const usable = await readFile(files.index, 'utf8');
  const corruptions = [
    ['deleted', async () => unlink(files.index)],
    ['empty', async () => writeFile(files.index, '')],
    ['truncated', async () => writeFile(files.index, usable.slice(0, Math.floor(usable.length / 2)))],
    ['not json', async () => writeFile(files.index, 'this is not an index')],
    ['unknown version', async () => writeFile(files.index, JSON.stringify({ ...JSON.parse(usable), v: 99 }))],
    ['wrong size', async () => writeFile(files.index, JSON.stringify({ ...JSON.parse(usable), size: 1 }))],
  ];
  for (const [label, corrupt] of corruptions) {
    await corrupt();
    const pages = await pageThrough('a');
    assert.deepEqual(oldestFirst(pages), expected, `${label} index must not change the result`);
    assert.equal(pages.at(-1).cursor, '', `${label} index must not invent a cursor`);
  }
});

test('an index carrying another room offsets cannot leak that room into the result', async (t) => {
  const files = await fixture(t);
  await seed(900);
  await pageThrough('a');
  const index = JSON.parse(await readFile(files.index, 'utf8'));
  // The most tempting corruption: valid offsets and a valid file, filed under
  // the wrong room key.
  index.rooms.b = index.rooms.a;
  delete index.rooms.a;
  await writeFile(files.index, JSON.stringify(index));

  const pages = await pageThrough('b');
  assert.deepEqual(oldestFirst(pages), expectedIds('b', 900));
  const again = await pageThrough('a');
  assert.deepEqual(oldestFirst(again), expectedIds('a', 900));
});

test('a rewrite invalidates stale offsets and appends stay visible', async (t) => {
  const files = await fixture(t);
  await seed(600);
  assert.deepEqual(oldestFirst(await pageThrough('a')), expectedIds('a', 600));

  // rewriteInbox replaces the file, so every offset the sidecar holds is wrong.
  const kept = [];
  for (let i = 0; i < 600; i += 2) kept.push(record(`m${i}`, ROOMS[i % ROOMS.length]));
  await store.rewriteInbox(kept, { port: 0 });
  const rewritten = expectedIds('a', 600).filter((id) => Number(id.slice(1)) % 2 === 0);
  const pages = await pageThrough('a');
  assert.deepEqual(oldestFirst(pages), rewritten);

  // Appends only grow the file: cached offsets stay valid and new rows appear.
  for (const id of ['late-1', 'late-2']) await store.appendInbox(record(id, 'a'), { port: 0 });
  const grown = await pageThrough('a');
  assert.deepEqual(oldestFirst(grown), [...rewritten, 'late-1', 'late-2']);
  assert.ok((await stat(files.index)).size > 0);
});

test('cursor errors keep their exact text with an index in place', async (t) => {
  const files = await fixture(t);
  for (let i = 0; i < 8; i++) await store.appendInbox(record(`p${i}`, 'a'), { port: 0 });
  const page = await store.readRoomHistory({ port: 0, room: 'a', limit: 2 });
  assert.deepEqual(page.records.map((row) => row.envelope.id), ['p6', 'p7']);
  const other = await store.readRoomHistory({ port: 0, room: 'b' });
  assert.equal(other.cursor, '');

  await assert.rejects(store.readRoomHistory({ port: 0, room: 'a', cursor: 'bad' }), (error) => error.message === 'invalid room history cursor');
  await assert.rejects(store.readRoomHistory({ port: 0, room: 'b', cursor: page.cursor }), (error) => error.message === 'invalid room history cursor');
  await assert.rejects(store.readRoomHistory({ port: 0, room: '' }), (error) => error.message === 'room is required');

  // Dropping the cursor record makes the cursor too old; it must say so
  // instead of pretending the history simply ended.
  const survivors = ['p0', 'p1', 'p2', 'p3'].map((id) => record(id, 'a'));
  await store.rewriteInbox(survivors, { port: 0 });
  await assert.rejects(
    store.readRoomHistory({ port: 0, room: 'a', cursor: page.cursor }),
    (error) => error.message === 'room history cursor no longer available',
  );
  // A missing log keeps the same two behaviours.
  await unlink(files.inbox);
  await assert.rejects(
    store.readRoomHistory({ port: 0, room: 'a', cursor: page.cursor }),
    (error) => error.message === 'room history cursor no longer available',
  );
  const empty = await store.readRoomHistory({ port: 0, room: 'a' });
  assert.deepEqual(empty.records, []);
  assert.equal(empty.cursor, '');
});