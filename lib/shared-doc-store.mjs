/**
 * Shared documents: the atomic on-disk store.
 *
 * The state layer (`lib/shared-doc-state.mjs`) decides what a command means; this
 * module decides when the answer is allowed to survive a crash. Three rules drive
 * the code below:
 *
 * - A write is all-or-nothing. The new state is serialized to a temporary file,
 *   flushed with `fsync`, and only then renamed over the real file. A rename is
 *   atomic on every platform we support, so a reader sees either the previous
 *   state or the next one — never half of each. If any step fails, the committed
 *   state (in memory and on disk) is left exactly as it was.
 * - A broken file is never papered over. A state document that does not parse,
 *   carries another version, or no longer hashes to its own revision ids is
 *   reported as `DOC_STORE_CORRUPT`. Starting from an empty state would look
 *   like "the room lost its documents" and would then overwrite the evidence.
 * - Transactions are serialized. Two callers that both read the state, change it
 *   and write it back would otherwise lose one of the two changes; queueing them
 *   is the only way "read, decide, write" stays valid without a lock file.
 *
 * Bodies are not stored in the state document: a revision carries a canonical
 * patch, so text is derived from the nearest snapshot plus the patches after it
 * and checked against `revision.resultHash`. Snapshots are therefore a cache, and
 * `compactSnapshots()` may drop the redundant ones — the derivation is verified
 * before a snapshot is dropped, and re-verified for every read afterwards.
 *
 * The frozen contract is `docs/shared-doc-interfaces.md` §1–§4 and §7.
 *
 * @module dsh-lan-mesh/lib/shared-doc-store
 */
import { createHash } from 'node:crypto';
import { open as openFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { TransportError } from './transport.mjs';
import {
  DOC_STATE_VERSION,
  emptyDocumentState,
  hashContent,
  isDocumentId,
  isRevisionId,
  normalizeContent,
} from './shared-doc-state.mjs';
import { applyPatch } from './shared-doc-merge.mjs';

/** Name of the state document inside a store directory. */
export const STATE_FILE_NAME = 'shared-docs.json';
/** Name of the snapshot cache inside a store directory. */
export const SNAPSHOT_FILE_NAME = 'shared-snapshots.json';
/** How many snapshots one document keeps before the oldest redundant ones go. */
export const MAX_SNAPSHOTS_PER_DOC = 8;

/** Maps that make up one state document, in a stable order. */
const STATE_MAPS = ['documents', 'revisions', 'proposals', 'events', 'maintainers'];

/* ------------------------------------------------------------- helpers --- */

/**
 * Raise a protocol error, the only kind this layer throws.
 * @param {string} code - §7 error code.
 * @param {string} message - human explanation, safe to log.
 * @param {number} [status] - HTTP status to answer with.
 * @returns {never}
 */
function fail(code, message, status = 400) {
  throw new TransportError(message, code, status);
}

/**
 * Wrap a filesystem failure as a protocol error.
 *
 * The store is unavailable rather than the request being wrong, so this is a 503:
 * the caller should retry, not fix its payload.
 * @param {string} action - what was being attempted.
 * @param {unknown} error - the original failure.
 * @returns {TransportError}
 */
function ioError(action, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return new TransportError(`${action} failed: ${detail}`, 'DOC_STORE_UNAVAILABLE', 503);
}

/**
 * JSON with object keys sorted, recursively.
 *
 * Audit hashes are computed over this form, and JS object key order is insertion
 * order, so sorting is what makes a hash a property of the event rather than of
 * the code path that rebuilt it.
 * @param {unknown} value - JSON-serializable value.
 * @returns {string}
 */
function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => (
    isPlainObject(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item
  ));
}

/**
 * Whether a value is a non-array object.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * sha256 of a UTF-8 string as lowercase hex.
 * @param {string} text - text to digest.
 * @returns {string}
 */
function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Canonical order of two `(generation, seq)` pairs (§4).
 * @param {{ generation: number, seq: number }} left - first record.
 * @param {{ generation: number, seq: number }} right - second record.
 * @returns {number}
 */
