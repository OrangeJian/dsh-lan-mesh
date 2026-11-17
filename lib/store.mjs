import { createReadStream } from 'node:fs';
/**
 * Persistent node identity and the on-disk message store for the LAN mesh.
 *
 * Everything here is Host-only and uses node: builtins exclusively so the
 * bundle stays resolvable from a linked workspace checkout.
 *
 * @module dsh-lan-mesh/lib/store
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, appendFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { emptyState, normalizeState } from './rooms.mjs';

/** Resolve the DSH home directory the same way the harness does. */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** The port a plugin instance uses when nothing else is configured. */
export const DEFAULT_PORT = 45871;

/**
 * Root directory owned by this plugin.
 *
 * A second DSH on the same machine shares the same `$DSH_HOME` but must not share
 * an identity: two nodes with one id would each treat the other's announcements
 * as their own echo and never see each other. The instance that owns the default
 * port keeps the original paths so an existing node keeps its history; every
 * other configured port gets its own subtree.
 *
 * @param {number} [port] - this instance's configured mesh port.
 * @param {number} [primaryPort] - the port that owns the top-level paths.
 * @returns {string}
 */
export function meshRootDir(port, primaryPort = DEFAULT_PORT) {
  const root = join(dshHome(), 'lan-mesh');
  if (port === undefined || port === primaryPort) return root;
  return join(root, 'instances', String(port));
}

/** Normalize an untrusted display name. */
export function cleanName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, 64);
}

/** A stable, filesystem-safe node id derived from the persisted document. */
const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/**
 * Load or create this node's durable identity.
 * @param {{ displayName?: string, port?: number, primaryPort?: number }} options - name override and storage slot.
 * @returns {Promise<{ nodeId: string, name: string, createdAt: string }>}
 */
export async function loadIdentity(options = {}) {
  const dir = meshRootDir(options.port, options.primaryPort);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'node.json');
  let stored;
  try {
    stored = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    stored = undefined;
  }
  const nodeId = NODE_ID_PATTERN.test(stored?.nodeId ?? '')
    ? stored.nodeId
    : `node-${randomUUID().slice(0, 8)}`;
  const name = cleanName(
    options.displayName,
    cleanName(stored?.name, `${hostname().split('.')[0] || 'dsh'}-${nodeId.slice(-4)}`),
  );
  const identity = { nodeId, name, createdAt: stored?.createdAt ?? new Date().toISOString() };
  if (stored?.nodeId !== nodeId || stored?.name !== name) {
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  }
  return identity;
}

/** Per-node inbox file path. */
function inboxFile(port, primaryPort) {
  return join(meshRootDir(port, primaryPort), 'inbox.jsonl');
}

// Appends and read-flag rewrites must share one queue. A rewrite racing an
// append can otherwise replace the newly delivered message or lose read flags.
const inboxWrites = new Map();
function queueInboxWrite(file, operation) {
  const pending = (inboxWrites.get(file) ?? Promise.resolve()).catch(() => {}).then(operation);
  inboxWrites.set(file, pending);
  pending.finally(() => {
    if (inboxWrites.get(file) === pending) inboxWrites.delete(file);
  }).catch(() => {});
  return pending;
}

/**
 * Append one delivered envelope to the durable inbox log.
 * @param {object} record - stored record (envelope plus local metadata).
 * @param {{ port?: number, primaryPort?: number }} [options] - storage slot.
 */
export async function appendInbox(record, options = {}) {
  const file = inboxFile(options.port, options.primaryPort);
  const body = `${JSON.stringify(record)}\n`;
  await queueInboxWrite(file, async () => {
    await mkdir(meshRootDir(options.port, options.primaryPort), { recursive: true, mode: 0o700 });
    await appendFile(file, body, { mode: 0o600 });
  });
}

/**
 * Read the durable inbox log, newest last. Malformed lines are skipped so one
 * truncated write cannot hide the rest of the history.
 * @param {{ limit?: number, port?: number, primaryPort?: number }} options - maximum records and storage slot.
 * @returns {Promise<object[]>}
 */
