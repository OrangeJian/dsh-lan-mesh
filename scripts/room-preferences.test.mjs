import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RoomPreferences } from '../lib/room-preferences.mjs';
import { MeshNode } from '../lib/service.mjs';
import { emptyState, createRoom } from '../lib/rooms.mjs';

test('local preferences serialize updates, survive reopen, and reject invalid patches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mesh-prefs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'prefs.json');
  const prefs = new RoomPreferences(file);
  await prefs.load();
  assert.deepEqual(prefs.get('room'), { pinned: false, muted: false, muteAtException: true });
  await Promise.all([prefs.update('room', { pinned: true }), prefs.update('room', { muted: true })]);
  const reopened = new RoomPreferences(file); await reopened.load();
  assert.deepEqual(reopened.get('room'), { pinned: true, muted: true, muteAtException: true });
  assert.equal(reopened.get('other').muted, false);
  await assert.rejects(prefs.update('room', { muted: 'true' }), /boolean/);
  await assert.rejects(prefs.update('room', { actor: 'human' }), /field/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).rooms.room.muted, true);
});

test('corrupt or unwritable storage preserves prior data and never reports success', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mesh-prefs-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'prefs.json'); await writeFile(file, '{broken');
  const prefs = new RoomPreferences(file);
  await assert.rejects(prefs.load());
  await assert.rejects(prefs.update('room', { muted: true }));
  assert.equal(await readFile(file, 'utf8'), '{broken');
  const blocked = new RoomPreferences(join(file, 'child.json'));
  await assert.rejects(blocked.update('room', { pinned: true }));
  assert.equal(blocked.get('room').pinned, false);
});

test('human mute projections preserve read state and agent attention', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mesh-prefs-service-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const node = new MeshNode({ config: { port: 0 }, agents: { list: () => [{id:'worker'}], get: () => ({id:'worker'}) } });
  node.config.clusterSecret = ''; node.started = true; node.identity = {nodeId:'local', name:'Local'};
  node.roomPreferences = new RoomPreferences(join(dir, 'prefs.json'));
  node.roomsDoc = emptyState();
  const room = createRoom(node.roomsDoc, {name:'Test', leader:{nodeId:'local',sessionId:'human',name:'Human'}}, randomUUID);
  const item = (id, refs) => ({id, room:room.id, from:{nodeId:'remote',sessionId:'a'}, text:'Hello', read:false, mentions:[], structuredMentions:refs, kind:'room-message'});
  node.messages = [item('plain', []),item('human', [{memberKey:'local/human'}]),item('worker', [{memberKey:'local/worker'}])];
  const before = JSON.stringify(node.roomsDoc);
  await node.setRoomPreferences({roomId:room.id,patch:{muted:true},via:'panel'});
  assert.deepEqual(node.humanInbox().messages.map(r=>r.id), ['human']);
  assert.equal(node.snapshot({sessionId:'human'}).rooms.unread[room.id], 1);
  assert.equal(node.inbox({sessionId:'worker',attentionOnly:true}).messages.length, 1);
  assert.equal(node.messages.every(row=>row.read===false), true);
  await node.setRoomPreferences({roomId:room.id,patch:{muteAtException:false},via:'panel'});
  assert.equal(node.humanInbox().unread, 0);
  assert.equal(node.snapshot({sessionId:'human'}).attention.messages.length, 0);
  assert.equal(JSON.stringify(node.roomsDoc), before);
  await assert.rejects(node.setRoomPreferences({roomId:room.id,patch:{muted:false}}), /human|panel/);
  const other = new MeshNode({config:{port:0}});
  assert.equal(other.roomPreferences.get(room.id).muted,false);
});
