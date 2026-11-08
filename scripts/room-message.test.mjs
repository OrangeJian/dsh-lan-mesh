import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../lib/room-message.mjs').catch(() => ({}));
const room = { members: [{key:'node-a/session-a'}, {key:'node-b/session-b'}] };
test('normalizer validates exact room identities and deterministic duplicates', () => {
  assert.equal(typeof api.normalizeRoomMessageMetadata, 'function');
  const m = {memberKey:'node-b/session-b', label:'Same'};
  assert.deepEqual(api.normalizeRoomMessageMetadata({mentions:[m,m],skillRefs:[{name:'review',sourceNodeId:'elsewhere',sourceNodeName:'Remote'}]},room), {mentions:[m],skillRefs:[{name:'review',sourceNodeId:'elsewhere',sourceNodeName:'Remote'}]});
});
test('normalizer distinguishes absent and explicit empty mentions', () => {
  assert.equal(typeof api.normalizeRoomMessageMetadata, 'function');
  assert.deepEqual(api.normalizeRoomMessageMetadata({},room), {});
  assert.deepEqual(api.normalizeRoomMessageMetadata({mentions:[]},room), {mentions:[]});
});
test('normalizer rejects wrong members, malformed values and oversized metadata', () => {
  assert.equal(typeof api.normalizeRoomMessageMetadata, 'function');
  for (const value of [{mentions:null},{mentions:['Same']},{mentions:[{memberKey:'other',label:'Same'}]},{mentions:[{memberKey:'node-a/session-a',label:'x'.repeat(257)}]},{mentions:Array(65).fill({memberKey:'node-a/session-a',label:'Same'})},{skillRefs:[{name:'',sourceNodeId:'a',sourceNodeName:'A'}]},{skillRefs:Array(33).fill({name:'review',sourceNodeId:'a',sourceNodeName:'A'})}]) {
    assert.throws(() => api.normalizeRoomMessageMetadata(value,room), /metadata|mention|skill|member/i);
  }
});
import { MeshNode } from '../lib/service.mjs';
import { MeshServer, normalizeEnvelope, signingInput, signEnvelope, verifyEnvelope, deliverToPeer } from '../lib/transport.mjs';
import { emptyState, createRoom, joinRoom } from '../lib/rooms.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInbox } from '../lib/store.mjs';

const refs = { mentions:[{memberKey:'node-b/session-b',label:'Same'}], skillRefs:[{name:'not-installed',sourceNodeId:'node-z',sourceNodeName:'Remote'}] };
const envelope = () => ({v:2,id:crypto.randomUUID(),from:{nodeId:'node-a',sessionId:'session-a'},to:'node-b',kind:'room-message',room:'room-aaaaaaaaaaaa',text:'@Same /not-installed hello',sentAt:'2026-11-08T00:00:00Z'});
test('reference signature extension survives normalization and detects routing/source tampering', () => {
  const legacy = envelope();
  assert.equal(signingInput(legacy).split('\n').length,9);
  const extended = {...legacy,...refs,referencesVersion:1};
  extended.sig = signEnvelope(extended,'secret');
  assert.deepEqual(normalizeEnvelope(extended).mentions,refs.mentions);
  assert.equal(verifyEnvelope(normalizeEnvelope(extended),'secret'),true);
  for (const mutation of [{mentions:[]},{mentions:[{memberKey:'node-c/session-c',label:'Same'}]},{skillRefs:[]},{from:{nodeId:'node-a',sessionId:'another'}},{referencesVersion:undefined,mentions:undefined,skillRefs:undefined}]) {
    assert.equal(verifyEnvelope({...extended,...mutation},'secret'),false);
  }
  assert.throws(() => normalizeEnvelope({...legacy,...refs}), /version|reference/i);
});