export async function readInbox(options = {}) {
  await inboxWrites.get(inboxFile(options.port, options.primaryPort))?.catch(() => {});
  const limit = Number.isFinite(options.limit) ? options.limit : 200;
  let raw;
  try {
    raw = await readFile(inboxFile(options.port, options.primaryPort), 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') records.push(parsed);
    } catch {
      // A partially written trailing line is expected after a crash.
    }
  }
  return records.slice(-limit);
}

/** File holding this node's full replica of the room document. */
const ROOM_STATE_FILE_NAME = 'rooms.json';

/**
 * Replace the inbox log with the supplied records.
 *
 * Read flags live in the same lines as the messages, so clearing a badge means
 * rewriting the file. It is bounded (`MEMORY_LIMIT`) and only happens when a room
 * is opened. preserveUnlisted checkpoints keep older durable records outside the
 * bounded memory window; default replacement remains available to explicit callers.
 * A full rewrite is cheaper than a second
 * side file that could disagree with the log.
 * @param {object[]} records - records to store, oldest first.
 * @param {{ port?: number, primaryPort?: number, log?: (message: string, error?: unknown) => void }} [options] - storage slot.
 * @returns {Promise<void>}
 */
export async function rewriteInbox(records, options = {}) {
  const dir = meshRootDir(options.port, options.primaryPort);
  const file = inboxFile(options.port, options.primaryPort);
  const body = records.map((record) => `${JSON.stringify(record)}\n`).join('');
  return queueInboxWrite(file, async () => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      let checkpoint=body;
      if(options.preserveUnlisted===true){
        let existing='';
        try{existing=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
        const key=record=>typeof record?.envelope?.id==='string'&&typeof record?.envelope?.from?.nodeId==='string'?JSON.stringify([record.envelope.from.nodeId,record.envelope.id]):null;
        const updates=new Map(records.map(record=>[key(record),record]).filter(([id])=>id!==null));
        const lines=[];
        for(const line of existing.split('\n')){
          if(!line.trim())continue;
          let previous;try{previous=JSON.parse(line);}catch{lines.push(line);continue;}
          const id=key(previous),update=id===null?undefined:updates.get(id);
          if(update){lines.push(JSON.stringify({...previous,...update,envelope:{...previous.envelope,...update.envelope},read:previous.read===true||update.read===true}));updates.delete(id);}
          else lines.push(line);
        }
        for(const record of records){const id=key(record);if(id===null||updates.has(id)){lines.push(JSON.stringify(record));if(id!==null)updates.delete(id);}}
        checkpoint=lines.length?lines.join('\n')+'\n':'';
      }
      const temp = `${file}.tmp`;
      await writeFile(temp, checkpoint, { mode: 0o600 });
      await rename(temp, file);
      // Every offset the sidecar holds points into the file just replaced.
      await unlink(roomIndexFile(options.port, options.primaryPort)).catch(() => {});
    } catch (error) {
      warn(options, 'cannot rewrite the inbox log', error);
      throw error;
    }
  });
}

/**
 * Absolute path of the replicated room-state document.
 *
 * Lives beside `node.json` and `inbox.jsonl` so one instance's whole footprint
 * is one directory, and so a second instance on the same host (its own port
 * subtree) keeps a separate replica.
 * @param {number} [port] - this instance's configured mesh port.
 * @param {number} [primaryPort] - the port that owns the top-level paths.
 * @returns {string}
 */
export function roomStateFile(port, primaryPort = DEFAULT_PORT) {
  return join(meshRootDir(port, primaryPort), ROOM_STATE_FILE_NAME);
}

/** File holding this node's nickname overrides. */
const NICKNAME_FILE_NAME = 'nicknames.json';

