import test from 'node:test';
import assert from 'node:assert/strict';
import { resultHash, taskResultReferences, selectTaskResults, validateTaskResultEvidence } from '../lib/task-result-context.mjs';
const result={status:'succeeded',summary:'Built candidate',artifacts:[{type:'file',value:'C:/worker/output.txt'}]};
const execution={executionId:'e1',taskId:'t1',roomId:'r1',workerKey:'node-b/worker',generation:1,attempt:2,state:'succeeded',result};
const state={tasks:{t1:{taskId:'t1',roomId:'r1',status:'review',currentExecutionId:'e1'}},executions:{e1:execution},workerExecutions:{}};
const selection=()=>[{executionId:'e1',resultHash:resultHash(result)}];
test('task evidence pins canonical result with source and keeps review separate from acceptance',()=>{
 assert.equal(resultHash(result),resultHash({artifacts:result.artifacts,summary:result.summary,status:result.status}));
 const refs=taskResultReferences(state,{roomId:'r1',actorKey:'node-a/human'});
 assert.deepEqual(refs.map(x=>({executionId:x.executionId,resultHash:x.resultHash})),selection());
 const [row]=selectTaskResults(state,{roomId:'r1',actorKey:'node-a/human',selections:selection()});
 assert.equal(row.workerKey,'node-b/worker');assert.equal(row.attempt,2);assert.equal(row.reviewStatus,'review');assert.deepEqual(row.result,result);
 row.result.summary='changed';assert.equal(result.summary,'Built candidate');assert.equal(validateTaskResultEvidence(row),false);
});
test('task evidence rejects stale hashes, foreign rooms, unknown results and user supplied bodies',()=>{
 for(const opts of [{roomId:'other',selections:selection()},{roomId:'r1',selections:[{executionId:'e1',resultHash:'f'.repeat(64)}]},{roomId:'r1',selections:[{executionId:'missing',resultHash:resultHash(result)}]},{roomId:'r1',selections:[{...selection()[0],result}]}])assert.throws(()=>selectTaskResults(state,{actorKey:'node-a/human',...opts}));
 assert.equal(taskResultReferences(state,{roomId:'other',actorKey:'node-a/human'}).length,0);
});
test('worker ledger evidence is visible only to its owning worker and has no acceptance claim',()=>{
 const local={tasks:{},executions:{},workerExecutions:{e1:{descriptor:{...execution},state:'uncertain',result}}};
 assert.equal(taskResultReferences(local,{roomId:'r1',actorKey:'node-a/human'}).length,0);
 const [row]=selectTaskResults(local,{roomId:'r1',actorKey:'node-b/worker',selections:selection()});
 assert.equal(row.reviewStatus,'unverified');assert.equal(row.state,'uncertain');assert.equal(row.source,'worker-ledger');
});
test('task evidence limits and duplicate selection are explicit errors',()=>{
 assert.throws(()=>selectTaskResults(state,{roomId:'r1',actorKey:'node-a/human',selections:Array(9).fill(selection()[0])}));
 assert.throws(()=>selectTaskResults(state,{roomId:'r1',actorKey:'node-a/human',selections:[...selection(),...selection()]}));
});
import { buildRoomContextPacket } from '../lib/room-context.mjs';
import { normalizeContextPacket,CONTEXT_SELECTION_SCHEMA } from '../lib/room-context-protocol.mjs';
test('context transports validated evidence and rejects tampering and evidence truncation',()=>{
 const evidence=selectTaskResults(state,{roomId:'r1',actorKey:'node-a/human',selections:selection()});
 const packet=buildRoomContextPacket({roomId:'r1',taskResultRefs:evidence});
 assert.deepEqual(packet.taskResultRefs,evidence);assert.deepEqual(normalizeContextPacket(packet,'r1').taskResultRefs,evidence);
 const changed=structuredClone(packet);changed.taskResultRefs[0].result.artifacts[0].value='tampered';assert.throws(()=>normalizeContextPacket(changed,'r1'));
 assert.throws(()=>buildRoomContextPacket({roomId:'other',taskResultRefs:evidence}));
 assert.throws(()=>buildRoomContextPacket({roomId:'r1',taskResultRefs:evidence},{maxBytes:400}));
 assert.deepEqual(CONTEXT_SELECTION_SCHEMA.properties.selectedTaskResults.items.required,['executionId','resultHash']);
});

test('an old result retains its hash without inheriting the current task review state',()=>{
 const snapshot=structuredClone(state);
 for(const currentExecutionId of ['e2',null]){
  snapshot.tasks.t1.currentExecutionId=currentExecutionId;
  const [row]=selectTaskResults(snapshot,{roomId:'r1',actorKey:'node-a/human',selections:selection()});
  assert.equal(row.resultHash,selection()[0].resultHash);
  assert.equal(row.reviewStatus,'unverified');
 }
});
test('a context cannot carry two results for one execution',()=>{
 const [row]=selectTaskResults(state,{roomId:'r1',actorKey:'node-a/human',selections:selection()});
 const packet=buildRoomContextPacket({roomId:'r1',taskResultRefs:[row]});
 assert.throws(()=>buildRoomContextPacket({roomId:'r1',taskResultRefs:[row,row]}),/Invalid task result/);
 packet.taskResultRefs.push(row);
 assert.throws(()=>normalizeContextPacket(packet,'r1'),/Invalid task result/);
});
