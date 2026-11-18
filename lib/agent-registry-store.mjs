/** Single-process local store; never share its directory between writers. */
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {emptyRegistry,applyRegistryCommand} from './agent-registry.mjs';
function validate(value,nodeId){
 if(value?.version!==1||!value.definitions||!value.bindings||Array.isArray(value.definitions)||Array.isArray(value.bindings))throw new Error('Invalid Registry storage');
 let rebuilt=emptyRegistry();const caller={nodeId,canManage:true};
 for(const [key,row] of Object.entries(value.definitions)){
  if(row.agentId!==key||row.authorityNodeId!==nodeId||!Number.isSafeInteger(row.revision)||row.revision<1)throw new Error('Invalid Registry definition');
  rebuilt=applyRegistryCommand(rebuilt,{type:'define',agentId:key,name:row.name},caller);
 }
 for(const [key,row] of Object.entries(value.bindings)){
  if(row.sessionId!==key||row.nodeId!==nodeId)throw new Error('Invalid Registry binding');
  rebuilt=applyRegistryCommand(rebuilt,{type:'bind',agentId:row.agentId,expectedRevision:rebuilt.definitions[row.agentId]?.revision,sessionId:key,workspaceId:row.workspaceId,localPath:row.localPath},caller);
 }
 for(const key of Object.keys(rebuilt.definitions))rebuilt.definitions[key].revision=value.definitions[key].revision;
 return rebuilt;
}
export async function openAgentRegistry({directory,nodeId,authorize,io=fs}){
 if(typeof authorize!=='function')throw new Error('Registry requires current server authorization');
 await io.mkdir(directory,{recursive:true,mode:0o700});
 const file=join(directory,'agent-registry.json');let current=emptyRegistry();
 try{current=validate(JSON.parse(await io.readFile(file,'utf8')),nodeId);}catch(error){if(error.code!=='ENOENT')throw error;}
 let pending=Promise.resolve();
 return {
  read:()=>structuredClone(current),
  command(input){
   const command=structuredClone(input);
   const operation=pending.then(async()=>{
    if(!await authorize({operation:command.type,agentId:command.agentId}))throw Object.assign(new Error('FORBIDDEN'),{code:'FORBIDDEN'});
    const next=applyRegistryCommand(current,command,{nodeId,canManage:true});
    const temp=`${file}.${randomUUID()}.tmp`;let handle;
    try{
     handle=await io.open(temp,'wx',0o600);await handle.writeFile(`${JSON.stringify(next)}\n`);await handle.sync();await handle.close();handle=undefined;await io.rename(temp,file);
    }catch(error){await handle?.close().catch(()=>{});await io.unlink(temp).catch(()=>{});throw error;}
    current=next;return structuredClone(next.definitions[command.agentId]);
   });
   pending=operation.catch(()=>{});return operation;
  },
  flush:()=>pending,
 };
}
