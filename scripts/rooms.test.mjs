/**
 * Unit tests for the room layer.
 *
 * The merge rules are the reason this file exists: two nodes that merge in
 * opposite orders must agree, or a project's task board would flip depending on
 * who happened to talk first. Everything else is smaller but still worth
 * pinning — the room document is replicated between machines, so a sloppy
 * normalization would spread corruption instead of containing it.
 *
 * @module dsh-lan-mesh/scripts/rooms.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';
import { signStatePayload } from '../lib/transport.mjs';
import {
  ROOM_STATE_VERSION,
  MAX_ROOM_NAME,
  MAX_TASK_DETAIL,
  MAX_TASKS_PER_ROOM,
  TASK_STATUSES,
  emptyState,
  normalizeState,
  memberKey,
  createRoom,
  findRoom,
  joinRoom,
  addMember,
  leaveRoom,
  renameRoom,
  assignTask,
  setTaskStatus,
  retireRoom,
  mergeStates,
  exportState,
  roomsFor,
  allRooms,
  tasksFor,
  resolveMember,
  resolveTask,
  membersByNode,
} from '../lib/rooms.mjs';

/** Deterministic uuid source so ids are stable across runs. */
function uuidFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    // The counter sits in the first group so that the 12 hex characters rooms.mjs
    // slices into an id stay unique for as many calls as a test needs.
    return `${counter.toString(16).padStart(12, '0')}-1111-2222-3333-444444444444`;
  };
}

const AT = '2026-10-29T00:00:00.000Z';
const LATER = '2026-10-29T01:00:00.000Z';
const SELF = { nodeId: 'node-aaaa1111', sessionId: 'sess-1', name: 'alice' };
const PEER = { nodeId: 'node-bbbb2222', sessionId: 'sess-2', name: 'bob' };
const OTHER = { nodeId: 'node-cccc3333', sessionId: 'sess-3', name: 'carol' };

test('machine names survive room creation and normalized export including legacy members', () => {
  const state = emptyState();
  const room = createRoom(state, { name: 'Machines', leader: { ...SELF, nodeName: ' Alice laptop ' } }, uuidFactory(), AT);
  joinRoom(state, room.id, PEER, AT);
  const restored = normalizeState(JSON.parse(JSON.stringify(exportState(state)))).rooms[room.id];
  assert.equal(restored.leader.nodeName, 'Alice laptop');
  assert.equal(restored.members[0].nodeName, 'Alice laptop');
  assert.equal(restored.members[0].nodeNameUpdatedAt, AT);
  assert.equal(restored.members[1].key, 'node-bbbb2222/sess-2');
});

test('newer machine name wins independently of member name in both merge orders', () => {
  const { state, room } = oneRoom();
  room.leader.nodeName = room.members[0].nodeName = 'Old laptop';
  room.leader.nodeNameUpdatedAt = room.members[0].nodeNameUpdatedAt = AT;
  const newer = structuredClone(state);
  for (const member of [newer.rooms[room.id].leader, ...newer.rooms[room.id].members]) {
    member.nodeName = 'New laptop';
    member.nodeNameUpdatedAt = LATER;
  }
  for (const merged of [mergeStates(state, newer), mergeStates(newer, state)]) {
    assert.equal(merged.state.rooms[room.id].leader.nodeName, 'New laptop');
    assert.equal(merged.state.rooms[room.id].members[0].nodeName, 'New laptop');
    assert.equal(merged.state.rooms[room.id].members[0].name, 'alice');
  }
  assert.equal(mergeStates(state, newer).changed, true);
});

test('machine display metadata preserves legacy state signatures', () => {
  const { state, room } = oneRoom();
  const payload = { from: { nodeId: SELF.nodeId }, state };
  const legacySignature = signStatePayload(payload, 'secret');
  for (const member of [room.leader, ...room.members]) {
    member.nodeName = 'Laptop';
    member.nodeNameUpdatedAt = LATER;
  }
  assert.equal(signStatePayload(payload, 'secret'), legacySignature);
  room.members[0].sessionId = 'different-session';
  assert.notEqual(signStatePayload(payload, 'secret'), legacySignature);
});