/**
 * Absolute path of the local nickname overrides.
 * @param {number} [port] - this instance's configured mesh port.
 * @param {number} [primaryPort] - the port that owns the top-level paths.
 * @returns {string}
 */
export function nicknameFile(port, primaryPort = DEFAULT_PORT) {
  return join(meshRootDir(port, primaryPort), NICKNAME_FILE_NAME);
}

/**
 * Report a recoverable room-state problem without failing node startup.
 * @param {object} options - caller's storage options, may carry a `log` hook.
 * @param {string} message - diagnostic text.
 * @param {unknown} [error] - underlying failure.
 */
function warn(options, message, error) {
  const log = options?.log;
  if (typeof log === 'function') {
    try {
      log(message, error);
    } catch {
      // A broken logger must not stop the node from starting.
    }
  }
}

/**
 * Read this node's nickname overrides.
 *
 * Nicknames are a local preference, not shared state: the person in front of
 * this screen decides what to call a session, and a peer's opinion of that name
 * must not overwrite it. So the file stays outside the merged room document.
 * @param {{ port?: number, primaryPort?: number, log?: (message: string, error?: unknown) => void }} [options] - storage slot.
 * @returns {Promise<{ self: string, members: Record<string, string> }>}
 */
export async function loadNicknames(options = {}) {
  let raw;
  try {
    raw = await readFile(nicknameFile(options.port, options.primaryPort), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(options, 'cannot read nicknames.json', error);
    return { self: '', members: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warn(options, 'nicknames.json is not valid JSON, ignoring it', error);
    return { self: '', members: {} };
  }
  const members = {};
  const source = parsed?.members;
  if (source !== null && typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      if (typeof key !== 'string' || key === '' || typeof value !== 'string') continue;
      const name = cleanName(value, '');
      if (name !== '') members[key] = name;
    }
  }
  return { self: typeof parsed?.self === 'string' ? cleanName(parsed.self, '') : '', members };
}

/**
 * Persist this node's nickname overrides atomically.
 * @param {{ self?: string, members?: Record<string, string> }} nicknames - overrides to store.
 * @param {{ port?: number, primaryPort?: number, log?: (message: string, error?: unknown) => void }} [options] - storage slot.
 * @returns {Promise<void>}
 */
export async function saveNicknames(nicknames, options = {}) {
  const dir = meshRootDir(options.port, options.primaryPort);
  const file = nicknameFile(options.port, options.primaryPort);
  const body = `${JSON.stringify({ self: nicknames?.self ?? '', members: nicknames?.members ?? {} }, null, 2)}\n`;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    await writeFile(temp, body, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    warn(options, 'cannot write nicknames.json', error);
    throw error;
  }
}

/**
 * Read this node's room-state replica.
 *
 * A node must always be able to start: a missing, truncated or hand-edited file
 * degrades to the empty state instead of throwing, and `normalizeState()` drops
 * whatever does not validate.
 * @param {{ port?: number, primaryPort?: number, log?: (message: string, error?: unknown) => void }} [options] - storage slot.
 * @returns {Promise<{ version: number, rooms: Record<string, object> }>}
 */
export async function loadRoomState(options = {}) {
  let raw;
  try {
    raw = await readFile(roomStateFile(options.port, options.primaryPort), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(options, 'cannot read rooms.json', error);
    return emptyState();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warn(options, 'rooms.json is not valid JSON, starting empty', error);
    return emptyState();
  }
  try {
    return normalizeState(parsed);
  } catch (error) {
    warn(options, 'rooms.json does not normalize, starting empty', error);
    return emptyState();
  }
}

/**
 * Persist this node's room-state replica atomically.
 *
 * The document is normalized first so a caller can never write a state that
 * would not load back, and written through a temp file plus rename so a crash
 * mid-write leaves the previous replica intact.
 * @param {unknown} state - room state to store; cleaned with `normalizeState()`.
 * @param {{ port?: number, primaryPort?: number, log?: (message: string, error?: unknown) => void }} [options] - storage slot.
 * @returns {Promise<void>}
 */
export async function saveRoomState(state, options = {}) {
  const dir = meshRootDir(options.port, options.primaryPort);
  const file = roomStateFile(options.port, options.primaryPort);
  const normalized = normalizeState(state);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    warn(options, 'cannot write rooms.json', error);
    throw error;
  }
}

/**
 * Sidecar offset index for the inbox log.
 *
 * Every page used to stream the whole log. Nothing about the log changed
 * between pages, so a small cache of record offsets answers recent pages
 * directly, while everything the cache cannot prove — missing file, unreadable
 * or edited index, a rewrite, a page deeper than the retained window — falls
 * back to the bounded full scan. The sidecar is therefore discardable: deleting
 * it can cost time but can never change a result.
 */
const ROOM_INDEX_FILE_NAME = 'inbox.room-index.json';
const ROOM_INDEX_VERSION = 1;
// Records per Room kept in the sidecar: eight default pages, or four maximum
// ones. Deeper pages than this fall back to the full scan by design.
const ROOM_INDEX_WINDOW = 400;
// Bytes hashed at the indexed end. Appends leave them untouched, a rewrite does not.
const ROOM_INDEX_TAIL_BYTES = 4096;

/** Absolute path of the history sidecar for one instance. */
function roomIndexFile(port, primaryPort) {
  return join(meshRootDir(port, primaryPort), ROOM_INDEX_FILE_NAME);
}

/** Content hash used for the sidecar's own consistency and for its tail pin. */
function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('base64url');
}