function compareKeys(left, right) {
  return (left.generation - right.generation) || (left.seq - right.seq);
}

/**
 * Snapshot map key for one revision.
 * @param {{ documentId: string, revisionId: string }} revision - revision record.
 * @returns {string}
 */
function snapshotKey(revision) {
  return `${revision.documentId}/${revision.revisionId}`;
}

/* --------------------------------------------------------- persistence --- */

/**
 * Write one file so that a crash leaves either the old content or the new one.
 *
 * `fsync` before the rename is what makes the guarantee real: without it the
 * rename can be durable while the bytes it points at are not, which on a power
 * loss yields a correctly named, empty file.
 * @param {string} file - destination path.
 * @param {string} text - bytes to store.
 * @returns {Promise<void>}
 */
async function writeTextAtomic(file, text) {
  const temporary = `${file}.tmp`;
  try {
    const handle = await openFile(temporary, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    // A failed attempt must not leave a half-written temp file behind to be
    // mistaken for the next attempt's work.
    await rm(temporary, { force: true }).catch(() => {});
    throw ioError(`writing ${path.basename(file)}`, error);
  }
  // Best effort: not every platform lets a directory be fsynced, and the rename
  // above is already atomic. Where it works it makes the rename itself durable.
  await syncDirectory(path.dirname(file));
}

/**
 * Flush a directory entry to disk, where the platform supports it.
 * @param {string} directory - directory to sync.
 * @returns {Promise<void>}
 */
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await openFile(directory, 'r');
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    // Directory fsync is not portable (Windows rejects it); the rename already
    // gave us the atomicity we needed.
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Read one JSON file, treating "not there yet" as an empty result.
 * @param {string} file - path to read.
 * @param {string} label - name used in error messages.
 * @returns {Promise<unknown | null>} parsed content, or `null` when absent.
 */
async function readJsonFile(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw ioError(`reading ${label}`, error);
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail(
      'DOC_STORE_CORRUPT',
      `${label} is not valid JSON; refusing to start from an empty state`,
    );
  }
}

/**
 * Validate a decoded state document and fill in maps an older file may lack.
 *
 * Only the frame is checked here; per-record rules stay in the state layer, which
 * is the module that owns them. A wrong version or a map of the wrong kind is
 * fatal because guessing would silently discard the room's documents.
 * @param {unknown} raw - decoded state document.
 * @returns {object} validated state.
 */
function requireLoadedState(raw) {
  if (!isPlainObject(raw)) fail('DOC_STORE_CORRUPT', 'the state file must contain a JSON object');
  if (raw.version !== DOC_STATE_VERSION) {
    fail(
      'DOC_STORE_CORRUPT',
      `state version ${JSON.stringify(raw.version)} is not ${DOC_STATE_VERSION}`,
    );
  }
  const state = { version: DOC_STATE_VERSION };
  for (const key of STATE_MAPS) {
    const map = raw[key];
    if (map !== undefined && map !== null && !isPlainObject(map)) {
      fail('DOC_STORE_CORRUPT', `state.${key} must be an object map`);
    }
    state[key] = map ?? {};
  }
  for (const [documentId, log] of Object.entries(state.events)) {
    if (!Array.isArray(log)) fail('DOC_STORE_CORRUPT', `state.events[${documentId}] must be an array`);
  }
  return state;
}

/**
 * Validate a decoded snapshot cache.
 * @param {unknown} raw - decoded snapshot document.
 * @returns {Map<string, string>} snapshots keyed by `documentId/revisionId`.
 */
