import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { MeshNode } from '../lib/service.mjs';
import { MeshServer, deliverToPeer, signEnvelope, verifyEnvelope, normalizeEnvelope } from '../lib/transport.mjs';
import { sendBlob, readPeerBlob } from '../lib/room-blob-protocol.mjs';
import { RoomAttachmentLedger } from '../lib/room-attachment-ledger.mjs';
import { emptyState, createRoom, joinRoom } from '../lib/rooms.mjs';
import { meshRootDir } from '../lib/store.mjs';

async function fixture(t) {
 const home=await mkdtemp(join(process.cwd(),'.attachment-test-')); const prev=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const state=emptyState();const room=createRoom(state,{name:'Files',leader:{nodeId:'node-b',sessionId:'human',name:'B'}},()=> 'aaaaaaaaaaaa-1111-2222-3333-444444444444');
 joinRoom(state,room.id,{nodeId:'node-a',sessionId:'human',name:'A'});
 const nodes=['a','b'].map((s,i)=>{const n=new MeshNode({config:{port:39001+i,clusterSecret:'secret',trustedPeers:[],autoWake:false}});n.started=true;n.identity={nodeId:`node-${s}`,name:s};n.roomsDoc=structuredClone(state);return n;});
 t.after(async()=>{for(const n of nodes)await n.close();if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;await rm(home,{recursive:true,force:true});});
 return {nodes,room};
}
const upload=(node,room,body='hello')=>node.uploadRoomAttachment({room:room.id,sessionId:'human',readable:Readable.from([body]),name:'hello.txt',mediaType:'text/plain',size:Buffer.byteLength(body),blobId:createHash('sha256').update(body).digest('hex')});

test('real service attachment upload validates identity and committed metadata',async t=>{
 const {nodes:[a],room}=await fixture(t);
 assert.equal(typeof a.uploadRoomAttachment,'function');
 await assert.rejects(upload(a,room,'x').then(ref=>a.sayInRoom({room:room.id,sessionId:'outsider',attachments:[ref]})),/member/);
 const ref=await upload(a,room);
 await assert.rejects(a.sayInRoom({room:room.id,sessionId:'human',attachments:[{...ref,name:'forged.txt'}]}),/metadata|upload|reference/);
 await assert.rejects(a.readRoomAttachment({room:room.id,sessionId:'human',blobId:ref.blobId}),/reference|committed/);
});

test('HTTP sender and Leader pin before ACK, stable retries and restart retain room refs',async t=>{
 const {nodes:[a,b],room}=await fixture(t);
 assert.equal(typeof b.roomAttachmentHandler,'function');
 const handler=await b.roomAttachmentHandler();
 b.server=new MeshServer({describe:()=>({...b.describe(),roomAttachments:1}),secret:()=> 'secret',trustedPeers:()=>[],onMessage:e=>b.receive(e),onBlob:handler});
 await b.server.listen(0);
 a.resolvePeers=()=>[{nodeId:b.nodeId,name:'B',address:'127.0.0.1',httpPort:b.server.port}];
 const ref=await upload(a,room);const req={room:room.id,sessionId:'human',text:'File',attachments:[ref],messageId:'stable-message'};
 const result=await a.sayInRoom(req);assert.equal(result.messageId,'stable-message');
 assert.equal((await a.sayInRoom(req)).messageId,result.messageId);
 for(const node of [a,b]) {
  assert.equal(node.roomDetail({room:room.id}).messages.filter(m=>m.id==='stable-message').length,1);
  const stream=await node.readRoomAttachment({room:room.id,sessionId:'human',blobId:ref.blobId});let bytes='';for await(const part of stream)bytes+=part;assert.equal(bytes,'hello');
  const manifest=await readFile(join(meshRootDir(node.config.port),'blobs','metadata.json'),'utf8');
  assert.match(manifest,/stable-message/);
 }
 await assert.rejects(a.sayInRoom({...req,text:'conflict'}),/conflict/);
 for(const old of [a,b]) {
  await old.close();
  const fresh=new MeshNode({config:old.config});fresh.started=true;fresh.identity=old.identity;fresh.roomsDoc=structuredClone(old.roomsDoc);
  await fresh.roomAttachmentHandler();
  assert.equal(fresh.roomDetail({room:room.id}).messages.filter(m=>m.id===req.messageId).length,1);
  const stream=await fresh.readRoomAttachment({room:room.id,sessionId:'human',blobId:ref.blobId});let bytes='';for await(const p of stream)bytes+=p;assert.equal(bytes,'hello');
  if(old===a)assert.equal((await fresh.sayInRoom(req)).messageId,req.messageId);
  await fresh.close();
 }
});