/**
 * Iterate log lines from a byte offset, in append order.
 *
 * Each line arrives as a buffer plus its absolute start offset, and a trailing
 * fragment without a newline is reported too because a line reader would emit
 * it. Returning false from `visit` stops the walk.
 * @param {string} file - inbox log.
 * @param {number} start - byte offset to begin at, always a line boundary.
 * @param {(line: Buffer, offset: number, terminated: boolean) => boolean} visit - per-line hook.
 * @returns {Promise<void>}
 */
async function eachLogLine(file, start, visit) {
  const stream = start > 0 ? createReadStream(file, { start }) : createReadStream(file);
  let base = start;
  let carry = Buffer.alloc(0);
  let stopped = false;
  try {
    for await (const chunk of stream) {
      const buffer = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      let index = 0;
      let newline = buffer.indexOf(0x0a);
      while (newline !== -1) {
        const line = buffer.subarray(index, newline);
        const origin = base + index;
        index = newline + 1;
        if (visit(line, origin, true) === false) {
          stopped = true;
          break;
        }
        newline = buffer.indexOf(0x0a, index);
      }
      base += index;
      carry = buffer.subarray(index);
      if (stopped) break;
    }
    if (!stopped && carry.length > 0) visit(carry, base, false);
  } finally {
    stream.destroy();
  }
}

/** Record one room message's position in the bounded per-room window. */
function rememberRoomRecord(rooms, envelope, offset) {
  const known = rooms.get(envelope.room) ?? { total: 0, entries: [] };
  known.total += 1;
  known.entries.push({ node: envelope.from.nodeId, id: envelope.id, offset });
  if (known.entries.length > ROOM_INDEX_WINDOW) known.entries.shift();
  rooms.set(envelope.room, known);
}

/**
 * One pass over the log from `start`.
 *
 * Starting at 0 is the authoritative scan: it also records where each room
 * record begins so the sidecar can be written. Starting later is only a
 * shortcut to a page the sidecar already located, and then `track` collects the
 * records actually found so the caller can prove they are the expected ones.
 * @param {string} file - inbox log.
 * @param {{ start?: number, room?: string | null, before?: { node: string, id: string } | null, limit: number, collect?: boolean, track?: boolean }} options - scan window and page size.
 * @returns {Promise<{ buffer: object[], found: boolean, size: number, rooms: Map<string, object> | null, seen: object[], cursorOffset: number | null }>}
 */