function requireLoadedSnapshots(raw) {
  if (raw === null) return new Map();
  if (!isPlainObject(raw)) fail('DOC_STORE_CORRUPT', 'the snapshot file must contain a JSON object');
  if (raw.version !== DOC_STATE_VERSION) {
    fail(
      'DOC_STORE_CORRUPT',
      `snapshot version ${JSON.stringify(raw.version)} is not ${DOC_STATE_VERSION}`,
    );
  }
  const entries = raw.entries ?? {};
  if (!isPlainObject(entries)) fail('DOC_STORE_CORRUPT', 'snapshot entries must be an object map');
  const snapshots = new Map();
  for (const [key, content] of Object.entries(entries)) {
    if (typeof content !== 'string') {
      fail('DOC_STORE_CORRUPT', `snapshot ${key} must be a string`);
    }
    snapshots.set(key, content);
  }
  return snapshots;
}

/* ------------------------------------------------------- content rebuild --- */

/**
 * Apply a stored patch to a base body.
 *
 * A `null` patch means "this revision did not change the text", which is how a
 * create-from-content revision is recorded; replaying it must return the base,
 * not throw.
 * @param {string} base - base body.
 * @param {unknown} patch - stored canonical patch, or `null`.
 * @returns {string}
 */
function applyStoredPatch(base, patch) {
  if (patch === null || patch === undefined) return base;
  try {
    return applyPatch(base, patch);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail('DOC_STORE_CORRUPT', `a stored patch can no longer be applied: ${detail}`);
  }
}

/**
 * Rebuild the body of one revision from the nearest snapshot plus later patches.
 *
 * Every hop is checked against `revision.resultHash`, so tampering with a stored
 * hash, a patch or a snapshot surfaces as corruption instead of as silently
 * different text. The result is memoized: a chain of revisions shares its
 * prefixes, and re-applying them would be quadratic.
 * @param {object} state - current state.
 * @param {Map<string, string>} snapshots - snapshot cache.
 * @param {object} revision - revision whose body is wanted.
 * @returns {string}
 */
function rebuildContent(state, snapshots, revision) {
  const cache = new Map();
  const visiting = new Set();
  const resolve = (target) => {
    const cached = cache.get(target.revisionId);
    if (cached !== undefined) return cached;
    if (visiting.has(target.revisionId)) {
      return fail('DOC_STORE_CORRUPT', `revision ${target.revisionId} sits on a cyclic base chain`);
    }
    visiting.add(target.revisionId);
    const key = snapshotKey(target);
    let content;
    if (snapshots.has(key)) {
      content = snapshots.get(key);
    } else if (target.baseRevisionId === null || target.baseRevisionId === undefined) {
      content = applyStoredPatch('', target.patch);
    } else {
      const base = state.revisions?.[target.baseRevisionId];
      if (!isPlainObject(base) || base.documentId !== target.documentId) {
        return fail(
          'DOC_STORE_CORRUPT',
          `revision ${target.revisionId} names base ${target.baseRevisionId}, which is not stored`,
        );
      }
      content = applyStoredPatch(resolve(base), target.patch);
    }
    if (hashContent(content) !== target.resultHash) {
      return fail(
        'DOC_STORE_CORRUPT',
        `revision ${target.revisionId} no longer hashes to its recorded resultHash`,
      );
    }
    visiting.delete(target.revisionId);
    cache.set(target.revisionId, content);
    return content;
  };
  return resolve(revision);
}

/**
 * Whether every revision of one document can still be rebuilt from `snapshots`.
 *
 * Used before a snapshot is dropped: a cache that cannot reproduce the text it
 * replaced is not a cache, it is data loss.
 * @param {object} state - current state.
 * @param {Map<string, string>} snapshots - candidate snapshot cache.
 * @param {string} documentId - document to check.
 * @returns {boolean}
 */
function rebuildable(state, snapshots, documentId) {
  const revisions = Object.values(state.revisions ?? {})
    .filter((revision) => revision.documentId === documentId);
  for (const revision of revisions) {
    try {
      rebuildContent(state, snapshots, revision);
    } catch {
      return false;
    }
  }
  return true;
}

/* ----------------------------------------------------------------- store --- */

/**
 * A directory that holds one replicated shared-document state.
 *
 * Use `SharedDocStore.open(directory)`; the constructor stays private so a store
 * can never exist without having loaded (and validated) what is on disk.
 */
