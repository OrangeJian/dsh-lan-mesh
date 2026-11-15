import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
/**
 * Persistent node identity and the on-disk message store for the LAN mesh.
 *
 * Everything here is Host-only and uses node: builtins exclusively so the
 * bundle stays resolvable from a linked workspace checkout.
 *
 * @module dsh-lan-mesh/lib/store
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, appendFile, writeFile, rename } from 'node:fs/promises';
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
 const file=inboxFile(options.port,options.primaryPort);await inboxWrites.get(file)?.catch(()=>{});
 const input=createReadStream(file,{encoding:'utf8'}),lines=createInterface({input,crlfDelay:Infinity});
 const buffer=[];let found=before===null;
 try{
  for await(const line of lines){
   let record;try{record=JSON.parse(line);}catch{continue;}
   const envelope=record?.envelope;
   if(envelope?.room!==room||typeof envelope.id!=='string'||typeof envelope.from?.nodeId!=='string')continue;
   if(before&&envelope.id===before.id&&envelope.from.nodeId===before.node){found=true;break;}
   buffer.push(record);if(buffer.length>limit+1)buffer.shift();
  }
 }catch(error){if(error.code!=='ENOENT')throw error;if(before)throw Error('room history cursor no longer available');}
 finally{lines.close();input.destroy();}
 if(!found)throw Error('room history cursor no longer available');
 const more=buffer.length>limit,records=buffer.slice(-limit),first=records[0]?.envelope;
 return {records,cursor:more?Buffer.from(JSON.stringify({v:1,room,node:first.from.nodeId,id:first.id})).toString('base64url'):'',scope:'local'};
}
