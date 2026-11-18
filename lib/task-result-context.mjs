import { createHash } from 'node:crypto';
import { canonicalTeamJson, teamId, teamMember } from './team-state.mjs';
const fail=message=>{throw Object.assign(new Error(message),{code:'BAD_CONTEXT'});};
const digest=value=>createHash('sha256').update(canonicalTeamJson(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
function validResult(result){
 return exact(result,['status','summary','artifacts'])&&['succeeded','failed'].includes(result.status)&&typeof result.summary==='string'&&result.summary.length>0&&result.summary.length<=4000&&
 (result.artifacts===undefined||(Array.isArray(result.artifacts)&&result.artifacts.length<=32&&result.artifacts.every(a=>exact(a,['type','value'])&&typeof a.type==='string'&&a.type.length>0&&a.type.length<=128&&typeof a.value==='string'&&a.value.length<=16384)));
}
export function resultHash(result){if(!validResult(result))fail('Invalid task result evidence');return digest(result);}
export function validateTaskResultEvidence(row){
 try{
  if(!exact(row,['roomId','taskId','executionId','workerKey','generation','attempt','state','source','reviewStatus','resultHash','result']))return false;
  for(const k of ['roomId','taskId','executionId'])teamId(row[k]);teamMember(row.workerKey);
  return Number.isSafeInteger(row.generation)&&row.generation>0&&((Number.isSafeInteger(row.attempt)&&row.attempt>0)||(row.source==='worker-ledger'&&row.attempt===null))&&['succeeded','failed','uncertain','cancelled'].includes(row.state)&&['leader-ledger','worker-ledger'].includes(row.source)&&['review','accepted','failed','blocked','cancelled','unverified'].includes(row.reviewStatus)&&!(row.source==='worker-ledger'&&row.reviewStatus!=='unverified')&&/^[a-f0-9]{64}$/.test(row.resultHash)&&resultHash(row.result)===row.resultHash;
 }catch{return false;}
}
function evidenceRows(state,{roomId,actorKey}){
 const rows=[];
 for(const e of Object.values(state?.executions??{})){
  const task=state.tasks?.[e.taskId];
  if(e.roomId!==roomId||task?.roomId!==roomId||!e.result)continue;
  const row={roomId,taskId:e.taskId,executionId:e.executionId,workerKey:e.workerKey,generation:e.generation,attempt:e.attempt,state:e.state,source:'leader-ledger',reviewStatus:task.currentExecutionId&&task.currentExecutionId!==e.executionId?'unverified':task.status,resultHash:resultHash(e.result),result:structuredClone(e.result)};
  if(validateTaskResultEvidence(row))rows.push(row);
 }
 for(const e of Object.values(state?.workerExecutions??{})){
  const d=e.descriptor;
  if(d?.roomId!==roomId||d.workerKey!==actorKey||!e.result||rows.some(r=>r.executionId===d.executionId))continue;
  const row={roomId,taskId:d.taskId,executionId:d.executionId,workerKey:d.workerKey,generation:d.generation,attempt:d.attempt??null,state:e.state,source:'worker-ledger',reviewStatus:'unverified',resultHash:resultHash(e.result),result:structuredClone(e.result)};
  if(validateTaskResultEvidence(row))rows.push(row);
 }
 return rows;
}
export function taskResultReferences(state,scope){return evidenceRows(state,scope).map(({result,...row})=>({...row,summary:result.summary,artifactCount:result.artifacts?.length??0}));}
export function selectTaskResults(state,{roomId,actorKey,selections=[]}){
 if(!Array.isArray(selections)||selections.length>8)fail('Select at most eight task results');
 const seen=new Set();
 for(const s of selections){if(!exact(s,['executionId','resultHash'])||typeof s.executionId!=='string'||!/^([a-f0-9]{64})$/.test(s.resultHash)||seen.has(s.executionId))fail('Invalid or duplicate task result selection');seen.add(s.executionId);}
 const rows=evidenceRows(state,{roomId,actorKey});
 return selections.map(s=>{const row=rows.find(r=>r.executionId===s.executionId&&r.resultHash===s.resultHash);if(!row)fail('Task result unavailable or version mismatch');return row;});
}
