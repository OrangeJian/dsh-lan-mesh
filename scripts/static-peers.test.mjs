import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaticPeers,peerCandidates } from '../lib/static-peers.mjs';
import { MeshNode } from '../lib/service.mjs';
import { MeshServer } from '../lib/transport.mjs';
import { emptyState,createRoom,mergeStates } from '../lib/rooms.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
test('static endpoints are bounded, explicit, unique and never replace trust',()=>{
 const peers=normalizeStaticPeers([{nodeId:'node-b',address:'192.168.1.2',httpPort:45871}]);
 assert.equal(peers[0].name,'node-b');assert.equal(peers[0].source,'static');
 for(const address of ['http://host','host/path','user@host','::1','a?x','bad host'])assert.throws(()=>normalizeStaticPeers([{nodeId:'b',address,httpPort:2}]),/STATIC_PEER/);
 assert.throws(()=>normalizeStaticPeers([{nodeId:'b',address:'host',httpPort:0}]),/STATIC_PEER/);
 assert.throws(()=>normalizeStaticPeers([{nodeId:'b',address:'host',httpPort:2},{nodeId:'b',address:'other',httpPort:2}]),/STATIC_PEER/);
 assert.throws(()=>normalizeStaticPeers(Array.from({length:65},(_,i)=>({nodeId:`n${i}`,address:'host',httpPort:i+1}))),/STATIC_PEER/);
 assert.equal(peers[0].trusted,undefined);
 const merged=peerCandidates([{nodeId:'node-b',address:'attacker',httpPort:1},{nodeId:'node-c',address:'other',httpPort:3}],peers,'self');
 assert.equal(merged.find(row=>row.nodeId==='node-b').address,'192.168.1.2');assert.equal(merged.length,2);
 assert.equal(peerCandidates([],peers,'node-b').length,0);
});

test('a failed static target retains dirty state and receives local history after recovery',async t=>{
 const home=await mkdtemp(join(tmpdir(),'mesh-static-retry-')),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const states={b:emptyState(),c:emptyState()};let cIdentity='wrong-c';
 const make=key=>new MeshServer({describe:()=>({nodeId:key==='c'?cIdentity:'node-b'}),secret:()=> 'secret',trustedPeers:()=>['node-a'],onState:async request=>{
  if(request.pull)return {state:states[key]};const result=mergeStates(states[key],request.state);states[key]=result.state;return {changed:result.changed};
 }});
 const b=make('b'),c=make('c');await b.listen(0);await c.listen(0);
 const node=new MeshNode({config:{port:0,clusterSecret:'secret',trustedPeers:[],staticPeers:[{nodeId:'node-b',address:'127.0.0.1',httpPort:b.port},{nodeId:'node-c',address:'127.0.0.1',httpPort:c.port}]},log:()=>{}});
 node.started=true;node.identity={nodeId:'node-a',name:'A'};
 t.after(async()=>{await node.close();await b.close();await c.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(home,{recursive:true,force:true});});
 const room=createRoom(node.roomsDoc,{name:'Local new room',leader:{nodeId:'node-a',sessionId:'human',nodeName:'A'}},randomUUID);node.roomsDirty=false;
 await node.syncRooms();assert.equal(node.roomsDirty,true,'one failed peer must keep the local update retryable');
 assert.ok(states.b.rooms[room.id]);assert.equal(states.c.rooms[room.id],undefined);
 cIdentity='node-c';await node.syncRooms();assert.ok(states.c.rooms[room.id]);assert.equal(node.roomsDirty,false);
});

test('no broadcast: static peer synchronizes only after signed matching identity; configuration grants no trust',async t=>{
 const home=await mkdtemp(join(tmpdir(),'mesh-static-')),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
 let remote=emptyState(),remoteId='node-b',trusted=['node-a'],pushes=0,received=0;
 const room=createRoom(remote,{name:'Existing remote room',leader:{nodeId:'node-b',sessionId:'human'}},randomUUID);
 const server=new MeshServer({describe:()=>({nodeId:remoteId,roomLifecycleVersion:1}),secret:()=> 'secret',trustedPeers:()=>trusted,onMessage:async()=>{received++;return {};},onState:async payload=>{
  if(payload.pull)return {state:remote};pushes++;const result=mergeStates(remote,payload.state);remote=result.state;return {changed:result.changed};
 }});
 const port=await server.listen(0);
 const node=new MeshNode({config:{port:0,clusterSecret:'secret',trustedPeers:[],staticPeers:[{nodeId:'node-b',address:'127.0.0.1',httpPort:port}]},log:()=>{}});
 node.started=true;node.identity={nodeId:'node-a',name:'A'};
 t.after(async()=>{await node.close();await server.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(home,{recursive:true,force:true});});
 assert.equal(node.discovery,undefined);assert.equal(node.peers().length,0);
 assert.equal(node.resolvePeers('node-b').length,1);
 remoteId='wrong-node';let sync=await node.syncRooms();
 assert.equal(sync.synced[0].ok,false);assert.equal(node.peers().length,0);assert.equal(pushes,0);
 assert.equal(node.listRooms({all:true}).some(row=>row.id===room.id),false);
 const failedSend=await node.send({target:'node-b',text:'must not reach the wrong identity'});
 assert.equal(failedSend.delivered[0].ok,false);assert.equal(received,0);
 remoteId='node-b';sync=await node.syncRooms();
 assert.equal(sync.synced[0].ok,true);assert.equal(node.peers().length,1);
 assert.equal(node.describe().peers,1);
 assert.equal(node.listRooms({all:true}).some(row=>row.id===room.id),true);
 node.staticSeen.set('node-b',Date.now()-20001);assert.equal(node.peers().length,0,'online projection expires without inventing health');
 const trustedBefore=[...node.config.trustedPeers];
 trusted=['not-node-a'];sync=await node.syncRooms();
 assert.equal(sync.synced[0].ok,false);assert.equal(node.peers().length,0);
 assert.deepEqual(node.config.trustedPeers,trustedBefore);
 assert.equal(node.resolvePeers('node-b').length,1,'failed probes retain configured target for retry');
});
