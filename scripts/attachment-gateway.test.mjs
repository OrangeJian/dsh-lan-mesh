import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {registerAttachmentGateway} from '../lib/attachment-gateway.mjs';
const bytes=Buffer.from([0,255,17,43]);
const ref={blobId:createHash('sha256').update(bytes).digest('hex'),name:'测试.html',mediaType:'text/html',size:4,ownerNodeId:'local'};
function fixture(){let route;const received=[];const node={start:async()=>{},snapshot:()=>({roomAttachmentLimits:{maxFileBytes:8}}),describeRoomAttachment:({room,sessionId,blobId})=>{assert.equal(sessionId,'human');if(room!=='room')throw Error('not a member');if(blobId!==ref.blobId)throw Error('no reference');return ref;},uploadRoomAttachment:async r=>{received.push(r);const chunks=[];for await(const c of r.readable)chunks.push(c);assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(r.sessionId,'human');return ref;},readRoomAttachment:async r=>{assert.equal(r.sessionId,'human');return Readable.from([bytes]);}};registerAttachmentGateway({fetch:{register:r=>{route=r;return ()=>{};}}},node);return {route,received};}
const url='http://localhost/api/lan-mesh/attachments?room=room&name='+encodeURIComponent(ref.name)+'&size=4&blobId='+ref.blobId;
test('owner streaming gateway consumes real Request and returns compact ref',async()=>{const {route,received}=fixture();assert.equal(route.path,'/api/lan-mesh/attachments');assert.equal(route.requestBody,'streaming');assert.deepEqual(route.methods,['POST','GET']);const r=await route.fetch(new Request(url+'&sessionId=forged',{method:'POST',body:Readable.toWeb(Readable.from([bytes])),duplex:'half',headers:{'content-type':'text/html'}}));assert.equal(r.status,200);assert.deepEqual(await r.json(),ref);assert.equal(received.length,1);});
test('GET authorizes exact room ref and forces active content download using stored metadata',async()=>{const {route}=fixture();const r=await route.fetch(new Request(url+'&mediaType=image/png&name=x.png&preview=1'));assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'text/html');assert.match(r.headers.get('content-disposition'),/^attachment;.*filename\*=UTF-8/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.equal((await route.fetch(new Request(url.replace('room=room','room=other')))).status,403);assert.equal((await route.fetch(new Request(url.replace(ref.blobId,'a'.repeat(64))))).status,403);});
test('gateway rejects size, malformed headers and pre-abort before storage',async()=>{const {route,received}=fixture();for(const u of [url.replace('size=4','size=9'),url.replace('size=4','size=wat'),url.replace(ref.blobId,'bad')]){const r=await route.fetch(new Request(u,{method:'POST',body:bytes,headers:{'content-type':'application/octet-stream'}}));assert.ok(r.status>=400);}const c=new AbortController();c.abort();assert.equal((await route.fetch(new Request(url,{method:'POST',body:bytes,signal:c.signal}))).status,499);assert.equal(received.length,0);});
test('stream abort propagates while upload is consuming Request body',async()=>{
 let route,destroyed=false;const c=new AbortController();const node={start:async()=>{},snapshot:()=>({roomAttachmentLimits:{maxFileBytes:8}}),uploadRoomAttachment:async({readable})=>{try{for await(const chunk of readable){c.abort();}}catch(e){destroyed=readable.destroyed;throw e;}throw Error('expected abort');}};
 registerAttachmentGateway({fetch:{register:r=>{route=r;}}},node);
 const body=new ReadableStream({start(controller){controller.enqueue(bytes);}});
 const r=await route.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/octet-stream'},body,duplex:'half',signal:c.signal}));assert.equal(r.status,499);assert.equal(destroyed,true);
});
test('abort while service upload waits in queue cannot emit unhandled stream error',async()=>{
 let route,entered;const waiting=new Promise(r=>entered=r);let resume;const gate=new Promise(r=>resume=r);const c=new AbortController();
 const node={start:async()=>{},snapshot:()=>({roomAttachmentLimits:{maxFileBytes:8}}),uploadRoomAttachment:async({readable})=>{entered();await gate;for await(const part of readable){};}};
 registerAttachmentGateway({fetch:{register:r=>route=r}},node);
 const response=route.fetch(new Request(url,{method:'POST',body:bytes,signal:c.signal}));await waiting;c.abort();await new Promise(r=>setImmediate(r));resume();assert.equal((await response).status,499);
});
