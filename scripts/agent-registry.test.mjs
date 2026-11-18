import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRegistry,applyRegistryCommand,publicAgent} from '../lib/agent-registry.mjs';
const owner={nodeId:'node-local',canManage:true};
const create={type:'define',agentId:'agent-one',name:'Builder'};
test('definition survives session binding changes without changing authority',()=>{
 let state=applyRegistryCommand(emptyRegistry(),create,owner);
 state=applyRegistryCommand(state,{type:'bind',agentId:'agent-one',expectedRevision:1,sessionId:'session-one',workspaceId:'workspace-one',localPath:'C:/private'},owner);
 assert.equal(state.definitions['agent-one'].revision,2);
 assert.equal(state.bindings['session-one'].agentId,'agent-one');
 assert.equal(state.definitions['agent-one'].authorityNodeId,'node-local');
 assert.equal(JSON.stringify(publicAgent(state,'agent-one')).includes('private'),false);
});
test('stale updates conflict and cannot mutate their input',()=>{
 const state=applyRegistryCommand(emptyRegistry(),create,owner),before=structuredClone(state);
 assert.throws(()=>applyRegistryCommand(state,{type:'rename',agentId:'agent-one',expectedRevision:0,name:'new'},owner),{code:'CONFLICT'});
 assert.deepEqual(state,before);
});
test('non-management or foreign authority cannot change a definition',()=>{
 const state=applyRegistryCommand(emptyRegistry(),create,owner);
 for(const caller of [{nodeId:'node-remote',canManage:true},{nodeId:'node-local',canManage:false}])assert.throws(()=>applyRegistryCommand(state,{type:'rename',agentId:'agent-one',expectedRevision:1,name:'new'},caller),{code:'FORBIDDEN'});
 assert.throws(()=>applyRegistryCommand(state,{...create,authorityNodeId:'node-remote'},owner),{code:'BAD_REQUEST'});
});
test('one session cannot silently change its stable definition',()=>{
 let state=applyRegistryCommand(emptyRegistry(),create,owner);
 state=applyRegistryCommand(state,{type:'define',agentId:'agent-two',name:'Builder'},owner);
 state=applyRegistryCommand(state,{type:'bind',agentId:'agent-one',expectedRevision:1,sessionId:'same',workspaceId:'workspace-one',localPath:'C:/private'},owner);
 assert.throws(()=>applyRegistryCommand(state,{type:'bind',agentId:'agent-two',expectedRevision:1,sessionId:'same',workspaceId:'workspace-two',localPath:'C:/other'},owner),{code:'CONFLICT'});
});

test('durable registry reopens stable identity and rechecks revoked management',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {openAgentRegistry}=await import('../lib/agent-registry-store.mjs');
 const directory=await mkdtemp(join(tmpdir(),'registry-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let allowed=true;const options={directory,nodeId:owner.nodeId,authorize:async()=>allowed};
 const store=await openAgentRegistry(options);
 await store.command(create);
 allowed=false;
 await assert.rejects(store.command({type:'rename',agentId:'agent-one',expectedRevision:1,name:'forbidden'}),{code:'FORBIDDEN'});
 const reopened=await openAgentRegistry(options);
 assert.equal(reopened.read().definitions['agent-one'].name,'Builder');
 assert.equal(reopened.read().definitions['agent-one'].revision,1);
});

test('concurrent revision claims serialize and only one succeeds',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {openAgentRegistry}=await import('../lib/agent-registry-store.mjs');
 const directory=await mkdtemp(join(tmpdir(),'registry-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=await openAgentRegistry({directory,nodeId:owner.nodeId,authorize:async()=>true});await store.command(create);
 const results=await Promise.allSettled(['one','two'].map(name=>store.command({type:'rename',agentId:'agent-one',expectedRevision:1,name})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONFLICT');assert.equal(store.read().definitions['agent-one'].revision,2);
});
test('failed durable publication never advances the in-memory registry and remains retryable',async t=>{
 const fs=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {openAgentRegistry}=await import('../lib/agent-registry-store.mjs');
 const directory=await fs.mkdtemp(join(tmpdir(),'registry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let broken=true;
 const store=await openAgentRegistry({directory,nodeId:owner.nodeId,authorize:async()=>true,io:{...fs,rename:async(...args)=>{if(broken)throw new Error('disk failed');return fs.rename(...args);}}});
 await assert.rejects(store.command(create),/disk failed/);assert.deepEqual(store.read(),emptyRegistry());broken=false;await store.command(create);assert.equal(store.read().definitions['agent-one'].revision,1);
});
