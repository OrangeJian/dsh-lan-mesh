import { open, mkdir, lstat, readFile, rename, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/;
const METADATA_LIMIT = 16 * 1024 * 1024;
function digest(id) {
  if (typeof id !== 'string' || !DIGEST.test(id)) throw new Error('Invalid blob digest');
  return id;
}
function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}
function attachment(input) {
  const { blobId, name, mediaType, size, ownerNodeId } = input;
  digest(blobId);
  text(name, 'filename', 255);
  if (/[\\/:*?"<>|]/.test(name) || /^[. ]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Unsafe filename');
  text(mediaType, 'mediaType');
  text(ownerNodeId, 'ownerNodeId');
  integer(size, 'size');
  return Object.freeze({ blobId, name, mediaType, size, ownerNodeId });
}
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function verify(path, id, size) {
  const stat = await exists(path);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== size) throw new Error('Corrupt blob size or file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== id) throw new Error('Corrupt blob hash');
}
function validateMetadata(data) {
  if (!data || data.version !== 1 || !data.blobs || typeof data.blobs !== 'object' || Array.isArray(data.blobs)) throw new Error('Invalid metadata');
  for (const [id, entry] of Object.entries(data.blobs)) {
    digest(id);
    if (!entry || typeof entry !== 'object') throw new Error('Invalid metadata entry');
    integer(entry.size, 'metadata size');
    integer(entry.orphanedAt, 'metadata timestamp');
    if (!Array.isArray(entry.pins) || !Array.isArray(entry.holders) || (entry.deleting !== undefined && entry.deleting !== true) || (entry.staging !== undefined && entry.staging !== true)) throw new Error('Invalid metadata lists');
    for (const pin of entry.pins) text(pin, 'metadata pin');
    for (const holder of entry.holders) text(holder, 'metadata holder');
    if (new Set(entry.pins).size !== entry.pins.length || new Set(entry.holders).size !== entry.holders.length || ((entry.deleting || entry.staging) && entry.pins.length)) throw new Error('Invalid metadata state');
  }
  return data;
}

/** One live owner per directory. All mutations and activity leases serialize in that owner. */
export class RoomBlobStore {
  #dir; #options; #data; #queue = Promise.resolve(); #reserved = 0; #active = new Map();

  static async open({ dir, maxFileBytes = 20971520, maxTotalBytes = 209715200, orphanGraceMs = 86400000 }) {
    text(dir, 'directory', 32768);
    for (const [key, value] of Object.entries({ maxFileBytes, maxTotalBytes, orphanGraceMs })) integer(value, key);
    const store = new RoomBlobStore();
    store.#dir = resolve(dir);
    store.#options = { maxFileBytes, maxTotalBytes, orphanGraceMs };
    await mkdir(store.#dir, { recursive: true });
    const path = join(store.#dir, 'metadata.json');
    const stat = await exists(path);
    if (stat) {
      try {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > METADATA_LIMIT) throw new Error('Invalid metadata file');
        store.#data = validateMetadata(JSON.parse(await readFile(path, 'utf8')));
      } catch (cause) { throw new Error('Corrupt blob metadata', { cause }); }
      for (const [id, entry] of Object.entries(store.#data.blobs)) {
        if (!entry.deleting && !entry.staging) await verify(store.#path(id), id, entry.size);
      }
    } else {
      store.#data = { version: 1, blobs: {} };
      await store.#save(store.#data);
    }
    return store;
  }

  #path(id) { return join(this.#dir, digest(id)); }
  #lock(fn) {
    const result = this.#queue.then(fn);
    this.#queue = result.catch(() => {});
    return result;
  }
  #lease(id, delta) {
    const count = (this.#active.get(id) ?? 0) + delta;
    if (count) this.#active.set(id, count); else this.#active.delete(id);
  }
  async #save(data) {
    const bytes = JSON.stringify(data);
    if (Buffer.byteLength(bytes) > METADATA_LIMIT) throw new Error('Metadata capacity exceeded');
    const temp = join(this.#dir, `.metadata-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temp, join(this.#dir, 'metadata.json'));
      this.#data = data;
    } finally {
      await handle?.close();
      await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  #entry(id) {
    const entry = this.#data.blobs[digest(id)];
    if (!entry || entry.deleting || entry.staging) throw new Error('Blob not found');
    return entry;
  }

  async put(readable, input) {
    const ref = attachment(input);
    if (ref.size > this.#options.maxFileBytes) throw new Error('File size exceeds limit');
    let reservation = 0;
    // An HTTP body may abort while we await reservation or opening its temp file.
    // Keep its error observed until async iteration takes over and rejects put.
    const observeError = () => {};
    readable.on?.('error', observeError);
    let duplicate;
    try { duplicate = await this.#lock(() => {
      const existing = this.#data.blobs[ref.blobId];
      if (existing?.deleting || existing?.staging) throw new Error('Blob pending collection');
      if (existing && existing.size !== ref.size) throw new Error('Blob size mismatch');
      reservation = existing ? 0 : ref.size;
      const used = Object.values(this.#data.blobs).reduce((total, entry) => total + entry.size, 0);
      if (reservation && used + this.#reserved + reservation > this.#options.maxTotalBytes) throw new Error('Blob quota exceeded');
      this.#reserved += reservation;
      this.#lease(ref.blobId, 1);
      return !!existing;
    }); } catch (error) {
      readable.off?.('error', observeError);
      throw error;
    }
    const temp = join(this.#dir, `.blob-${randomUUID()}.tmp`);
    let handle;
    try {
      if (!duplicate) handle = await open(temp, 'wx', 0o600);
      const hash = createHash('sha256');
      let size = 0;
      for await (const part of readable) {
        const bytes = typeof part === 'string' ? Buffer.from(part) : Buffer.from(part);
        size += bytes.length;
        if (size > ref.size) throw new Error('Blob size mismatch');
        hash.update(bytes);
        if (handle) {
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
            if (!bytesWritten) throw new Error('Incomplete blob write');
            offset += bytesWritten;
          }
        }
      }
      if (size !== ref.size) throw new Error('Blob size mismatch');
      if (hash.digest('hex') !== ref.blobId) throw new Error('Blob hash mismatch');
      if (handle) { await handle.sync(); await handle.close(); handle = null; }
      await this.#lock(async () => {
        const destination = this.#path(ref.blobId);
        const existing = this.#data.blobs[ref.blobId];
        // Another leased upload may have failed since this upload reserved space.
        if (existing?.deleting || existing?.staging) throw new Error('Blob pending collection');
        if (existing && existing.size !== ref.size) throw new Error('Blob size mismatch');
        const previous = this.#data;
        let published = false;
        let staged = false;
        try {
          if (await exists(destination)) {
            if (!existing) throw new Error('Unregistered blob destination conflict');
            await verify(destination, ref.blobId, ref.size);
          }
          else {
            if (duplicate || existing) throw new Error('Corrupt missing blob');
            // A durable intent identifies our own crash leftovers, without ever
            // treating unregistered digest-looking user files as collectible.
            const intent = structuredClone(this.#data);
            intent.blobs[ref.blobId] = { size: ref.size, orphanedAt: Date.now(), pins: [], holders: [], staging: true };
            await this.#save(intent);
            staged = true;
            await rename(temp, destination);
            published = true;
          }
          const next = structuredClone(this.#data);
          next.blobs[ref.blobId] = existing ? structuredClone(existing) : { size: ref.size, orphanedAt: Date.now(), pins: [], holders: [] };
          const entry = next.blobs[ref.blobId];
          if (!entry.holders.includes(ref.ownerNodeId)) entry.holders.push(ref.ownerNodeId);
          await this.#save(next);
        }
        catch (error) {
          if (published) await unlink(destination);
          // If rollback persistence also fails, retain the hidden staging entry
          // for grace-delayed GC and conservative quota accounting on restart.
          if (staged) await this.#save(previous).catch(() => {});
          throw error;
        }
      });
      return ref;
    } finally {
      try {
        await handle?.close();
        await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } finally {
        readable.off?.('error', observeError);
        await this.#lock(() => { this.#reserved -= reservation; this.#lease(ref.blobId, -1); });
      }
    }
  }

  async has(blobId) {
    digest(blobId);
    return this.#lock(async () => {
      const entry = this.#data.blobs[blobId];
      if (!entry || entry.deleting || entry.staging) return false;
      const stat = await exists(this.#path(blobId));
      return !!stat?.isFile() && !stat.isSymbolicLink() && stat.size === entry.size;
    });
  }
  async openRead(blobId) {
    digest(blobId);
    return this.#lock(async () => {
      this.#entry(blobId);
      const path = this.#path(blobId);
      const stat = await exists(path);
      if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Corrupt missing blob');
      const handle = await open(path, 'r');
      this.#lease(blobId, 1);
      const stream = handle.createReadStream();
      stream.once('close', () => this.#lease(blobId, -1));
      return stream;
    });
  }
  async #mutate(blobId, value, kind, remove = false) {
    digest(blobId); text(value, kind);
    return this.#lock(async () => {
      this.#entry(blobId);
      const next = structuredClone(this.#data);
      const entry = next.blobs[blobId];
      const previous = entry[kind];
      entry[kind] = remove ? previous.filter(item => item !== value) : [...new Set([...previous, value])];
      if (kind === 'pins' && previous.length && !entry.pins.length) entry.orphanedAt = Date.now();
      await this.#save(next);
    });
  }
  async declareHolder(blobId, nodeId) { await this.#mutate(blobId, nodeId, 'holders'); }
  async pin(blobId, referenceId) { await this.#mutate(blobId, referenceId, 'pins'); }
  async unpin(blobId, referenceId) { await this.#mutate(blobId, referenceId, 'pins', true); }

  async collectOrphans(now = Date.now()) {
    integer(now, 'collection timestamp');
    return this.#lock(async () => {
      const collected = [];
      for (const [id, entry] of Object.entries(this.#data.blobs)) {
        if (entry.pins.length || this.#active.has(id) || (!entry.deleting && now - entry.orphanedAt < this.#options.orphanGraceMs)) continue;
        // Persist deletion intent first: failure after unlink remains restartable.
        if (!entry.deleting) {
          const next = structuredClone(this.#data);
          next.blobs[id].deleting = true;
          await this.#save(next);
        }
        const path = this.#path(id);
        const stat = await exists(path);
        if (stat) {
          await verify(path, id, entry.size);
          await unlink(path);
        }
        const next = structuredClone(this.#data);
        delete next.blobs[id];
        await this.#save(next);
        collected.push(id);
      }
      return collected;
    });
  }
}