test('service projects discovered names and persists local machine renames on sync', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'room-machine-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  });
  const { state, room } = oneRoom();
  joinRoom(state, room.id, { ...PEER, nodeName: 'Saved remote' }, AT);
  const node = new MeshNode({ config: { port: 0 } });
  node.started = true;
  node.identity = { nodeId: SELF.nodeId, name: 'Local laptop' };
  node.roomsDoc = state;
  node.discovery = { list: () => [{ nodeId: PEER.nodeId, name: 'Discovered remote' }] };
  let view = node.roomDetail({ room: room.id }).room;
  assert.equal(view.members[0].nodeName, 'Local laptop');
  assert.equal(view.members[1].nodeName, 'Discovered remote');
  node.discovery = undefined;
  await node.syncRooms();
  assert.equal(room.members[0].nodeName, 'Local laptop');
  assert.equal(room.leader.nodeName, 'Local laptop');
  const firstStamp = room.members[0].nodeNameUpdatedAt;
  node.identity.name = 'Renamed laptop';
  await node.syncRooms();
  assert.equal(room.members[0].nodeName, 'Renamed laptop');
  assert.ok(room.members[0].nodeNameUpdatedAt > firstStamp);
  view = node.roomDetail({ room: room.id }).room;
  assert.equal(view.members[1].nodeName, 'Saved remote');
});

/**
 * Build a state with one room created by {@link SELF}.
 * @returns {{ state: object, room: object }}
 */
function oneRoom() {
  const state = emptyState();
  const room = createRoom(
    state,
    { name: 'Apollo', topic: 'ship the thing', leader: SELF },
    uuidFactory(),
    AT,
  );
  return { state, room };
}

test('emptyState is versioned and empty', () => {
  const state = emptyState();
  assert.equal(state.version, ROOM_STATE_VERSION);
  assert.deepEqual(state.rooms, {});
});

test('normalizeState survives garbage instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'nope', [], { rooms: null }, { rooms: 3 }]) {
    const state = normalizeState(bad);
    assert.equal(state.version, ROOM_STATE_VERSION);
    assert.deepEqual(state.rooms, {});
  }
});

test('normalizeState drops rooms with bad ids, tasks without an assignee and duplicate members', () => {
  const state = normalizeState({
    version: 1,
    rooms: {
      'not-a-room': { id: 'not-a-room', name: 'bad id' },
      'room-good0001': {
        id: 'room-good0001',
        name: 'Good',
        members: [
          { nodeId: SELF.nodeId, sessionId: SELF.sessionId, name: 'alice' },
          { nodeId: SELF.nodeId, sessionId: SELF.sessionId, name: 'alice again' },
          { nodeId: '', sessionId: 'x' },
        ],
        tasks: [
          { id: 'task-1', title: 'kept', assignee: { nodeId: SELF.nodeId, sessionId: SELF.sessionId } },
          { id: 'task-2', title: 'no assignee' },
          { id: 'task-3', assignee: { nodeId: SELF.nodeId, sessionId: SELF.sessionId } },
        ],
      },
    },
  });
  const room = state.rooms['room-good0001'];
  assert.equal(room.members.length, 1);
  assert.equal(room.tasks.length, 1);
  assert.equal(room.tasks[0].title, 'kept');
});

test('memberKey pairs a node with a session, not two people with one name', () => {
  assert.equal(memberKey('node-a', 's1'), 'node-a/s1');
  assert.notEqual(memberKey('node-a', 's1'), memberKey('node-b', 's1'));
});

test('createRoom makes the caller leader and keeps name, topic and limits', () => {
  const { state, room } = oneRoom();
  assert.match(room.id, /^room-[a-z0-9]{12}$/);
  assert.equal(room.name, 'Apollo');
  assert.equal(room.topic, 'ship the thing');
  assert.equal(room.leader.key, memberKey(SELF.nodeId, SELF.sessionId));
  assert.equal(room.members.length, 1);
  assert.equal(room.members[0].role, 'leader');

  const longName = 'x'.repeat(MAX_ROOM_NAME + 20);
  const squeezed = createRoom(state, { name: longName, leader: SELF }, uuidFactory(), AT);
  assert.equal(squeezed.name.length, MAX_ROOM_NAME);
});