test('service exact mentions control wake, inbox attention, unread and persistence on three same-named nodes', async t => {
  const home = await mkdtemp(join(tmpdir(),'room-refs-'));
  const previous = process.env.DSH_HOME; process.env.DSH_HOME=home;
  t.after(async()=> {if(previous===undefined) delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(home,{recursive:true,force:true});});
  const state = emptyState();
  const r = createRoom(state,{name:'References',leader:{nodeId:'node-a',sessionId:'session-a',name:'Same'}},()=> 'aaaaaaaaaaaa-1111-2222-3333-444444444444');
  for(const suffix of ['b','c']) joinRoom(state,r.id,{nodeId:`node-${suffix}`,sessionId:`session-${suffix}`,name:'Same'});
  for(const suffix of ['a','b','c']) {
    const woke=[];
    const node=new MeshNode({config:{port:0,autoWake:true,clusterSecret:''},agents:{get:id=>({session:{id,title:'Same'},followup:()=>woke.push(id)}),list:()=>[]}});
    node.started=true;node.identity={nodeId:`node-${suffix}`,name:`Node ${suffix}`};node.roomsDoc=structuredClone(state);
    assert.equal(node.describe().roomReferences,1);
    await node.receive({...envelope(),room:r.id,...refs});
    assert.deepEqual(woke,suffix==='b'?['session-b']:[]);
    assert.equal(node.inbox({attentionOnly:true,sessionId:`session-${suffix}`}).messages.length,suffix==='b'?1:0);
    assert.equal(node.snapshot({sessionId:`session-${suffix}`}).rooms.unread[r.id] ?? 0,suffix==='b'?1:0);
    assert.deepEqual(node.roomDetail({room:r.id}).messages[0].structuredMentions,refs.mentions);
    assert.deepEqual(node.inbox().messages[0].skillRefs,refs.skillRefs);
    await node.receive({...envelope(),room:r.id,mentions:[]});
    assert.equal(woke.length,suffix==='b'?1:0);
    await node.receive({...envelope(),room:r.id});
    assert.equal(woke.length,suffix==='a'?0:suffix==='b'?2:1);
    await assert.rejects(node.receive({...envelope(),room:r.id,mentions:[{memberKey:'wrong/member',label:'Same'}]}),/member/);
    await assert.rejects(node.receive({...envelope(),room:'room-unknown',...refs}),/room/i);
    await assert.rejects(node.receive({...envelope(),room:r.id,from:{nodeId:'outsider',sessionId:'session-a'},...refs}),/sender|member/);
    node.markAllRead();
    let stored=[];
    for(let attempt=0;attempt<100;attempt++) {
      stored=await readInbox({port:0,limit:100});
      if(stored.length===3 && stored.every(record=>record.read===true)) break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(stored.length,3);
    assert.ok(stored.every(record=>record.read===true));
    assert.ok(stored.some(record=>record.envelope.mentions?.[0]?.memberKey==='node-b/session-b'));
    assert.ok(stored.some(record=>record.envelope.skillRefs?.[0]?.name==='not-installed'));
  }
});

test('HTTP reference delivery negotiates capability and rejects legacy exact routing',async t=>{
 const received=[];
 const server=new MeshServer({describe:()=>({nodeId:'node-b',roomReferences:1}),secret:()=> 'secret',trustedPeers:()=>[],onMessage:async e=>{received.push(e);return {receivedAt:'now'};}});
 const port=await server.listen(0);t.after(()=>server.close());
 await deliverToPeer({address:'127.0.0.1',port,secret:'secret',envelope:{...envelope(),...refs}});
 assert.deepEqual(received[0].mentions,refs.mentions);
 const tampered={...envelope(),...refs,referencesVersion:1};tampered.sig=signEnvelope(tampered,'secret');tampered.mentions=[];
 const answer=await fetch(`http://127.0.0.1:${port}/lan-mesh/v1/send-references`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(tampered)});
 assert.equal(answer.status,401);assert.equal(received.length,1);
 const old=new MeshServer({describe:()=>({nodeId:'old'}),secret:()=> 'secret',trustedPeers:()=>[],onMessage:async e=>{received.push(e);return {};}});
 const oldPort=await old.listen(0);t.after(()=>old.close());
 await assert.rejects(deliverToPeer({address:'127.0.0.1',port:oldPort,secret:'secret',envelope:{...envelope(),...refs}}),/support/i);
 assert.equal(received.length,1);
 await deliverToPeer({address:'127.0.0.1',port:oldPort,secret:'secret',envelope:{...envelope(),skillRefs:refs.skillRefs}});
 assert.equal(received[1].skillRefs,undefined);assert.match(received[1].text,/not-installed/);
});