async function scanLog(file, { start = 0, room = null, before = null, limit, collect = false, track = false }) {
  const buffer = [];
  const rooms = collect ? new Map() : null;
  const seen = [];
  let found = before === null;
  let buffering = true;
  let size = start;
  let cursorOffset = null;
  await eachLogLine(file, start, (line, origin, terminated) => {
    if (collect && terminated) size = origin + line.length + 1;
    let record;
    try {
      record = JSON.parse(line.toString('utf8'));
    } catch {
      return true;
    }
    const envelope = record?.envelope;
    if (typeof envelope?.room !== 'string' || typeof envelope.id !== 'string' || typeof envelope.from?.nodeId !== 'string') return true;
    if (collect && terminated) rememberRoomRecord(rooms, envelope, origin);
    if (buffering && envelope.room === room) {
      if (before && envelope.id === before.id && envelope.from.nodeId === before.node) {
        found = true;
        cursorOffset = origin;
        if (!collect) return false;
        // The page is complete, but the rebuild still wants offsets for the
        // newer half of the log: keep collecting, stop buffering.
        buffering = false;
        return true;
      }
      if (track) seen.push({ node: envelope.from.nodeId, id: envelope.id, offset: origin });
      buffer.push(record);
      if (buffer.length > limit + 1) buffer.shift();
    }
    return true;
  });
  return { buffer, found, size, rooms, seen, cursorOffset };
}

/** Page shape shared by the indexed and the full-scan paths. */
function pageFromScan(scan, room, limit) {
  const more = scan.buffer.length > limit;
  const records = scan.buffer.slice(-limit);
  const first = records[0]?.envelope;
  return { records, cursor: more ? Buffer.from(JSON.stringify({ v: 1, room, node: first.from.nodeId, id: first.id })).toString('base64url') : '', scope: 'local' };
}

/** Hash the bytes immediately before `size`: an append keeps them, a rewrite does not. */
async function tailSignature(file, size) {
  if (size <= 0) return { offset: 0, length: 0, hash: hashBytes(Buffer.alloc(0)) };
  const length = Math.min(ROOM_INDEX_TAIL_BYTES, size);
  const chunks = [];
  const stream = createReadStream(file, { start: size - length, end: size - 1 });
  for await (const chunk of stream) chunks.push(chunk);
  return { offset: size - length, length, hash: hashBytes(Buffer.concat(chunks)) };
}

/** Canonical hash over everything the sidecar claims, so a hand edit invalidates it. */
function indexDigest(index) {
  const rooms = Object.keys(index.rooms).sort().map((room) => [room, index.rooms[room].total, index.rooms[room].entries.map((entry) => [entry.node, entry.id, entry.offset])]);
  return hashBytes(Buffer.from(JSON.stringify({ v: index.v, size: index.size, rooms, tail: [index.tail.offset, index.tail.length, index.tail.hash] }), 'utf8'));
}

/**
 * Load the sidecar, or nothing at all.
 *
 * Anything unexpected — unreadable, unparsable, wrong version, wrong shape,
 * offsets outside the file, missing or mismatched digest — is treated as absent
 * rather than repaired in place.
 * @param {string} path - sidecar path.
 * @returns {Promise<object | null>}
 */
async function readStoredIndex(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.v !== ROOM_INDEX_VERSION) return null;
  if (!Number.isInteger(parsed.size) || parsed.size < 0) return null;
  const tail = parsed.tail;
  if (!tail || !Number.isInteger(tail.offset) || !Number.isInteger(tail.length) || typeof tail.hash !== 'string') return null;
  if (typeof parsed.digest !== 'string') return null;
  if (!parsed.rooms || typeof parsed.rooms !== 'object' || Array.isArray(parsed.rooms)) return null;
  const rooms = {};
  for (const [room, value] of Object.entries(parsed.rooms)) {
    if (!value || !Number.isInteger(value.total) || value.total < 0 || !Array.isArray(value.entries)) return null;
    const entries = [];
    for (const entry of value.entries) {
      if (!entry || typeof entry.node !== 'string' || typeof entry.id !== 'string') return null;
      if (!Number.isInteger(entry.offset) || entry.offset < 0 || entry.offset >= parsed.size) return null;
      entries.push({ node: entry.node, id: entry.id, offset: entry.offset });
    }
    rooms[room] = { total: value.total, entries };
  }
  const index = { v: ROOM_INDEX_VERSION, size: parsed.size, rooms, tail: { offset: tail.offset, length: tail.length, hash: tail.hash } };
  if (indexDigest(index) !== parsed.digest) return null;
  return index;
}

