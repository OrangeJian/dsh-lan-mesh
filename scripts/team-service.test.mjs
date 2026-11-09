import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';

test('Team service defaults closed and never accepts a self-reported actor', async t => {
  const node = new MeshNode({ config: { teamEnabled: false } });
  await assert.rejects(node.teamCreate({ roomId: 'room-team', actorKey: 'fake/leader' }), { code: 'TEAM_DISABLED' });
});

test('enabled Team requires local identity, authorization and matching Room leader', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'team-service-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = directory;
  const node = new MeshNode({ config: { teamEnabled: true, clusterSecret: 'test-secret', trustedPeers: ['remote-node'], teamAuthorizations: [], port: 0, discoveryPort: 0, displayName: 'test', autoWake: false } });
  t.after(async () => { await node.close(); if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; await rm(directory, { recursive: true, force: true }); });
  await node.start();
  await assert.rejects(node.teamCreate({ roomId: 'room-team', actorKey: 'fake/leader' }), { code: 'BAD_REQUEST' });
  node.roomsDoc.rooms['room-team'] = { id: 'room-team', leader: { key: `${node.nodeId}/leader` }, members: [{ key: `${node.nodeId}/leader` }] };
  await assert.rejects(node.teamCreate({ roomId: 'room-team', sessionId: 'other' }), { code: 'FORBIDDEN' });
  await assert.rejects(node.teamCreate({ roomId: 'room-team', sessionId: 'leader' }), { code: 'FORBIDDEN' });
  node.config.teamAuthorizations.push({ roomId: 'room-team', leaderKey: `${node.nodeId}/leader`, workerSessionId: '', workspaceRoot: directory });
  const created = await node.teamCreate({ roomId: 'room-team', sessionId: 'leader' });
  assert.equal(created.leaderKey, `${node.nodeId}/leader`);
  node.roomsDoc.rooms['room-team'].members.push({ key: 'untrusted-node/worker' });
  await assert.rejects(node.teamDispatch({ roomId: 'room-team', sessionId: 'leader', workerKey: 'untrusted-node/worker', title: 'Must not leave node' }), { code: 'FORBIDDEN' });
  assert.equal(Object.keys(node.team.store.read().tasks).length, 0);
  node.roomsDoc.rooms['room-team'].members.push({ key: 'remote-node/worker' });
  let sends = 0;
  node.team.send = async () => { sends++; throw new Error('offline'); };
  const queued = await node.teamDispatch({ roomId: 'room-team', sessionId: 'leader', workerKey: 'remote-node/worker', title: 'Pending' });
  const before = sends;
  await assert.rejects(node.teamReconcile({ executionId: queued.executionId, sessionId: 'leader', stopped: true, reason: 'Not uncertain yet' }), { code: 'INVALID_TRANSITION' });
  assert.equal(sends, before);
  await node.team.store.transact(state => { state.executions[queued.executionId].admissionExpiresAt = 0; return { state }; });
  await node.team.tick();
  const reconciled = await node.teamReconcile({ executionId: queued.executionId, sessionId: 'leader', stopped: true, reason: 'Human checked Worker stopped' });
  assert.equal(reconciled.execution.state, 'cancelled');
  assert.equal(reconciled.remotePending, true);
  assert.equal(Object.hasOwn(node.team.store.read().outbox[`reconcile:${queued.executionId}`].body, 'events'), false);
  node.roomsDoc.rooms['room-team'].leader.key = 'remote-node/replacement';
  await node.team.tick();
  await assert.rejects(node.teamDispatch({ roomId: 'room-team', sessionId: 'leader', workerKey: 'remote-node/worker', title: 'Test' }), { code: 'ROOM_CHANGED' });
});