export class SharedDocStore {
  #directory;
  #state;
  #encoded;
  #snapshots;
  #encodedSnapshots;
  #queue;
  #closed;
  #closing;

  /**
   * @param {string} directory - store directory, already created.
   * @param {object} state - validated state.
   * @param {Map<string, string>} snapshots - validated snapshot cache.
   */
  constructor(directory, state, snapshots) {
    this.#directory = directory;
    this.#state = state;
    this.#encoded = JSON.stringify(state);
    this.#snapshots = snapshots;
    this.#encodedSnapshots = encodeSnapshots(snapshots);
    this.#queue = Promise.resolve();
    this.#closed = false;
    this.#closing = false;
  }

  /**
   * Open (and create when needed) one store directory.
   *
   * Loading never writes: a directory whose state file is unreadable must be
   * left exactly as it is so the operator can inspect it, which is also why a
   * failed open never falls back to an empty state.
   * @param {string} directory - directory to open.
   * @returns {Promise<SharedDocStore>}
   */
  static async open(directory) {
    if (typeof directory !== 'string' || directory.length === 0) {
      return fail('DOC_COMMAND_INVALID', 'a store directory is required');
    }
    const resolved = path.resolve(directory);
    try {
      await mkdir(resolved, { recursive: true });
    } catch (error) {
      throw ioError(`creating ${resolved}`, error);
    }
    const rawState = await readJsonFile(path.join(resolved, STATE_FILE_NAME), STATE_FILE_NAME);
    const rawSnapshots = await readJsonFile(path.join(resolved, SNAPSHOT_FILE_NAME), SNAPSHOT_FILE_NAME);
    const state = rawState === null ? emptyDocumentState() : requireLoadedState(rawState);
    const snapshots = requireLoadedSnapshots(rawSnapshots);
    return new SharedDocStore(resolved, state, snapshots);
  }

  /** Directory this store persists to. */
  get directory() {
    return this.#directory;
  }

  /** Whether `close()` has finished. */
  get closed() {
    return this.#closed;
  }

