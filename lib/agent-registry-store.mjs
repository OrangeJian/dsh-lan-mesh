/** Single-process local store; never share its directory between writers. */
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {emptyRegistry,applyRegistryCommand} from './agent-registry.mjs';
const digest=command=>createHash('sha256').update(JSON.stringify(Object.keys(command).sort().map(key=>[key,command[key]]))).digest('hex');
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
 const file=join(directory,'agent-registry.json');let current=emptyRegistry(),audit=[];
 try{
  const saved=JSON.parse(await io.readFile(file,'utf8'));
  current=validate(saved.version===2?saved.registry:saved,nodeId);
  if(saved.version===2){
   if(!Array.isArray(saved.audit))throw new Error('Invalid Registry audit');
   const ids=new Set();
   for(const row of saved.audit){
    if(!row||typeof row.requestId!=='string'||ids.has(row.requestId)||!/^[a-f0-9]{64}$/.test(row.fingerprint)||row.nodeId!==nodeId||typeof row.operation!=='string'||typeof row.at!=='string'||!row.result||row.result.authorityNodeId!==nodeId||!Number.isSafeInteger(row.result.revision)||row.result.revision<1)throw new Error('Invalid Registry audit entry');
    ids.add(row.requestId);
   }
   audit=saved.audit;
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let pending=Promise.resolve();
 return {
  read:()=>structuredClone(current),
  history:()=>structuredClone(audit),
  command(input,{requestId=randomUUID(),prepare}={}){
   const command=structuredClone(input);
   const operation=pending.then(async()=>{
    if(typeof requestId!=='string'||!requestId.trim()||requestId.length>200)throw Object.assign(new Error('BAD_REQUEST'),{code:'BAD_REQUEST'});
    if(!await authorize({operation:command.type,agentId:command.agentId}))throw Object.assign(new Error('FORBIDDEN'),{code:'FORBIDDEN'});
    const fingerprint=digest(command);
    const previous=audit.find(row=>row.requestId===requestId);
    if(previous){
     if(previous.fingerprint!==fingerprint){
      // Older bind records hashed the resolved path as part of the command.
      if(!prepare||previous.rawRequest||previous.operation!==command.type||previous.agentId!==command.agentId||previous.fingerprint!==digest(await prepare(command)))throw Object.assign(new Error('CONFLICT'),{code:'CONFLICT'});
      if(!await authorize({operation:command.type,agentId:command.agentId}))throw Object.assign(new Error('FORBIDDEN'),{code:'FORBIDDEN'});
     }
     return structuredClone(previous.result);
    }
    const prepared=prepare ? await prepare(command) : command;
    if(prepare&&!await authorize({operation:command.type,agentId:command.agentId}))throw Object.assign(new Error('FORBIDDEN'),{code:'FORBIDDEN'});
    const next=applyRegistryCommand(current,prepared,{nodeId,canManage:true});
    const nextAudit=[...audit,{requestId,fingerprint,rawRequest:true,nodeId,operation:command.type,agentId:command.agentId,at:new Date().toISOString(),result:structuredClone(next.definitions[command.agentId])}];
    const temp=`${file}.${randomUUID()}.tmp`;let handle;
    try{
     handle=await io.open(temp,'wx',0o600);await handle.writeFile(`${JSON.stringify({version:2,registry:next,audit:nextAudit})}\n`);await handle.sync();await handle.close();handle=undefined;await io.rename(temp,file);
    }catch(error){await handle?.close().catch(()=>{});await io.unlink(temp).catch(()=>{});throw error;}
    current=next;audit=nextAudit;return structuredClone(next.definitions[command.agentId]);
   });
   pending=operation.catch(()=>{});return operation;
  },
  flush:()=>pending,
 };
}
