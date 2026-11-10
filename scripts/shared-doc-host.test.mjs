import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {apply} from '../index.js';

test('real owner document RPC and Agent tools bind identity and import/export through Host',async t=>{
 const previous=process.env.DSH_HOME,home=await mkdtemp(join(tmpdir(),'shared-doc-host-'));
 process.env.DSH_HOME=home;
 const tools=new Map(),routes=new Map(),disposers=[];
 const ctx={get:name=>name==='tools'?{register:definition=>{tools.set(definition.name,definition);return ()=>{};}}:undefined,effect:fn=>{const dispose=fn();if(typeof dispose==='function')disposers.push(dispose);},inject(names,fn){return fn({tools:this.get('tools'),connection:{fetch:{register:route=>{routes.set(route.path,route);return ()=>{};}}},effect:this.effect});}};
 t.after(async()=>{for(const dispose of disposers.reverse())await dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(home,{recursive:true,force:true});});
 apply(ctx,{port:39873,discoveryPort:39874,autoWake:false});
 const rpc=async(method,payload)=>{
  const response=await routes.get('/api/lan-mesh').fetch(new Request('http://localhost/api/lan-mesh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:method,payload:{method,payload}})}));
  const result=(await response.json()).result;
  assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;
 };
 const room=(await rpc('roomCreate',{name:'Documents'})).room;
 const created=await rpc('documentCreate',{roomId:room.id,title:'Design',content:'First version',message:'initial',requestId:'host-create'});
 const documentId=created.document.documentId;
 assert.equal((await rpc('documentCreate',{roomId:room.id,title:'Design',content:'First version',message:'initial',requestId:'host-create'})).document.documentId,documentId);
 await tools.get('lan_mesh_room_member').execute({action:'join',room:room.id},{agent:{id:'actual-agent'}});
 const read=tools.get('lan_mesh_document_read');
 const output=await read.execute({documentId},{agent:{id:'actual-agent'}});
 assert.equal(JSON.parse(output.summary).document.content,'First version');
 const packet=await tools.get('lan_mesh_room_context').execute({roomId:room.id,contextSelection:{documentIds:[documentId]}},{agent:{id:'actual-agent'}});
 assert.equal(JSON.parse(packet.summary).selectedDocumentVersions[0].content,'First version');
 await assert.rejects(read.execute({documentId},{}),/executing Agent/);
 const forged=await routes.get('/api/lan-mesh').fetch(new Request('http://localhost/api/lan-mesh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'forged',payload:{method:'documentCreate',payload:{roomId:room.id,title:'Human',content:'Owner',sessionId:'not-member',actorKey:'remote/human'}}})}));
 assert.equal((await forged.json()).result.ok,true);
 const imported=await rpc('documentImport',{roomId:room.id,name:'import.md',content:'# imported',requestId:'host-import'});
 const exported=await rpc('documentExport',{documentId:imported.document.documentId});
 assert.equal(exported.content,'# imported');assert.match(exported.name,/\.md$/);
 const history=await rpc('documentHistory',{documentId:imported.document.documentId});
 assert.ok(history.events.some(event=>event.type==='document-imported'));
});
