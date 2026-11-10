import { join } from 'node:path';
import { RoomBlobStore } from './room-blob-store.mjs';
import { RoomAttachmentLedger } from './room-attachment-ledger.mjs';
import { createBlobHandler, sendBlob, readPeerBlob } from './room-blob-protocol.mjs';
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
  onReceived:async r=>ledger.recordReceived({roomId:r.roomId,senderNodeId:r.senderNodeId,ref:r.ref})});
 const pin=async e=>{for(const ref of e.attachments){if(!await store.has(ref.blobId))throw new Error('attachment blob missing');await store.pin(ref.blobId,ledger.key(e));}};

 // One in-flight send per message id. The periodic sweep, an operator retry and
 // a fresh sayInRoom() that all target the same id share a single operation
 // instead of racing two replications (M3 #4).
 const inFlight=new Map();
 const withInFlight=(key,fn)=>{
  if(inFlight.has(key))return inFlight.get(key);
  const p=Promise.resolve().then(fn).finally(()=>inFlight.delete(key));
  inFlight.set(key,p);return p;
 };
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
  // M3 #8: an ordinary member that POSITIVELY advertises no attachment support
  // still gets a readable plain-text note (body + file names + an explicit
  // "cannot preview" hint). This is NOT a downgrade to inline bytes/new base64,
  // NOT a broadcast: the note keeps the same precise signed `to`, carries no
  // mentions/skillRefs/attachments, and is addressed to exactly this peer.
  // The job stays 'pending' on purpose: once the peer upgrades, a later retry
  // delivers the real refs; publish() then patches the existing same-id message
  // in place instead of duplicating the body. The Leader never takes this path.
  if(allowDowngrade&&desc?.roomAttachments!==1){
   const names=e.attachments.map(r=>r.name).join('、');
   const downgrade={id:e.id,from:{...e.from},to:peerId,kind:e.kind,topic:e.topic,room:e.room,
    text:[e.text,`[附件暂不可用：此客户端不支持附件预览] 文件：${names}`].filter(Boolean).join('\n'),sentAt:e.sentAt};
   await deliverToPeer({...wire,envelope:downgrade});
   return {nodeId:peerId,ok:true,downgraded:true,delivered:'readable-text-only'};
  }
  if(desc?.roomAttachments!==1||desc?.roomBlobs!==1)throw new Error('peer identity mismatch or does not support room attachments');
  const prepared=await deliverToPeer({...wire,envelope:{...e,to:peerId,attachmentPhase:'prepare'}});
  if(!prepared.receipt.committed)for(const ref of e.attachments)await sendBlob({peer:{...peer,port:peer.httpPort,roomBlobs:1},nodeId:node.nodeId,secret:node.config.clusterSecret,roomId:e.room,attachment:ref,readable:await store.openRead(ref.blobId)});
  await deliverToPeer({...wire,envelope:{...e,to:peerId,attachmentPhase:'commit'}});
  await setJob(e,peerId,'committed');
  return {nodeId:peerId,ok:true};
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
     return store.openRead(ref.blobId);
    }catch{continue;}
   }
   throw new Error('attachment is temporarily unavailable; no reachable holder');
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
  send:e=>withInFlight(ledger.key(e),()=>runSend(e)),
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
 api.drain=async()=>{await Promise.allSettled([...inFlight.values()]);};
 // No network work at startup: retain pending intents, rebuild all committed
 // messages, and repair pins idempotently before capability advertisement.
 for(const entry of Object.values(ledger.data.messages))if(entry.status==='committed'){await pin(entry.envelope);await publish(entry.envelope,entry.receivedAt);}
 return api;
}
