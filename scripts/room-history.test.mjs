import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as store from '../lib/store.mjs';
async function setup(t){const before=process.env.DSH_HOME;const home=await mkdtemp(join(tmpdir(),'mesh-page-'));process.env.DSH_HOME=home;t.after(async()=>{if(before===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=before;await rm(home,{recursive:true,force:true});});return home;}
const record=(id,room='a',node='n')=>({envelope:{id,room,kind:'room-message',from:{nodeId:node,sessionId:'human'},text:id,sentAt:'2026-11-15T00:00:00Z'},receivedAt:'2026-11-15T00:00:00Z',read:false});
test('durable history pages older than memory window and filters exact room before paging',async t=>{
 await setup(t);assert.equal(typeof store.readRoomHistory,'function');
 for(let i=0;i<620;i++)await store.appendInbox(record(String(i),i%2?'b':'a'),{port:0});
 let cursor='',ids=[];do{const page=await store.readRoomHistory({port:0,room:'a',cursor,limit:70});ids.unshift(...page.records.map(row=>row.envelope.id));cursor=page.cursor;}while(cursor);
 assert.equal(ids.length,310);assert.equal(new Set(ids).size,310);assert.equal(ids[0],'0');assert.equal(ids.at(-1),'618');
});
test('history cursors bind room and exact source and survive new append',async t=>{
 await setup(t);assert.equal(typeof store.readRoomHistory,'function');
 for(const row of [record('same','a','n1'),record('same','a','n2'),record('last')])await store.appendInbox(row,{port:0});
 const page=await store.readRoomHistory({port:0,room:'a',limit:1});assert.equal(page.records[0].envelope.id,'last');await store.appendInbox(record('new'),{port:0});
 const older=await store.readRoomHistory({port:0,room:'a',cursor:page.cursor,limit:2});assert.deepEqual(older.records.map(r=>r.envelope.from.nodeId),['n1','n2']);assert.equal(older.cursor,'');
 await assert.rejects(store.readRoomHistory({port:0,room:'b',cursor:page.cursor}),/cursor/i);await assert.rejects(store.readRoomHistory({port:0,room:'a',cursor:'bad'}),/cursor/i);
});
import { MeshNode } from '../lib/service.mjs';
import {emptyState,createRoom} from '../lib/rooms.mjs';
import {randomUUID} from 'node:crypto';
test('local history requires owner panel and eligible human membership, including archived rooms',async t=>{
 await setup(t);const node=new MeshNode({config:{port:0,autoWake:false}});node.identity={nodeId:'local',name:'Local'};node.started=true;node.roomsDoc=emptyState();const room=createRoom(node.roomsDoc,{name:'History',leader:{nodeId:'local',sessionId:'human'}},randomUUID);
 await store.appendInbox(record('historic',room.id),{port:0});
 assert.equal(typeof node.roomHistory,'function');await assert.rejects(node.roomHistory({room:room.id,sessionId:'human'}),/panel/i);
 const page=await node.roomHistory({room:room.id,sessionId:'human',via:'panel'});assert.equal(page.messages[0].id,'historic');
 await assert.rejects(node.roomHistory({room:room.id,sessionId:'agent',via:'panel'}),/human/i);
 room.members=[];await assert.rejects(node.roomHistory({room:room.id,sessionId:'human',via:'panel'}),/member/i);
 room.lifecycle={status:'archived'};room.participants={'local/human':true};assert.equal((await node.roomHistory({room:room.id,sessionId:'human',via:'panel'})).messages.length,1);
});

test('history rechecks human eligibility after asynchronous disk reading',async t=>{
 await setup(t);const node=new MeshNode({config:{port:0,autoWake:false}});node.identity={nodeId:'local',name:'Local'};node.started=true;node.roomsDoc=emptyState();const room=createRoom(node.roomsDoc,{name:'Revoked history',leader:{nodeId:'local',sessionId:'human'}},randomUUID);
 await store.appendInbox(record('private',room.id),{port:0});const pending=node.roomHistory({room:room.id,sessionId:'human',via:'panel'});room.members=[];
 await assert.rejects(pending,/member|eligib/i);
});

test('restart preserves durable arrival order even when late records have older timestamps',async t=>{
 await setup(t);let node=new MeshNode({config:{port:0,discoveryPort:0,autoWake:false,clusterSecret:'',trustedPeers:[]}});await node.start();const created=await node.createRoom({name:'Arrival order',sessionId:'human'});await node.close();
 await store.appendInbox({...record('arrived-first',created.room.id),receivedAt:300},{port:0});await store.appendInbox({...record('late-old',created.room.id),receivedAt:100},{port:0});
 node=new MeshNode({config:{port:0,discoveryPort:0,autoWake:false,clusterSecret:'',trustedPeers:[]}});await node.start();try{assert.deepEqual(node.roomDetail({room:created.room.id,sessionId:'human'}).messages.map(row=>row.id),['arrived-first','late-old']);}finally{await node.close();}
});