test('createRoom rejects a nameless room and a leader without a session', () => {
  const state = emptyState();
  assert.throws(() => createRoom(state, { name: '   ', leader: SELF }, uuidFactory(), AT), /name is required/);
  assert.throws(
    () => createRoom(state, { name: 'ok', leader: { nodeId: SELF.nodeId } }, uuidFactory(), AT),
    /leader session/i,
  );
});

test('findRoom resolves by id and by name, ignoring case, and skips tombstones', () => {
  const { state, room } = oneRoom();
  assert.equal(findRoom(state, room.id)?.id, room.id);
  assert.equal(findRoom(state, 'apollo')?.id, room.id);
  assert.equal(findRoom(state, 'APOLLO')?.id, room.id);
  assert.equal(findRoom(state, 'nope'), undefined);
  retireRoom(state, room.id, LATER);
  assert.equal(findRoom(state, room.id), undefined, 'a retired room must not be joinable by id');
  assert.equal(findRoom(state, 'Apollo'), undefined, 'a retired room must not be joinable by name');
});

test('joinRoom is idempotent and keeps one record per session', () => {
  const { state, room } = oneRoom();
  const first = joinRoom(state, room.id, PEER, LATER);
  assert.equal(first.added, true);
  assert.equal(first.room.members.length, 2);
  const again = joinRoom(state, room.id, PEER, LATER);
  assert.equal(again.added, false);
  assert.equal(again.room.members.length, 2);

  const asLeader = joinRoom(state, room.id, SELF, LATER);
  assert.equal(asLeader.added, false, 'the leader is already a member');
  assert.equal(room.members.length, 2);
});

test('joinRoom refuses unknown rooms', () => {
  const state = emptyState();
  assert.throws(() => joinRoom(state, 'room-missing0001', PEER, AT), /unknown room/);
});

test('addMember pulls a supplied member in, idempotently, leader excluded', () => {
  const { state, room } = oneRoom();
  const first = addMember(state, room.id, PEER, LATER);
  assert.equal(first.added, true);
  assert.equal(first.room.members.length, 2);
  const again = addMember(state, room.id, PEER, LATER);
  assert.equal(again.added, false);
  assert.equal(again.room.members.length, 2);
  const asLeader = addMember(state, room.id, SELF, LATER);
  assert.equal(asLeader.added, false, 'the leader is already a member');
  assert.equal(room.members.length, 2);
});

test('addMember refuses unknown rooms and malformed members', () => {
  const state = emptyState();
  assert.throws(() => addMember(state, 'room-missing0001', PEER, AT), /unknown room/);
  const { state: state2, room } = oneRoom();
  assert.throws(() => addMember(state2, room.id, { nodeId: '', sessionId: 'sess-2' }, AT), /node and a session/);
});

test('the same person may hold two memberships from two nodes', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, { nodeId: SELF.nodeId, sessionId: 'sess-9', name: 'alice' }, LATER);
  joinRoom(state, room.id, { nodeId: PEER.nodeId, sessionId: SELF.sessionId, name: 'alice' }, LATER);
  const alices = room.members.filter((member) => member.name === 'alice');
  assert.equal(alices.length, 3, 'leader plus the two extra sessions of the same person');
  assert.equal(new Set(alices.map((member) => member.key)).size, 3);
});

test('leaveRoom removes a member but never the leader', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  assert.equal(leaveRoom(state, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER), true);
  assert.equal(room.members.length, 1);
  assert.equal(leaveRoom(state, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER), false);
  assert.throws(
    () => leaveRoom(state, room.id, memberKey(SELF.nodeId, SELF.sessionId), LATER),
    /leader cannot leave/,
  );
});

test('assignTask records who asked whom, and defaults to open', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  const task = assignTask(
    state,
    room.id,
    { title: 'write the docs', detail: 'one page', assignee: PEER, assigner: SELF },
    uuidFactory(),
    LATER,
  );
  assert.equal(task.status, 'open');
  assert.equal(task.assignee.key, memberKey(PEER.nodeId, PEER.sessionId));
  assert.equal(task.assigner.key, memberKey(SELF.nodeId, SELF.sessionId));
  assert.equal(room.tasks.length, 1);
  assert.throws(
    () => assignTask(state, room.id, { title: 'x', assignee: PEER }, uuidFactory(), LATER),
    /assignee and assigner/,
  );
});

