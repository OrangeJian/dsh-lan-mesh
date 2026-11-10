import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSyncEntry, attachmentFingerprint, fetchAttachmentManifest, syncPageHash, SYNC_MAX_BODY_BYTES } from '../lib/room-attachment-sync.mjs';
import { openRoomAttachments } from '../lib/room-attachment-service.mjs';
import { MeshNode } from '../lib/service.mjs';

const room='room-aaaaaaaaaaaa';
const ref={blobId:'a'.repeat(64),name:'a.txt',mediaType:'text/plain',size:1,ownerNodeId:'node-a'};
const entry={id:'message',room,from:{nodeId:'node-a',sessionId:'agent-a'},kind:'room-message',text:'hello',sentAt:new Date().toISOString(),receivedAt:new Date().toISOString(),attachments:[ref],mentions:[{memberKey:'node-b/human',label:'B'}],skillRefs:[{name:'review',sourceNodeId:'node-a',sourceNodeName:'A'}]};

test('manifest retains exact mentions and skill references across normalization',()=>{
 const normalized=normalizeSyncEntry({...entry,fingerprint:attachmentFingerprint(entry)});
 assert.deepEqual(normalized.mentions,entry.mentions);
 assert.deepEqual(normalized.skillRefs,entry.skillRefs);
 assert.equal(normalized.fingerprint,attachmentFingerprint(entry));
});

test('manifest cancels oversized streams and rejects excessive entry count',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 let cancelled=false;
 globalThis.fetch=async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(SYNC_MAX_BODY_BYTES+1));},cancel(){cancelled=true;}}));
 const options={nodeId:'node-a',peer:{nodeId:'node-b',address:'127.0.0.1',port:1},roomId:room};
 await assert.rejects(fetchAttachmentManifest(options),/SYNC_PAGE_TOO_LARGE/);
 assert.equal(cancelled,true);
 globalThis.fetch=async()=>Response.json({ok:true,syncVersion:1,room,leader:'node-b',entries:[{},{}],nextCursor:''});
 await assert.rejects(fetchAttachmentManifest({...options,limit:1}),/BAD_RESPONSE/);
});

test('unfinished reconciliation pages leave missing messages unknown',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sync-boundaries-'));
 const previous=globalThis.fetch;t.after(async()=>{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});});
 const roomView={id:room,leader:{nodeId:'node-b'},members:[{nodeId:'node-a',sessionId:'agent-a'}]};
 const node={nodeId:'node-a',config:{clusterSecret:''},resolvePeers:()=>[{nodeId:'node-b',address:'127.0.0.1',httpPort:1}],log:()=>{}};
 const api=await openRoomAttachments({dir,node,member:()=>roomView,peerMember:()=>true,publish:async()=>{}});
 await api.ledger.run(()=>api.ledger.prepare({...entry,attachmentsVersion:1,attachmentPhase:'prepare'},true));
 globalThis.fetch=async()=>Response.json({ok:true,syncVersion:1,room,leader:'node-b',entries:[],nextCursor:'more',hash:syncPageHash(room,'more',[])});
 const result=await api.reconcile({room,sessionId:'agent-a',maxPages:1});
 assert.deepEqual(result.unknown,['message']);assert.deepEqual(result.absent,[]);
 assert.equal(api.ledger.data.messages[api.ledger.key(entry)].reconcile,undefined);
});

test('agent-only room backfill uses a real member rather than human',async()=>{
 let received;
 const self={closed:false,nodeId:'node-a',roomsDoc:{version:1,rooms:{[room]:{id:room,name:'Room',leader:{nodeId:'node-b'},members:[{nodeId:'node-a',sessionId:'agent-a'}]}}},roomAttachmentHandler:async()=>{},attachmentService:{syncFromLeader:async request=>{received=request;}}};
 await MeshNode.prototype.backfillRoomAttachments.call(self,room,'agent-a');
 assert.equal(received.sessionId,'agent-a');
 await MeshNode.prototype.backfillRoomAttachments.call(self,room);
 assert.equal(received.sessionId,'agent-a');
});
