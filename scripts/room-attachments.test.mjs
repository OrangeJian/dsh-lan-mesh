import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { MeshNode } from '../lib/service.mjs';
import { MeshServer } from '../lib/transport.mjs';
import { emptyState, createRoom, joinRoom } from '../lib/rooms.mjs';
import { meshRootDir } from '../lib/store.mjs';

async function fixture(t) {
 const home=await mkdtemp(join(process.cwd(),'.attachment-test-')); const prev=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const state=emptyState();const room=createRoom(state,{name:'Files',leader:{nodeId:'node-b',sessionId:'human',name:'B'}},()=> 'aaaaaaaaaaaa-1111-2222-3333-444444444444');
 joinRoom(state,room.id,{nodeId:'node-a',sessionId:'human',name:'A'});
 const nodes=['a','b'].map((s,i)=>{const n=new MeshNode({config:{port:39001+i,clusterSecret:'secret',trustedPeers:[],autoWake:false}});n.started=true;n.identity={nodeId:`node-${s}`,name:s};n.roomsDoc=structuredClone(state);return n;});
 t.after(async()=>{for(const n of nodes)await n.server?.close();if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;await rm(home,{recursive:true,force:true});});
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
});

test('offline Leader fails without publishing and retains prepared upload',async t=>{
 const {nodes:[a],room}=await fixture(t);const ref=await upload(a,room);a.resolvePeers=()=>[];
 await assert.rejects(a.sayInRoom({room:room.id,sessionId:'human',attachments:[ref],messageId:'offline'}),/Leader|leader/);
 assert.equal(a.roomDetail({room:room.id}).messages.length,0);
 assert.equal(await a.blobStore.has(ref.blobId),true);
});