/**
 * Current, trusted sidecar for the log, or null when the log must be rescanned.
 *
 * A stored index is reused only while the file is at least as long as it was
 * and the exact bytes it pinned are still there; appends since then are folded
 * in from their own offset, so new messages stay visible.
 * @param {string} file - inbox log.
 * @param {string} path - sidecar path.
 * @returns {Promise<object | null>}
 */
async function reconcileRoomIndex(file, path) {
  const stored = await readStoredIndex(path);
  if (!stored) return null;
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (info.size < stored.size) return null;
  const current = await tailSignature(file, stored.size);
  if (current.length !== stored.tail.length || current.hash !== stored.tail.hash) return null;
  if (info.size === stored.size) return stored;
  const caught = await scanLog(file, { start: stored.size, limit: 1, collect: true });
  // A trailing fragment that never ends in a newline keeps the file longer than
  // the last complete line: that file is not indexable, so scan it in full.
  if (caught.size !== info.size) return null;
  const rooms = {};
  for (const [room, value] of Object.entries(stored.rooms)) rooms[room] = { total: value.total, entries: [...value.entries] };
  for (const [room, value] of caught.rooms) {
    const previous = rooms[room] ?? { total: 0, entries: [] };
    rooms[room] = { total: previous.total + value.total, entries: [...previous.entries, ...value.entries].slice(-ROOM_INDEX_WINDOW) };
  }
  return { v: ROOM_INDEX_VERSION, size: caught.size, rooms, tail: await tailSignature(file, caught.size) };
}

/**
 * Where a page may start reading, or null when only the full scan can answer.
 *
 * The plan names the exact records the shortcut must encounter, so a wrong or
 * stale offset is caught by the caller instead of being returned as history.
 * @param {object | null} index - trusted sidecar.
 * @param {string} room - room id.
 * @param {{ node: string, id: string } | null} before - exclusive upper bound.
 * @param {number} limit - page size.
 * @returns {{ start: number | null, expect: object[], cursorOffset: number | null } | null}
 */
function planRoomPage(index, room, before, limit) {
  if (!index) return null;
  const known = Object.prototype.hasOwnProperty.call(index.rooms, room) ? index.rooms[room] : null;
  if (!known) return before === null ? { start: null, expect: [], cursorOffset: null } : null;
  const entries = known.entries;
  const truncated = known.total > entries.length;
  if (before === null) {
    if (entries.length === 0) return { start: null, expect: [], cursorOffset: null };
    const from = entries.length - (limit + 1);
    if (from < 0 && truncated) return null;
    const start = Math.max(0, from);
    return { start: entries[start].offset, expect: entries.slice(start), cursorOffset: null };
  }
  const matches = entries.filter((entry) => entry.node === before.node && entry.id === before.id);
  // Zero matches means the cursor may still exist older than the window; more
  // than one means the log repeats an author/message pair and only a scan from
  // byte 0 can say which occurrence the cursor means.
  if (matches.length !== 1) return null;
  const at = entries.indexOf(matches[0]);
  const from = at - (limit + 1);
  if (from < 0 && truncated) return null;
  const start = Math.max(0, from);
  return { start: entries[start].offset, expect: entries.slice(start, at), cursorOffset: entries[at].offset };
}

