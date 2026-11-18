import test from 'node:test';
import assert from 'node:assert/strict';
import {roomTaskBoardView,canMoveRoomTask} from '../ui/models/room-task-board.mjs';
const task=(id,status='open',node='a')=>({id,title:'Same task',status,assignee:{nodeId:node,sessionId:'human',name:'Same'}});
const rooms=[{id:'r1',name:'Same room',tasks:[task('t'),task('done','done'),task('unknown','future'),{...task('deleted'),deleted:true}]},{id:'r2',name:'Same room',tasks:[task('t','doing','b')]},{id:'gone',deleted:true,tasks:[task('x')]}];
test('stable Room/task identity preserves namesakes and unknown states while excluding deleted',()=>{const v=roomTaskBoardView({rooms});assert.equal(v.rows.length,4);assert.equal(new Set(v.rows.map(r=>r.key)).size,4);assert.equal(v.counts.unknown,1);assert.equal(v.groups.find(g=>g.id==='unknown').rows[0].task.id,'unknown');});
test('exact assignee identity filters cross-machine humans and invalid filters recover',()=>{const v=roomTaskBoardView({rooms,assignee:JSON.stringify(['b','human'])});assert.equal(v.rows.length,1);assert.equal(v.rows[0].roomId,'r2');assert.equal(roomTaskBoardView({rooms:[],status:'doing',assignee:'missing'}).activeStatus,'all');assert.equal(roomTaskBoardView({rooms,assignee:'missing'}).activeAssignee,'all');});
test('search retains full detail and source without inventing Team status',()=>{const v=roomTaskBoardView({rooms:[{id:'r',name:'Design',tasks:[{...task('t'),detail:'one\ntwo',updatedAt:'invalid'}]}],query:'two'});assert.equal(v.rows[0].detail,'one\ntwo');assert.equal(v.rows[0].updatedAt,'时间未知');assert.equal(v.rows[0].source,'Room任务');});
test('task controls require leader or exact complete owner identity',()=>{assert.equal(canMoveRoomTask({task:task('t'),nodeId:'b',sessionId:'human'}),false);assert.equal(canMoveRoomTask({task:task('t'),nodeId:'a',sessionId:'human'}),true);assert.equal(canMoveRoomTask({task:task('t'),sessionId:'human'}),false);assert.equal(canMoveRoomTask({task:task('t'),isLeader:true}),true);});
import {RoomTaskBoard} from '../ui/tasks/room-task-board.mjs';
test('board is grouped read-only and opens only the exact Room',()=>{const opened=[];const h=(type,props,...children)=>({type,props:props??{},children:children.flat()});const React={useState:value=>[value,()=>{}]};const tree=RoomTaskBoard({h,React,modelOf:roomTaskBoardView,rooms,onOpenRoom:id=>opened.push(id)});const walk=node=>!node||typeof node!=='object'?[]:[node,...node.children.flatMap(walk)];const rows=walk(tree).filter(n=>n.props.className?.includes('lm-taskBoardRow')&&n.type==='button');assert.equal(rows.length,4);rows.find(r=>r.props.key===JSON.stringify(['r2','t'])).props.onClick();assert.deepEqual(opened,['r2']);assert.ok(!walk(tree).some(n=>String(n.children).includes('派发任务')));});

// A11/A12 read-only display evidence. Only the existing free-form task.status
// field is used; no new component state, Team state-machine field or approval
// field is introduced. The board's existing `unknown` fallback must keep the
// raw value and never promote these to a success/acceptance state.
const authorityStatuses=['uncertain','planned','review','accepted','succeeded'];
const authorityRooms=[{id:'room-authority',name:'审批与评审样本',tasks:authorityStatuses.map(status=>({...task('t-'+status,status),title:status+' 样本'}))}];
test('authority-like statuses fall back to unknown with the raw value, never to success',()=>{
 const v=roomTaskBoardView({rooms:authorityRooms});
 assert.equal(v.rows.length,authorityStatuses.length);
 assert.equal(v.counts.done,0);
 assert.equal(v.counts.unknown,authorityStatuses.length);
 assert.equal(v.groups.length,1);
 assert.equal(v.groups[0].id,'unknown');
 for(const status of authorityStatuses){
  const row=v.rows.find(r=>r.task.status===status);
  assert.equal(row.status,'unknown');
  assert.equal(row.statusLabel,'未知状态 · '+status);
 }
});
test('read-only board exposes no dispatch approve merge accept or retry control for authority states',()=>{
 const h=(type,props,...children)=>({type,props:props??{},children:children.flat()});
 const React={useState:value=>[value,()=>{}]};
 const opened=[];
 const tree=RoomTaskBoard({h,React,modelOf:roomTaskBoardView,rooms:authorityRooms,onRefresh:()=>{},onOpenRoom:id=>opened.push(id)});
 const walk=node=>!node||typeof node!=='object'?[]:[node,...node.children.flatMap(walk)];
 const all=walk(tree);
 const interactive=all.filter(n=>['button','input','select'].includes(n.type));
 const rowButtons=interactive.filter(n=>n.type==='button'&&n.props.className?.includes('lm-taskBoardRow'));
 const otherButtons=interactive.filter(n=>n.type==='button'&&!n.props.className?.includes('lm-taskBoardRow'));
 assert.equal(rowButtons.length,authorityStatuses.length);
 assert.deepEqual(otherButtons.map(n=>n.children.join('')),['刷新']);
 // Five rows + refresh + search input + status filter + assignee filter = 9.
 assert.equal(interactive.length,authorityStatuses.length+4);
 assert.deepEqual(interactive.filter(n=>n.type==='select').map(n=>n.props['aria-label']),['任务状态','任务负责人']);
 assert.equal(interactive.find(n=>n.type==='input').props['aria-label'],'搜索房间任务');
 for(const forbidden of ['派发','批准','合并','验收','接受','重试']) assert.ok(!interactive.some(n=>String(n.children).includes(forbidden)),'unexpected control text: '+forbidden);
 for(const row of rowButtons) row.props.onClick();
 assert.equal(opened.length,authorityStatuses.length);
 assert.ok(opened.every(id=>id==='room-authority'));
});
