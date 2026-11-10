import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSharedDocuments} from '../lib/shared-doc-service.mjs';
import {signEnvelope,verifyEnvelope,normalizeEnvelope} from '../lib/transport.mjs';

test('admitted mutation replay survives restart; a fresh request with stable business ID is idempotent',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shared-doc-replay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const roomId='room-aaaaaaaaaaaa',node={nodeId:'node-b',identity:{name:'B'},config:{clusterSecret:'secret'},resolvePeers:()=>[],log:()=>{}};
 const rooms=()=>({[roomId]:{id:roomId,leader:{nodeId:'node-b',sessionId:'human',key:'node-b/human'},members:[{nodeId:'node-a',sessionId:'human',key:'node-a/human'},{nodeId:'node-b',sessionId:'human',key:'node-b/human'}]}});
 const envelope={id:'request-one',kind:'shared-doc',to:'node-b',from:{nodeId:'node-a',sessionId:'human'},sentAt:new Date().toISOString(),payload:{method:'createDocument',actorKind:'human',request:{roomId,title:'Replay',content:'one',requestId:'business-one'}}};
 let service=await openSharedDocuments({dir,node,rooms});
 const first=await service.receive(envelope);await service.close();
 service=await openSharedDocuments({dir,node,rooms});
 try{
  await assert.rejects(service.receive(envelope),/Previously admitted/);
  const retried=await service.receive({...envelope,id:'fresh-request'});
  assert.equal(retried.body.value.document.documentId,first.body.value.document.documentId);
  assert.equal(Object.keys(service.store.state().documents).length,1);
 }finally{await service.close();}
});

test('context content and pinned revisions are covered by signatures and bounded at intake',()=>{
 const packet={roomId:'room-aaaaaaaaaaaa',selectedDocumentVersions:[{documentId:'doc-aaaaaaaaaaaa',revisionId:'rev-aaaaaaaaaaaa',contentHash:'a'.repeat(64),content:'old revision'}]};
 const envelope={v:2,id:'context-signature',kind:'room-message',from:{nodeId:'node-a',sessionId:'human'},to:'node-b',room:packet.roomId,text:'review',sentAt:new Date().toISOString(),contextPacket:packet,roomContextVersion:1};
 envelope.sig=signEnvelope(envelope,'secret');
 assert.equal(verifyEnvelope(normalizeEnvelope(envelope),'secret'),true);
 const changed=structuredClone(envelope);changed.contextPacket.selectedDocumentVersions[0].content='tampered';
 assert.equal(verifyEnvelope(changed,'secret'),false);
 changed.contextPacket.selectedDocumentVersions[0].content='x'.repeat(65536);
 assert.throws(()=>normalizeEnvelope(changed),/too large/);
 assert.throws(()=>normalizeEnvelope({...envelope,roomContextVersion:2}),/context version/);
});
