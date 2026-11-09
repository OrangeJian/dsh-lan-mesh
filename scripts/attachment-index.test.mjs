import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../index.js';
import {MeshNode} from '../lib/service.mjs';
test('index registers owner routes, validates config, binds model actor and panel human',async()=>{
 const saved={start:MeshNode.prototype.start,say:MeshNode.prototype.sayInRoom};const calls=[],tools=new Map(),routes=new Map(),disposers=[];let config;
 MeshNode.prototype.start=async function(){config=this.config;};MeshNode.prototype.sayInRoom=async r=>{calls.push(r);return {room:{name:'R',members:[]},delivered:[],messageId:r.messageId,durableNodes:['n']};};
 const ctx={get:n=>n==='tools'?{register:d=>{tools.set(d.name,d);return ()=>{};}}:undefined,effect:fn=>{const d=fn();if(typeof d==='function')disposers.push(d);},inject(names,fn){return fn({tools:this.get('tools'),connection:{fetch:{register:r=>{routes.set(r.path,r);return ()=>{};}}},effect:this.effect});}};
 try {
  assert.throws(()=>apply(ctx,{roomAttachmentLimits:{maxAttachments:0}}),/limit/);
  apply(ctx,{roomAttachmentLimits:{maxAttachments:9}});assert.equal(config.roomAttachmentLimits.maxAttachments,9);assert.equal(config.roomAttachmentLimits.maxFileBytes,20971520);
  assert.equal(routes.get('/api/lan-mesh/attachments').requestBody,'streaming');
  const say=tools.get('lan_mesh_room_say');assert.ok(say.parameters.properties.attachments);assert.ok(say.parameters.properties.messageId);
  await say.execute({room:'r',text:'x',attachments:[],messageId:'id',sessionId:'forged'},{agent:{id:'actual'}});assert.equal(calls.at(-1).sessionId,'actual');assert.equal(calls.at(-1).messageId,'id');
  await assert.rejects(say.execute({room:'r',text:'x'},{}),/agent/i);
  const r=await routes.get('/api/lan-mesh').fetch(new Request('http://localhost/api/lan-mesh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'r',payload:{method:'roomSay',payload:{room:'r',text:'x',sessionId:'forged',messageId:'owner-id'}}})}));assert.equal((await r.json()).result.ok,true);assert.equal(calls.at(-1).sessionId,'human');
 }finally{MeshNode.prototype.start=saved.start;MeshNode.prototype.sayInRoom=saved.say;}
});
