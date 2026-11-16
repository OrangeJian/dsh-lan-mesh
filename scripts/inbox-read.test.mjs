import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';
import { appendInbox, rewriteInbox, readInbox, meshRootDir } from '../lib/store.mjs';

async function fixture(t) {
  const previous = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), 'mesh-inbox-read-'));
  process.env.DSH_HOME = home;
  const config = { port: 0, discoveryPort: 0, autoWake: false, clusterSecret: '', trustedPeers: [] };
  const nodes = [];
  const open = async () => {
    const node = new MeshNode({ config });
    nodes.push(node);
    await node.start();
    return node;
  };
  t.after(async () => {
    for (const node of nodes) await node.close();
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });
  return { open };
}

function message(id, nodeId, sessionId = 'human', extra = {}) {
  return { id, from: { nodeId, sessionId }, to: 'local', kind: 'note', text: id, sentAt: new Date().toISOString(), ...extra };
}

test('human inbox excludes every local human send before paging and preserves agent history', async t => {
  const { open } = await fixture(t);
  const node = await open();
  await node.receive(message('remote-human', 'remote-node'));
  await node.receive(message('local-agent', node.nodeId, 'agent-one'));
  await node.receive(message('remote-agent', 'remote-node', 'agent-two'));
  // More outgoing messages than the former snapshot limit must not hide inbound.
  for (let i = 0; i < 110; i++) await node.receive(message(`own-${i}`, node.nodeId, i % 2 ? 'human' : '', { to: `${node.nodeId}/agent-one` }));
  const snapshot = node.snapshot({ sessionId: 'human' });
  assert.deepEqual(snapshot.inbox.messages.map(item => item.id), ['remote-human', 'local-agent', 'remote-agent']);
  assert.equal(snapshot.inbox.unread, snapshot.inbox.messages.length);
  assert.equal(snapshot.self.unread, 3);
  assert.equal(node.inbox({ limit: 200 }).messages.length, 113, 'agent inbox retains all records');
  assert.equal(node.inbox({ limit: 200 }).unread, 113, 'agent unread semantics unchanged');
  assert.equal(node.snapshot().inbox.unread, 3, 'snapshot polling does not mark anything read');
});

test('single ordinary room message and all-read flags survive close and restart', async t => {
  const { open } = await fixture(t);
  let node = await open();
  const created = await node.createRoom({ name: 'Read persistence', sessionId: 'human' });
  const roomId = created.room.id;
  await node.receive(message('ordinary-room', 'remote-node', 'human', { kind: 'room-message', room: roomId }));
  await node.receive(message('private', 'remote-node', 'agent-one', { file: { name: 'note.txt', size: 1, type: 'text/plain', data: 'data:text/plain;base64,eA==' } }));
  node.roomDetail({ room: roomId, sessionId: 'human' });
  assert.equal(node.humanInbox().unread, 1, 'viewing the room clears ordinary replies but not private messages');
  assert.equal(await node.markAllRead('ordinary-room'), 0);
  assert.deepEqual(node.humanInbox().messages.map(item => item.id), ['private']);
  assert.equal((await readInbox({ port: 0 })).find(item => item.envelope.id === 'ordinary-room').read, true);
  await node.close();
  node = await open();
  assert.deepEqual(node.humanInbox().messages.map(item => item.id), ['private']);
  assert.equal(await node.markAllRead(), 1);
  await node.close();
  node = await open();
  assert.equal(node.humanInbox().unread, 0);
  assert.equal(node.snapshot().self.unread, 0);
  assert.equal(node.inbox().messages.find(item => item.id === 'private').file.name, 'note.txt');
});

test('open human room acknowledges new agent replies without clearing other rooms or private mail', async t => {
  const { open } = await fixture(t);
  const node = await open();
  const first = await node.createRoom({ name: 'Visible', sessionId: 'human' });
  const other = await node.createRoom({ name: 'Other', sessionId: 'human' });
  await node.receive(message('other-reply', 'remote', 'agent', { kind: 'room-message', room: other.room.id }));
  await node.receive(message('private-reply', 'remote', 'agent'));
  for (const id of ['reply-one', 'reply-two']) {
    await node.receive(message(id, 'remote', 'agent', { kind: 'room-message', room: first.room.id }));
    node.roomDetail({ room: first.room.id, sessionId: 'human' });
    assert.deepEqual(node.humanInbox().messages.map(m => m.id), ['other-reply', 'private-reply']);
  }
  await node.close();
  const fresh = await open();
  assert.deepEqual(fresh.humanInbox().messages.map(m => m.id), ['other-reply', 'private-reply']);
});