test('offline Leader fails without publishing and retains prepared upload',async t=>{
 const {nodes:[a],room}=await fixture(t);const ref=await upload(a,room);a.resolvePeers=()=>[];
 await assert.rejects(a.sayInRoom({room:room.id,sessionId:'human',attachments:[ref],messageId:'offline'}),/Leader|leader/);
 assert.equal(a.roomDetail({room:room.id}).messages.length,0);
 assert.equal(await a.blobStore.has(ref.blobId),true);
});

async function httpLeader(a,b) {
 b.server=new MeshServer({describe:()=>b.describe(),secret:()=> 'secret',trustedPeers:()=>[],onMessage:e=>b.receive(e),onBlob:await b.roomAttachmentHandler()});await b.server.listen(0);
 a.resolvePeers=()=>[{nodeId:b.nodeId,name:'B',address:'127.0.0.1',httpPort:b.server.port}];
 return {address:'127.0.0.1',port:b.server.port,secret:'secret'};
}

test('lost Leader commit ACK retries same prepared message without duplicate or unauthorized re-PUT',async t=>{
 const {nodes:[a,b],room}=await fixture(t);await httpLeader(a,b);const ref=await upload(a,room);
 const original=b.receive.bind(b);let lose=true;b.receive=async e=>{const value=await original(e);if(e.attachmentPhase==='commit'&&lose){lose=false;throw new Error('lost ACK');}return value;};
 const req={room:room.id,sessionId:'human',attachments:[ref],messageId:'lost-ack'};
 await assert.rejects(a.sayInRoom(req),/lost ACK/);assert.equal(a.roomDetail({room:room.id}).messages.length,0);
 assert.equal((await a.sayInRoom(req)).messageId,req.messageId);
 assert.equal(b.roomDetail({room:room.id}).messages.length,1);
});

test('HTTP blob admission requires precise prepared transfer; GET requires committed room ref',async t=>{
 const {nodes:[a,b],room}=await fixture(t);const wire=await httpLeader(a,b);const ref=await upload(a,room);
 const peer={...wire,nodeId:b.nodeId,roomBlobs:1};
 const send=()=>sendBlob({peer,nodeId:a.nodeId,secret:'secret',roomId:room.id,attachment:ref,readable:Readable.from(['hello'])});
 await assert.rejects(send(),/403|FORBIDDEN/);
 const e={id:'permissions',from:{nodeId:a.nodeId,sessionId:'human'},to:b.nodeId,kind:'room-message',room:room.id,text:'',sentAt:new Date().toISOString(),attachments:[ref],attachmentsVersion:1,attachmentPhase:'prepare'};
 await assert.rejects(deliverToPeer({...wire,envelope:{...e,attachmentPhase:'commit'}}),/prepare/);
 await deliverToPeer({...wire,envelope:e});await send();
 await assert.rejects(readPeerBlob({peer,nodeId:a.nodeId,secret:'secret',roomId:room.id,attachment:ref,store:a.blobStore}),/403|FORBIDDEN/);
 await deliverToPeer({...wire,envelope:{...e,attachmentPhase:'commit'}});
 const other=createRoom(b.roomsDoc,{name:'Other',leader:{nodeId:b.nodeId,sessionId:'human',name:'B'}},()=> 'bbbbbbbbbbbb-1111-2222-3333-444444444444');
 joinRoom(b.roomsDoc,other.id,{nodeId:a.nodeId,sessionId:'human',name:'A'});
 await assert.rejects(readPeerBlob({peer,nodeId:a.nodeId,secret:'secret',roomId:other.id,attachment:ref,store:a.blobStore}),/403|FORBIDDEN/);
 await assert.rejects(readPeerBlob({peer,nodeId:'outsider',secret:'secret',roomId:room.id,attachment:ref,store:a.blobStore}),/403|FORBIDDEN/);
 await readPeerBlob({peer,nodeId:a.nodeId,secret:'secret',roomId:room.id,attachment:ref,store:a.blobStore});
 await assert.rejects(deliverToPeer({...wire,envelope:{...e,text:'conflict'}}),/conflict/);
});

test('new attachment signature covers phase, metadata, owner and sender session',async t=>{
 const {nodes:[a],room}=await fixture(t);const ref=await upload(a,room);
 const e={v:2,id:'signed',from:{nodeId:a.nodeId,sessionId:'human'},to:a.nodeId,kind:'room-message',room:room.id,text:'',sentAt:new Date().toISOString(),attachments:[ref],attachmentsVersion:1,attachmentPhase:'prepare',mentions:[]};e.sig=signEnvelope(e,'secret');
 assert.equal(verifyEnvelope(normalizeEnvelope(e),'secret'),true);
 for(const change of [{attachmentPhase:'commit'},{attachments:[{...ref,name:'other.txt'}]},{attachments:[{...ref,ownerNodeId:'other'}]},{from:{...e.from,sessionId:'other'}},{mentions:undefined}])assert.equal(verifyEnvelope({...e,...change},'secret'),false);
});