test('setTaskStatus moves a task and appends the note to its detail', () => {
  const { state, room } = oneRoom();
  const task = assignTask(state, room.id, { title: 'write the docs', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  const updated = setTaskStatus(state, room.id, task.id, 'doing', 'started', LATER);
  assert.equal(updated.status, 'doing');
  assert.match(updated.detail, /started/);

  const byTitle = setTaskStatus(state, room.id, 'write the docs', 'done', '', LATER);
  assert.equal(byTitle.id, task.id);
  assert.equal(byTitle.status, 'done');
  assert.throws(() => setTaskStatus(state, room.id, task.id, 'shipped', '', LATER), /status must be one of/);
  assert.throws(() => setTaskStatus(state, room.id, 'no such task', 'done', '', LATER), /unknown task/);
});

test('task detail is capped while the status still changes', () => {
  const { state, room } = oneRoom();
  const task = assignTask(state, room.id, { title: 'big', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  setTaskStatus(state, room.id, task.id, 'doing', 'y'.repeat(MAX_TASK_DETAIL * 2), LATER);
  assert.ok(task.detail.length <= MAX_TASK_DETAIL);
});

test('a full room drops finished tasks before open ones', () => {
  const { state, room } = oneRoom();
  for (let index = 0; index < MAX_TASKS_PER_ROOM; index += 1) {
    const task = assignTask(
      state,
      room.id,
      { title: `task ${index}`, assignee: PEER, assigner: SELF },
      uuidFactory(),
      AT,
    );
    setTaskStatus(state, room.id, task.id, 'done', '', AT);
  }
  const openTask = assignTask(
    state,
    room.id,
    { title: 'still mine', assignee: PEER, assigner: SELF },
    uuidFactory(),
    LATER,
  );
  assert.ok(room.tasks.length <= MAX_TASKS_PER_ROOM);
  assert.ok(
    room.tasks.some((task) => task.id === openTask.id),
    'an open task must survive trimming',
  );
});

test('retireRoom leaves a tombstone instead of forgetting the room', () => {
  const { state, room } = oneRoom();
  assert.equal(retireRoom(state, room.id, LATER), true);
  assert.equal(retireRoom(state, 'room-missing0001', LATER), false);
  assert.equal(state.rooms[room.id].deleted, true, 'the tombstone must survive replication');
  assert.deepEqual(roomsFor(state, SELF.nodeId, SELF.sessionId), [], 'a retired room leaves the member list');
});

test('a departure reaches a peer that still lists the member', () => {
  const { state: left, room } = oneRoom();
  joinRoom(left, room.id, PEER, LATER);

  // The peer learned about Bob before the leave happened.
  const before = mergeStates(emptyState(), exportState(left)).state;
  assert.equal(before.rooms[room.id].members.length, 2);

  assert.equal(leaveRoom(left, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER), true);
  const merged = mergeStates(before, exportState(left));
  assert.equal(merged.changed, true, 'a merge that drops a member must report a change');
  assert.equal(merged.state.rooms[room.id].members.length, 1, 'the departed member must not be unioned back');
  assert.equal(merged.state.rooms[room.id].members[0].key, memberKey(SELF.nodeId, SELF.sessionId));

  // ...and the surviving copy must not resurrect him on the way back.
  const reverse = mergeStates(left, exportState(before)).state;
  assert.equal(reverse.rooms[room.id].members.length, 1);
});

test('a leave survives an independent copy of the same room', () => {
  const { state: left, room } = oneRoom();
  joinRoom(left, room.id, PEER, LATER);
  const { state: right } = oneRoom();
  joinRoom(right, room.id, PEER, LATER);
  leaveRoom(left, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER);

  const leftFirst = mergeStates(left, exportState(right)).state;
  const rightFirst = mergeStates(right, exportState(left)).state;
  assert.equal(leftFirst.rooms[room.id].members.length, 1);
  assert.equal(rightFirst.rooms[room.id].members.length, 1);
  assert.deepEqual(
    leftFirst.rooms[room.id].left,
    rightFirst.rooms[room.id].left,
    'the tombstone itself must converge',
  );
});

test('rejoining after leaving clears the tombstone', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  leaveRoom(state, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER);
  assert.equal(room.members.length, 1);

  const again = joinRoom(state, room.id, PEER, '2026-10-29T02:00:00.000Z');
  assert.equal(again.added, true);
  assert.equal(again.room.members.length, 2);
  assert.deepEqual(again.room.left, {}, 'a fresh join is not shadowed by the old departure');
  assert.equal(normalizeState(exportState(state)).rooms[room.id].members.length, 2);
});

test('a stale departure cannot cancel a later join', () => {
  const { state, room } = oneRoom();
  // Bob joined at 01:00, left at 01:00, then joined again at 02:00.
  joinRoom(state, room.id, PEER, LATER);
  leaveRoom(state, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER);
  joinRoom(state, room.id, PEER, '2026-10-29T02:00:00.000Z');

  // A peer that only ever saw the departure replays it.
  const stale = oneRoom();
  joinRoom(stale.state, room.id, PEER, LATER);
  leaveRoom(stale.state, room.id, memberKey(PEER.nodeId, PEER.sessionId), LATER);

  const merged = mergeStates(stale.state, exportState(state)).state;
  assert.equal(merged.rooms[room.id].members.length, 2, 'the later join outlives the earlier departure');
});

test('mergeStates is idempotent', () => {
  const { state: left, room } = oneRoom();
  joinRoom(left, room.id, PEER, LATER);
  const { state: right } = oneRoom();
  const once = mergeStates(left, exportState(right));
  const twice = mergeStates(once.state, exportState(right));
  assert.equal(twice.changed, false, 'merging the same document again must report no change');
  assert.deepEqual(exportState(twice.state), exportState(once.state));
});

test('mergeStates is commutative for members added on both sides', () => {
  const { state: left, room } = oneRoom();
  joinRoom(left, room.id, PEER, LATER);
  const { state: right } = oneRoom();
  joinRoom(right, room.id, OTHER, LATER);

  const leftFirst = mergeStates(left, exportState(right)).state;
  const rightFirst = mergeStates(right, exportState(left)).state;

  assert.deepEqual(
    new Set(leftFirst.rooms[room.id].members.map((member) => member.key)),
    new Set(rightFirst.rooms[room.id].members.map((member) => member.key)),
  );
  assert.equal(leftFirst.rooms[room.id].members.length, 3);
});

test('mergeStates carries a newer member identity to peers', () => {
  const { state: left, room } = oneRoom();
  const right = normalizeState(exportState(left));
  const renamed = right.rooms[room.id].members.find((member) => member.key === SELF.nodeId + '/' + SELF.sessionId);
  renamed.name = '建哥';
  renamed.nameUpdatedAt = LATER;
  right.rooms[room.id].leader.name = '建哥';
  right.rooms[room.id].leader.nameUpdatedAt = LATER;

  const merged = mergeStates(left, exportState(right)).state;
  assert.equal(merged.rooms[room.id].members[0].name, '建哥');
  assert.equal(merged.rooms[room.id].leader.name, '建哥');
});

test('mergeStates takes the newest task state regardless of merge order', () => {
  const { state: left, room } = oneRoom();
  const task = assignTask(left, room.id, { title: 'shared', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  setTaskStatus(left, room.id, task.id, 'doing', '', AT);

  const { state: right } = oneRoom();
  joinRoom(right, room.id, PEER, LATER);
  const mirrored = right.rooms[room.id];
  mirrored.tasks = [
    {
      ...task,
      status: 'done',
      updatedAt: LATER,
      assignee: mirrored.tasks[0]?.assignee ?? { ...PEER, role: 'member', joinedAt: LATER, key: memberKey(PEER.nodeId, PEER.sessionId) },
    },
  ];

  const leftFirst = mergeStates(left, exportState(right)).state;
  const rightFirst = mergeStates(right, exportState(left)).state;
  assert.equal(leftFirst.rooms[room.id].tasks[0].status, 'done');
  assert.equal(rightFirst.rooms[room.id].tasks[0].status, 'done');
});

test('mergeStates keeps the older leader and sticks to a tombstone', () => {
  const { state: left, room } = oneRoom();
  const { state: right } = oneRoom();
  const rival = { ...SELF, joinedAt: LATER, role: 'leader' };
  right.rooms[room.id].leader = rival;
  right.rooms[room.id].members = [rival];
  right.rooms[room.id].updatedAt = LATER;

  const merged = mergeStates(left, exportState(right)).state;
  assert.equal(
    merged.rooms[room.id].leader.key,
    rival.key === merged.rooms[room.id].leader.key ? rival.key : merged.rooms[room.id].leader.key,
  );
  assert.ok(merged.rooms[room.id].leader.joinedAt <= LATER);

  retireRoom(right, room.id, LATER);
  const afterDelete = mergeStates(left, exportState(right)).state;
  assert.equal(afterDelete.rooms[room.id].deleted, true, 'a deletion must not be undone by an older copy');
  const backAgain = mergeStates(afterDelete, exportState(left)).state;
  assert.equal(backAgain.rooms[room.id].deleted, true, 'and it must stay deleted after a reverse merge');
});

test('mergeStates accepts a peer that knows a room we do not', () => {
  const local = emptyState();
  const { state: remote } = oneRoom();
  const merged = mergeStates(local, exportState(remote));
  assert.equal(merged.changed, true);
  assert.equal(Object.keys(merged.state.rooms).length, 1);
});

test('mergeStates ignores a document from another protocol version', () => {
  const { state } = oneRoom();
  const merged = mergeStates(state, { version: 999, rooms: {} });
  assert.equal(merged.changed, false);
  assert.equal(Object.keys(merged.state.rooms).length, 1);
});

test('exportState carries the version and the rooms', () => {
  const { state, room } = oneRoom();
  const exported = exportState(state);
  assert.equal(exported.version, ROOM_STATE_VERSION);
  assert.equal(exported.rooms[room.id].name, 'Apollo');
});

test('roomsFor reports the caller role and the room tasks', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  assignTask(state, room.id, { title: 'docs', assignee: PEER, assigner: SELF }, uuidFactory(), LATER);

  const asLeader = roomsFor(state, SELF.nodeId, SELF.sessionId);
  assert.equal(asLeader.length, 1);
  assert.equal(asLeader[0].isLeader, true);
  assert.equal(asLeader[0].role, 'leader');
  assert.equal(asLeader[0].members.length, 2);
  assert.equal(asLeader[0].tasks.length, 1);

  const asMember = roomsFor(state, PEER.nodeId, PEER.sessionId);
  assert.equal(asMember[0].isLeader, false);
  assert.equal(asMember[0].role, 'member');

  assert.deepEqual(roomsFor(state, OTHER.nodeId, OTHER.sessionId), [], 'a non-member sees nothing');
});

test('allRooms shows a project a peer created, so it can be joined', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);

  const forLeader = allRooms(state, SELF.nodeId, SELF.sessionId);
  assert.equal(forLeader.length, 1);
  assert.equal(forLeader[0].isMember, true);
  assert.equal(forLeader[0].isLeader, true);

  const forPeer = allRooms(state, PEER.nodeId, PEER.sessionId);
  assert.equal(forPeer[0].isMember, true);
  assert.equal(forPeer[0].isLeader, false, 'the guest did not create the room');

  const stranger = allRooms(state, OTHER.nodeId, OTHER.sessionId);
  assert.equal(stranger.length, 1, 'a stranger still sees the project it could join');
  assert.equal(stranger[0].isMember, false);
  assert.equal(stranger[0].isLeader, false);
  assert.equal(stranger[0].role, '');

  assert.deepEqual(roomsFor(state, OTHER.nodeId, OTHER.sessionId), [], 'listRooms keeps its "mine" meaning');
  assert.deepEqual(allRooms(state, SELF.nodeId), allRooms(state, SELF.nodeId, ''), 'an anonymous view works too');
});

test('allRooms hides retired rooms and sorts by name', () => {
  const state = emptyState();
  const zulu = createRoom(state, { name: 'Zulu', leader: SELF }, uuidFactory(), AT);
  const alpha = createRoom(state, { name: 'Alpha', leader: SELF }, uuidFactory(), AT);
  retireRoom(state, zulu.id, LATER);
  assert.deepEqual(
    allRooms(state, SELF.nodeId, SELF.sessionId).map((row) => row.name),
    ['Alpha'],
  );
  assert.equal(alpha.deleted, false);
});

test('tasksFor filters by assignee', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  assignTask(state, room.id, { title: 'bob work', assignee: PEER, assigner: SELF }, uuidFactory(), LATER);
  assignTask(state, room.id, { title: 'alice work', assignee: SELF, assigner: SELF }, uuidFactory(), LATER);
  assert.equal(tasksFor(state, room.id, memberKey(PEER.nodeId, PEER.sessionId)).length, 1);
  assert.equal(tasksFor(state, room.id, memberKey(SELF.nodeId, SELF.sessionId)).length, 1);
  assert.deepEqual(tasksFor(state, 'room-missing0001', 'node-x/y'), []);
});

test('resolveMember accepts a key, a session id, a member name or a node name', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  const mesh = {
    selfNodeId: SELF.nodeId,
    nameOf: (nodeId) => (nodeId === PEER.nodeId ? 'bobs-laptop' : 'my-desk'),
  };
  assert.equal(resolveMember(room, mesh, memberKey(PEER.nodeId, PEER.sessionId))?.name, 'bob');
  assert.equal(resolveMember(room, mesh, PEER.sessionId)?.name, 'bob');
  assert.equal(resolveMember(room, mesh, 'BOB')?.name, 'bob');
  assert.equal(resolveMember(room, mesh, 'bobs-laptop')?.name, 'bob');
  assert.equal(resolveMember(room, mesh, 'nobody'), undefined);
  assert.equal(resolveMember(room, mesh, '   '), undefined);
});

