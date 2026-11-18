/** Trusted Host owner-route adapter. Never register on the peer HTTP server. */
import {realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {openAgentRegistry} from './agent-registry-store.mjs';
import {publicAgent} from './agent-registry.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function createRegistryPanel({node,directory}){
 let pending,closed=false;
 const available=()=>{if(closed||node.closed)fail('CLOSED');if(!node.nodeId)fail('UNAVAILABLE');};
 const store=async()=>{
  available();
  if(!pending)pending=openAgentRegistry({directory,nodeId:node.nodeId,authorize:async()=>!closed&&!node.closed}).catch(error=>{pending=undefined;throw error;});
  return pending;
 };
 return {
  async list(){
   const registry=await store();await registry.flush();available();const state=registry.read();
   return Object.keys(state.definitions).map(id=>({...publicAgent(state,id),bindings:Object.values(state.bindings).filter(binding=>binding.agentId===id).map(({sessionId,workspaceId,nodeId})=>({sessionId,workspaceId,nodeId}))}));
  },
  async command(input,requestId){
   available();if(typeof requestId!=='string'||!requestId.trim()||requestId.length>200)fail('BAD_REQUEST');
   if(!input||typeof input!=='object'||Array.isArray(input))fail('BAD_REQUEST');
   const command=structuredClone(input);
   if(command.type==='bind'){
    if(Object.keys(command).some(key=>!['type','agentId','sessionId','expectedRevision'].includes(key)))fail('BAD_REQUEST');
    const catalogue=await node.catalogueAgents({peers:false});available();
    const session=catalogue.agents.find(row=>row.id===command.sessionId);
    if(!session)fail('NOT_FOUND');
    if(!isAbsolute(session.cwd||''))fail('WORKSPACE_UNAVAILABLE');
    command.localPath=await realpath(session.cwd);available();
    command.workspaceId=`workspace-${createHash('sha256').update(command.localPath).digest('hex').slice(0,24)}`;
   }
   const registry=await store();available();return registry.command(command,{requestId});
  },
  async close(){closed=true;if(pending)await (await pending).flush();},
 };
}
