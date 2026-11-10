import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {MeshNode} from '../lib/service.mjs';
import {meshRootDir} from '../lib/store.mjs';
import {registerAttachmentGateway} from '../lib/attachment-gateway.mjs';
const home=await mkdtemp(join(tmpdir(),'mesh-attachment-smoke-'));const prior=process.env.DSH_HOME;process.env.DSH_HOME=home;
const config={clusterSecret:'attachment-smoke',trustedPeers:[],autoWake:false,discoveryPort:47980};const open=[];
const make=async(name,port)=>{const n=new MeshNode({config:{...config,displayName:name,port}});open.push(n);await n.start();return n;};
const until=async predicate=>{const deadline=Date.now()+15000;while(!await predicate()){if(Date.now()>deadline)throw Error('discovery timed out');await new Promise(r=>setTimeout(r,100));}};
const route=node=>{let captured;registerAttachmentGateway({fetch:{register:r=>{captured=r;}}},node);return captured;};
try{
 let leader=await make('attachment-Leader',47981);const sender=await make('attachment-sender',47982);
 await until(()=>leader.peers().length&&sender.peers().length);
 const {room}=await leader.createRoom({name:'Attachment smoke',sessionId:'human'});await sender.syncRooms();await until(()=>sender.listRooms({all:true}).some(r=>r.id===room.id));await sender.joinRoom({room:room.id,sessionId:'human'});await leader.syncRooms();
 const bytes=Buffer.from(Array.from({length:65537},(_,i)=>(i*29)%256)),blobId=createHash('sha256').update(bytes).digest('hex');
 const gateway=route(sender),query=new URLSearchParams({room:room.id,blobId,name:'binary.bin',size:String(bytes.length)});
 const response=await gateway.fetch(new Request('http://owner/api/lan-mesh/attachments?'+query,{method:'POST',headers:{'content-type':'application/octet-stream'},body:Readable.toWeb(Readable.from([bytes.subarray(0,100),bytes.subarray(100)])),duplex:'half'}));assert.equal(response.status,200);const ref=await response.json();
 const request={room:room.id,sessionId:'human',text:'Binary',attachments:[ref],messageId:'online-binary'};
 assert.equal((await sender.sayInRoom(request)).durableNodes.length,2);
 for(const node of [sender,leader]){const metadata=JSON.parse(await readFile(join(meshRootDir(node.config.port),'blobs','metadata.json'),'utf8'));assert.ok(metadata.blobs[blobId].pins.length);const r=await route(node).fetch(new Request('http://owner/api/lan-mesh/attachments?'+query));assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);}
 await sender.sayInRoom(request);assert.equal(leader.roomDetail({room:room.id}).messages.filter(m=>m.id===request.messageId).length,1);
 console.log('PASS online streamed binary bytes/hash, sender + Leader pins, authorized received access, same-ID dedup');
 await leader.close();
 const offline={...request,messageId:'offline-binary'};
 await assert.rejects(sender.sayInRoom(offline),/Leader|leader/);assert.equal(sender.roomDetail({room:room.id}).messages.some(m=>m.id===offline.messageId),false);
 leader=await make('attachment-Leader',47981);await until(()=>sender.peers().some(p=>p.nodeId===leader.nodeId));await sender.retryRoomAttachmentDeliveries();
 await until(()=>leader.roomDetail({room:room.id}).messages.some(m=>m.id===offline.messageId));assert.equal((await sender.sayInRoom(offline)).messageId,offline.messageId);assert.equal(leader.roomDetail({room:room.id}).messages.filter(m=>m.id===offline.messageId).length,1);
 const read=await route(leader).fetch(new Request('http://owner/api/lan-mesh/attachments?'+query));assert.deepEqual(Buffer.from(await read.arrayBuffer()),bytes);
 console.log('PASS actual offline Leader restart + recovery, retained bytes, stable retry, received download');
 // A member that joins only after the original sender is gone must obtain the
 // authorized reference from the Leader through the signed manifest channel
 // (never by hand-injecting a ledger) and then download verified bytes.
 await sender.close();
 const late=await make('attachment-late',47983);await until(()=>late.peers().length>0);
 await late.syncRooms();await until(()=>late.listRooms({all:true}).some(r=>r.id===room.id));
 await late.joinRoom({room:room.id,sessionId:'human'});
 await until(()=>late.roomDetail({room:room.id}).messages.some(m=>m.id===request.messageId));
 const chunks=[];for await(const chunk of await late.readRoomAttachment({room:room.id,sessionId:'human',blobId}))chunks.push(Buffer.from(chunk));
 assert.deepEqual(Buffer.concat(chunks),bytes);
 const lateMeta=JSON.parse(await readFile(join(meshRootDir(late.config.port),'blobs','metadata.json'),'utf8'));
 assert.ok(lateMeta.blobs[blobId].pins.length,'fetched committed bytes stay pinned against orphan GC');
 const lateRead=await route(late).fetch(new Request('http://owner/api/lan-mesh/attachments?'+query));assert.deepEqual(Buffer.from(await lateRead.arrayBuffer()),bytes);
 console.log('PASS late member synced authorized history from the Leader after the sender left, verified and pinned the bytes');
}finally{for(const node of open)await node.close();if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;await rm(home,{recursive:true,force:true});}
