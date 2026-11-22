import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MeshNode } from '../lib/service.mjs';
import { TeamCoordinator } from '../lib/team-coordinator.mjs';
import { openTeamStore } from '../lib/team-store.mjs';
import { createResultReviewLedger } from '../lib/m6-review-ledger.mjs';
import { resultHash } from '../lib/task-result-context.mjs';

for (const decision of ['accepted','rejected']) {
  test('room assignment publishes result and ' + decision + ' decision', async t => {
    const dir = await mkdtemp(join(tmpdir(),'room-team-flow-'));
    t.after(() => rm(dir,{recursive:true,force:true}));
    const leader = {nodeId:'a',sessionId:'human',key:'a/human',name:'Owner'};
    const worker = {nodeId:'b',sessionId:'agent',key:'b/agent',name:'Worker'};
    const room = {id:'room-test',name:'Test',leader,members:[leader,worker],tasks:[]};
    const coordinators = {};
    for (const id of ['a','b']) {
      coordinators[id] = new TeamCoordinator({nodeId:id,store:await openTeamStore({directory:join(dir,id)}),
        getRoom:()=>room,authorize:()=>true,wake:()=>true,send:(target,request)=>coordinators[target].handle(request)});
    }
    const node = new MeshNode({config:{teamEnabled:true}});
    node.started = true;
    node.identity = {nodeId:'a'};
    node.roomsDoc.rooms[room.id] = room;
    node.team = coordinators.a;
    const notices = [];
    node.sayInRoom = async (request,id) => { notices.push({request,id}); return {delivered:[{ok:true}]}; };
    const {execution} = await node.assignTask({room:room.id,sessionId:'human',teamDispatch:true,assignee:worker.key,title:'Deliver'});
    await coordinators.b.tick();
    const result = {status:'succeeded',summary:'Ready for inspection'};
    await coordinators.b.report({executionId:execution.executionId,actorKey:worker.key,result});
    await coordinators.b.tick();
    await node.flushTeamRoomNotices();
    const overview = await node.ownerTeamOverview(room.id);
    assert.equal(overview.tasks[0].status,'review');
    assert.match(notices[1].request.text,/Ready for inspection/);
    const ledger = createResultReviewLedger({store:node.team.store,nodeId:'a',getRoom:()=>room,authorize:()=>true});
    await ledger.review({roomId:room.id,actorKey:leader.key,taskId:execution.taskId,requestId:'review-1',
      intent:{reviewedExecutionId:execution.executionId,resultHash:resultHash(result),generation:1,decision,
        ...(decision==='rejected'?{reason:'Please revise'}:{})}});
    await node.flushTeamRoomNotices();
    await node.flushTeamRoomNotices();
    assert.equal(notices.length,3);
    assert.match(notices[2].request.text,decision==='accepted'?/已验收/:/Please revise/);
  });
}
