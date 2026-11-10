import { join } from 'node:path';
import { RoomBlobStore } from './room-blob-store.mjs';
import { RoomAttachmentLedger } from './room-attachment-ledger.mjs';
import { createBlobHandler, sendBlob, readPeerBlob } from './room-blob-protocol.mjs';
import { fetchAttachmentManifest, attachmentFingerprint } from './room-attachment-sync.mjs';
import { normalizeRoomAttachments, normalizeRoomMessageMetadata, ROOM_ATTACHMENT_LIMITS, ROOM_ATTACHMENT_WIRE_LIMITS } from './room-message.mjs';
import { deliverToPeer, TransportError } from './transport.mjs';

export async function openRoomAttachments({dir,node,member,peerMember,publish}) {
 const limits={...ROOM_ATTACHMENT_LIMITS,...node.config.roomAttachmentLimits};
 for(const [key,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1)throw new Error(`invalid attachment limit ${key}`);
 if(limits.maxAttachments>ROOM_ATTACHMENT_WIRE_LIMITS.maxAttachments)throw new Error('attachment count limit exceeds wire bound');
 const store=await RoomBlobStore.open({dir:join(dir,'blobs'),...limits});
 const ledger=await RoomAttachmentLedger.open(dir);
 const handler=createBlobHandler({store,nodeId:()=>node.nodeId,secret:()=>node.config.clusterSecret,trustedPeers:()=>node.config.trustedPeers??[],maxFileBytes:limits.maxFileBytes,warn:node.log,
  authorize:r=>peerMember(r.roomId,r.senderNodeId) && ledger.authorize(r),
  // A successful authorized PUT must persist a narrowly-scoped, durable proof
  // on THIS prepared intent (room + sender + exact immutable ref) before the
  // bytes are acknowledged. commit() refuses a remote message whose refs lack
  // such proof, so a blob already present node-wide from another room can
  // never be promoted into a read grant by physical deduplication (M3 #1).
  // The receipt write joins the same serial transaction queue as prepare/commit:
  // two concurrent PUTs must not snapshot `ledger.data` independently and lose
  // one receipt. recordReceived() re-validates inside the queued clone.
  onReceived:async r=>ledger.run(()=>ledger.recordReceived({roomId:r.roomId,senderNodeId:r.senderNodeId,ref:r.ref}))});
 // Strict pin: used when WE are about to send, so missing bytes are a hard error.
 const pin=async e=>{for(const ref of e.attachments){if(!await store.has(ref.blobId))throw new Error('attachment blob missing');await store.pin(ref.blobId,ledger.key(e));}};
 // Lenient pin: a manifest-imported message is committed without local bytes (a
 // late member legitimately holds the reference before the blob). Startup must
 // rebuild pins only for bytes we actually verified locally, otherwise one
 // imported reference would abort the whole node start. (M3 Task 4)
 const pinLocal=async e=>{for(const ref of e.attachments)if(await store.has(ref.blobId))await store.pin(ref.blobId,ledger.key(e));};

 // Coalescing must NEVER be decided by the message id alone: a retry reuses the
 // id, but a DIFFERENT payload that happens to reuse it is a conflict, not the
 // same operation. So the envelope is normalized and deep-copied BEFORE it
 // enters the map, and the map value carries the ledger's own canonical
 // fingerprint (id, room, sender node+session, text, mentions, skillRefs and
 // every immutable ref). Delivery details (sentAt, per-peer `to`, the
 // prepare/commit phase) are not content and are deliberately excluded, which
 // also keeps fan-out replicas of one send identical. (M3 Task 2)
 const canonicalSend=request=>{
  const room=member(request.room,node.nodeId,request.from.sessionId,true);
  const metadata=normalizeRoomMessageMetadata(request,room);
  const attachments=normalizeRoomAttachments(request.attachments,ledger.data.messages[ledger.key(request)]?undefined:limits);
  const envelope={...request,from:{...request.from},attachments,...metadata};
  return {envelope,fingerprint:ledger.fingerprint(envelope)};
 };
 const inFlight=new Map();
 const setJob=(e,peerId,state)=>ledger.run(()=>ledger.save(d=>{const m=d.messages[ledger.key(e)];if(m)m.jobs[peerId]=state;}));

 // Network replication. This runs OUTSIDE ledger.run: it never holds the
 // transaction queue while fetching /info, delivering envelopes or streaming
 // blob bytes. Job-state writes rejoin the serial queue briefly. (M3 #4)
 const replicate=async(e,peerId,allowDowngrade=false)=>{
  const key=ledger.key(e);
  await setJob(e,peerId,'pending');
  const peer=node.resolvePeers(peerId)[0];if(!peer)throw new Error('Room Leader/member node is unavailable; retry same messageId');
  const info=await fetch(`http://${peer.address}:${peer.httpPort}/lan-mesh/v1/info`,{signal:AbortSignal.timeout(8000)});const desc=(await info.json()).node;
  if(!info.ok||desc?.nodeId!==peerId)throw new Error('peer identity mismatch or does not support room attachments');
  const wire={address:peer.address,port:peer.httpPort,secret:node.config.clusterSecret};
  // M3 #8 / Task 3 — an ordinary member that POSITIVELY advertises no attachment
  // support must still learn the message exists, but the readable note MAY NOT
  // widen who gets woken on that node.
  //
  // The old shape stripped `mentions` and kept only the node-level `to`. The
  // receiving service then re-derives targets from the plain body, so an `@` in
  // the body — or merely in a FILE NAME, including `@all` — woke agents that
  // were never addressed. Two capabilities now decide this, and only exact,
  // signed references may carry a wake at all:
  //
  //   * no blobs BUT exact references (roomReferences === 1): send the note as a
  //     normal references-version message. `mentions` is always DEFINED (the
  //     sender's exact structured refs, or `[]` when they typed no address), so
  //     the receiver uses exact member keys and never body/file-name tokens.
  //   * no exact references at all: fail closed. Nothing is delivered and the
  //     sender sees `incompatible: true`, instead of us guessing a target and
  //     letting a legacy broadcast heuristic choose agents to run.
  //
  // This is not a new unsigned `noWake` flag an old node would ignore: the
  // emptiness of `mentions` is the real, signed reference semantics, which the
  // receiver already implements. No bytes are ever inlined; the job stays
  // 'pending' so an upgraded peer is backfilled by a later retry (publish then
  // patches the existing same-id message instead of duplicating it).
  if(allowDowngrade&&desc?.roomAttachments!==1){
   // No exact-reference support at all: fail closed. Sending a plain room
   // message there would let the receiver's legacy body/broadcast heuristic pick
   // agents to run, and we have no signed way to say "do not wake anyone".
   if(desc?.roomReferences!==1){
    return {nodeId:peerId,ok:false,incompatible:true,metadataDelivered:false,blobDelivered:false,
     error:'peer supports neither room attachments nor exact references; nothing was delivered'};
   }
   const names=e.attachments.map(r=>r.name).join('、');
   const notice={id:e.id,from:{...e.from},to:peerId,kind:e.kind,topic:e.topic,room:e.room,
    text:[e.text,`[附件暂不可用：此客户端不支持附件预览] 文件：${names}`].filter(Boolean).join('\n'),
    sentAt:e.sentAt,
    // Always DEFINED: the sender's exact signed refs, or `[]` when they addressed
    // nobody. The receiver therefore matches exact member keys only and never
    // falls back to body/file-name tokens (where `@all` would fan out).
    mentions:e.mentions??[],
    ...(e.skillRefs===undefined?{}:{skillRefs:e.skillRefs})};
   await deliverToPeer({...wire,envelope:notice});
   return {nodeId:peerId,ok:true,downgraded:true,metadataDelivered:true,blobDelivered:false,delivered:'readable-text-with-exact-references'};
  }
  if(desc?.roomAttachments!==1||desc?.roomBlobs!==1)throw new Error('peer identity mismatch or does not support room attachments');
  const prepared=await deliverToPeer({...wire,envelope:{...e,to:peerId,attachmentPhase:'prepare'}});
  if(!prepared.receipt.committed)for(const ref of e.attachments)await sendBlob({peer:{...peer,port:peer.httpPort,roomBlobs:1},nodeId:node.nodeId,secret:node.config.clusterSecret,roomId:e.room,attachment:ref,readable:await store.openRead(ref.blobId)});
  await deliverToPeer({...wire,envelope:{...e,to:peerId,attachmentPhase:'commit'}});
  await setJob(e,peerId,'committed');
  // metadataDelivered describes the signed envelope/refs; blobDelivered means the
  // bytes really landed on that node. A plain ok:true must not imply the latter.
  return {nodeId:peerId,ok:true,metadataDelivered:true,blobDelivered:true};
 };

 const runSend=e0=>{
  // PHASE 1 (transaction queue): ONLY atomic state changes. No network here,
  // otherwise a peer's inbound receive() (which also needs our queue) would
  // deadlock when two nodes send at once. (M3 #4)
  return ledger.run(async()=>{
   if(node.closed)throw new Error('attachment service is closed');
   let e={...e0,from:{...e0.from},attachments:normalizeRoomAttachments(e0.attachments,ledger.data.messages[ledger.key(e0)]?undefined:limits)};
   for(const ref of e.attachments){const uploaded=ledger.data.uploads[JSON.stringify([e.room,e.from.sessionId,ref.blobId,ref.name,ref.mediaType])];if(!uploaded||JSON.stringify(uploaded)!==JSON.stringify(ref))throw new Error('attachment reference metadata does not match local upload');}
   let entry=await ledger.prepare(e,true);e=entry.envelope;
   await pin(e);
   const room=member(e.room,node.nodeId,e.from.sessionId,true);
   if(!entry.leaderNodeId){await ledger.save(d=>{d.messages[ledger.key(e)].leaderNodeId=room.leader?.nodeId;});entry=ledger.data.messages[ledger.key(e)];}
   const leader=entry.leaderNodeId;
   if(!leader)throw new TransportError('Room Leader is unavailable; retry same messageId','LEADER_UNAVAILABLE',503);
   return {e,leader,room,committed:entry.status==='committed',key:ledger.key(e)};
  }).then(async plan=>{
   const {e,leader,room,key}=plan;
   const delivered=[];
   // PHASE 2 (network, queue released): Leader replication is fatal.
   if(leader!==node.nodeId&&!plan.committed){try{delivered.push(await replicate(e,leader));}catch(error){throw new TransportError(`Room Leader replication failed: ${error.message}; retry same messageId`,'LEADER_UNAVAILABLE',503);}}
   // PHASE 3: durable commit decision + publication, both idempotent.
   const committed=await ledger.run(()=>ledger.commit(e,store));
   await publish(e,committed.receivedAt,true);
   if(leader!==node.nodeId&&!delivered.length)delivered.push({nodeId:leader,ok:true});
   // PHASE 4 (network, queue released): ordinary-member backfill is best effort.
   for(const peerId of new Set(room.members.map(m=>m.nodeId))){
    if(peerId===node.nodeId||peerId===leader)continue;
    if(ledger.data.messages[key]?.jobs[peerId]==='committed'){delivered.push({nodeId:peerId,ok:true});continue;}
    try{delivered.push(await replicate(e,peerId,true));}catch(error){delivered.push({nodeId:peerId,ok:false,error:error.message});}
   }
   // PHASE 5: persist result (last crash point; restart is idempotent).
   const result={messageId:e.id,room,delivered,durableNodes:[...new Set([node.nodeId,leader])]};
   await ledger.run(()=>ledger.save(d=>{const m=d.messages[key];if(m)m.result=result;}));
   return result;
  });
 };

 const api={store,ledger,handler,limits,
  upload:request=>ledger.run(async()=>{
   member(request.room,node.nodeId,request.sessionId,true);
   normalizeRoomAttachments([{...request,ownerNodeId:node.nodeId}],limits);
   const ref=await store.put(request.readable,{...request,ownerNodeId:node.nodeId});
   await ledger.save(d=>{d.uploads[JSON.stringify([request.room,request.sessionId,ref.blobId,ref.name,ref.mediaType])]=ref;});return ref;
  }),
  describe:request=>{
   member(request.room,node.nodeId,request.sessionId,true);
   const ref=Object.values(ledger.data.messages).filter(e=>e.status==='committed'&&e.envelope.room===request.room).flatMap(e=>e.envelope.attachments).find(r=>r.blobId===request.blobId);
   if(!ref)throw new Error('attachment has no committed room reference');
   return {...ref};
  },
  read:async request=>{
   const room=member(request.room,node.nodeId,request.sessionId,true);
   const ref=api.describe(request);
   if(await store.has(ref.blobId))return store.openRead(ref.blobId);
   // M3 #7: the immutable ref is committed in THIS room (describe() proved it),
   // but our node has no local bytes (e.g. a late member, or a past GC). Any
   // current room member that still holds the bytes may serve them on demand.
   // readPeerBlob verifies length + mediaType + SHA-256 via store.put before it
   // publishes locally; only AFTER that do we declare ourselves a holder. A
   // digest we know, or a holder declaration alone, never grants a cross-room
   // read: the holder's own GET authorize requires a committed ref in this room
   // and our current membership. If nobody reachable holds it, fail clearly.
   for(const holderId of new Set(room.members.map(m=>m.nodeId))){
    if(holderId===node.nodeId)continue;
    let peer;try{peer=node.resolvePeers(holderId)[0];}catch{continue;}
    if(!peer)continue;
    try{
     const info=await fetch(`http://${peer.address}:${peer.httpPort}/lan-mesh/v1/info`,{signal:AbortSignal.timeout(8000)});
     const desc=(await info.json()).node;
     if(!info.ok||desc?.nodeId!==holderId||desc?.roomBlobs!==1)continue;
     await readPeerBlob({peer:{address:peer.address,port:peer.httpPort,nodeId:holderId,roomBlobs:1},nodeId:node.nodeId,secret:node.config.clusterSecret,roomId:request.room,attachment:ref,store});
     if(!await store.has(ref.blobId))continue;
     await store.declareHolder(ref.blobId,node.nodeId);
     // Bytes we fetched and verified for a COMMITTED room reference must be
     // pinned, otherwise orphan GC would reclaim them and the attachment would
     // silently start failing again.
     const owner=Object.values(ledger.data.messages).find(entry=>entry.status==='committed'&&entry.envelope.room===request.room&&(entry.envelope.attachments??[]).some(r=>r.blobId===ref.blobId));
     if(owner)await store.pin(ref.blobId,ledger.key(owner.envelope));
     return store.openRead(ref.blobId);
    }catch{continue;}
   }
   throw new Error('attachment is temporarily unavailable; no reachable holder');
  },
  /**
   * Backfill committed attachment history for one room from its current Leader.
   *
   * A member that joined after the sender left has no committed ref of its own,
   * and rooms.json anti-entropy deliberately carries no attachment refs. The
   * Leader therefore serves a signed, paged, read-only manifest; we import it as
   * already-committed, relay-attested entries (author unchanged, no forged
   * sender signature, no byte receipt claimed).
   *
   * Constraints kept here:
   *  * the network runs OUTSIDE the ledger queue; only each page's import rejoins it;
   *  * only the room's current Leader is contacted, and only if we are a member;
   *  * importing never wakes an agent and never requires local bytes;
   *  * pages are idempotent (same id + same fingerprint = skip), and a page that
   *    conflicts is reported without overwriting local history.
   * @param {{ room: string, sessionId?: string, maxPages?: number }} request - backfill request.
   * @returns {{ room: string, pages: number, imported: number, skipped: number, conflicts: string[], complete: boolean }}
   */
  syncFromLeader:async request=>{
   const room=member(request.room,node.nodeId,request.sessionId,true);
   const leaderId=room.leader?.nodeId;
   const empty={room:room.id,pages:0,imported:0,skipped:0,conflicts:[],complete:true};
   if(!leaderId||leaderId===node.nodeId)return empty;
   const peer=node.resolvePeers(leaderId)[0];
   if(!peer)return {...empty,complete:false};
   const summary={...empty};
   let cursor='';
   const maxPages=Math.max(1,Math.min(200,Number.isSafeInteger(request.maxPages)?request.maxPages:50));
   for(let page=0;page<maxPages;page+=1){
    const body=await fetchAttachmentManifest({peer:{address:peer.address,port:peer.httpPort,nodeId:leaderId},nodeId:node.nodeId,secret:node.config.clusterSecret,roomId:room.id,cursor});
    summary.pages+=1;
    // Import is its own queued transaction: never hold the queue across the fetch.
    const applied=await ledger.run(()=>ledger.importManifest({roomId:room.id,relayNodeId:leaderId,entries:body.entries}));
    // Make the page visible to humans/agents exactly once (publish dedupes by
    // sender+id and patches stripped records in place). notify=false by design:
    // finding out that old history exists must never wake an agent.
    for(const entry of body.entries){
     const stored=ledger.data.messages[ledger.key(entry)];
     if(stored?.status==='committed')await publish(stored.envelope,stored.receivedAt);
    }
    summary.imported+=applied.imported;summary.skipped+=applied.skipped;
    for(const id of applied.conflicts)if(!summary.conflicts.includes(id))summary.conflicts.push(id);
    if(!body.nextCursor){summary.complete=true;return summary;}
    cursor=body.nextCursor;
   }
   // Page budget exhausted: history exists but is not fully backfilled yet.
   return {...summary,complete:false};
  },
  /**
   * Read-only reconciliation of local intents whose outcome we never learned.
   *
   * A send whose Leader ACK was lost leaves a LOCAL draft whose true state is
   * unknown: the Leader may have committed it (then re-sending a user-edited
   * draft would publish the wrong text) or may never have seen it (then
   * skipping it forever strands a legitimate message). Neither guess is
   * acceptable, so we ASK the Leader's signed committed manifest and record the
   * verdict:
   *
   *  * present (same sender + id + canonical fingerprint) -> the Leader really
   *    committed it. Promote our own prepared intent to committed from that
   *    attestation. Nothing is transmitted, so no draft can be re-published.
   *  * absent -> provably never committed. Record `decision:'absent'` so the
   *    message is a definite failure a human can retry, never a silent resend.
   *  * unreachable / error -> `unknown`, and NOTHING is recorded: an
   *    undetermined state must not become durable history.
   *
   * @param {{ room: string, sessionId?: string, maxPages?: number }} request - reconcile request.
   * @returns {Promise<{ room: string, checked: number, committed: string[], absent: string[], unknown: string[] }>}
   */
  reconcile:async request=>{
   const room=member(request.room,node.nodeId,request.sessionId,true);
   const summary={room:room.id,checked:0,committed:[],absent:[],unknown:[]};
   const candidates=Object.entries(ledger.data.messages)
    .filter(([,entry])=>entry.local&&entry.envelope.room===room.id&&entry.status==='prepared'&&!entry.result)
    .map(([key,entry])=>({key,id:entry.envelope.id,fingerprint:ledger.fingerprint(entry.envelope)}));
   if(!candidates.length)return summary;
   const leaderId=room.leader?.nodeId;
   const peer=leaderId&&leaderId!==node.nodeId?node.resolvePeers(leaderId)[0]:undefined;
   if(!peer){summary.unknown=candidates.map(item=>item.id);return summary;}
   // Authorization is the Leader's call (it re-checks OUR current membership), so
   // a membership change between send and reconcile cannot be bypassed here.
   const attested=new Map();
   let cursor='';
   const maxPages=Math.max(1,Math.min(200,Number.isSafeInteger(request.maxPages)?request.maxPages:50));
   try{
    for(let page=0;page<maxPages;page+=1){
     const body=await fetchAttachmentManifest({peer:{address:peer.address,port:peer.httpPort,nodeId:leaderId},nodeId:node.nodeId,secret:node.config.clusterSecret,roomId:room.id,cursor});
     for(const entry of body.entries)if(entry.from?.nodeId===node.nodeId)attested.set(entry.id,entry);
     if(!body.nextCursor)break;
     cursor=body.nextCursor;
    }
   }catch{summary.unknown=candidates.map(item=>item.id);return summary;}
   for(const item of candidates){
    summary.checked+=1;
    const entry=attested.get(item.id);
    if(!entry){await ledger.run(()=>ledger.recordReconcile({key:item.key,decision:'absent',relayNodeId:leaderId}));summary.absent.push(item.id);continue;}
    if(attachmentFingerprint(entry)!==item.fingerprint){
     // The Leader knows this sender+id with DIFFERENT content: a real conflict.
     // Never adopt it, never overwrite; surface it as unresolved.
     summary.unknown.push(item.id);continue;
    }
    const applied=await ledger.run(()=>ledger.importManifest({roomId:room.id,relayNodeId:leaderId,entries:[entry]}));
    if(applied.conflicts.length){summary.unknown.push(item.id);continue;}
    const stored=ledger.data.messages[item.key];
    if(stored?.status==='committed')await publish(stored.envelope,stored.receivedAt);
    summary.committed.push(item.id);
   }
   return summary;
  },
  receive:e=>ledger.run(async()=>{
   const room=member(e.room,e.from.nodeId,e.from.sessionId,true);
   const metadata=normalizeRoomMessageMetadata(e,room);
   const refs=normalizeRoomAttachments(e.attachments,ledger.data.messages[ledger.key(e)]?undefined:limits);
   e={...e,...metadata,from:{...e.from},attachments:refs};
   if(refs.some(r=>r.ownerNodeId!==e.from.nodeId))throw new Error('attachment owner must be sender');
   if(e.attachmentPhase==='prepare'){const entry=await ledger.prepare(e);if(entry.status!=='committed'&&entry.expiresAt<=Date.now())throw new Error('attachment prepare expired');return {prepared:true,committed:entry.status==='committed',messageId:e.id};}
   if(e.attachmentPhase!=='commit')throw new Error('invalid attachment phase');
   const entry=await ledger.commit(e,store);await publish(entry.envelope,entry.receivedAt,true);return {messageId:e.id,receivedAt:entry.receivedAt,woken:false};
  }),
  // Coalesce by id ONLY when the canonical content is identical. A different
  // payload reusing an in-flight id is a conflict the caller must see, not a
  // silent share of the first operation's result. (M3 Task 2)
  send:async e0=>{
   const {envelope:e,fingerprint}=canonicalSend(e0);
   const key=ledger.key(e);
   const active=inFlight.get(key);
   if(active){
    if(active.fingerprint!==fingerprint)throw new Error('attachment message id conflict: a different message with this id is already being sent');
    return active.promise;
   }
   const p=runSend(e);
   // Clean up on BOTH outcomes so a failed send can be retried with the same id
   // (and a settled promise is never handed to a later identical retry).
   p.then(()=>{},()=>{}).finally(()=>{if(inFlight.get(key)?.promise===p)inFlight.delete(key);});
   inFlight.set(key,{fingerprint,promise:p});
   return p;
  },
 };
 api.retry=async(options={})=>{
  const results=[];
  for(const entry of Object.values(ledger.data.messages)){
   if(!entry.local)continue;
   // M3 #5: a BACKGROUND sweep must NOT silently publish an editable draft that
   // never committed (Leader was offline; the human may have edited/removed it).
   // Only committed messages (offline-member backfill / lost-ACK reconcile) are
   // safe to retry automatically. An explicit operator retry() still sees all
   // local pending intents.
   if(options.background&&entry.status!=='committed')continue;
   if(!(entry.status!=='committed'||!entry.result||Object.values(entry.jobs).includes('pending')))continue;
   try{results.push({messageId:entry.envelope.id,ok:true,result:await api.send(entry.envelope)});}
   catch(error){results.push({messageId:entry.envelope.id,ok:false,error:error.message});}
  }
  return results;
 };
 // M3 #6: production orphan cleanup. collectOrphans already protects committed
 // pins, in-flight reads, staged/deleting entries and unknown foreign files;
 // here we also prune the matching (now-invalid) local upload records. `now`
 // is injectable so regression tests can cross the grace period deterministically.
 api.collectGarbage=async(now)=>{
  const collected=await store.collectOrphans(now);
  if(collected.length)await ledger.run(()=>ledger.save(d=>{for(const [key,ref] of Object.entries(d.uploads))if(collected.includes(ref.blobId))delete d.uploads[key];}));
  return collected;
 };
 api.drain=async()=>{await Promise.allSettled([...inFlight.values()].map(active=>active.promise));};
 // No network work at startup: retain pending intents, rebuild all committed
 // messages, and repair pins idempotently before capability advertisement.
 // Manifest-imported history is committed WITHOUT local bytes (a late member has
 // the reference before the blob), so only verified local bytes are pinned —
 // otherwise one import would make startup throw 'attachment blob missing'.
 for(const entry of Object.values(ledger.data.messages))if(entry.status==='committed'){await pinLocal(entry.envelope);await publish(entry.envelope,entry.receivedAt);}
 return api;
}