/** True when the shortcut met exactly the records the sidecar promised. */
function planHolds(plan, scan) {
  if (scan.cursorOffset !== plan.cursorOffset) return false;
  if (scan.seen.length !== plan.expect.length) return false;
  for (let index = 0; index < plan.expect.length; index += 1) {
    const want = plan.expect[index];
    const got = scan.seen[index];
    if (got.offset !== want.offset || got.node !== want.node || got.id !== want.id) return false;
  }
  return true;
}

/** Serve a page from the sidecar; null means "rescan the log instead". */
async function readPlannedPage(file, plan, room, before, limit) {
  if (plan.start === null) return { records: [], cursor: '', scope: 'local' };
  const scan = await scanLog(file, { start: plan.start, room, before, limit, track: true });
  if (!scan.found) return null;
  if (!planHolds(plan, scan)) return null;
  return pageFromScan(scan, room, limit);
}

/**
 * Rescan the whole log and answer from that pass.
 *
 * The same pass rebuilds the sidecar, so the first page of a history pays the
 * full scan once and later pages start from offsets.
 */
async function fullScanPage(file, path, room, before, limit, options, previous) {
  let scan;
  try {
    scan = await scanLog(file, { start: 0, room, before, limit, collect: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (before) throw Error('room history cursor no longer available');
    return { records: [], cursor: '', scope: 'local' };
  }
  if (!scan.found) throw Error('room history cursor no longer available');
  await persistRoomIndex(file, path, scan, options, previous);
  return pageFromScan(scan, room, limit);
}

/** Write the sidecar through a temp file; a failure costs speed, never a page. */
async function persistRoomIndex(file, path, scan, options, previous) {
  if (previous && previous.size === scan.size) return;
  try {
    const rooms = {};
    for (const [room, value] of scan.rooms) rooms[room] = value;
    const index = { v: ROOM_INDEX_VERSION, size: scan.size, rooms, tail: await tailSignature(file, scan.size) };
    await mkdir(meshRootDir(options.port, options.primaryPort), { recursive: true, mode: 0o700 });
    const temp = `${path}.tmp`;
    await writeFile(temp, `${JSON.stringify({ ...index, digest: indexDigest(index) })}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    warn(options, 'cannot write the inbox room index', error);
  }
}

/** Bounded local Room history page; append order and exact author/message cursor. */
export async function readRoomHistory(options={}) {
 const room=typeof options.room==='string'?options.room:'';
 if(!room)throw Error('room is required');
 const limit=Number.isFinite(options.limit)?Math.max(1,Math.min(100,Math.trunc(options.limit))):50;
 let before=null;
 if(options.before){const value=options.before;if(typeof value.id!=='string'||typeof value.nodeId!=='string')throw Error('invalid room history cursor');before={v:1,room,node:value.nodeId,id:value.id};}
 if(options.cursor){
  try{if(typeof options.cursor!=='string'||options.cursor.length>4096)throw Error();before=JSON.parse(Buffer.from(options.cursor,'base64url').toString('utf8'));if(before.v!==1||before.room!==room||typeof before.node!=='string'||typeof before.id!=='string')throw Error();}catch{throw Error('invalid room history cursor');}
 }
 const file=inboxFile(options.port,options.primaryPort),sidecar=roomIndexFile(options.port,options.primaryPort);
 await inboxWrites.get(file)?.catch(()=>{});
 // One queue for the log and its sidecar: an append or a rewrite must never
 // land between reading offsets and reading the bytes they point at.
 return queueInboxWrite(file,async()=>{
  let index=null;
  try{index=await reconcileRoomIndex(file,sidecar);}catch(error){warn(options,'cannot read the inbox room index',error);}
  const plan=planRoomPage(index,room,before,limit);
  if(plan){
   try{const page=await readPlannedPage(file,plan,room,before,limit);if(page)return page;}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return fullScanPage(file,sidecar,room,before,limit,options,index);
 });
}
