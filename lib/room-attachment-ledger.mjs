import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeRoomAttachments, normalizeRoomMessageMetadata } from './room-message.mjs';

/**
 * Canonical, immutable attachment reference string. Physical dedup is keyed by
 * blobId alone, but an authorization receipt must be bound to ALL of these
 * fields: a same-digest blob from another room/name MUST NOT satisfy it.
 */
export function receiptRefKey({ blobId, name, mediaType, size, ownerNodeId }) {
  return JSON.stringify([blobId, name, mediaType, size, ownerNodeId]);
}

/**
 * Opaque, stable page cursor for the Leader manifest: `{ at, key }` as base64url
 * JSON. It only ever encodes durable ledger positions, so a cursor stays valid
 * across restarts; a malformed cursor is a hard error rather than "start over"
 * (silently restarting would let a client loop forever on a corrupt cursor).
 */
export function encodeCursor(value) {
  return Buffer.from(JSON.stringify([value.at, value.key]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid attachment manifest cursor');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || typeof parsed[1] !== 'string' || !parsed[1] || parsed[1].length > 512) {
    throw new Error('invalid attachment manifest cursor');
  }
  return { at: parsed[0], key: parsed[1] };
}

/**
 * Separate write-ahead ledger. The ONLY authorization proof that a remote
 * commit may use is a per-intent `receivedRefs` list on that prepared message:
 * it is durably written when an authorized PUT actually delivers these exact
 * immutable bytes for this sender/room/intent. node-wide store.has() / physical
 * dedup is never proof (M3 final review finding #1).
 */
export class RoomAttachmentLedger {
  static async open(dir) {
    await mkdir(dir,{recursive:true,mode:0o700});
    const ledger=new RoomAttachmentLedger();ledger.file=join(dir,'attachments.json');ledger.queue=Promise.resolve();
    try { const raw=await readFile(ledger.file,'utf8');if(Buffer.byteLength(raw)>32*1024*1024)throw new Error('attachment ledger too large');ledger.data=JSON.parse(raw);if(ledger.data.version!==1 || !ledger.data.uploads || !ledger.data.messages)throw new Error('invalid attachment ledger'); }
    catch(e){if(e.code!=='ENOENT')throw e;ledger.data={version:1,uploads:{},messages:{}};}
    // Migration rule: historical ledgers have no per-intent byte receipts. Keep
    // legal *committed* history intact (commit() short-circuits on status).
    // Historical *prepared* intents simply get an empty receivedRefs list, i.e.
    // they lack proof and MUST fail commit until a fresh legal prepare + upload.
    // We never auto-promote them and never clear the ledger.
    if(Array.isArray(ledger.data.uploads)||Array.isArray(ledger.data.messages)||typeof ledger.data.uploads!=='object'||typeof ledger.data.messages!=='object')throw new Error('invalid attachment ledger maps');
    for(const [key,ref] of Object.entries(ledger.data.uploads)){
      normalizeRoomAttachments([ref]);const scope=JSON.parse(key);
      if(!Array.isArray(scope)||scope.length!==5||!scope.every(x=>typeof x==='string'&&x)||scope[2]!==ref.blobId||scope[3]!==ref.name||scope[4]!==ref.mediaType)throw new Error('invalid upload ledger scope');
    }
    for(const [key,entry] of Object.entries(ledger.data.messages)){
      const e=entry?.envelope;
      if(!e||typeof e.id!=='string'||!e.id||e.id.length>64||!/^room-[a-z0-9-]{4,64}$/.test(e.room)||typeof e.from?.nodeId!=='string'||!e.from.nodeId||typeof e.from?.sessionId!=='string'||!e.from.sessionId||typeof e.text!=='string'||e.kind!=='room-message'||e.attachmentsVersion!==1||e.attachmentPhase!=='prepare'||key!==ledger.key(e)||!['prepared','committed'].includes(entry.status)||typeof entry.local!=='boolean'||!Number.isSafeInteger(entry.expiresAt)||entry.expiresAt<0||!entry.jobs||Array.isArray(entry.jobs)||typeof entry.jobs!=='object')throw new Error('invalid attachment ledger entry');
      if(entry.receivedRefs!==undefined&&(!Array.isArray(entry.receivedRefs)||!entry.receivedRefs.every(x=>typeof x==='string')))throw new Error('invalid attachment receipt refs');
      if(entry.imported!==undefined&&typeof entry.imported!=='boolean')throw new Error('invalid attachment import flag');
      if(entry.relayNodeId!==undefined&&(typeof entry.relayNodeId!=='string'||!entry.relayNodeId||entry.relayNodeId.length>64))throw new Error('invalid attachment relay id');
      normalizeRoomAttachments(e.attachments);normalizeRoomMessageMetadata(e);
      if(e.attachments.some(r=>r.ownerNodeId!==e.from.nodeId)||Object.values(entry.jobs).some(s=>!['pending','committed'].includes(s))||(entry.status==='committed'&&(typeof entry.receivedAt!=='string'||!Number.isFinite(Date.parse(entry.receivedAt)))))throw new Error('invalid attachment ledger state');
    }
    return ledger;
  }
  run(fn) { const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p; }
  async save(mutator) {
    const next=structuredClone(this.data);mutator(next);
    const bytes=JSON.stringify(next);if(Buffer.byteLength(bytes)>32*1024*1024)throw new Error('attachment ledger capacity exceeded');
    const temp=`${this.file}.${randomUUID()}.tmp`;let handle;
    try {handle=await open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;await rename(temp,this.file);this.data=next;}
    finally {await handle?.close();await unlink(temp).catch(()=>{});}
  }
  key(e) {return JSON.stringify([e.from.nodeId,e.id]);}
  fingerprint(e) {return JSON.stringify([e.id,e.room,e.from.nodeId,e.from.sessionId,e.text,e.mentions??null,e.skillRefs??null,e.attachments]);}
  async prepare(e,local=false) {
    const key=this.key(e),prior=this.data.messages[key];
    if(prior) {
      if(this.fingerprint(prior.envelope)!==this.fingerprint(e))throw new Error('attachment message id conflict');
      // Only a NEW admitted prepare can re-arm a stale intent. Renewing wipes
      // prior byte receipts so a replayed/captured prepare cannot revive an old
      // authorization: a fresh, nonce-protected, time-windowed PUT is required
      // again before commit. Identical same-ID retries remain recoverable.
      if(!local&&prior.status==='prepared'&&prior.expiresAt<=Date.now())await this.save(d=>{d.messages[key].expiresAt=Date.now()+900000;d.messages[key].receivedRefs=[];});
      return this.data.messages[key];
    }
    if(Object.keys(this.data.messages).length>=10000)throw new Error('attachment intent capacity exceeded');
    const entry={envelope:e,local,expiresAt:Date.now()+900000,status:'prepared',jobs:{},receivedRefs:[]};
    await this.save(d=>{d.messages[key]=structuredClone(entry);});return this.data.messages[key];
  }
  /**
   * Durable, precisely-scoped proof that these exact bytes were received through
   * the authorized PUT channel for a specific prepared intent. The receipt lives
   * ON the intent (room + sender + immutable ref), never on a node-wide digest
   * map, so physical dedup / store.has() can never stand in for authorization.
   *
   * MUST be called inside `run()` by every caller (the blob handler does so via
   * the service): `save()` clones `this.data` at its own entry, so two receipt
   * writes that both start outside the queue would each snapshot independently
   * and the later write would drop the earlier receipt. Validity (status,
   * expiry, room, sender, exact immutable ref) is re-read at commit time from
   * the clone being written, never from a stale pre-queue scan.
   */
  async recordReceived({ roomId, senderNodeId, ref }) {
    const canonical=receiptRefKey(ref);
    if(!this.#receiptTargets({roomId,senderNodeId,canonical}))return false;
    let recorded=false;
    await this.save(d=>{
      const now=Date.now();
      for(const entry of Object.values(d.messages)) {
        if(entry.local!==false||entry.status!=='prepared'||entry.expiresAt<=now)continue;
        if(entry.envelope.room!==roomId||entry.envelope.from.nodeId!==senderNodeId)continue;
        if(!entry.envelope.attachments.some(r=>receiptRefKey(r)===canonical))continue;
        const list=entry.receivedRefs??(entry.receivedRefs=[]);
        if(!list.includes(canonical))list.push(canonical);
        recorded=true;
      }
    });
    return recorded;
  }
  #receiptTargets({ roomId, senderNodeId, canonical }) {
    const now=Date.now();
    return Object.values(this.data.messages).some(entry=>entry.local===false&&entry.status==='prepared'&&entry.expiresAt>now&&entry.envelope.room===roomId&&entry.envelope.from.nodeId===senderNodeId&&entry.envelope.attachments.some(r=>receiptRefKey(r)===canonical));
  }
  authorize({operation,roomId,senderNodeId,blobId}) {
    return Object.values(this.data.messages).some(e=>e.envelope.room===roomId && e.envelope.attachments.some(r=>r.blobId===blobId) && (operation==='get'?e.status==='committed':e.envelope.from.nodeId===senderNodeId && e.status==='prepared' && e.expiresAt>Date.now()));
  }
  /**
   * Read one page of THIS room's committed attachment messages.
   *
   * Used only to answer the Leader manifest endpoint. Prepared intents, other
   * rooms and non-attachment messages are never included. Ordering is by
   * `receivedAt` then ledger key, both of which are durable, so paging is
   * stable across restarts and repeated syncs.
   *
   * MUST run inside `run()`.
   * @param {{ roomId: string, limit: number, cursor?: string }} request - page request.
   * @returns {{ entries: object[], nextCursor: string }}
   */
  committedPage({roomId,limit,cursor=''}) {
    const after=cursor?decodeCursor(cursor):undefined;
    const rows=Object.entries(this.data.messages)
      .filter(([,entry])=>entry.status==='committed'&&entry.envelope.room===roomId)
      .map(([key,entry])=>({key,entry,at:Date.parse(entry.receivedAt)}))
      .filter(row=>Number.isFinite(row.at))
      .sort((left,right)=>left.at-right.at||(left.key<right.key?-1:left.key>right.key?1:0));
    const start=after?rows.findIndex(row=>row.at>after.at||(row.at===after.at&&row.key>after.key)):-1;
    const slice=(after?start<0?[]:rows.slice(start):rows).slice(0,limit);
    const entries=slice.map(row=>({
      id:row.entry.envelope.id,
      room:row.entry.envelope.room,
      from:row.entry.envelope.from,
      kind:row.entry.envelope.kind,
      topic:row.entry.envelope.topic,
      text:row.entry.envelope.text,
      sentAt:row.entry.envelope.sentAt,
      attachments:row.entry.envelope.attachments,
      ...(row.entry.envelope.mentions===undefined?{}:{mentions:row.entry.envelope.mentions}),
      ...(row.entry.envelope.skillRefs===undefined?{}:{skillRefs:row.entry.envelope.skillRefs}),
      receivedAt:row.entry.receivedAt,
    }));
    const last=slice[slice.length-1];
    const hasMore=(after?start<0?0:start:0)+slice.length<rows.length;
    return {entries,nextCursor:hasMore&&last?encodeCursor({at:last.at,key:last.key}):''};
  }
  /**
   * Import committed history attested by the current Room Leader.
   *
   * This is deliberately NOT a remote prepare/commit: the original author stays
   * the author, the Leader is recorded as the relay that attested the entry, and
   * no local byte receipt is claimed (we may have no bytes yet). The entry is
   * stored already-committed so reads work immediately, and `imported: true`
   * keeps it distinguishable from a message we accepted ourselves.
   *
   * Idempotent by sender+id. A same-id entry with different canonical content is
   * a conflict: that single entry is refused and nothing is overwritten.
   *
   * MUST run inside `run()`.
   * @param {{ roomId: string, relayNodeId: string, entries: object[] }} request - attested page.
   * @returns {{ imported: number, skipped: number, conflicts: string[] }}
   */
  async importManifest({roomId,relayNodeId,entries}) {
    const conflicts=[],fresh=[];
    for(const entry of entries){
      if(entry.room!==roomId)throw new Error('attachment manifest entry belongs to another room');
      const key=this.key(entry),prior=this.data.messages[key];
      if(prior){
        if(this.fingerprint(prior.envelope)!==this.fingerprint(entry)){conflicts.push(entry.id);continue;}
        if(prior.status==='committed')continue;
        // A local prepared intent exists for the same content: the Leader's
        // committed copy is the durable truth, so promote it without inventing
        // receipts. The original envelope (and its local flag) is preserved.
        fresh.push({key,entry,prior});
        continue;
      }
      fresh.push({key,entry,prior:undefined});
    }
    if(!fresh.length&&!conflicts.length)return {imported:0,skipped:entries.length,conflicts};
    let imported=0;
    await this.save(d=>{
      for(const item of fresh){
        const target=d.messages[item.key];
        if(target&&target.status==='committed')continue;
        d.messages[item.key]={
          envelope:structuredClone(item.entry),
          // A promoted local draft keeps its own locality; an entry we never
          // prepared is remote-attested, so `local:false` keeps it out of the
          // editable-draft and retry paths.
          local:target?.local??false,
          imported:target?.imported??true,
          relayNodeId,
          expiresAt:target?.expiresAt??Date.now()+900000,
          status:'committed',
          jobs:target?.jobs??{},
          receivedRefs:target?.receivedRefs??[],
          receivedAt:target?.receivedAt??item.entry.receivedAt,
        };
        imported+=1;
      }
    });
    return {imported,skipped:entries.length-fresh.length,conflicts};
  }
  async commit(e,store) {
    const key=this.key(e),entry=this.data.messages[key];
    if(!entry || this.fingerprint(entry.envelope)!==this.fingerprint(e))throw new Error('attachment commit requires matching prepare');
    if(entry.status==='committed')return entry;
    if(!entry.local && entry.expiresAt<=Date.now())throw new Error('attachment prepare expired');
    // A remote commit must be backed by a durable, per-intent receipt for EXACTLY
    // these immutable refs. A same-digest blob stored for another room, or a
    // node-wide store.has() hit, must never authorize this one. Old migrated
    // prepared intents have no receipts and fail here until a legal re-upload.
    if(!entry.local){
      const received=new Set(entry.receivedRefs??[]);
      for(const ref of e.attachments)if(!received.has(receiptRefKey(ref)))throw new Error('attachment bytes were not received for this intent');
    }
    for(const ref of e.attachments) {
      if(!await store.has(ref.blobId))throw new Error('attachment blob missing');
      const hash=createHash('sha256');let size=0;for await(const chunk of await store.openRead(ref.blobId)){size+=chunk.length;hash.update(chunk);}
      if(size!==ref.size||hash.digest('hex')!==ref.blobId)throw new Error('corrupt attachment blob');
      await store.pin(ref.blobId,key);
    }
    await this.save(d=>{d.messages[key].status='committed';d.messages[key].receivedAt??=new Date().toISOString();});
    return this.data.messages[key];
  }
}
