import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyState, createRoom, joinRoom, leaveRoom, mergeStates, normalizeState } from '../lib/rooms.mjs';
import { setLifecycle, archived } from '../lib/room-lifecycle.mjs';
import { MeshNode } from '../lib/service.mjs';
import { signStatePayload,verifyStatePayload,MeshServer,pullStateFromPeer } from '../lib/transport.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoomState } from '../lib/store.mjs';

test('archive is reversible, audited and cannot be undone by legacy state',()=>{
 const state=emptyState();const room=createRoom(state,{name:'Lifecycle',leader:{nodeId:'a',sessionId:'human'}},randomUUID);
 joinRoom(state,room.id,{nodeId:'b',sessionId:'human'});
 const old=structuredClone(state);
 setLifecycle(room,{actorKey:'a/human',status:'archived',eventId:'archive-1',baseGeneration:0});
 assert.equal(archived(room),true);assert.equal(room.deleted,false);
 assert.equal(mergeStates(state,old).state.rooms[room.id].lifecycle.status,'archived');
 assert.equal(mergeStates(old,state).state.rooms[room.id].lifecycle.status,'archived');
 const restarted=normalizeState(state).rooms[room.id];
 assert.equal(restarted.lifecycleEvents.length,1);
 assert.throws(()=>setLifecycle(restarted,{actorKey:'b/human',status:'active',eventId:'bad',baseGeneration:1}),/Leader/);
 setLifecycle(restarted,{actorKey:'a/human',status:'active',eventId:'restore-1',baseGeneration:1});
 assert.equal(archived(restarted),false);assert.equal(restarted.lifecycle.generation,2);
 assert.equal(restarted.lifecycleEvents.length,2);
 assert.throws(()=>setLifecycle(restarted,{actorKey:'a/human',status:'archived',eventId:'stale',baseGeneration:0}),/changed/);
});

test('human historical qualification survives departure and merge, agent does not qualify',()=>{
 const state=emptyState();const room=createRoom(state,{name:'History',leader:{nodeId:'a',sessionId:'human'}},randomUUID);
 joinRoom(state,room.id,{nodeId:'b',sessionId:'human'});
 joinRoom(state,room.id,{nodeId:'b',sessionId:'agent'});
 const old=structuredClone(state);
 leaveRoom(state,room.id,'b/human','2099-01-01T00:00:00.000Z');
 const merged=mergeStates(state,old).state.rooms[room.id];
 assert.equal(merged.participants['b/human'],true);
 assert.equal(merged.participants['b/agent'],undefined);
 assert.equal(merged.members.some(m=>m.key==='b/human'),false);
});

test('archived state authenticates lifecycle and blocks all new room execution entrances',async()=>{
 const state=emptyState();const room=createRoom(state,{name:'Read only',leader:{nodeId:'a',sessionId:'human'}},randomUUID);
 setLifecycle(room,{actorKey:'a/human',status:'archived',eventId:'seal',baseGeneration:0});
 const packet={v:2,id:'signed',from:{nodeId:'a'},sentAt:'now',state};packet.sig=signStatePayload(packet,'secret');
 assert.equal(verifyStatePayload(packet,'secret'),true);
 packet.state.rooms[room.id].lifecycle.status='active';
 assert.equal(verifyStatePayload(packet,'secret'),false);
 packet.state.rooms[room.id].lifecycle.status='archived';
 const node=new MeshNode({config:{port:0,clusterSecret:''}});node.started=true;node.identity={nodeId:'a',name:'A'};node.roomsDoc=state;
 for(const operation of [()=>node.sayInRoom({room:room.id,sessionId:'human',text:'No'}),()=>node.assignTask({room:room.id,sessionId:'human'}),()=>node.joinRoom({room:room.id,sessionId:'new'}),()=>node.renameRoom({room:room.id,sessionId:'human',name:'No'}),()=>node.addRoomMember({room:room.id,via:'panel',memberSessionId:'x'}),()=>node.uploadRoomAttachment({room:room.id}),()=>node.receive({room:room.id,kind:'room-message'})])await assert.rejects(operation(),/archived/);
 assert.equal(node.snapshot({sessionId:'human'}).rooms.archived.length,1);
 assert.equal(node.snapshot({sessionId:'human'}).rooms.mine.length,0);
 assert.throws(()=>node.roomDetail({room:room.id,sessionId:'agent'}),/participating humans/);
 assert.equal(node.roomDetail({room:room.id,sessionId:'human'}).room.lifecycle.status,'archived');
});

test('real signed archive sync persists and rejects old peers and tampered replies',async t=>{
 const home=await mkdtemp(join(tmpdir(),'mesh-lifecycle-')),prior=process.env.DSH_HOME;
 process.env.DSH_HOME=home;
 t.after(async()=>{if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;await rm(home,{recursive:true,force:true});});
 const state=emptyState(),room=createRoom(state,{name:'Synced',leader:{nodeId:'a',sessionId:'human'}},randomUUID);
 joinRoom(state,room.id,{nodeId:'b',sessionId:'human'});
 let replica=structuredClone(state),capability=0;
 const server=new MeshServer({describe:()=>({nodeId:'b',roomLifecycleVersion:capability}),secret:()=> 'secret',trustedPeers:()=>[],onState:async payload=>{
  if(payload.pull)return {state:replica};
  const merged=mergeStates(replica,payload.state);replica=merged.state;return {changed:merged.changed};
 }});
 const port=await server.listen(0);t.after(()=>server.close());
 const node=new MeshNode({config:{port:39869,clusterSecret:'secret'},log:()=>{}});node.started=true;node.identity={nodeId:'a',name:'A'};node.roomsDoc=state;
 node.discovery={list:()=>[{nodeId:'b',name:'B',address:'127.0.0.1',httpPort:port}]};
 const archive={roomId:room.id,status:'archived',baseGeneration:0,requestId:'http-archive',via:'panel'};
 await assert.rejects(node.setRoomLifecycle(archive),/upgrade/);
 assert.equal(archived(room),false);
 capability=1;
 await node.setRoomLifecycle(archive);
 assert.equal(archived(replica.rooms[room.id]),true);
 assert.equal(archived((await loadRoomState({port:39869})).rooms[room.id]),true);
 const request={address:'127.0.0.1',port,secret:'secret',fromNodeId:'a'};
 assert.equal(archived((await pullStateFromPeer(request)).state.rooms[room.id]),true);
 const originalFetch=globalThis.fetch;
 try{
  globalThis.fetch=async(...args)=>{const response=await originalFetch(...args),body=await response.json();body.state.rooms[room.id].lifecycle.status='active';return new Response(JSON.stringify(body),{status:200});};
  await assert.rejects(pullStateFromPeer(request),/signature/);
  globalThis.fetch=async(...args)=>{const response=await originalFetch(...args),body=await response.json();delete body.node.roomLifecycleVersion;delete body.state.rooms[room.id].lifecycle;delete body.lifecycleProof;body.state.rooms[room.id].name='forged';return new Response(JSON.stringify(body),{status:200});};
  await assert.rejects(pullStateFromPeer(request),/signature/);
 }finally{globalThis.fetch=originalFetch;}
 await node.setRoomLifecycle({...archive,status:'active',baseGeneration:1,requestId:'http-restore'});
 assert.equal(archived(replica.rooms[room.id]),false);
 assert.equal(replica.rooms[room.id].lifecycle.generation,2);
});
