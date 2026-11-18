import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createRegistryPanel} from '../lib/agent-registry-panel.mjs';
test('owner panel binds only server-known local sessions and projects no paths',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'registry-panel-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const node={nodeId:'node-local',closed:false,catalogueAgents:async()=>({agents:[{id:'session-one',cwd:directory}]})};
 const panel=createRegistryPanel({node,directory});t.after(()=>panel.close());
 await panel.command({type:'define',agentId:'agent-one',name:'Builder'},'r1');
 await panel.command({type:'bind',agentId:'agent-one',sessionId:'session-one',expectedRevision:1},'r2');
 const rows=await panel.list();assert.equal(rows[0].bindings[0].sessionId,'session-one');assert.equal(JSON.stringify(rows).includes(directory),false);
 await assert.rejects(panel.command({type:'bind',agentId:'agent-one',sessionId:'missing',expectedRevision:2},'r3'),{code:'NOT_FOUND'});
 await assert.rejects(panel.command({type:'rename',agentId:'agent-one',name:'bad',expectedRevision:2},''),{code:'BAD_REQUEST'});
 node.closed=true;await assert.rejects(panel.list(),{code:'CLOSED'});
});

test('committed binding can replay after restart without a live Session catalogue',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'registry-bind-replay-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const node={nodeId:'node-local',closed:false,catalogueAgents:async()=>({agents:[{id:'session-one',cwd:directory}]})};
 let panel=createRegistryPanel({node,directory});
 await panel.command({type:'define',agentId:'agent-one',name:'Builder'},'define');
 const bind={type:'bind',agentId:'agent-one',sessionId:'session-one',expectedRevision:1};
 const original=await panel.command(bind,'bind');
 await panel.close();
 node.catalogueAgents=async()=>{throw new Error('catalogue offline');};
 panel=createRegistryPanel({node,directory});
 assert.deepEqual(await panel.command(bind,'bind'),original);
 await assert.rejects(panel.command({...bind,sessionId:'different'},'bind'),{code:'CONFLICT'});
 assert.equal((await panel.list())[0].revision,2);
 await panel.close();
});
