/**
 * End-to-end room check across two nodes on one LAN.
 *
 * scripts/rooms.test.mjs proves the pure state machine and
 * scripts/twin-transport-check.mjs proves the state payload, but neither shows
 * that two MeshNode instances actually converge. This runs the whole user story:
 * one node creates a project, the other discovers it, joins, receives a task,
 * reports progress, gets a room message, and leaves — with every step verified
 * from the *other* node's point of view.
 *
 * Both nodes share one DSH_HOME but take different mesh ports, which is exactly
 * how a second DSH instance on one machine stores its replica
 * (`$DSH_HOME/lan-mesh/instances/<port>`).
 *
 * Run: node scripts/rooms-smoke.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';

const savedHome = process.env.DSH_HOME;
let failures = 0;

/** Report one expectation. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/** Wait until `test()` holds, polling every 100 ms. */
async function until(test, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return test();
}

/** Ids of the rooms one session is in on one node. */
function roomNames(node, sessionId) {
  return node.listRooms({ sessionId }).map((room) => room.name);
}

/** A room as one session sees it, or undefined. */
function roomOf(node, sessionId, name) {
  return node.listRooms({ sessionId }).find((room) => room.name === name);
}

/** Messages this node holds for one room, filtered to real chat. */
function chatIn(node, roomId) {
  return node.roomDetail({ room: roomId, sessionId: '' }).messages.filter((item) => item.kind === 'room-message');
}

const home = await mkdtemp(join(tmpdir(), 'lan-mesh-rooms-'));
process.env.DSH_HOME = home;

const shared = {
  displayName: '',
  clusterSecret: '',
  discoveryPort: 45_931,
  autoWake: false,
  trustedPeers: [],
};

/** Both nodes, closed in the finally block. */
const open = [];
/** Build one node. */
function node(name, port) {
  const created = new MeshNode({
    config: { ...shared, displayName: name, port },
    log: (message, error) => console.log(`  [${name}] ${message}${error === undefined ? '' : `: ${error}`}`),
  });
  open.push(created);
  return created;
}

