import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomTimeline } from '../ui/models/room-timeline.mjs';
const rows=(...ids)=>ids.map(id=>({id}));
test('initial snapshot follows latest and near-bottom scroll follows new arrivals',()=>{
 const t=createRoomTimeline();assert.deepEqual(t.update(rows('a','b')),{follow:true,pending:0,top:0});
 t.observe({scrollTop:760,scrollHeight:1000,clientHeight:200});assert.equal(t.update(rows('a','b','c')).follow,true);
});
test('reading history never follows append and repeated polls do not inflate pending',()=>{
 const t=createRoomTimeline();t.update(rows('a','b'));t.observe({scrollTop:100,scrollHeight:1000,clientHeight:200});
 assert.deepEqual(t.update(rows('a','b','c')),{follow:false,pending:1,top:100});assert.equal(t.update(rows('a','b','c')).pending,1);
 assert.equal(t.update(rows('a','b','c','d')).pending,2);assert.equal(t.jump().pending,0);assert.equal(t.update(rows('b','c','d','e')).follow,true);
});
test('history prepend is not a new arrival and fixed-size windows count new tail ids',()=>{
 const t=createRoomTimeline();t.update(rows('b','c'));t.observe({scrollTop:20,scrollHeight:900,clientHeight:200});
 assert.equal(t.update(rows('a','b','c')).pending,0);assert.equal(t.update(rows('b','c','d')).pending,1);
});
test('scrolling to latest clears local count and duplicates or idless rows never inflate it',()=>{
 const t=createRoomTimeline();t.update(rows('a'));t.observe({scrollTop:0,scrollHeight:800,clientHeight:200});
 assert.equal(t.update([...rows('a','b','b'),{},{}]).pending,1);
 assert.equal(t.observe({scrollTop:600,scrollHeight:800,clientHeight:200}).pending,0);
});
test('empty initial successful view follows later first arrival, clearing view does not invent unread',()=>{
 const t=createRoomTimeline();t.update([]);assert.equal(t.update(rows('a')).follow,true);
 t.observe({scrollTop:0,scrollHeight:800,clientHeight:200});t.update(rows('a','b'));assert.equal(t.update([]).pending,0);
});

test('visible message anchor survives history prepend and delayed image layout above it',()=>{
 const t=createRoomTimeline();t.update(rows('a','b'));let anchorTop=60;
 const anchor={getAttribute:()=> 'b',getBoundingClientRect:()=>({top:anchorTop,bottom:anchorTop+50})};
 const node={scrollTop:200,scrollHeight:1000,clientHeight:300,getBoundingClientRect:()=>({top:40}),querySelectorAll:()=>[anchor]};
 t.observe(node);anchorTop=160;t.restore(node);assert.equal(node.scrollTop,300);
 anchorTop=110;t.restore(node);assert.equal(node.scrollTop,350);
});
test('missing anchor restores saved offset and follow mode never applies an old anchor',()=>{
 const t=createRoomTimeline();t.update(rows('a'));const node={scrollTop:100,scrollHeight:1000,clientHeight:300};t.observe(node);
 const replacement={scrollTop:0,scrollHeight:1000,clientHeight:300};t.restore(replacement);assert.equal(replacement.scrollTop,100);
 t.jump();replacement.scrollTop=20;t.restore(replacement);assert.equal(replacement.scrollTop,20);
});