test('concurrent delivery and repeated read rewrites retain all records and durable flags', async t => {
  const { open } = await fixture(t);
  const node = await open();
  await node.receive(message('first', 'remote-node'));
  const operations = [node.markAllRead('first')];
  for (let i = 0; i < 25; i++) {
    operations.push(node.receive(message(`new-${i}`, 'remote-node')));
    operations.push(node.markAllRead(`new-${i}`));
  }
  await Promise.all(operations);
  const stored = await readInbox({ port: 0, limit: 200 });
  assert.equal(stored.length, 26);
  assert.equal(new Set(stored.map(item => item.envelope.id)).size, 26);
  assert.ok(stored.every(item => item.read));
  assert.equal(node.humanInbox().unread, 0);
  // Direct store users use the same ordering, including multiple atomic rewrites.
  const record = { envelope: message('store-first', 'remote-node'), read: true };
  const later = { envelope: message('store-later', 'remote-node'), read: false };
  await Promise.all([rewriteInbox([record], { port: 1 }), appendInbox(later, { port: 1 }), rewriteInbox([record, { ...later, read: true }], { port: 1 })]);
  assert.deepEqual((await readInbox({ port: 1 })).map(item => [item.envelope.id, item.read]), [['store-first', true], ['store-later', true]]);
});

test('room history exposes every retained message beyond twenty and survives restart', async t => {
  const { open }=await fixture(t);let node=await open();const {room}=await node.createRoom({name:'Long Room history',sessionId:'human'});
  for(let index=0;index<41;index++)await node.receive(message('history-'+index,'remote-node','human',{kind:'room-message',room:room.id,text:'history line '+index}));
  let detail=node.roomDetail({room:room.id,sessionId:'human'});
  assert.equal(detail.messages.length,41);assert.equal(detail.messages[0].id,'history-0');assert.equal(detail.messages.at(-1).id,'history-40');
  await node.close();node=await open();detail=node.roomDetail({room:room.id,sessionId:'human'});
  assert.equal(detail.messages.length,41);assert.equal(detail.messages[0].id,'history-0');assert.ok(detail.messages.every(row=>row.read===true));
});
test('long room history filters by exact room before displaying retained records', async t => {
  const {open}=await fixture(t);const node=await open();const first=await node.createRoom({name:'First history',sessionId:'human'}),second=await node.createRoom({name:'Second history',sessionId:'human'});
  for(let index=0;index<60;index++)await node.receive(message('mixed-'+index,'remote-node','human',{kind:'room-message',room:index%2?first.room.id:second.room.id}));
  const detail=node.roomDetail({room:first.room.id,sessionId:'human'});assert.equal(detail.messages.length,30);assert.ok(detail.messages.every(row=>row.room===first.room.id));assert.equal(detail.messages[0].id,'mixed-1');
});

test('read and shutdown checkpoints never truncate durable history beyond the memory window',async t=>{
 const {open}=await fixture(t);
 for(let i=0;i<620;i++)await appendInbox({envelope:message('archive-'+i,'remote-node','human',{kind:'room-message',room:'room-retained'}),receivedAt:new Date(1700000000000+i).toISOString(),read:false},{port:0});
 let node=await open();assert.equal(node.messages.length,500);await node.markAllRead();await node.close();
 let records=await readInbox({port:0,limit:1000});assert.equal(records.length,620);assert.equal(records[0].envelope.id,'archive-0');assert.equal(records.at(-1).read,true);
 node=await open();await node.close();records=await readInbox({port:0,limit:1000});assert.equal(records.length,620);assert.equal(records[0].envelope.text,'archive-0');
});
test('preserving checkpoint keeps concurrent appends and distinguishes same ids from different origins',async t=>{
 await fixture(t);const a={envelope:message('same','a'),read:false},b={envelope:message('same','b'),read:false};
 await appendInbox(a,{port:1});await appendInbox(b,{port:1});
 await Promise.all([rewriteInbox([{...a,read:true}],{port:1,preserveUnlisted:true}),appendInbox({envelope:message('new','c'),read:false},{port:1})]);
 const rows=await readInbox({port:1,limit:1000});assert.equal(rows.length,3);assert.equal(rows[0].read,true);assert.equal(rows[1].envelope.from.nodeId,'b');assert.equal(rows[2].envelope.id,'new');
});

