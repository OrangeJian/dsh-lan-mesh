import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeRoomAttachments, normalizeRoomMessageMetadata } from './room-message.mjs';

/** Separate write-ahead ledger. Never releases a pin, including pending intents. */
export class RoomAttachmentLedger {
  static async open(dir) {
    await mkdir(dir,{recursive:true,mode:0o700});
    const ledger=new RoomAttachmentLedger();ledger.file=join(dir,'attachments.json');ledger.queue=Promise.resolve();
    try { const raw=await readFile(ledger.file,'utf8');if(Buffer.byteLength(raw)>32*1024*1024)throw new Error('attachment ledger too large');ledger.data=JSON.parse(raw);if(ledger.data.version!==1 || !ledger.data.uploads || !ledger.data.messages)throw new Error('invalid attachment ledger'); }
    catch(e){if(e.code!=='ENOENT')throw e;ledger.data={version:1,uploads:{},messages:{}};}
    if(Array.isArray(ledger.data.uploads)||Array.isArray(ledger.data.messages)||typeof ledger.data.uploads!=='object'||typeof ledger.data.messages!=='object')throw new Error('invalid attachment ledger maps');
    for(const [key,ref] of Object.entries(ledger.data.uploads)){
      normalizeRoomAttachments([ref]);const scope=JSON.parse(key);
      if(!Array.isArray(scope)||scope.length!==5||!scope.every(x=>typeof x==='string'&&x)||scope[2]!==ref.blobId||scope[3]!==ref.name||scope[4]!==ref.mediaType)throw new Error('invalid upload ledger scope');
    }
    for(const [key,entry] of Object.entries(ledger.data.messages)){
      const e=entry?.envelope;
      if(!e||typeof e.id!=='string'||!e.id||e.id.length>64||!/^room-[a-z0-9-]{4,64}$/.test(e.room)||typeof e.from?.nodeId!=='string'||!e.from.nodeId||typeof e.from?.sessionId!=='string'||!e.from.sessionId||typeof e.text!=='string'||e.kind!=='room-message'||e.attachmentsVersion!==1||e.attachmentPhase!=='prepare'||key!==ledger.key(e)||!['prepared','committed'].includes(entry.status)||typeof entry.local!=='boolean'||!Number.isSafeInteger(entry.expiresAt)||entry.expiresAt<0||!entry.jobs||Array.isArray(entry.jobs)||typeof entry.jobs!=='object')throw new Error('invalid attachment ledger entry');
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
    if(prior) {if(this.fingerprint(prior.envelope)!==this.fingerprint(e))throw new Error('attachment message id conflict');return prior;}
    if(Object.keys(this.data.messages).length>=10000)throw new Error('attachment intent capacity exceeded');
    const entry={envelope:e,local,expiresAt:Date.now()+900000,status:'prepared',jobs:{}};
    await this.save(d=>{d.messages[key]=entry;});return this.data.messages[key];
  }
  authorize({operation,roomId,senderNodeId,blobId}) {
    return Object.values(this.data.messages).some(e=>e.envelope.room===roomId && e.envelope.attachments.some(r=>r.blobId===blobId) && (operation==='get'?e.status==='committed':e.envelope.from.nodeId===senderNodeId && e.status==='prepared' && e.expiresAt>Date.now()));
  }
  async commit(e,store) {
    const key=this.key(e),entry=this.data.messages[key];
    if(!entry || this.fingerprint(entry.envelope)!==this.fingerprint(e))throw new Error('attachment commit requires matching prepare');
    if(entry.status==='committed')return entry;
    if(!entry.local && entry.expiresAt<=Date.now())throw new Error('attachment prepare expired');
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
