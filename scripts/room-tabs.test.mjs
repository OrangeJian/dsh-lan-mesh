import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomTabs} from '../ui/room/room-tabs.mjs';
const h=(type,props,...children)=>({type,props:props??{},children:children.flat()});
test('four room tabs expose selected state, bounded counts and accessible panel relationships',()=>{
 const tree=RoomTabs({h,value:'chat',prefix:'room-a',tasks:3,members:4,onSelect(){}});assert.equal(tree.props.role,'tablist');assert.equal(tree.children.length,4);
 assert.deepEqual(tree.children.map(n=>n.props['data-tab']),['chat','docs','tasks','members']);assert.equal(tree.children[0].props.tabIndex,0);assert.equal(tree.children[1].props.tabIndex,-1);assert.ok(tree.children[2].children.some(x=>String(x).includes('3')));
});
test('keyboard arrows and Home/End select and focus exact peer tab without global DOM access',()=>{
 const selected=[],focused=[];const tree=RoomTabs({h,value:'docs',prefix:'r',onSelect:id=>selected.push(id)});const buttons=tree.children.map((_,i)=>({focus:()=>focused.push(i)}));let prevented=0;
 const event=key=>({key,preventDefault:()=>prevented++,currentTarget:{parentElement:{querySelectorAll:()=>buttons}}});
 tree.children[1].props.onKeyDown(event('ArrowRight'));tree.children[1].props.onKeyDown(event('Home'));tree.children[1].props.onKeyDown(event('End'));
 assert.deepEqual(selected,['tasks','chat','members']);assert.deepEqual(focused,[2,0,3]);assert.equal(prevented,3);
});