test('explicit read can target one origin without acknowledging another origin with the same message id',async t=>{
 const {open}=await fixture(t);for(const origin of ['first','second'])await appendInbox({envelope:message('shared-id',origin,'agent'),receivedAt:new Date().toISOString(),read:false},{port:0});const node=await open();
 assert.equal(await node.markAllRead('shared-id','first'),1);assert.equal(node.messages.find(row=>row.from.nodeId==='first').read,true);assert.equal(node.messages.find(row=>row.from.nodeId==='second').read,false);
});

test('failed durable read acknowledgement keeps unread state until a successful retry',async t=>{
 const {open}=await fixture(t),node=await open();await node.receive(message('retry-read','remote','agent'));await readInbox({port:0});
 const blocked=join(meshRootDir(0),'inbox.jsonl.tmp');await mkdir(blocked);
 try{await assert.rejects(node.markAllRead('retry-read','remote'));assert.equal(node.messages.find(row=>row.id==='retry-read').read,false);assert.equal(node.humanInbox().unread,1);assert.equal((await readInbox({port:0})).find(row=>row.envelope.id==='retry-read').read,false);}finally{await rm(blocked,{recursive:true,force:true});}
 assert.equal(await node.markAllRead('retry-read','remote'),1);assert.equal(node.humanInbox().unread,0);
});

test('failed room auto-read rolls the badge back instead of claiming a read a restart would lose',async t=>{
 const {open}=await fixture(t);const node=await open();const {room}=await node.createRoom({name:'Read failure',sessionId:'human'});
 await node.receive(message('room-unread','remote-node','agent',{kind:'room-message',room:room.id,text:'needs a look'}));
 const blocked=join(meshRootDir(0),'inbox.jsonl.tmp');await mkdir(blocked);
 try{
  // The call stays synchronous: the panel and roomDetail both read the count in
  // the same expression, so the flip is optimistic and the rewrite is queued.
  assert.equal(node.markRoomRead(room.id,'human'),1);
  assert.equal(node.messages.find(row=>row.id==='room-unread').read,true);
  await node.inboxReadsSettled();
  assert.equal(node.messages.find(row=>row.id==='room-unread').read,false);
  assert.equal(node.humanInbox().unread,1);
  assert.equal((await readInbox({port:0})).find(row=>row.envelope.id==='room-unread').read,false);
 }finally{await rm(blocked,{recursive:true,force:true});}
 assert.equal(node.markRoomRead(room.id,'human'),1);
 await node.inboxReadsSettled();
 assert.equal(node.humanInbox().unread,0);
 assert.equal((await readInbox({port:0})).find(row=>row.envelope.id==='room-unread').read,true);
});

test('failed inbox markRead keeps the unread count and is retryable without throwing',async t=>{
 const {open}=await fixture(t);const node=await open();await node.receive(message('agent-unread','remote-node','agent'));
 const blocked=join(meshRootDir(0),'inbox.jsonl.tmp');await mkdir(blocked);
 try{
  const page=node.inbox({limit:20,markRead:true});
  assert.equal(page.unread,0);
  await node.inboxReadsSettled();
  assert.equal(node.inbox({limit:20}).unread,1);
  assert.equal((await readInbox({port:0})).find(row=>row.envelope.id==='agent-unread').read,false);
 }finally{await rm(blocked,{recursive:true,force:true});}
 node.inbox({limit:20,markRead:true});
 await node.inboxReadsSettled();
 assert.equal(node.inbox({limit:20}).unread,0);
 assert.equal((await readInbox({port:0})).find(row=>row.envelope.id==='agent-unread').read,true);
});

test('queued room reads survive shutdown and never publish a stale unread record',async t=>{
 const {open}=await fixture(t);let node=await open();const {room}=await node.createRoom({name:'Burst reads',sessionId:'human'});
 for(let index=0;index<8;index++)await node.receive(message('burst-'+index,'remote-node','agent',{kind:'room-message',room:room.id,text:'line '+index}));
 assert.equal(node.markRoomRead(room.id,'human'),8);
 // Close immediately: the queued rewrite must be awaited before the final
 // checkpoint, otherwise the restart below reloads all eight as unread.
 await node.close();
 node=await open();
 assert.ok(node.messages.filter(row=>row.room===room.id).every(row=>row.read===true));
 assert.equal(node.humanInbox().unread,0);
 assert.ok((await readInbox({port:0})).filter(row=>row.envelope.room===room.id).every(row=>row.read));
});