test('expiry survives reopen, signed identical prepare renews; corruption and count/aggregate fail closed',async t=>{
 const {nodes:[a,b],room}=await fixture(t);const wire=await httpLeader(a,b);const ref=await upload(a,room);
 const e={id:'expired',to:b.nodeId,sentAt:new Date().toISOString(),from:{nodeId:a.nodeId,sessionId:'human'},room:room.id,kind:'room-message',text:'',attachments:[ref],attachmentsVersion:1,attachmentPhase:'prepare'};
 await b.receive(e);const l=b.attachmentService.ledger;await l.run(()=>l.save(d=>{d.messages[l.key(e)].expiresAt=1;}));
 const reopened=await RoomAttachmentLedger.open(meshRootDir(b.config.port));assert.equal(reopened.authorize({operation:'put',roomId:room.id,senderNodeId:a.nodeId,blobId:ref.blobId}),false);
 await assert.rejects(b.receive({...e,attachmentPhase:'commit'}),/expired/);
 const peer={...wire,nodeId:b.nodeId,roomBlobs:1};const put=()=>sendBlob({peer,nodeId:a.nodeId,secret:'secret',roomId:room.id,attachment:ref,readable:Readable.from(['hello'])});
 await assert.rejects(put(),/403|FORBIDDEN/);
 await assert.rejects(deliverToPeer({...wire,envelope:{...e,text:'conflicting new content'}}),/conflict/);
 await deliverToPeer({...wire,envelope:e});await put();await deliverToPeer({...wire,envelope:{...e,attachmentPhase:'commit'}});
 assert.equal(b.roomDetail({room:room.id}).messages.length,1);
 await assert.rejects(a.sayInRoom({room:room.id,sessionId:'human',attachments:Array(9).fill(ref)}),/count/);
 await assert.rejects(a.sayInRoom({room:room.id,sessionId:'human',attachments:Array(3).fill({...ref,size:20*1024*1024})}),/size/);
 await l.run(()=>l.save(d=>{d.messages[l.key(e)].status='invalid';}));await assert.rejects(RoomAttachmentLedger.open(meshRootDir(b.config.port)),/invalid/);
});

test('sender crash after durable commit before result publication recovers without duplicate',async t=>{
 const {nodes:[a,b],room}=await fixture(t);await httpLeader(a,b);const ref=await upload(a,room);const ledger=a.attachmentService.ledger,save=ledger.save.bind(ledger);let crash=true;
 ledger.save=async fn=>{const probe=structuredClone(ledger.data);fn(probe);if(crash&&Object.values(probe.messages).some(e=>e.result)){crash=false;throw new Error('crash before result');}return save(fn);};
 const req={room:room.id,sessionId:'human',attachments:[ref],messageId:'crash-result'};await assert.rejects(a.sayInRoom(req),/crash/);
 await a.close();const fresh=new MeshNode({config:a.config});fresh.started=true;fresh.identity=a.identity;fresh.roomsDoc=a.roomsDoc;await fresh.roomAttachmentHandler();
 assert.equal((await fresh.sayInRoom(req)).messageId,req.messageId);assert.equal(fresh.roomDetail({room:room.id}).messages.length,1);assert.equal(b.roomDetail({room:room.id}).messages.length,1);await fresh.close();
});

