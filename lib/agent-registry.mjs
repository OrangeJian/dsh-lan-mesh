/** Local Registry domain model. Caller is server-derived, never a wire payload. */
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value);
export const emptyRegistry=()=>({version:1,definitions:{},bindings:{}});
export function publicAgent(state,agentId){
 const row=state.definitions[agentId];
 if(!row)return null;
 return {agentId:row.agentId,name:row.name,authorityNodeId:row.authorityNodeId,revision:row.revision};
}
export function applyRegistryCommand(current,command,caller){
 if(current?.version!==1)fail('BAD_STATE');
 if(!caller?.canManage||!id(caller.nodeId))fail('FORBIDDEN');
 if(!command||!id(command.agentId))fail('BAD_REQUEST');
 const fields={define:['type','agentId','name'],rename:['type','agentId','expectedRevision','name'],bind:['type','agentId','expectedRevision','sessionId','workspaceId','localPath'],unbind:['type','agentId','expectedRevision','sessionId']};
 if(!fields[command.type]||Object.keys(command).some(key=>!fields[command.type].includes(key)))fail('BAD_REQUEST');
 const state=structuredClone(current),row=state.definitions[command.agentId];
 const name=()=>{if(typeof command.name!=='string'||!command.name.trim()||command.name.length>120)fail('BAD_REQUEST');return command.name.trim();};
 if(command.type==='define'){
  if(row)fail('CONFLICT');
  state.definitions[command.agentId]={agentId:command.agentId,name:name(),authorityNodeId:caller.nodeId,revision:1};
  return state;
 }
 if(!row)fail('NOT_FOUND');
 if(row.authorityNodeId!==caller.nodeId)fail('FORBIDDEN');
 if(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision!==row.revision)fail('CONFLICT');
 if(command.type==='rename')row.name=name();
 if(command.type==='bind'){
  if(!id(command.sessionId)||!id(command.workspaceId)||typeof command.localPath!=='string'||!command.localPath.trim())fail('BAD_REQUEST');
  if(state.bindings[command.sessionId])fail('CONFLICT');
  state.bindings[command.sessionId]={agentId:row.agentId,nodeId:caller.nodeId,sessionId:command.sessionId,workspaceId:command.workspaceId,localPath:command.localPath};
 }
 if(command.type==='unbind'){
  if(!id(command.sessionId))fail('BAD_REQUEST');
  if(state.bindings[command.sessionId]?.agentId!==row.agentId)fail('NOT_FOUND');
  delete state.bindings[command.sessionId];
 }
 row.revision++;
 return state;
}
