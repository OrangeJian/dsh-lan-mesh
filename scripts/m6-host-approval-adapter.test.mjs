/** Directed boundary tests for the M6 human-approval local authorization adapter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshNode } from '../lib/service.mjs';
import {
  CAPABILITIES, IGNORED_IDENTITY_FIELDS, ApprovalDenied,
  isOwnerPrincipal, authorizeM6HumanApproval,
} from '../lib/m6-host-approval-adapter.mjs';

// The public SDK's browserPeer shape: { id, principal:{ kind:'owner' } }.
const OWNER = Object.freeze({ id: 'peer-browser', principal: Object.freeze({ kind: 'owner' }) });
const knownOverview = roomId => ({
  scope: 'local', known: true, roomId, status: 'active', revision: 1, generation: 1,
});

function stubNode(overview = knownOverview('room-a')) {
  const calls = [];
  return {
    calls,
    node: { ownerTeamOverview: async roomId => { calls.push(roomId); return overview; } },
  };
}

function realNode() {
  const node = new MeshNode({ config: { teamEnabled: true } });
  node.started = true;
  node.identity = { nodeId: 'node-local' };
  const ownerKey = 'node-local/human';
  const room = { id: 'room-a', name: 'Room A', leader: { key: ownerKey }, members: [{ key: ownerKey }] };
  node.roomsDoc.rooms[room.id] = room;
  node.team = { store: { read: () => ({
    teams: { [room.id]: { revision: 2, generation: 1 } },
    tasks: {}, executions: {},
  }) } };
  return { node, room, ownerKey };
}

test('request-body self-reported identity is never read or reflected in the decision', async () => {
  const { node, calls } = stubNode();
  const forged = {
    capability: 'teamOverview', roomId: 'room-a',
    sessionId: 'human', actorKey: 'node-local/fake-leader', via: 'panel',
    owner: true, principal: { kind: 'owner' }, role: 'owner', leaderKey: 'other/human',
  };
  const decision = await authorizeM6HumanApproval(node, forged, OWNER);
  assert.equal(decision.ok, true);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(decision.basis, 'current-local-human-room-leadership');
  for (const key of IGNORED_IDENTITY_FIELDS) assert.equal(Object.hasOwn(decision, key), false);
  assert.deepEqual(calls, ['room-a']); // only Room data crossed the boundary
});

test('agent and non-owner callers cannot impersonate the human', async () => {
  const { node, calls } = stubNode();
  const bodies = [{
    capability: 'teamOverview', roomId: 'room-a',
    sessionId: 'human', via: 'panel', owner: true,
  }];
  for (const caller of [
    undefined, null, 'human', { kind: 'api' }, { kind: 'agent', sessionId: 'human' },
    { id: 'agent-peer', principal: { kind: 'api' } },
    { sessionId: 'human', via: 'panel' },
  ]) {
    for (const request of bodies) {
      await assert.rejects(
        authorizeM6HumanApproval(node, request, caller),
        error => error instanceof ApprovalDenied && error.code === 'NOT_OWNER',
      );
    }
  }
  assert.deepEqual(calls, []); // refused before touching any Room
  assert.equal(isOwnerPrincipal({ kind: 'agent', sessionId: 'human' }), false);
  assert.equal(isOwnerPrincipal(OWNER), true);
});

test('non-manager, revoked rights and wrong Room are refused through ownerTeamOverview', async () => {
  const { node, room, ownerKey } = realNode();
  // Current local human is Room leader + member: authorized.
  assert.equal((await authorizeM6HumanApproval(node, { capability: 'teamOverview', roomId: room.id }, OWNER)).ok, true);

  // Rights revoked: leader changed while the call is outstanding.
  room.leader.key = 'foreign/human';
  await assert.rejects(
    authorizeM6HumanApproval(node, { capability: 'teamOverview', roomId: room.id }, OWNER),
    error => error instanceof ApprovalDenied && error.code === 'FORBIDDEN',
  );

  // Restored leader, but human removed from membership: refused.
  room.leader.key = ownerKey;
  room.members = [];
  await assert.rejects(
    authorizeM6HumanApproval(node, { capability: 'teamOverview', roomId: room.id }, OWNER),
    error => error instanceof ApprovalDenied && error.code === 'FORBIDDEN',
  );

  // Wrong / unknown Room cannot be probed.
  await assert.rejects(
    authorizeM6HumanApproval(node, { capability: 'teamOverview', roomId: 'no-such-room' }, OWNER),
    error => error instanceof ApprovalDenied && error.code === 'UNKNOWN_ROOM',
  );
});

test('unknown host capability is rejected before any Room access', async () => {
  const { node, calls } = stubNode();
  for (const capability of [undefined, '', 'dispatch', 'approvePlan', 42, 'teamOverview ']) {
    await assert.rejects(
      authorizeM6HumanApproval(node, { capability, roomId: 'room-a' }, OWNER),
      error => error instanceof ApprovalDenied && error.code === 'UNKNOWN_CAPABILITY',
    );
  }
  assert.deepEqual(CAPABILITIES, ['teamOverview', 'resultReview']);
  assert.equal(CAPABILITIES.includes('dispatch'), false);
  assert.equal(CAPABILITIES.includes('approvePlan'), false);
  assert.deepEqual(calls, []);
});

test('authorized decision produces no execution and fails closed on an unknown local view', async () => {
  const ok = stubNode();
  const decision = await authorizeM6HumanApproval(ok.node, { capability: 'resultReview', roomId: 'room-a' }, OWNER);
  assert.equal(decision.producesExecution, false);
  assert.equal(Object.hasOwn(decision, 'executionId'), false);
  assert.deepEqual(ok.calls, ['room-a']);

  const unknown = stubNode({ scope: 'local', known: false, reason: 'NOT_READY' });
  await assert.rejects(
    authorizeM6HumanApproval(unknown.node, { capability: 'teamOverview', roomId: 'room-a' }, OWNER),
    error => error instanceof ApprovalDenied && error.code === 'NOT_READY',
  );
});