test('durable outbox retries offline ordinary member after sender restart and wakes exactly once',async t=>{
 const {nodes:[a,b],room}=await fixture(t);await httpLeader(a,b);
 const c=new MeshNode({config:{...a.config,port:39003,autoWake:true},agents:{get:id=>({session:{id,title:'C'},followup:()=>wakes.push(id)}),list:()=>[]}});const wakes=[];c.started=true;c.identity={nodeId:'node-c',name:'C'};
 joinRoom(a.roomsDoc,room.id,{nodeId:c.nodeId,sessionId:'worker',name:'C'});b.roomsDoc=structuredClone(a.roomsDoc);c.roomsDoc=structuredClone(a.roomsDoc);t.after(()=>c.close());
 const leaderPeer=a.resolvePeers()[0];a.resolvePeers=id=>id===b.nodeId?[leaderPeer]:[];
 const ref=await upload(a,room),req={room:room.id,sessionId:'human',attachments:[ref],messageId:'late-holder'};
 const first=await a.sayInRoom(req);assert.equal(first.delivered.find(r=>r.nodeId===c.nodeId).ok,false);assert.equal(a.attachmentService.ledger.data.messages[JSON.stringify([a.nodeId,req.messageId])].jobs[c.nodeId],'pending');
 await a.close();const fresh=new MeshNode({config:a.config});fresh.started=true;fresh.identity=a.identity;fresh.roomsDoc=a.roomsDoc;
 c.server=new MeshServer({describe:()=>c.describe(),secret:()=> 'secret',trustedPeers:()=>[],onMessage:e=>c.receive(e),onBlob:await c.roomAttachmentHandler()});await c.server.listen(0);
 fresh.resolvePeers=id=>id===b.nodeId?[leaderPeer]:[{nodeId:c.nodeId,address:'127.0.0.1',httpPort:c.server.port}];
 const retry=await fresh.retryRoomAttachmentDeliveries();assert.equal(retry[0].ok,true);assert.equal(c.roomDetail({room:room.id}).messages.length,1);assert.deepEqual(wakes,['worker']);
 await fresh.sayInRoom(req);await fresh.retryRoomAttachmentDeliveries();assert.deepEqual(wakes,['worker']);await fresh.close();
});

test('unsupported Leader and corrupt bytes fail without sender publication; prepared pin survives restart',async t=>{
 const {nodes:[a,b],room}=await fixture(t);const ref=await upload(a,room);
 b.server=new MeshServer({describe:()=>({nodeId:b.nodeId,roomReferences:1}),secret:()=> 'secret',trustedPeers:()=>[],onMessage:e=>b.receive(e)});await b.server.listen(0);a.resolvePeers=()=>[{nodeId:b.nodeId,address:'127.0.0.1',httpPort:b.server.port}];
 await assert.rejects(a.sayInRoom({room:room.id,sessionId:'human',attachments:[ref],messageId:'unsupported'}),/support/);assert.equal(a.messages.length,0);
 const metadata=JSON.parse(await readFile(join(meshRootDir(a.config.port),'blobs','metadata.json'),'utf8'));assert.ok(metadata.blobs[ref.blobId].pins.length);
 await a.close();const fresh=new MeshNode({config:a.config});fresh.started=true;fresh.identity=a.identity;fresh.roomsDoc=a.roomsDoc;await fresh.roomAttachmentHandler();assert.equal(await fresh.blobStore.has(ref.blobId),true);await fresh.close();
 await writeFile(join(meshRootDir(a.config.port),'blobs',ref.blobId),'xxxxx');
 const corrupt=new MeshNode({config:a.config});corrupt.started=true;corrupt.identity=a.identity;corrupt.roomsDoc=a.roomsDoc;await assert.rejects(corrupt.roomAttachmentHandler(),/Corrupt/);await corrupt.close();
});

test('prepare, pin and sender commit write failures retain retryable intent and never publish early',async t=>{
 const {nodes:[a,b],room}=await fixture(t);await httpLeader(a,b);const ref=await upload(a,room);
 const req={room:room.id,sessionId:'human',attachments:[ref],messageId:'failure-boundaries'};
 const ledger=a.attachmentService.ledger,save=ledger.save.bind(ledger);let prepareFail=true;
 ledger.save=async fn=>{if(prepareFail){prepareFail=false;throw new Error('prepare write failure');}return save(fn);};
 await assert.rejects(a.sayInRoom(req),/prepare write/);assert.equal(a.messages.length,0);assert.equal(b.messages.length,0);
 const pin=a.blobStore.pin.bind(a.blobStore);let pinFail=true;a.blobStore.pin=async(...args)=>{if(pinFail){pinFail=false;throw new Error('pin write failure');}return pin(...args);};
 await assert.rejects(a.sayInRoom(req),/pin write/);assert.equal(a.messages.length,0);assert.equal(b.messages.length,0);
 let commitFail=true;ledger.save=async fn=>{const probe=structuredClone(ledger.data);fn(probe);if(commitFail&&Object.values(probe.messages).some(e=>e.status==='committed')){commitFail=false;throw new Error('commit write failure');}return save(fn);};
 await assert.rejects(a.sayInRoom(req),/commit write/);assert.equal(a.messages.length,0);assert.equal(b.messages.length,1);
 await a.close();const fresh=new MeshNode({config:a.config});fresh.started=true;fresh.identity=a.identity;fresh.roomsDoc=a.roomsDoc;fresh.resolvePeers=a.resolvePeers;
 assert.equal((await fresh.sayInRoom(req)).messageId,req.messageId);assert.equal(fresh.messages.length,1);assert.equal(b.messages.length,1);await fresh.close();
});
