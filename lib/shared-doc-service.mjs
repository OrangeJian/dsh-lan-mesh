import { join } from 'node:path';
import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { SharedDocStore,validateSharedDocReplica } from './shared-doc-store.mjs';
import { SharedDocCoordinator } from './shared-doc-coordinator.mjs';
import { deliverToPeer, TransportError } from './transport.mjs';
import { normalizeContent,hashContent } from './shared-doc-state.mjs';

const READS=new Set(['listDocuments','getDocument','listDocumentHistory']);
const WRITES=new Set(['createDocument','submitDocumentProposal','resolveDocumentConflict','confirmDocumentResolution','renameDocument','archiveDocument','grantDocumentMaintainer']);
const signature=(body,secret)=>createHmac('sha256',secret).update(JSON.stringify(body)).digest('hex');
const fail=(message,code='DOC_COMMAND_INVALID')=>{throw new TransportError(message,code);};

/** Host-bound operations route to the canonical Room Leader. Replicas never mint revisions. */
export async function openSharedDocuments({dir,node,rooms}) {
 const store=await SharedDocStore.open(join(dir,'shared-docs'));
 validateSharedDocReplica(store.state());
 const roomInfo=id=>{
  const room=rooms()[id];
  return room&&{id:room.id,leaderKey:room.leader?.key??'',memberKeys:new Set(room.members.map(m=>m.key))};
 };
 const coordinator=new SharedDocCoordinator({store,nodeId:node.nodeId,nodeName:node.identity?.name,roomInfo});
 const snapshots=new Map();
 const digest=text=>createHash('sha256').update(text).digest('hex');
 const packSnapshot=roomId=>{
  const text=JSON.stringify(snapshot(roomId));
  if(Buffer.byteLength(text)>32*1024*1024)fail('Document replica exceeds snapshot budget','DOC_LIMIT_REACHED');
  for(const [id,entry] of snapshots)if(entry.expires<Date.now())snapshots.delete(id);
  while(snapshots.size>=4)snapshots.delete(snapshots.keys().next().value);
  const id=randomUUID(),parts=[];
  for(let offset=0;offset<text.length;offset+=16000)parts.push(text.slice(offset,offset+16000));
  snapshots.set(id,{roomId,parts,expires:Date.now()+120000});
  return {id,hash:digest(text),parts:parts.length,first:parts[0]};
 };
 const member=(roomId,nodeId,sessionId)=>{
  const room=rooms()[roomId];
  if(!room)fail('Unknown document room','UNKNOWN_ROOM');
  if(!room.members.some(m=>m.nodeId===nodeId&&m.sessionId===sessionId))fail('Document caller is not a member','NOT_ROOM_MEMBER');
  return room;
 };
 const roomFor=request=>request.roomId??store.state().documents[request.documentId]?.roomId;
 const snapshot=roomId=>{
  const state=store.state(),ids=new Set(Object.values(state.documents).filter(d=>d.roomId===roomId).map(d=>d.documentId));
  return {
   documents:Object.fromEntries(Object.entries(state.documents).filter(([id])=>ids.has(id))),
   revisions:Object.fromEntries(Object.entries(state.revisions).filter(([,r])=>ids.has(r.documentId))),
   proposals:Object.fromEntries(Object.entries(state.proposals).filter(([,p])=>ids.has(p.documentId))),
   events:Object.fromEntries(Object.entries(state.events).filter(([id])=>ids.has(id))),
   maintainers:Object.fromEntries(Object.entries(state.maintainers).filter(([id])=>ids.has(id))),
   idempotency:Object.fromEntries(Object.entries(state.idempotency??{}).filter(([,item])=>ids.has(item.documentId)||item.authorityRoomId===roomId)),
  };
 };
 const importSnapshot=async(roomId,data)=>{
  if(!data||Object.values(data.documents??{}).some(d=>d.roomId!==roomId))fail('Wrong snapshot room');
  if(data.idempotency?.[`authority:${roomId}`]?.leaderKey!==rooms()[roomId]?.leader?.key)fail('Snapshot authority changed','DOC_AUTHORITY_CHANGED');
  try { await store.transact(state=>{
   for(const key of ['documents','revisions','proposals','events','maintainers','idempotency']){
    if(!data[key]||Array.isArray(data[key]))fail('Invalid document snapshot');
   }
   // Preserve other rooms. Canonical per-room state replaces only that room's replica.
   const ids=new Set(Object.values(state.documents).filter(d=>d.roomId===roomId).map(d=>d.documentId));
   const stale=new Set();
   for(const [id,document] of Object.entries(data.documents)){
    const prior=state.documents[id];
    if(prior&&prior.roomId!==roomId)fail('Document identifier collision','CONFLICTING_CHECKPOINT');
    if(prior){
     if(prior.generation===document.generation&&prior.seq===document.seq&&prior.contentHash!==document.contentHash)fail('Document checkpoint diverged','CONFLICTING_CHECKPOINT');
     if(prior.generation>document.generation||(prior.generation===document.generation&&prior.seq>document.seq))stale.add(id);
     const localLog=state.events[id]??[],remoteLog=data.events[id]??[];
     const last=localLog.at(-1),incoming=remoteLog.at(-1);
     if(last&&incoming&&(last.generation>incoming.generation||(last.generation===incoming.generation&&last.seq>incoming.seq)))stale.add(id);
     const localSlots=new Map(localLog.map(event=>[`${event.generation}:${event.seq}`,event.hash]));
     for(const event of remoteLog){const hash=localSlots.get(`${event.generation}:${event.seq}`);if(hash!==undefined&&hash!==event.hash)fail('Audit checkpoint diverged','CONFLICTING_CHECKPOINT');}
     const remoteIds=new Map(remoteLog.map(event=>[event.eventId,event.hash]));
     if(!stale.has(id)&&localLog.some(event=>remoteIds.get(event.eventId)!==event.hash))fail('Audit history was removed','CONFLICTING_CHECKPOINT');
    }
   }
   for(const [id,revision] of Object.entries(data.revisions))if(state.revisions[id]&&JSON.stringify(state.revisions[id])!==JSON.stringify(revision))fail('Canonical revision changed','CONFLICTING_CHECKPOINT');
   for(const [id,revision] of Object.entries(state.revisions))if(ids.has(revision.documentId)){
    if(!data.documents[revision.documentId]||stale.has(revision.documentId))continue;
    const remote=data.revisions[id];
    if(!remote||JSON.stringify(remote)!==JSON.stringify(revision))fail('Canonical history diverged','CONFLICTING_CHECKPOINT');
   }
   for(const key of ['documents','revisions','proposals','events','maintainers','idempotency']){
    for(const [id,item] of Object.entries(data[key])){
     const documentId=key==='documents'?id:['events','maintainers'].includes(key)?id:item.documentId;
     if(!(key==='idempotency'&&item.authorityRoomId===roomId)&&!data.documents[documentId])fail('Snapshot contains unrelated records');
    }
    for(const [id,item] of Object.entries(data[key])){
     const documentId=key==='documents'?id:['events','maintainers'].includes(key)?id:item.documentId;
     if(!stale.has(documentId))(state[key]??={})[id]=structuredClone(item);
    }
   }
   validateSharedDocReplica(state);
   return state;
  },{replica:true}); } catch(error) {
   if(error.code==='CONFLICTING_CHECKPOINT'){
    await store.transact(state=>{state.outbox[`fault:${roomId}`]={roomId,status:'blocked',reason:error.message};return state;},{replica:true});
    node.log('shared document replication paused: conflicting checkpoint',error);
   }
   throw error;
  }
 };
 const invoke=async(method,request,actor)=>{
  if(!READS.has(method)&&!WRITES.has(method)&&method!=='__snapshot')fail('Unknown document operation');
  const roomId=roomFor(request),room=member(roomId,actor.nodeId,actor.sessionId);
  if(WRITES.has(method)&&store.state().outbox?.[`fault:${roomId}`])fail('Document replication is paused for manual reconciliation','CONFLICTING_CHECKPOINT');
  if(room.leader?.nodeId!==node.nodeId)fail('Only Room Leader orders documents','NOT_LEADER');
  const authorityKey=`authority:${roomId}`;
  const authority=store.state().idempotency?.[authorityKey];
  if(authority&&authority.leaderKey!==room.leader.key)fail('Document Leader changed; explicit reconciliation is required','DOC_AUTHORITY_CHANGED');
  if(!authority)await store.transact(state=>{state.idempotency??={};state.idempotency[authorityKey]={authorityRoomId:roomId,leaderKey:room.leader.key};return state;});
  if(method==='__snapshot'){
   const entry=snapshots.get(request.snapshotId);
   if(!entry||entry.roomId!==roomId||entry.expires<Date.now()||!Number.isSafeInteger(request.part)||request.part<0||request.part>=entry.parts.length)fail('Snapshot expired; retry synchronization');
   return {value:entry.parts[request.part],roomId};
  }
  const bound={...request,roomId,via:actor.via,sessionId:actor.sessionId};
  // remoteCaller() is the trusted transport adapter; never derive it from payload.
  const target=actor.nodeId===node.nodeId?coordinator:coordinator.forTrustedActor({...actor,isHuman:actor.via==='panel'});
  const value=await target[method](bound);
  if(WRITES.has(method))Promise.resolve().then(()=>flush()).catch(error=>node.log('document outbox retained',error));
  return {value,snapshot:packSnapshot(roomId),roomId};
 };
 const received=new Map();
 const receive=async envelope=>{
  if(node.closed)fail('Document service closed');
  if(envelope.to!==node.nodeId||envelope.kind!=='shared-doc')fail('Wrong document target');
  const age=Date.now()-Date.parse(envelope.sentAt);
  if(!Number.isFinite(age)||Math.abs(age)>120000)fail('Expired document request');
  const {method,request,actorKind}=envelope.payload??{};
  const actor={nodeId:envelope.from.nodeId,sessionId:envelope.from.sessionId,via:actorKind==='human'?'panel':'tool',name:envelope.from.name??envelope.from.nodeId};
  if((actor.via==='panel')!==(actor.sessionId==='human'))fail('Invalid caller kind');
  const key=JSON.stringify([actor.nodeId,envelope.id]);
  const fingerprint=JSON.stringify([method,request,actor]);
  const prior=received.get(key);
  if(prior){if(prior.fingerprint!==fingerprint)fail('Document request ID conflict');return prior.promise;}
  for(const [id,item] of received)if(item.expires<Date.now())received.delete(id);
  if(received.size>=10000)fail('Document request capacity exceeded');
  const operation=async()=>{
   if(WRITES.has(method)){
    const roomId=roomFor(request);
    member(roomId,actor.nodeId,actor.sessionId);
    const nonceKey=`rpc:${actor.nodeId}:${envelope.id}`;
    await store.transact(state=>{
     for(const [id,entry] of Object.entries(state.idempotency??{}))if(entry.rpcNonce&&entry.expiresAt<Date.now())delete state.idempotency[id];
     if(state.idempotency[nonceKey])fail('Previously admitted request; query state or retry with the stable business ID','DOC_REQUEST_UNCERTAIN');
     if(Object.values(state.idempotency).filter(entry=>entry.rpcNonce).length>=10000)fail('Document replay ledger full','DOC_LIMIT_REACHED');
     state.idempotency[nonceKey]={rpcNonce:true,roomId,fingerprint,expiresAt:Date.parse(envelope.sentAt)+120000};
     return state;
    });
   }
   if(method!=='__refresh')return invoke(method,request,actor);
   const room=member(request.roomId,actor.nodeId,actor.sessionId);
   if(room.leader?.nodeId!==actor.nodeId)fail('Replica updates require current Leader','NOT_LEADER');
   const local=room.members.find(m=>m.nodeId===node.nodeId&&m.sessionId==='human')??room.members.find(m=>m.nodeId===node.nodeId);
   if(!local)fail('Replica is no longer a room member','NOT_ROOM_MEMBER');
   const peer=node.resolvePeers(actor.nodeId)[0];
   if(!peer)fail('Leader is unavailable','DOC_LEADER_UNAVAILABLE');
   await importReply({snapshot:request.snapshot},peer,{nodeId:node.nodeId,sessionId:local.sessionId,via:local.sessionId==='human'?'panel':'tool'},room.id);
   return {value:{replicated:true},roomId:room.id};
  };
  const promise=operation().then(result=>{
   const body={requestId:envelope.id,to:actor.nodeId,from:node.nodeId,...result};
   return {body,sig:signature(body,node.config.clusterSecret??'')};
  });
  received.set(key,{fingerprint,promise,expires:Date.now()+240000});
  return promise;
 };
 const remote=async(peer,method,clean,actor,roomId,replicaAck=false)=>{
  const id=randomUUID();
  const result=await deliverToPeer({address:peer.address,port:peer.httpPort,secret:node.config.clusterSecret??'',envelope:{id,kind:'shared-doc',from:{nodeId:node.nodeId,sessionId:actor.sessionId,name:node.identity?.name??node.nodeId},to:peer.nodeId,room:roomId,text:'',sentAt:new Date().toISOString(),sharedDocsVersion:1,documentId:clean.documentId??'doc-000000000000',op:READS.has(method)||method==='__snapshot'?'sync':'submit',payload:{method,request:clean,actorKind:actor.via==='panel'?'human':'agent'}}});
  const reply=result.result??result.receipt;
  if(!reply?.body||reply.body.requestId!==id||reply.body.to!==node.nodeId||reply.body.from!==peer.nodeId||reply.body.roomId!==roomId)fail('Invalid document response');
  const expected=signature(reply.body,node.config.clusterSecret??''),given=reply.sig;
  if(typeof given!=='string'||given.length!==expected.length||!timingSafeEqual(Buffer.from(given),Buffer.from(expected)))fail('Invalid document response signature');
  member(roomId,node.nodeId,actor.sessionId);
  if(!replicaAck&&rooms()[roomId]?.leader?.nodeId!==reply.body.from)fail('Document authority changed','NOT_LEADER');
  return reply.body;
 };
 const importReply=async(reply,peer,actor,roomId)=>{
  const meta=reply.snapshot;
  if(!meta||!Number.isSafeInteger(meta.parts)||meta.parts<1||meta.parts>10000||typeof meta.first!=='string')fail('Invalid snapshot descriptor');
  let text=meta.first;
  for(let part=1;part<meta.parts;part++){
   const chunk=await remote(peer,'__snapshot',{roomId,snapshotId:meta.id,part},actor,roomId);
   if(typeof chunk.value!=='string')fail('Invalid snapshot part');
   text+=chunk.value;
   if(Buffer.byteLength(text)>32*1024*1024)fail('Snapshot too large');
  }
  if(digest(text)!==meta.hash)fail('Document snapshot hash mismatch','CONFLICTING_CHECKPOINT');
  await importSnapshot(roomId,JSON.parse(text));
 };
 const call=async(method,request={})=>{
  if(node.closed)fail('Document service closed');
  const sessionId=request.via==='tool'?request.sessionId:'human';
  if(typeof sessionId!=='string'||!sessionId||sessionId.includes('/')||(request.via==='tool'&&sessionId==='human'))fail('Invalid executing session');
  const roomId=roomFor(request),room=member(roomId,node.nodeId,sessionId);
  if(WRITES.has(method)&&store.state().outbox?.[`fault:${roomId}`])fail('Document replication is paused for manual reconciliation','CONFLICTING_CHECKPOINT');
  const clean={...request,roomId};delete clean.via;delete clean.sessionId;delete clean.actorKey;
  const actor={nodeId:node.nodeId,sessionId,via:sessionId==='human'?'panel':'tool'};
  const offline=async()=>{
   if(READS.has(method))return {...await coordinator[method]({...clean,via:actor.via,sessionId}),offline:true};
   if(method!=='submitDocumentProposal')fail('Document Leader unavailable; draft retained','DOC_LEADER_UNAVAILABLE');
   if(!/^prop-[a-z0-9]{12}$/.test(clean.proposalId??''))fail('Offline proposals require a stable proposalId');
   const state=store.state(),document=state.documents[clean.documentId],base=state.revisions[clean.baseRevisionId];
   if(!document||!base||base.documentId!==document.documentId)fail('Offline proposal requires a cached base revision','DOC_BASE_NOT_FOUND');
   const content=normalizeContent(clean.content),key=`pending:${actor.nodeId}/${actor.sessionId}:${clean.proposalId}`;
   const fingerprint=JSON.stringify([actor,clean.documentId,clean.baseRevisionId,content,clean.message??'']);
   await store.transact(next=>{
    const prior=next.idempotency[key];
    if(prior&&prior.fingerprint!==fingerprint)fail('Proposal ID reused with different offline content','DOC_PROPOSAL_ID_REUSED');
    next.idempotency[key]??={documentId:clean.documentId,roomId,pendingProposal:true,actor,request:{...clean,content},fingerprint,decision:'pending'};
    return next;
   });
   return {status:'pending',reason:'Leader unavailable; proposal saved locally for synchronization',proposal:{proposalId:clean.proposalId,documentId:clean.documentId,status:'pending',resultHash:hashContent(content),message:clean.message??''}};
  };
  if(room.leader?.nodeId===node.nodeId){
   const result=await invoke(method,clean,actor);
   if(WRITES.has(method))flush().catch(error=>node.log('document replication retained for retry',error));
   return result.value;
  }
  const peer=node.resolvePeers(room.leader?.nodeId)[0];
  if(!peer)return offline();
  if(peer.nodeId!==room.leader.nodeId)fail('Resolved document Leader identity mismatch');
  let reply;
  try{reply=await remote(peer,method,clean,actor,roomId);}catch(error){if(['UNREACHABLE','DOC_LEADER_UNAVAILABLE'].includes(error.code))return offline();throw error;}
  await importReply(reply,peer,actor,roomId);
  return reply.value;
 };
 let flushing;
 const flush=()=>{
  if(flushing)return flushing;
  flushing=(async()=>{
   for(const [key,item] of Object.entries(store.state().idempotency??{})){
    if(node.closed)break;
    if(!item.pendingProposal||item.decision!=='pending')continue;
    try{
     const result=await call('submitDocumentProposal',{...item.request,via:item.actor.via,sessionId:item.actor.sessionId});
     if(result.status!=='pending')await store.transact(next=>{next.idempotency[key].decision=result.status;return next;});
    }catch(error){node.log('offline document proposal retained',error);}
   }
   const pending=Object.entries(store.state().outbox??{}).filter(([,item])=>item.status==='pending'&&item.documentId);
   for(const room of Object.values(rooms())){
    if(node.closed)break;
    if(room.leader?.nodeId!==node.nodeId)continue;
    const state=store.state();
    const ids=pending.filter(([,item])=>state.documents[item.documentId]?.roomId===room.id).map(([id])=>id);
    if(!ids.length)continue;
    const snapshot=packSnapshot(room.id),actor={nodeId:node.nodeId,sessionId:room.leader.sessionId,via:room.leader.sessionId==='human'?'panel':'tool'};
    const targets=[...new Set(room.members.map(m=>m.nodeId))].filter(id=>id!==node.nodeId);
    let complete=true;
    for(const target of targets){
     if(node.closed){complete=false;break;}
     const peer=node.resolvePeers(target)[0];
     if(!peer||peer.nodeId!==target){complete=false;continue;}
     try{await remote(peer,'__refresh',{roomId:room.id,snapshot},actor,room.id,true);}catch(error){complete=false;node.log('document replica is pending',error);}
    }
    if(complete&&rooms()[room.id]?.leader?.key===room.leader.key)await store.transact(next=>{
     for(const id of ids)if(next.outbox[id]){next.outbox[id].status='sent';next.outbox[id].deliveredNodeIds=targets;}
     return next;
    });
   }
  })().finally(()=>{flushing=undefined;});
  return flushing;
 };
 return {store,coordinator,call,receive,flush,close:async()=>{await flushing;await store.close();}};
}
