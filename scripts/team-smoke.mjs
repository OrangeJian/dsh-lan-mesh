/** Two real HTTP MeshNodes, two Worker sessions, stub model runtime. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';
import { createRoom, emptyState, addMember } from '../lib/rooms.mjs';

const root = await mkdtemp(join(tmpdir(), 'team-wire-'));
const savedHome = process.env.DSH_HOME;
const nodes = [];
const wakes = [];
function runtime(ids) {
  const agents = new Map(ids.map(id => [id, { id, status: 'idle', followup: value => wakes.push({ id, value }) }]));
  return { get: id => agents.get(id), list: () => [...agents.values()] };
}
try {
  for (const [name, ids] of [['a', ['leader']], ['b', ['worker-1', 'worker-2']]]) {
    process.env.DSH_HOME = join(root, name);
    const node = new MeshNode({ agents: runtime(ids), sessionPersistence: { list: async () => ids.map(id => ({ header: { id, cwd: root } })) }, config: {
      displayName: name, port: 0, discoveryPort: 0, clusterSecret: 'integration-secret', trustedPeers: ['bootstrap'], autoWake: false, teamEnabled: true, teamAuthorizations: [],
    } });
    nodes.push(node);
    await node.start();
    clearInterval(node.teamTimer);
  }
  const [a, b] = nodes;
  a.config.trustedPeers = [b.nodeId];
  b.config.trustedPeers = [a.nodeId];
  const state = emptyState();
  const leader = { nodeId: a.nodeId, sessionId: 'leader', name: 'Leader' };
  const room = createRoom(state, { name: 'Wire integration', leader }, () => '111111111111-aaaa-bbbb-cccc-111111111111');
  // Use the same public Room reducer as the production room service.
  for (const id of ['worker-1', 'worker-2']) addMember(state, room.id, { nodeId: b.nodeId, sessionId: id, name: id });
  a.roomsDoc = structuredClone(state);
  b.roomsDoc = structuredClone(state);
  a.config.teamAuthorizations = [{ roomId: room.id, leaderKey: `${a.nodeId}/leader`, workerSessionId: '', workspaceRoot: root }];
  b.config.teamAuthorizations = ['worker-1', 'worker-2'].map(workerSessionId => ({ roomId: room.id, leaderKey: `${a.nodeId}/leader`, workerSessionId, workspaceRoot: root }));
  a.resolvePeers = () => [{ nodeId: b.nodeId, address: '127.0.0.1', httpPort: b.server.port }];
  b.resolvePeers = () => [{ nodeId: a.nodeId, address: '127.0.0.1', httpPort: a.server.port }];
  await a.teamCreate({ roomId: room.id, sessionId: 'leader' });
  const executions = [];
  for (const id of ['worker-1', 'worker-2']) executions.push(await a.teamDispatch({ roomId: room.id, sessionId: 'leader', workerKey: `${b.nodeId}/${id}`, title: `Task ${id}` }));
  await b.team.tick();
  assert.equal(wakes.length, 2);
  await b.team.tick();
  assert.equal(wakes.length, 2);
  for (const e of executions) await b.teamReport({ sessionId: e.workerKey.split('/')[1], executionId: e.executionId, status: 'succeeded', summary: 'Integration result' });
  const status = await a.teamStatus({ roomId: room.id, sessionId: 'leader' });
  assert.equal(status.tasks.length, 2);
  assert.ok(status.tasks.every(task => task.status === 'review'));
  assert.ok(status.executions.every(e => e.state === 'succeeded'));
  console.log('Team HTTP smoke: two Worker sessions woke once each; both results persisted for review.');
  b.config.teamAuthorizations = [];
  const denied = await a.teamDispatch({ roomId: room.id, sessionId: 'leader', workerKey: `${b.nodeId}/worker-1`, title: 'Revoked authorization' });
  await b.team.tick();
  assert.equal(wakes.length, 2);
  assert.equal(a.team.store.read().executions[denied.executionId].state, 'queued');
  console.log('Team HTTP smoke: revoked local authorization prevents execution.');
} finally {
  await Promise.allSettled(nodes.map(node => node.close()));
  if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
  await rm(root, { recursive: true, force: true });
}