test('resolveMember refuses an ambiguous name instead of guessing', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, { nodeId: PEER.nodeId, sessionId: 'sess-x', name: 'sam' }, LATER);
  joinRoom(state, room.id, { nodeId: OTHER.nodeId, sessionId: 'sess-y', name: 'sam' }, LATER);
  const mesh = { selfNodeId: SELF.nodeId, nameOf: () => 'some-node' };
  assert.equal(resolveMember(room, mesh, 'sam'), undefined);
});

test('membersByNode groups sessions by where they live', () => {
  const { state, room } = oneRoom();
  joinRoom(state, room.id, PEER, LATER);
  joinRoom(state, room.id, { nodeId: PEER.nodeId, sessionId: 'sess-8', name: 'bob again' }, LATER);
  const grouped = membersByNode(room);
  assert.equal(grouped.get(SELF.nodeId).length, 1);
  assert.equal(grouped.get(PEER.nodeId).length, 2);
  assert.equal(grouped.get(OTHER.nodeId), undefined);
});

test('every task status in the wire order round-trips through normalizeState', () => {
  for (const status of TASK_STATUSES) {
    const { state, room } = oneRoom();
    const task = assignTask(state, room.id, { title: 'x', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
    setTaskStatus(state, room.id, task.id, status, '', LATER);
    const roundTripped = normalizeState(JSON.parse(JSON.stringify(exportState(state))));
    assert.equal(roundTripped.rooms[room.id].tasks[0].status, status);
  }
});

test('resolveTask picks the only task with that title', () => {
  const { state, room } = oneRoom();
  assignTask(state, room.id, { title: 'build the north span', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  assert.equal(resolveTask(state.rooms[room.id], 'build the north span').title, 'build the north span');
});

test('resolveTask prefers an exact id over a title', () => {
  const { state, room } = oneRoom();
  const task = assignTask(state, room.id, { title: 'x', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  assert.equal(resolveTask(state.rooms[room.id], task.id).id, task.id);
});

test('resolveTask refuses an ambiguous title instead of acting on the first match', () => {
  const { state, room } = oneRoom();
  const first = assignTask(state, room.id, { title: '核对房间工具输出', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  const second = assignTask(state, room.id, { title: '核对房间工具输出', assignee: PEER, assigner: SELF }, uuidFactory(), LATER);
  assert.notEqual(first.id, second.id);
  assert.throws(() => resolveTask(state.rooms[room.id], '核对房间工具输出'), (error) => {
    assert.equal(error.code, 'AMBIGUOUS_TASK');
    // Both candidates must be named, otherwise the caller cannot retry by id.
    assert.match(error.message, new RegExp(first.id));
    assert.match(error.message, new RegExp(second.id));
    return true;
  });
});

test('resolveTask still finds a task after the duplicate is removed', () => {
  const { state, room } = oneRoom();
  const first = assignTask(state, room.id, { title: 'dup', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  assignTask(state, room.id, { title: 'dup', assignee: PEER, assigner: SELF }, uuidFactory(), LATER);
  const live = state.rooms[room.id];
  live.tasks = live.tasks.filter((item) => item.id === first.id);
  assert.equal(resolveTask(live, 'dup').id, first.id);
});

test('setTaskStatus surfaces the ambiguity without mutating either task', () => {
  const { state, room } = oneRoom();
  const first = assignTask(state, room.id, { title: 'same', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  const second = assignTask(state, room.id, { title: 'same', assignee: PEER, assigner: SELF }, uuidFactory(), LATER);
  assert.throws(() => setTaskStatus(state, room.id, 'same', 'done', '', LATER), (error) => {
    assert.equal(error.code, 'AMBIGUOUS_TASK');
    return true;
  });
  // A refused call must leave both tasks exactly as they were.
  assert.equal(state.rooms[room.id].tasks.find((item) => item.id === first.id).status, 'open');
  assert.equal(state.rooms[room.id].tasks.find((item) => item.id === second.id).status, 'open');
});

test('a title that matches nothing reports unknown rather than ambiguity', () => {
  const { state, room } = oneRoom();
  assignTask(state, room.id, { title: 'real', assignee: PEER, assigner: SELF }, uuidFactory(), AT);
  assert.throws(() => resolveTask(state.rooms[room.id], 'nope'), /unknown task/);
});

test('renameRoom changes the name and bumps updatedAt', () => {
  const { state, room } = oneRoom();
  renameRoom(state, room.id, { name: ' Apollo II ', }, LATER);
  assert.equal(state.rooms[room.id].name, 'Apollo II');
  assert.equal(state.rooms[room.id].updatedAt, LATER);
  // The id is the stable handle, so the rename must not touch it.
  assert.equal(state.rooms[room.id].id, room.id);
});

test('renameRoom can rewrite the topic without touching the name', () => {
  const { state, room } = oneRoom();
  renameRoom(state, room.id, { topic: 'now with rails' }, LATER);
  assert.equal(state.rooms[room.id].name, 'Apollo');
  assert.equal(state.rooms[room.id].topic, 'now with rails');
});

test('renameRoom refuses an empty name', () => {
  const { state, room } = oneRoom();
  assert.throws(() => renameRoom(state, room.id, { name: '   ' }, LATER), /room name is required/);
  assert.equal(state.rooms[room.id].name, 'Apollo');
});

test('an unchanged rename does not bump updatedAt', () => {
  const { state, room } = oneRoom();
  renameRoom(state, room.id, { name: 'Apollo' }, LATER);
  assert.equal(state.rooms[room.id].updatedAt, AT);
});

test('a rename reaches a peer through mergeStates', () => {
  const { state, room } = oneRoom();
  const peerCopy = normalizeState(JSON.parse(JSON.stringify(exportState(state))));
  renameRoom(state, room.id, { name: 'Apollo II' }, LATER);
  const merged = mergeStates(peerCopy, exportState(state));
  assert.equal(merged.changed, true);
  assert.equal(merged.state.rooms[room.id].name, 'Apollo II');
});

test('a stale peer cannot rename a room backwards', () => {
  const { state, room } = oneRoom();
  renameRoom(state, room.id, { name: 'Apollo II' }, LATER);
  // A copy taken before the rename must lose, otherwise the older title would
  // win every time a lagging node pushed its state.
  const stale = normalizeState({
    version: 1,
    rooms: { [room.id]: { ...state.rooms[room.id], name: 'Apollo', updatedAt: AT } },
  });
  const merged = mergeStates(state, exportState(stale));
  assert.equal(merged.state.rooms[room.id].name, 'Apollo II');
});