try {
  const alpha = node('alpha', 45_893);
  await alpha.start();
  const beta = node('beta', 45_898);
  await beta.start();

  console.log('\ndiscovery');
  const seen = await until(() => alpha.peers().length > 0 && beta.peers().length > 0);
  check('the two nodes find each other', seen, `alpha=${alpha.peers().length} beta=${beta.peers().length}`);
  check('sharing one DSH_HOME still gives separate identities', alpha.nodeId !== beta.nodeId, `${alpha.nodeId} vs ${beta.nodeId}`);

  console.log('\ncreate a project');
  const created = await alpha.createRoom({
    name: 'shared project',
    topic: 'ship the room layer',
    sessionId: 'sess-alpha',
    sessionName: 'alpha work',
  });
  const roomId = created.room.id;
  check('the room id follows the contract pattern', /^room-[a-z0-9-]{4,64}$/.test(roomId), roomId);
  check('the creator is the leader', created.room.leader?.sessionId === 'sess-alpha', JSON.stringify(created.room.leader));
  check('the creator is in the room', roomNames(alpha, 'sess-alpha').includes('shared project'), JSON.stringify(roomNames(alpha, 'sess-alpha')));
  check('a stranger is not in the room', !roomNames(alpha, 'sess-stranger').includes('shared project'));

  console.log('\nthe peer learns the project');
  await beta.syncRooms();
  const knownToBeta = () => beta.listRooms({ sessionId: 'sess-beta', all: true }).find((room) => room.id === roomId);
  const arrived = await until(() => knownToBeta() !== undefined);
  check('the room reaches the peer without a restart', arrived, JSON.stringify(beta.listRooms({ sessionId: 'sess-beta', all: true })));
  check('the peer sees it as joinable, not as its own', knownToBeta()?.isMember === false, JSON.stringify(knownToBeta()));
  check('the peer does not claim the room as its own', roomNames(beta, 'sess-beta').length === 0, JSON.stringify(roomNames(beta, 'sess-beta')));

  console.log('\njoin the project');
  const joined = await beta.joinRoom({ room: 'shared project', sessionId: 'sess-beta', sessionName: 'beta work' });
  check('join reports that the member was added', joined.added === true);
  check('the joiner is in the room', roomNames(beta, 'sess-beta').includes('shared project'), JSON.stringify(roomNames(beta, 'sess-beta')));
  await alpha.syncRooms();
  const twoMembers = await until(() => (roomOf(alpha, 'sess-alpha', 'shared project')?.members.length ?? 0) === 2);
  check('the creator learns about the joiner', twoMembers, JSON.stringify(roomOf(alpha, 'sess-alpha', 'shared project')?.members));
  check('the peer built the same member list', roomOf(beta, 'sess-beta', 'shared project')?.members.length === 2, JSON.stringify(roomOf(beta, 'sess-beta', 'shared project')?.members));

  console.log('\nleader assigns a task');
  const nonLeader = await beta
    .assignTask({ room: roomId, sessionId: 'sess-beta', assignee: 'sess-beta', title: 'not allowed' })
    .then(() => '')
    .catch((error) => String(error?.code ?? error));
  check('a non-leader cannot assign', nonLeader === 'NOT_LEADER', nonLeader);

  const assigned = await alpha.assignTask({
    room: roomId,
    sessionId: 'sess-alpha',
    assignee: 'sess-beta',
    title: 'build the rooms panel',
    detail: 'two sections: my rooms and joinable projects',
  });
  check('the task is created as open', assigned.task.status === 'open', JSON.stringify(assigned.task));
  check('the assignee is resolved by session id', assigned.task.assignee.sessionId === 'sess-beta', JSON.stringify(assigned.task.assignee));
  check('the delivery reached the assignee node', assigned.delivered.some((row) => row.ok === true), JSON.stringify(assigned.delivered));

  const taskArrived = await until(() =>
    beta.inbox({ limit: 50 }).messages.some((item) => item.kind === 'room-task' && item.room === roomId),
  );
  check('the assignee node holds the task notification', taskArrived, JSON.stringify(beta.inbox({ limit: 5 }).messages.map((item) => item.kind)));
  const taskEnvelope = beta.inbox({ limit: 50 }).messages.find((item) => item.kind === 'room-task');
  check('the notification keeps the room id', taskEnvelope?.room === roomId, JSON.stringify(taskEnvelope?.room));
  check('the notification comes from the leader node', taskEnvelope?.from.nodeId === alpha.nodeId, JSON.stringify(taskEnvelope?.from));

  console.log('\nassignee reports progress');
  const strangerStatus = await beta
    .setTaskStatus({ room: roomId, sessionId: 'sess-gamma', task: 'build the rooms panel', status: 'doing' })
    .then(() => '')
    .catch((error) => String(error?.code ?? error));
  check('a non-member cannot move a task', strangerStatus === 'BAD_REQUEST', strangerStatus);

  const moved = await beta.setTaskStatus({
    room: roomId,
    sessionId: 'sess-beta',
    task: 'build the rooms panel',
    status: 'doing',
    note: 'started on the panel',
  });
  check('the assignee can move its task', moved.task.status === 'doing', JSON.stringify(moved.task));
  await alpha.syncRooms();
  const leaderSees = await until(() => roomOf(alpha, 'sess-alpha', 'shared project')?.tasks[0]?.status === 'doing');
  check('the leader sees the new status', leaderSees, JSON.stringify(roomOf(alpha, 'sess-alpha', 'shared project')?.tasks));

  console.log('\nroom conversation');
  const said = await alpha.sayInRoom({ room: roomId, sessionId: 'sess-alpha', text: 'kickoff at ten' });
  check('the sender keeps its own message', said.room.id === roomId && chatIn(alpha, roomId).some((item) => item.text === 'kickoff at ten'), JSON.stringify(chatIn(alpha, roomId).map((item) => item.text)));
  check('the message was sent to the peer node', said.delivered.some((row) => row.ok === true && row.nodeId === beta.nodeId), JSON.stringify(said.delivered));
  const heard = await until(() => chatIn(beta, roomId).some((item) => item.text === 'kickoff at ten'));
  check('the peer stores the room message', heard, JSON.stringify(chatIn(beta, roomId).map((item) => item.text)));
  check('the chat excludes task notifications', chatIn(beta, roomId).every((item) => item.kind === 'room-message'));

  console.log('\na human joins the project');
  // The panel speaks as `human`: a person has no agent session, so the only way
  // to show them in a member list is a fixed session id under the node id.
  const humanJoined = await alpha.joinRoom({ room: roomId, sessionId: 'human' });
  check('the human becomes a member', humanJoined.added === true, JSON.stringify(humanJoined.added));
  const humanRow = humanJoined.room.members.find((member) => member.sessionId === 'human');
  check('the human is named after the machine', humanRow?.name === alpha.describe().name, JSON.stringify(humanRow));
  check('the human is marked present', humanRow?.live === true, JSON.stringify(humanRow));
  await beta.syncRooms();
  const humanAtPeer = await until(() =>
    (roomOf(beta, 'sess-beta', 'shared project')?.members ?? []).some((member) => member.sessionId === 'human'),
  );
  check('the peer sees the human member', humanAtPeer, JSON.stringify(roomOf(beta, 'sess-beta', 'shared project')?.members));

  console.log('\nmember liveness');
  const betaMembers = roomOf(beta, 'sess-beta', 'shared project')?.members ?? [];
  const remoteAgent = betaMembers.find((member) => member.nodeId === alpha.nodeId && member.sessionId !== 'human');
  check('a remote agent is live while its node is online', remoteAgent?.live === true, JSON.stringify(remoteAgent));
  // This script runs MeshNode without an agent runtime, so a local member has no
  // session behind it and must report as offline rather than as present.
  const localAgent = betaMembers.find((member) => member.sessionId === 'sess-beta');
  check('a local member with no live session is offline', localAgent?.live === false, JSON.stringify(localAgent));
  check('the human is live even with no agent', betaMembers.find((member) => member.sessionId === 'human')?.live === true);

  console.log('\nthe human speaks');
  const humanSaid = await alpha.sayInRoom({ room: roomId, sessionId: 'human', text: '@beta 请看一下任务' });
  check('the human message is kept locally', chatIn(alpha, roomId).some((item) => item.text === '@beta 请看一下任务'), JSON.stringify(chatIn(alpha, roomId).map((item) => item.text)));
  check('the human message reaches the peer', humanSaid.delivered.some((row) => row.ok === true && row.nodeId === beta.nodeId), JSON.stringify(humanSaid.delivered));

  console.log('\nunread counts follow the badge');
  const unreadBefore = (await beta.snapshot({ sessionId: 'sess-beta' })).rooms.unread[roomId] ?? 0;
  check('the peer has unread room messages', unreadBefore > 0, String(unreadBefore));
  beta.roomDetail({ room: roomId, sessionId: 'sess-beta' });
  const unreadAfter = (await beta.snapshot({ sessionId: 'sess-beta' })).rooms.unread[roomId] ?? 0;
  check('opening the room clears the badge', unreadAfter === 0, String(unreadAfter));

  console.log('\nchatter between agents does not bother the person');
  await alpha.sayInRoom({ room: roomId, sessionId: 'sess-alpha', text: '我先看一下任务背景，稍后回复。' });
  await until(() => chatIn(beta, roomId).some((item) => item.text === '我先看一下任务背景，稍后回复。'));
  const quietBadge = (await beta.snapshot({ sessionId: 'sess-beta' })).rooms.unread[roomId] ?? 0;
  check('a message with no @beta leaves the badge alone', quietBadge === 0, String(quietBadge));
  const quietAttention = (await beta.snapshot({ sessionId: 'sess-beta' })).attention.messages;
  check('it stays out of the attention list too', quietAttention.length === 0, JSON.stringify(quietAttention));

  await alpha.sayInRoom({ room: roomId, sessionId: 'sess-alpha', text: '@Beta 结论是这个方案可行。' });
  await until(() => chatIn(beta, roomId).some((item) => item.text === '@Beta 结论是这个方案可行。'));
  const loudBadge = (await beta.snapshot({ sessionId: 'sess-beta' })).rooms.unread[roomId] ?? 0;
  check('an @beta brings the badge back', loudBadge === 1, String(loudBadge));
  const loudAttention = (await beta.snapshot({ sessionId: 'sess-beta' })).attention.messages;
  check('the attention list names the message', loudAttention.some((item) => item.text.includes('@Beta')), JSON.stringify(loudAttention.map((item) => item.text)));
  beta.roomDetail({ room: roomId, sessionId: 'sess-beta' });

  console.log('\nmember nicknames are local; self identity is shared');
  const nicknamed = await beta.setNickname({ member: 'sess-alpha', name: '小王' });
  check('a nickname is stored', nicknamed.nicknames.members[`${alpha.nodeId}/sess-alpha`] === '小王', JSON.stringify(nicknamed.nicknames));
  const nickRow = roomOf(beta, 'sess-beta', 'shared project')?.members.find((member) => member.sessionId === 'sess-alpha');
  check('the member list shows the nickname', nickRow?.title === '小王', JSON.stringify(nickRow));
  const peerRow = roomOf(alpha, 'sess-alpha', 'shared project')?.members.find((member) => member.sessionId === 'sess-alpha');
  check('the nickname stays on the node that set it', peerRow?.title !== '小王', JSON.stringify(peerRow?.title));
  const selfNamed = await alpha.setNickname({ self: true, name: '老板' });
  check('the person can name themselves', selfNamed.nicknames.self === '老板', JSON.stringify(selfNamed.nicknames));
  const selfRow = roomOf(alpha, 'sess-alpha', 'shared project')?.members.find((member) => member.sessionId === 'human');
  check('the human member reads with that name', selfRow?.name === '老板', JSON.stringify(selfRow));
  await until(() => roomOf(beta, 'sess-beta', 'shared project')?.members.find((member) => member.sessionId === 'human')?.name === '老板');
  const renamedPeerView = roomOf(beta, 'sess-beta', 'shared project')?.members.find((member) => member.sessionId === 'human');
  check('the configured identity reaches a peer', renamedPeerView?.name === '老板', JSON.stringify(renamedPeerView));
  await beta.setNickname({ member: 'sess-alpha', name: '' });
  check('clearing a nickname restores the title', (() => {
    const row = roomOf(beta, 'sess-beta', 'shared project')?.members.find((member) => member.sessionId === 'sess-alpha');
    return row?.title !== '小王';
  })(), JSON.stringify(roomOf(beta, 'sess-beta', 'shared project')?.members.find((member) => member.sessionId === 'sess-alpha')));

  console.log('\nan answer that names the person reaches them');
  // The person is a member under a fixed id, so their own name is not in the
  // member list — it comes from the self nickname (or the machine name). Without
  // that, "@老板 已完成" lands on the node and nobody's attention list shows it.
  await alpha.sayInRoom({ room: roomId, sessionId: 'sess-alpha', text: '@老板 任务已经做完了。' });
  const localAttention = (await alpha.snapshot({ sessionId: 'human' })).attention.messages;
  check(
    'a local agent answer names the person',
    localAttention.some((item) => item.text.includes('@老板')),
    JSON.stringify(localAttention.map((item) => item.text)),
  );
  check(
    'the person is not notified about their own message',
    localAttention.every((item) => item.from?.sessionId !== 'human'),
    JSON.stringify(localAttention.map((item) => item.from)),
  );
  await beta.sayInRoom({ room: roomId, sessionId: 'sess-beta', text: '@老板 我这边也收尾了。' });
  await until(() =>
    (async () => {
      const rows = (await alpha.snapshot({ sessionId: 'human' })).attention.messages;
      return rows.some((item) => item.text.includes('我这边也收尾了')) ? rows : undefined;
    })(),
  );
  const remoteRow = (await alpha.snapshot({ sessionId: 'human' })).attention.messages;
  check(
    'a peer answer names the person too',
    remoteRow.some((item) => item.text.includes('我这边也收尾了')),
    JSON.stringify(remoteRow.map((item) => item.text)),
  );
  alpha.roomDetail({ room: roomId, sessionId: 'human' });
  const swept = (await alpha.snapshot({ sessionId: 'human' })).attention.messages;
  check('looking at the room clears the person list', swept.length === 0, JSON.stringify(swept.map((item) => item.text)));

  console.log('\nrename the project');
  const strangerRename = await beta
    .renameRoom({ room: roomId, sessionId: 'sess-beta', name: 'hijacked' })
    .then(() => '')
    .catch((error) => String(error?.code ?? error));
  check('a non-leader cannot rename', strangerRename === 'NOT_LEADER', strangerRename);

  const renamed = await alpha.renameRoom({
    room: roomId,
    sessionId: 'sess-alpha',
    name: 'shared project II',
    topic: 'now with a panel',
  });
  check('the leader renames the room', renamed.room.name === 'shared project II', JSON.stringify(renamed.room.name));
  check('the rename keeps the id', renamed.room.id === roomId, renamed.room.id);
  check('the rename rewrites the topic', renamed.room.topic === 'now with a panel', renamed.room.topic);
  await beta.syncRooms();
  const renameReached = await until(() => roomOf(beta, 'sess-beta', 'shared project II') !== undefined);
  check('the peer learns the new name', renameReached, JSON.stringify(roomNames(beta, 'sess-beta')));

  console.log('\nrestart keeps the project');
  await beta.close();
  const reloaded = new MeshNode({
    config: { ...shared, displayName: 'beta', port: 45_898 },
    log: () => {},
  });
  open.push(reloaded);
  await reloaded.start();
  check('the identity survives a restart', reloaded.nodeId === beta.nodeId, `${reloaded.nodeId} vs ${beta.nodeId}`);
  const restored = roomOf(reloaded, 'sess-beta', 'shared project II');
  check('the room survives a restart', restored !== undefined, JSON.stringify(roomNames(reloaded, 'sess-beta')));
  check('the renamed title survives a restart', restored?.name === 'shared project II', JSON.stringify(restored?.name));
  check('the membership survives a restart', restored?.members.length === 3, JSON.stringify(restored?.members));
  check('the task survives a restart', restored?.tasks[0]?.status === 'doing', JSON.stringify(restored?.tasks));

  console.log('\nleave the project');
  const left = await reloaded.leaveRoom({ room: 'shared project II', sessionId: 'sess-beta' });
  check('leave reports the removal', left.removed === true);
  check('the leaver is out on its own node', !roomNames(reloaded, 'sess-beta').includes('shared project II'), JSON.stringify(roomNames(reloaded, 'sess-beta')));
  await alpha.syncRooms();
  const alphaNoticed = await until(() => (roomOf(alpha, 'sess-alpha', 'shared project II')?.members.length ?? 9) === 2);
  check('the leader learns the departure', alphaNoticed, JSON.stringify(roomOf(alpha, 'sess-alpha', 'shared project II')?.members));
  check('the room itself stays', roomOf(alpha, 'sess-alpha', 'shared project II') !== undefined);

  const leaderCannotLeave = await alpha
    .leaveRoom({ room: roomId, sessionId: 'sess-alpha' })
    .then(() => '')
    .catch((error) => String(error?.code ?? error));
  check('a leader cannot leave its own room', leaderCannotLeave !== '', leaderCannotLeave);

  const unknown = await alpha
    .joinRoom({ room: 'no such project', sessionId: 'sess-alpha' })
    .then(() => '')
    .catch((error) => String(error?.code ?? error));
  check('an unknown room is reported, not created', unknown === 'UNKNOWN_ROOM', unknown);
} finally {
  for (const created of open) {
    try {
      await created.close();
    } catch {
      // Closing twice is normal here: one node was restarted mid-run.
    }
  }
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nrooms interop ok' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
