/**
 * Tests for pulling a local session into a room.
 *
 * The permission question here is not "did the button render" but "what does
 * the server accept". Every fact the decision rests on has to be derived on
 * this node: which authority a caller may use follows from the surface it
 * arrived on — the owner-only panel route grants the human rule, an agent's own
 * tool execution does not — while membership comes from the replicated room
 * document and the invited session from the real local agent catalogue. A
 * client that merely claims to be human, claims another node, or names a session
 * that does not exist here must not get a member row manufactured for it.
 *
 * @module dsh-lan-mesh/scripts/room-invite.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';
import { emptyState, createRoom, joinRoom, memberKey } from '../lib/rooms.mjs';

const ROOM_ID_SEED = 'aaaaaaaaaaaa-1111-2222-3333-444444444444';

/**
 * Build a started node with a fixed identity and a room document, without
 * touching the network: `started` short-circuits `start()`, and an undefined
 * discovery service leaves `syncRooms()` with no peers to push to.
 * @param {object} options - identity, room state, live agents, stored headers.
 * @returns {MeshNode}
 */
function makeNode({ nodeId, nodeName, state, agents = [], stored = [] }) {
  const live = new Map(agents.map((row) => [row.id, row]));
  const node = new MeshNode({
    config: { port: 0, autoWake: true, clusterSecret: '' },
    agents: { get: (id) => live.get(id), list: () => [...live.values()] },
    sessionPersistence: { list: async () => stored.map((header) => ({ header })) },
  });
  node.started = true;
  node.identity = { nodeId, name: nodeName, createdAt: '2026-11-08T00:00:00.000Z' };
  node.roomsDoc = structuredClone(state);
  return node;
}

/**
 * A room whose leader is an agent session, with one human member already in it.
 * `human` is the fixed session id the panel uses for the person at the screen.
 */
function seededState() {
  const state = emptyState();
  const room = createRoom(
    state,
    { name: 'Invite', leader: { nodeId: 'node-local', sessionId: 'agent-leader', name: 'Leader' } },
    () => ROOM_ID_SEED,
  );
  joinRoom(state, room.id, { nodeId: 'node-local', sessionId: 'human', name: '建哥' });
  return { state, roomId: room.id };
}

test('a human room member can pull a local live agent session into the room', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  const result = await node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: 'worker-1' });
  assert.equal(result.added, true);
  const added = result.room.members.find((member) => member.sessionId === 'worker-1');
  assert.ok(added, 'the invited session became a member');
  assert.equal(added.nodeId, 'node-local', 'the node is derived server-side, not claimed by the client');
});

test('a stored session this node can resume is a legitimate invite target', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-stored-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    stored: [{ id: 'stored-1', cwd: 'C:/work' }],
  });

  const result = await node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: 'stored-1' });
  assert.equal(result.added, true);
  assert.ok(result.room.members.some((member) => member.sessionId === 'stored-1'));
});

test('a human who is not a member of this room cannot add anyone', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-outsider-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const state = emptyState();
  const room = createRoom(
    state,
    { name: 'Closed', leader: { nodeId: 'node-elsewhere', sessionId: 'agent-far', name: 'Far' } },
    () => ROOM_ID_SEED,
  );
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  await assert.rejects(
    node.addRoomMember({ room: room.id, via: 'panel', memberSessionId: 'worker-1' }),
    (error) => error.code === 'NOT_LEADER' && /leader or a human room member/.test(error.message),
  );
  assert.equal(node.roomsDoc.rooms[room.id].members.some((member) => member.sessionId === 'worker-1'), false);
});

test('an agent member that is not the leader cannot add members by claiming to be human', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-agent-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  joinRoom(state, roomId, { nodeId: 'node-local', sessionId: 'agent-member', name: 'Member' });
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  // The payload lies about being human; nothing in it can promote the caller,
  // because the human rule is granted by the panel surface and this call did
  // not come from one.
  await assert.rejects(
    node.addRoomMember({
      room: roomId,
      sessionId: 'agent-member',
      memberNodeId: 'node-local',
      memberSessionId: 'worker-1',
      human: true,
      role: 'leader',
    }),
    (error) => error.code === 'NOT_LEADER',
  );
});

