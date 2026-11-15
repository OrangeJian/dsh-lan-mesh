import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRoomTranscript} from '../ui/models/room-history.mjs';
test('history prepends without duplicates and authoritative recent rows retain metadata',()=>{
 const row=(id,node='n',extra={})=>({id,from:{nodeId:node},...extra});
 const earlier=[row('a'),row('b')],recent=[row('b','n',{read:true}),row('c'),row('b','other')];
 const result=mergeRoomTranscript(earlier,recent);assert.deepEqual(result.map(r=>r.id),['a','b','c','b']);assert.equal(result[1].read,true);assert.equal(result[3].from.nodeId,'other');assert.equal(earlier.length,2);
});
