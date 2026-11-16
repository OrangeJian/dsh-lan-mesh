import test from 'node:test';
import assert from 'node:assert/strict';
import {inboxWorkbenchView} from '../ui/models/inbox-workbench.mjs';
const msg=(id,node='remote',session='agent',extra={})=>({id,from:{nodeId:node,sessionId:session,title:'Same'},text:'line one\nline two',...extra});
test('unread only excludes own humans but retains local agents, exact identities and reverse arrival order',()=>{
 const input=[msg('same','a'),msg('same','b'),msg('own','local','human'),msg('legacy','local',''),msg('agent','local'),msg('read','remote','agent',{read:true})];const before=structuredClone(input);const view=inboxWorkbenchView({messages:input,self:{nodeId:'local',name:'Desk'}});assert.deepEqual(view.rows.map(r=>r.id),['agent','same','same']);assert.notEqual(view.rows[1].key,view.rows[2].key);assert.equal(view.rows[0].device,'Desk · local');assert.equal(view.rows[1].message,input[1]);assert.deepEqual(input,before);
});
test('classification uses only explicit metadata and counts precede search',()=>{
 const input=[msg('a','n','agent',{text:'@me task done'}),msg('b','n','agent',{kind:'room-task'}),msg('c','n','agent',{kind:'system-event'}),msg('d','n','agent',{structuredMentions:[{memberKey:'local/human'}]})];const view=inboxWorkbenchView({messages:input,self:{nodeId:'local'},query:'task',filter:'tasks'});assert.deepEqual(view.counts,{all:4,mentions:1,tasks:1,system:1});assert.deepEqual(view.availableFilters,['all','mentions','tasks','system']);assert.equal(inboxWorkbenchView({messages:[input[0]],self:{nodeId:'local'},filter:'mentions'}).counts.mentions,0);
});
test('room and device search preserve source and multiline body without treating author name as device',()=>{
 const message=msg('a','n','agent',{room:'r',topic:'old',text:'A\nB',sentAt:'stamp'});const view=inboxWorkbenchView({messages:[message],rooms:[{id:'r',name:'Design'}],peers:[{nodeId:'n',name:'Laptop'}],query:'laptop'});assert.equal(view.rows.length,1);assert.equal(view.rows[0].body,'A\nB');assert.equal(view.rows[0].roomLabel,'Design');assert.equal(view.rows[0].timestamp,'stamp');assert.equal(inboxWorkbenchView({messages:[message]}).rows[0].device,'n');assert.deepEqual(inboxWorkbenchView().rows,[]);
});

test('unavailable or invalid filter falls back to all after final typed reminder disappears',()=>{
 const view=inboxWorkbenchView({messages:[msg('ordinary')],filter:'tasks'});assert.equal(view.activeFilter,'all');assert.equal(view.rows.length,1);
 assert.equal(inboxWorkbenchView({messages:[msg('ordinary')],filter:'invented'}).rows.length,1);
});
