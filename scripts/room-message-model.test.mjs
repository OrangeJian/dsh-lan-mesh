import test from 'node:test';
import assert from 'node:assert/strict';
import { roomMessageRows } from '../ui/models/room-message-model.mjs';
const row=(id,second=0,extra={})=>({id,kind:'room-message',from:{nodeId:'n1',sessionId:'s1',title:'Same'},sentAt:new Date(Date.UTC(2026,10,15,10,0,second)).toISOString(),text:'hello\nworld',...extra});
test('adjacent exact authors group up to three minutes without mutating or sorting',()=>{
 const input=[row('a'),row('b',180),row('c',361)];const before=structuredClone(input);const out=roomMessageRows(input);
 assert.deepEqual(out.map(r=>r.continuation),[false,true,false]);assert.equal(out[1].message,input[1]);assert.deepEqual(input,before);
});
test('same names across devices or sessions never group, including missing identities',()=>{
 for(const from of [{nodeId:'n2',sessionId:'s1',title:'Same'},{nodeId:'n1',sessionId:'s2',title:'Same'},{nodeId:'n1'},{sessionId:'s1'},{}]) assert.equal(roomMessageRows([row('a'),row('b',1,{from})])[1].continuation,false);
});
test('events, unknown kinds and all reference/attachment boundaries break groups',()=>{
 for(const extra of [{kind:'room-task'},{kind:'other'},{skillRefs:[{name:'test'}]},{documentRefs:[{documentId:'d'}]},{structuredMentions:[{memberKey:'n/s'}]},{mentions:[{memberKey:'n/s'}]},{attachments:[{blobId:'b'}]},{file:{name:'old.txt'}}]){
 const out=roomMessageRows([row('a'),row('b',1,extra),row('c',2)]);assert.equal(out[1].continuation,false);assert.equal(out[2].continuation,false);
 }
});
test('invalid time, reverse time and day boundary never group',()=>{
 for(const sentAt of ['',null,'invalid','2026-11-15T09:59:59Z','2026-11-16T10:00:00Z'])assert.equal(roomMessageRows([row('a'),row('b',1,{sentAt})])[1].continuation,false);
 assert.equal(roomMessageRows([row('a',0,{sentAt:new Date(2026,10,15,23,59).toISOString()}),row('b',0,{sentAt:new Date(2026,10,16,0,0).toISOString()})])[1].continuation,false);
});
test('device labels use trusted display fields, always disambiguated by full node id',()=>{
 const messages=[row('a'),row('b',1,{from:{nodeId:'n2',sessionId:'human',name:'Author name'}}),row('c',2,{from:{}})];
 const out=roomMessageRows(messages,{self:{nodeId:'n1',name:'Workstation'},members:[],peers:[{nodeId:'n2',name:'Workstation'}]});
 assert.equal(out[0].deviceLabel,'Workstation · n1');assert.equal(out[1].deviceLabel,'Workstation · n2');assert.equal(out[1].kind,'human');assert.equal(out[2].deviceLabel,'来源设备未知');
 assert.equal(roomMessageRows([messages[1]])[0].deviceLabel,'n2');
});
test('timestamp priority matches existing Room display and exact value is retained',()=>{
 const raw=row('a',0,{at:'2026-11-15T10:01:00.123Z',receivedAt:'bad'});assert.equal(roomMessageRows([raw])[0].timestamp,raw.at);
 assert.deepEqual(roomMessageRows(null),[]);
});
