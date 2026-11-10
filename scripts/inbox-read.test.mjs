import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';
import { appendInbox, rewriteInbox, readInbox } from '../lib/store.mjs';

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