test('an agent cannot borrow the human rule by passing the human session id', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-impersonate-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  // `node-local/human` is a real, listed member of this room, so a payload
  // carrying that id would previously have been read as "a human member is
  // asking". Without `via: 'panel'` no owner-authenticated surface is involved,
  // so the call is an agent's and only the leader path remains — the string
  // alone buys nothing.
  await assert.rejects(
    node.addRoomMember({ room: roomId, sessionId: 'human', memberSessionId: 'worker-1' }),
    (error) => error.code === 'NOT_LEADER',
  );
  assert.equal(
    node.roomsDoc.rooms[roomId].members.some((member) => member.sessionId === 'worker-1'),
    false,
    'no member row was manufactured for the impersonating call',
  );
});

test('a target hosted on another node is refused even when the client claims otherwise', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-crossnode-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  await assert.rejects(
    node.addRoomMember({
      room: roomId,
      via: 'panel',
      memberSessionId: 'worker-1',
      memberNodeId: 'node-remote',
    }),
    (error) => error.code === 'BAD_REQUEST' && /hosted on this node/.test(error.message),
  );
});

test('a session that does not exist on this node is refused', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-missing-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({ nodeId: 'node-local', nodeName: 'Local node', state, agents: [] });

  await assert.rejects(
    node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: 'ghost-session' }),
    (error) => error.code === 'BAD_REQUEST' && /does not exist/.test(error.message),
  );
  // The human's own session id is not an invite target either: it is already in
  // the room by construction and has no agent behind it.
  await assert.rejects(
    node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: 'human' }),
    (error) => error.code === 'BAD_REQUEST' && /agent session is required/.test(error.message),
  );
});

test('inviting the same session twice is idempotent', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-twice-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  const first = await node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: 'worker-1' });
  const second = await node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: 'worker-1' });
  assert.equal(first.added, true);
  assert.equal(second.added, false);
  const rows = second.room.members.filter((member) => member.key === memberKey('node-local', 'worker-1'));
  assert.equal(rows.length, 1);
});

test('the original leader path still works for an agent leader', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-leader-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: 'worker-1', status: 'idle' }],
  });

  // The tool layer creates rooms with an agent session id as the leader, so an
  // agent leader must keep its ability to add a worker.
  const result = await node.addRoomMember({ room: roomId, sessionId: 'agent-leader', memberSessionId: 'worker-1' });
  assert.equal(result.added, true);
  assert.ok(result.room.members.some((member) => member.sessionId === 'worker-1'));
});

test('two sessions sharing the 64-char member-key prefix are refused rather than merged', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-prefix-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  // agent-team recycle ids reuse the first 64 chars; the room layer truncates
  // member session ids to exactly that, so both rows would land on one key.
  const shared = 'r'.repeat(64);
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [
      { id: `${shared}-session-one`, status: 'idle' },
      { id: `${shared}-session-two`, status: 'idle' },
    ],
  });

  await assert.rejects(
    node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: `${shared}-session-one` }),
    (error) => error.code === 'AMBIGUOUS_ROOM' && /ambiguous/.test(error.message),
  );
  assert.equal(node.roomsDoc.rooms[roomId].members.some((member) => member.sessionId === shared), false);
});

test('a stored session with the same 64-char prefix as a live one is also refused', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-invite-prefix-stored-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  const { state, roomId } = seededState();
  const shared = 'q'.repeat(64);
  const node = makeNode({
    nodeId: 'node-local',
    nodeName: 'Local node',
    state,
    agents: [{ id: `${shared}-live`, status: 'idle' }],
    stored: [{ id: `${shared}-stored`, cwd: 'C:/work' }],
  });

  await assert.rejects(
    node.addRoomMember({ room: roomId, via: 'panel', memberSessionId: `${shared}-live` }),
    (error) => error.code === 'AMBIGUOUS_ROOM',
  );
});
