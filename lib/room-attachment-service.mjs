import { join } from 'node:path';
import { RoomBlobStore } from './room-blob-store.mjs';
import { RoomAttachmentLedger } from './room-attachment-ledger.mjs';
import { createBlobHandler, sendBlob } from './room-blob-protocol.mjs';
import { normalizeRoomAttachments, normalizeRoomMessageMetadata, ROOM_ATTACHMENT_LIMITS, ROOM_ATTACHMENT_WIRE_LIMITS } from './room-message.mjs';
import { deliverToPeer, TransportError } from './transport.mjs';

export async function openRoomAttachments({dir,node,member,peerMember,publish}) {
 const limits={...ROOM_ATTACHMENT_LIMITS,...node.config.roomAttachmentLimits};
 for(const [key,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1)throw new Error(`invalid attachment limit ${key}`);
 if(limits.maxAttachments>ROOM_ATTACHMENT_WIRE_LIMITS.maxAttachments)throw new Error('attachment count limit exceeds wire bound');
 const store=await RoomBlobStore.open({dir:join(dir,'blobs'),...limits});
 const ledger=await RoomAttachmentLedger.open(dir);
 const handler=createBlobHandler({store,nodeId:()=>node.nodeId,secret:()=>node.config.clusterSecret,trustedPeers:()=>node.config.trustedPeers??[],maxFileBytes:limits.maxFileBytes,warn:node.log,authorize:r=>peerMember(r.roomId,r.senderNodeId) && ledger.authorize(r)});
 const pin=async e=>{for(const ref of e.attachments){if(!await store.has(ref.blobId))throw new Error('attachment blob missing');await store.pin(ref.blobId,ledger.key(e));}};
 const api={store,ledger,handler,limits,
  upload:request=>ledger.run(async()=>{
   member(request.room,node.nodeId,request.sessionId,true);
   normalizeRoomAttachments([{...request,ownerNodeId:node.nodeId}],limits);
   const ref=await store.put(request.readable,{...request,ownerNodeId:node.nodeId});
   await ledger.save(d=>{d.uploads[JSON.stringify([request.room,request.sessionId,ref.blobId,ref.name,ref.mediaType])]=ref;});return ref;
  }),
  read:async request=>{
   member(request.room,node.nodeId,request.sessionId,true);
   if(!ledger.authorize({operation:'get',roomId:request.room,blobId:request.blobId}))throw new Error('attachment has no committed room reference');
   return store.openRead(request.blobId);
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
  send:e=>ledger.run(async()=>{
   if(node.closed)throw new Error('attachment service is closed');
   const refs=normalizeRoomAttachments(e.attachments,ledger.data.messages[ledger.key(e)]?undefined:limits);
   e={...e,from:{...e.from},attachments:refs};
   for(const ref of refs){const uploaded=ledger.data.uploads[JSON.stringify([e.room,e.from.sessionId,ref.blobId,ref.name,ref.mediaType])];if(!uploaded||JSON.stringify(uploaded)!==JSON.stringify(ref))throw new Error('attachment reference metadata does not match local upload');}
   let entry=await ledger.prepare(e,true);e=entry.envelope;
   await pin(e);
   const room=member(e.room,node.nodeId,e.from.sessionId,true);
   if(!entry.leaderNodeId){await ledger.save(d=>{d.messages[ledger.key(e)].leaderNodeId=room.leader?.nodeId;});entry=ledger.data.messages[ledger.key(e)];}
   const leader=entry.leaderNodeId;
   if(!leader)throw new TransportError('Room Leader is unavailable; retry same messageId','LEADER_UNAVAILABLE',503);
   const delivered=[];
   const replicate=async peerId=>{
    await ledger.save(d=>{d.messages[ledger.key(e)].jobs[peerId]='pending';});
    const peer=node.resolvePeers(peerId)[0];if(!peer)throw new Error('Room Leader/member node is unavailable; retry same messageId');
    const info=await fetch(`http://${peer.address}:${peer.httpPort}/lan-mesh/v1/info`,{signal:AbortSignal.timeout(8000)});const desc=(await info.json()).node;
    if(!info.ok||desc?.nodeId!==peerId||desc?.roomAttachments!==1||desc?.roomBlobs!==1)throw new Error('peer identity mismatch or does not support room attachments');
    const wire={address:peer.address,port:peer.httpPort,secret:node.config.clusterSecret};
    const prepared=await deliverToPeer({...wire,envelope:{...e,to:peerId,attachmentPhase:'prepare'}});
    if(!prepared.receipt.committed)for(const ref of refs)await sendBlob({peer:{...peer,port:peer.httpPort,roomBlobs:1},nodeId:node.nodeId,secret:node.config.clusterSecret,roomId:e.room,attachment:ref,readable:await store.openRead(ref.blobId)});
    await deliverToPeer({...wire,envelope:{...e,to:peerId,attachmentPhase:'commit'}});
    await ledger.save(d=>{d.messages[ledger.key(e)].jobs[peerId]='committed';});
    return {nodeId:peerId,ok:true};
   };
   if(leader!==node.nodeId&&entry.status!=='committed'){try{delivered.push(await replicate(leader));}catch(error){throw new TransportError(`Room Leader replication failed: ${error.message}; retry same messageId`,'LEADER_UNAVAILABLE',503);}}
   // Persist the publication decision before exposing it. The ledger is the source
   // of truth if the separate inbox append or final response is interrupted.
   entry=await ledger.commit(e,store);await publish(e,entry.receivedAt,true);
   if(leader!==node.nodeId&&!delivered.length)delivered.push({nodeId:leader,ok:true});
   for(const peerId of new Set(room.members.map(m=>m.nodeId))){if(peerId===node.nodeId||peerId===leader)continue;if(entry.jobs[peerId]==='committed'){delivered.push({nodeId:peerId,ok:true});continue;}try{delivered.push(await replicate(peerId));}catch(error){delivered.push({nodeId:peerId,ok:false,error:error.message});}}
   const result={messageId:e.id,room,delivered,durableNodes:[...new Set([node.nodeId,leader])]};
   await ledger.save(d=>{d.messages[ledger.key(e)].result=result;});return result;
  }),
 };
 api.retry=async()=>{
  const results=[];
  for(const entry of Object.values(ledger.data.messages))if(entry.local&&(entry.status!=='committed'||!entry.result||Object.values(entry.jobs).includes('pending'))){try{results.push({messageId:entry.envelope.id,ok:true,result:await api.send(entry.envelope)});}catch(error){results.push({messageId:entry.envelope.id,ok:false,error:error.message});}}
  return results;
 };
 // No network work at startup: retain pending intents, rebuild all committed
 // messages, and repair pins idempotently before capability advertisement.
 for(const entry of Object.values(ledger.data.messages))if(entry.status==='committed'){await pin(entry.envelope);await publish(entry.envelope,entry.receivedAt);}
 return api;
}