  /**
   * The committed state, as a copy.
   *
   * A copy because the live state is the store's only durable truth: a caller
   * that mutated what it was handed would change a state that is already on disk.
   * @returns {object}
   */
  state() {
    this.#requireOpen();
    return structuredClone(this.#state);
  }

  /**
   * Run one write transaction, serialized against every other transaction.
   *
   * `operation` receives a copy of the state, so throwing leaves the store
   * untouched — that is the rollback. Returning `undefined` means "nothing to
   * change" and skips the disk entirely; returning a state makes it the new
   * committed state, but only after it has been written and flushed.
   *
   * The second argument lets an operation record snapshots (`snapshot(documentId,
   * revisionId, content)`), so text materialized by this transaction is persisted
   * atomically with the state that refers to it.
   * @param {(state: object, tools: { snapshot: (documentId: string, revisionId: string, content: string) => void }) => object | undefined | Promise<object | undefined>} operation - the transaction body.
   * @returns {Promise<boolean>} whether anything was written.
   */
  transact(operation) {
    if (typeof operation !== 'function') {
      return Promise.reject(new TransportError('a transaction needs a function', 'DOC_COMMAND_INVALID'));
    }
    if (this.#closed || this.#closing) {
      return Promise.reject(new TransportError('the shared document store is closed', 'DOC_STORE_UNAVAILABLE', 503));
    }
    const run = this.#queue.then(() => this.#commit(operation));
    // The queue must survive a failed transaction, or one rejected write would
    // wedge every later one.
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Record one materialized body so later reads need fewer patches.
   *
   * Optional: `documentAt` can always rebuild from a patch chain. Snapshots only
   * shorten that chain — except for a revision whose patch is `null`, which is
   * unrecoverable without a snapshot.
   * @param {string} documentId - document the body belongs to.
   * @param {string} revisionId - revision the body is the result of.
   * @returns {{ document: object, revision: object, content: string }}
   */
  documentAt(documentId, revisionId) {
    this.#requireOpen();
    if (!isDocumentId(documentId)) fail('DOC_NOT_FOUND', `unknown document ${String(documentId)}`);
    if (!isRevisionId(revisionId)) fail('DOC_NOT_FOUND', `unknown revision ${String(revisionId)}`);
    const document = this.#state.documents?.[documentId];
    if (document === undefined) fail('DOC_NOT_FOUND', `unknown document ${documentId}`);
    const revision = this.#state.revisions?.[revisionId];
    if (revision === undefined || revision.documentId !== documentId) {
      fail('DOC_NOT_FOUND', `document ${documentId} has no revision ${revisionId}`);
    }
    const content = rebuildContent(this.#state, this.#snapshots, revision);
    return {
      document: structuredClone(document),
      revision: structuredClone(revision),
      content,
    };
  }

  /**
   * Check one document's audit log end to end.
   *
   * The log is what the two users are shown, so a broken link has to be
   * reportable rather than thrown: the caller wants to display "this history is
   * damaged at event 4", not to crash. Nothing is repaired here — a rewritten
   * chain cannot be told apart from a legitimate one once we start fixing it.
   * @param {string} documentId - document whose log is checked.
   * @returns {{ ok: boolean, events: object[], reason?: string }}
   */
  verifyAudit(documentId) {
    this.#requireOpen();
    if (!isDocumentId(documentId)) fail('DOC_NOT_FOUND', `unknown document ${String(documentId)}`);
    if (this.#state.documents?.[documentId] === undefined) {
      fail('DOC_NOT_FOUND', `unknown document ${documentId}`);
    }
    const log = this.#state.events?.[documentId];
    const events = Array.isArray(log) ? [...log] : [];
    const broken = (reason) => ({ ok: false, events, reason });

    let previousHash = '';
    let previousKey = null;
    const seen = new Set();
    for (const [index, event] of events.entries()) {
      if (!isPlainObject(event)) return broken(`event ${index} is not an object`);
      if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
        return broken(`event ${index} has no eventId`);
      }
      if (seen.has(event.eventId)) return broken(`event ${index} repeats ${event.eventId}`);
      seen.add(event.eventId);
      if (typeof event.hash !== 'string' || event.hash.length === 0) {
        return broken(`event ${index} (${event.eventId}) has no hash`);
      }
      const { hash, ...body } = event;
      if (sha256Hex(canonicalJson(body)) !== hash) {
        return broken(`event ${index} (${event.eventId}) does not hash to its recorded hash`);
      }
      if ((event.prevHash ?? '') !== previousHash) {
        return broken(`event ${index} (${event.eventId}) does not link to its predecessor`);
      }
      if (previousKey !== null && compareKeys(event, previousKey) <= 0) {
        return broken(`event ${index} (${event.eventId}) is not ordered after its predecessor`);
      }
      previousHash = hash;
      previousKey = { generation: event.generation, seq: event.seq };
    }
    return { ok: true, events };
  }

  /**
   * Drop snapshot entries the remaining chain can still reproduce.
   *
   * This is purely a size optimization: the contract requires every historical
   * revision to rebuild to the same text afterwards, so each document's candidate
   * set is verified revision by revision and abandoned when even one revision
   * cannot be rebuilt. Keeping the head snapshot and the root one is the extreme
   * case, not a rule — correctness, not the budget, decides.
   * @returns {Promise<boolean>} whether anything was dropped.
   */
  async compactSnapshots() {
    if (this.#closed || this.#closing) {
      return Promise.reject(new TransportError('the shared document store is closed', 'DOC_STORE_UNAVAILABLE', 503));
    }
    const run = this.#queue.then(() => this.#compact());
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Flush and release the store.
   *
   * Every commit is already flushed, so this waits for queued work and then
   * refuses further transactions rather than writing anything.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#closed) return;
    this.#closing = true;
    await this.#queue.catch(() => {});
    this.#closed = true;
    this.#closing = false;
  }

  /* --------------------------------------------------------- internals --- */

  /**
   * Refuse work once the store is closed.
   * @returns {void}
   */
  #requireOpen() {
    if (this.#closed) fail('DOC_STORE_UNAVAILABLE', 'the shared document store is closed', 503);
  }

  /**
   * Body of one serialized transaction: decide, validate, persist, adopt.
   * @param {Function} operation - caller-supplied transaction body.
   * @returns {Promise<boolean>} whether anything was written.
   */
  async #commit(operation) {
    const draft = structuredClone(this.#state);
    const recorded = new Map();
    const snapshot = (documentId, revisionId, content) => {
      if (!isDocumentId(documentId)) fail('DOC_COMMAND_INVALID', 'snapshot needs a document id');
      if (!isRevisionId(revisionId)) fail('DOC_COMMAND_INVALID', 'snapshot needs a revision id');
      recorded.set(`${documentId}/${revisionId}`, normalizeContent(content));
    };

    const produced = await operation(draft, { snapshot });
    const changed = produced !== undefined && produced !== null;
    const next = changed ? requireNextState(produced) : this.#state;

    // Checked even when only snapshots are recorded: a cached body that does not
    // hash to its revision would shadow the derived one on the next read.
    if (recorded.size > 0) requireSnapshotTargets(next, recorded);
    if (!changed && recorded.size === 0) return false;

    const encoded = changed ? JSON.stringify(next) : this.#encoded;
    const candidate = new Map(this.#snapshots);
    for (const [key, content] of recorded) candidate.set(key, content);
    const pruned = changed ? this.#prune(next, candidate) : candidate;
    const encodedSnapshots = encodeSnapshots(pruned);
    if (encoded === this.#encoded && encodedSnapshots === this.#encodedSnapshots) return false;

    // Snapshots go first: an extra cached body is inert, while a state pointing
    // at a body that was never written would make `documentAt` fail later. If the
    // state write then fails, the committed state is untouched and only a spare
    // snapshot has been left behind.
    if (encodedSnapshots !== this.#encodedSnapshots) {
      await writeTextAtomic(path.join(this.#directory, SNAPSHOT_FILE_NAME), encodedSnapshots);
      this.#snapshots = pruned;
      this.#encodedSnapshots = encodedSnapshots;
    }
    if (encoded !== this.#encoded) {
      await writeTextAtomic(path.join(this.#directory, STATE_FILE_NAME), encoded);
      this.#state = next;
      this.#encoded = encoded;
    }
    return true;
  }

  /**
   * Body of `compactSnapshots()`, run inside the same queue.
   *
   * Drops snapshots one at a time and verifies after each drop, so the guarantee
   * "every historical revision still rebuilds to the same text" is checked rather
   * than assumed. The root and the head of each document are never candidates:
   * without the root a chain has no starting text, and without the head the most
   * common read would replay the whole chain.
   * @returns {Promise<boolean>} whether anything was dropped.
   */
  async #compact() {
    let next = new Map(this.#snapshots);
    let dropped = 0;
    for (const documentId of this.#snapshotDocuments()) {
      const revisions = Object.values(this.#state.revisions ?? {})
        .filter((revision) => revision.documentId === documentId)
        .sort(compareKeys);
      if (revisions.length === 0) continue;
      const essential = new Set([
        snapshotKey(revisions[0]),
        snapshotKey(revisions[revisions.length - 1]),
      ]);
      for (const revision of revisions) {
        const key = snapshotKey(revision);
        if (essential.has(key) || !next.has(key)) continue;
        const candidate = new Map(next);
        candidate.delete(key);
        if (!rebuildable(this.#state, candidate, documentId)) continue;
        next = candidate;
        dropped += 1;
      }
    }
    if (dropped === 0) return false;
    const encoded = encodeSnapshots(next);
    if (encoded === this.#encodedSnapshots) return false;
    await writeTextAtomic(path.join(this.#directory, SNAPSHOT_FILE_NAME), encoded);
    this.#snapshots = next;
    this.#encodedSnapshots = encoded;
    return true;
  }

  /**
   * Documents that currently hold at least one snapshot.
   * @returns {string[]}
   */
  #snapshotDocuments() {
    const documents = new Set();
    for (const key of this.#snapshots.keys()) documents.add(key.slice(0, key.indexOf('/')));
    return [...documents];
  }

  /**
   * Bound the snapshot cache when one transaction records many snapshots at once.
   *
   * Keeps the root plus the newest entries and verifies the reduced set; when the
   * reduction would break a rebuild the previous set is kept instead. Correctness
   * wins over the budget, which is why the verification is not optional.
   * @param {object} state - state being committed.
   * @param {Map<string, string>} candidate - snapshots after this transaction.
   * @returns {Map<string, string>}
   */
  #prune(state, candidate) {
    let result = candidate;
    for (const documentId of new Set([...candidate.keys()].map((key) => key.slice(0, key.indexOf('/'))))) {
      const keys = [...result.keys()].filter((key) => key.startsWith(`${documentId}/`));
      if (keys.length <= MAX_SNAPSHOTS_PER_DOC) continue;
      const revisions = Object.values(state.revisions ?? {})
        .filter((revision) => revision.documentId === documentId)
        .sort(compareKeys);
      if (revisions.length === 0) continue;
      const wanted = new Set([snapshotKey(revisions[0])]);
      for (const revision of [...revisions].reverse()) {
        if (wanted.size >= MAX_SNAPSHOTS_PER_DOC) break;
        wanted.add(snapshotKey(revision));
      }
      const reduced = new Map();
      for (const [key, content] of result) {
        if (key.startsWith(`${documentId}/`) && !wanted.has(key)) continue;
        reduced.set(key, content);
      }
      if (rebuildable(state, reduced, documentId)) result = reduced;
    }
    return result;
  }
}

/**
 * Serialize a snapshot cache.
 * @param {Map<string, string>} snapshots - snapshot cache.
 * @returns {string}
 */
function encodeSnapshots(snapshots) {
  const entries = {};
  for (const key of [...snapshots.keys()].sort()) entries[key] = snapshots.get(key);
  return JSON.stringify({ version: DOC_STATE_VERSION, entries });
}

/**
 * Validate the state a transaction wants to commit.
 * @param {unknown} produced - whatever the operation returned.
 * @returns {object}
 */
function requireNextState(produced) {
  if (!isPlainObject(produced)) fail('DOC_COMMAND_INVALID', 'a transaction must return a state object');
  if (produced.version !== DOC_STATE_VERSION) {
    fail('DOC_COMMAND_INVALID', `a transaction may not change the state version`);
  }
  for (const key of STATE_MAPS) {
    const map = produced[key];
    if (map !== undefined && map !== null && !isPlainObject(map)) {
      fail('DOC_COMMAND_INVALID', `state.${key} must be an object map`);
    }
  }
  return produced;
}

/**
 * Every recorded snapshot must describe the revision it names.
 *
 * Checked against the state being committed, because a snapshot written for a
 * revision that is not there would either be dead weight or, worse, shadow a real
 * body with the wrong text.
 * @param {object} state - state being committed.
 * @param {Map<string, string>} recorded - snapshots recorded by this transaction.
 * @returns {void}
 */
function requireSnapshotTargets(state, recorded) {
  for (const [key, content] of recorded) {
    const separator = key.indexOf('/');
    const documentId = key.slice(0, separator);
    const revisionId = key.slice(separator + 1);
    const revision = state.revisions?.[revisionId];
    if (!isPlainObject(revision) || revision.documentId !== documentId) {
      fail('DOC_NOT_FOUND', `snapshot ${key} names a revision that is not stored`);
    }
    if (hashContent(content) !== revision.resultHash) {
      fail('DOC_PATCH_MISMATCH', `snapshot ${key} does not hash to the revision resultHash`);
    }
  }
}
