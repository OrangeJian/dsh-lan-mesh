// M6 Owner human plan entry: read / submit / approve through the owner-only
// exact Fetch route. These tests exercise the real public SDK route boundary
// (non-owner 403 before the handler) and the server-derived identity/Room
// authorization used by the plan ledger transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MeshNode } from '../lib/service.mjs';
import { openTeamStore } from '../lib/team-store.mjs';
import { applyTeamCommand } from '../lib/team-state.mjs';
import { planFingerprint } from '../lib/m6-plan-preview.mjs';
import { createM6PlanEntry } from '../index.js';

const ROOM = 'room-owner';
const OTHER_ROOM = 'room-other';
const LEADER = 'node-local/human';
const OWNER = Object.freeze({ kind: 'owner' });
const FORGED = {
  sessionId: 'human', actorKey: 'node-evil/human', via: 'panel',
  owner: true, principal: { kind: 'owner' }, role: 'owner', leaderKey: 'node-evil/human',
};

const TASKS = [
  { taskId: 'A', roomId: ROOM, dependsOn: [], requiredCapabilities: ['build'], title: 'A', detail: 'a' },
  { taskId: 'B', roomId: ROOM, dependsOn: ['A'], requiredCapabilities: ['test'], title: 'B', detail: 'b' },
];
const TASKS_V2 = [
  { taskId: 'A', roomId: ROOM, dependsOn: [], requiredCapabilities: ['build'], title: 'A', detail: 'a-v2' },
  { taskId: 'B', roomId: ROOM, dependsOn: ['A'], requiredCapabilities: ['test'], title: 'B', detail: 'b' },
];
const FP = planFingerprint(TASKS);

test('owner preview reads the approved ledger version and ignores untrusted candidate inputs', async t => {
  const { raw, entry } = await setup(t);
  await entry.submit(submit());
  await entry.approve({ roomId: ROOM, planId: 'plan-1', expectedRevision: 1, expectedGeneration: 1, fingerprint: FP, requestId: 'approve-preview' });
  const payload = { roomId: ROOM, planId: 'plan-1', tasks: [], authorizations: ['node-evil/agent'] };
  await assert.rejects(raw.preview(payload, { kind: 'agent' }), { code: 'NOT_OWNER' });
  const report = await raw.preview(payload, OWNER);
  assert.equal(report.bound, true);
  assert.deepEqual(report.dag.order, ['A', 'B']);
  assert.deepEqual(report.candidates.A.recommended, []);
  assert.equal(report.candidates.A.dispatchable, false);
});

function roomOf(id, leaderKey, name = 'Owner Room') {
  return {
    id, name,
    leader: { key: leaderKey },
    members: [{ key: leaderKey }],
    lifecycle: { status: 'active' },
  };
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'm6-owner-plan-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openTeamStore({ directory });
  await store.transact(state => ({
    state: applyTeamCommand(state, {
      type: 'create-team', roomId: ROOM, actorKey: LEADER, leaderKey: LEADER,
    }).state,
  }));
  const node = new MeshNode({ config: { teamEnabled: true } });
  node.started = true;
  node.identity = { nodeId: 'node-local', name: 'local' };
  const room = roomOf(ROOM, LEADER);
  node.roomsDoc.rooms[ROOM] = room;
  node.team = { store };
  const raw = createM6PlanEntry({ node, now: () => 1_700_000_000_000 });
  // Test convenience: bind the owner admission fact explicitly, as the owner-only
  // route bridge does in production.
  const entry = Object.freeze({
    list: payload => raw.list(payload, OWNER),
    read: payload => raw.read(payload, OWNER),
    submit: payload => raw.submit(payload, OWNER),
    approve: payload => raw.approve(payload, OWNER),
  });
  return { directory, store, node, room, entry, raw };
}

function submit(overrides = {}) {
  return {
    requestId: 'req-submit-1', roomId: ROOM, planId: 'plan-1',
    expectedRevision: 0, expectedGeneration: 1, tasks: structuredClone(TASKS),
    ...overrides,
  };
}

function approve(overrides = {}) {
  return {
    requestId: 'req-approve-1', roomId: ROOM, planId: 'plan-1',
    expectedRevision: 1, expectedGeneration: 1, fingerprint: FP,
    ...overrides,
  };
}

test('owner can list, read, submit and approve a plan through the entry', async t => {
  const { store, entry } = await setup(t);
  const submitted = await entry.submit({ ...submit(), ...FORGED });
  assert.deepEqual(submitted, {
    planId: 'plan-1', roomId: ROOM, generation: 1, revision: 1,
    fingerprint: FP, approved: false,
  });
  assert.equal(store.read().plans['plan-1'].tasks[0].detail, 'a');

  const listed = await entry.list({ roomId: ROOM, ...FORGED });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].planId, 'plan-1');

  // The request may name the Room; the ledger only ever sees the canonical id.
  assert.equal((await entry.list({ roomId: 'Owner Room' })).length, 1);

  const read = await entry.read({ roomId: ROOM, planId: 'plan-1' });
  assert.equal(read.revision, 1);
  assert.equal(read.approval, null);

  const approved = await entry.approve({ ...approve(), ...FORGED });
  assert.equal(approved.actorKey, LEADER, 'identity is server-derived, not the forged body');
  assert.equal(approved.planId, 'plan-1');
  assert.equal(approved.fingerprint, FP);
  assert.deepEqual((await entry.read({ roomId: ROOM, planId: 'plan-1' })).approval, approved);
});

test('owner admission fact is required before any Room or ledger access', async t => {
  const { raw, node } = await setup(t);
  let roomCalls = 0;
  const realOverview = node.ownerTeamOverview.bind(node);
  node.ownerTeamOverview = async (...args) => { roomCalls += 1; return realOverview(...args); };
  for (const admission of [
    undefined, null, 'owner', { kind: 'agent' }, { kind: 'api' },
    { sessionId: 'human', via: 'panel', owner: true },
    { id: 'agent', principal: { kind: 'agent' } },
  ]) {
    await assert.rejects(raw.list({ roomId: ROOM }, admission), error => error.code === 'NOT_OWNER');
    await assert.rejects(raw.submit(submit(), admission), error => error.code === 'NOT_OWNER');
    await assert.rejects(raw.approve(approve(), admission), error => error.code === 'NOT_OWNER');
  }
  assert.equal(roomCalls, 0, 'refused before touching any Room');
});

test('self-reported body identity is never read and cannot become the approver', async t => {
  const { store, entry } = await setup(t);
  await entry.submit(submit());
  const approved = await entry.approve({ ...approve(), ...FORGED });
  assert.equal(approved.actorKey, LEADER);
  assert.notEqual(approved.actorKey, FORGED.actorKey);
  assert.equal(store.read().plans['plan-1'].approval.actorKey, LEADER);
});

test('non-manager, revoked rights and wrong Room are refused', async t => {
  const { node, room, store, entry } = await setup(t);
  await entry.submit(submit());

  // A different Room the local human does not lead cannot be used as a handle.
  node.roomsDoc.rooms[OTHER_ROOM] = roomOf(OTHER_ROOM, 'node-local/agent', 'Other Room');
  await assert.rejects(entry.submit(submit({ roomId: OTHER_ROOM, planId: 'plan-2' })),
    error => error.code === 'FORBIDDEN');
  await assert.rejects(entry.read({ roomId: OTHER_ROOM, planId: 'plan-2' }),
    error => error.code === 'FORBIDDEN');
  await assert.rejects(entry.list({ roomId: OTHER_ROOM }), error => error.code === 'FORBIDDEN');

  // Unknown Room cannot be probed.
  await assert.rejects(entry.list({ roomId: 'no-such-room' }), error => error.code === 'UNKNOWN_ROOM');

  // Leader changed while the plan exists: approval is revoked immediately.
  room.leader.key = 'foreign/human';
  await assert.rejects(entry.approve(approve()), error => error.code === 'FORBIDDEN');
  assert.equal(store.read().plans['plan-1'].approval, null);

  // Restored leadership, but the human is no longer a member.
  room.leader.key = LEADER;
  room.members = [];
  await assert.rejects(entry.approve(approve()), error => error.code === 'FORBIDDEN');
  assert.equal(node.team.store.read().plans['plan-1'].approval, null);
});

test('revocation that lands after the pre-check is caught inside the ledger transaction', async t => {
  const { node, room, entry } = await setup(t);
  const realOverview = node.ownerTeamOverview.bind(node);
  let calls = 0;
  // First call is the entry's canonical-Room pre-check; the second is the
  // delegate consulted by the plan service INSIDE its transaction. Revoke
  // between them to prove the write is re-authorized at commit time.
  node.ownerTeamOverview = async (...args) => {
    calls += 1;
    if (calls === 2) room.leader.key = 'foreign/human';
    return realOverview(...args);
  };
  await assert.rejects(entry.submit(submit()), error => error.code === 'FORBIDDEN');
  assert.equal(calls, 2, 'the delegate must be consulted inside the transaction');
  assert.equal(node.team.store.read().plans['plan-1'], undefined, 'revoked write must not persist');
});

test('version, generation and approval binding conflicts are refused by the ledger', async t => {
  const { store, entry } = await setup(t);
  await entry.submit(submit());

  await assert.rejects(entry.submit(submit({ requestId: 'req-stale-rev' })),
    error => error.code === 'REVISION_CONFLICT');
  await assert.rejects(entry.submit(submit({ requestId: 'req-stale-gen', expectedRevision: 1, expectedGeneration: 2 })),
    error => error.code === 'STALE_GENERATION');

  await entry.approve(approve());
  await assert.rejects(entry.approve(approve({ requestId: 'req-wrong-rev', expectedRevision: 2 })),
    error => error.code === 'APPROVAL_BINDING_MISMATCH');
  await assert.rejects(entry.approve(approve({ requestId: 'req-wrong-fp', fingerprint: planFingerprint(TASKS_V2) })),
    error => error.code === 'APPROVAL_BINDING_MISMATCH');
  assert.equal(store.read().plans['plan-1'].revision, 1);

  // A content change requires a new revision and clears the old approval.
  const bumped = await entry.submit(submit({
    requestId: 'req-submit-2', expectedRevision: 1, tasks: structuredClone(TASKS_V2),
  }));
  assert.equal(bumped.revision, 2);
  assert.equal(store.read().plans['plan-1'].approval, null);
});

// --- Real public SDK owner-only exact-route boundary ------------------------

function resolveSdk() {
  let resolver = createRequire(new URL('../package.json', import.meta.url));
  try {
    resolver.resolve('@deepseek-ai/dsh/package.json');
  } catch {
    const root = execFileSync(
      process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npm root -g'] : ['root', '-g'],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true },
    ).trim();
    resolver = createRequire(join(root, '__m6_owner_plan__.cjs'));
  }
  const hostPath = resolver.resolve('@deepseek-ai/dsh/package.json');
  return createRequire(hostPath);
}

test('real SDK exact route: non-owner is 403 before the handler; owner can approve', async t => {
  const { store, entry } = await setup(t);
  const fromHost = resolveSdk();
  const { Context } = await import(pathToFileURL(fromHost.resolve('@deepseek-ai/cordis')).href);
  const { HostConnectionService } = await import(
    pathToFileURL(fromHost.resolve('@deepseek-ai/dsh-client-connection')).href
  );

  const connection = new HostConnectionService(new Context(), [], {
    isAuthenticated: () => false, authenticateApi: () => undefined,
  });
  t.after(async () => {
    await connection.browserPeer.dispose().catch(() => {});
  });

  const ROUTE = '/api/m6-owner-plan-entry-test';
  let handlerCalls = 0;
  let handlerArgs = null;
  const dispose = connection.fetch.register({
    path: ROUTE, methods: ['POST'], requestBody: 'buffered',
    fetch: async (...args) => {
      handlerCalls += 1;
      handlerArgs = args;
      const body = await args[0].json();
      const value = await entry[body.action](body.payload);
      return new Response(JSON.stringify(value), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  t.after(() => dispose());

  const handler = connection.createSharedFetchHandler('/api');
  const request = () => new Request('http://localhost' + ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner': 'true' },
    body: JSON.stringify({ action: 'submit', payload: { ...submit(), ...FORGED } }),
  });

  // Non-owner (api / agent) is rejected by the shared handler before the route
  // runs, no matter what the body or headers claim.
  for (const principal of [{ principal: { kind: 'api' } }, { id: 'agent', principal: { kind: 'agent' } }]) {
    const denied = await handler.fetch(request(), principal);
    assert.equal(denied.status, 403);
  }
  assert.equal(handlerCalls, 0);
  assert.equal(handlerArgs, null);

  // The real browserPeer owner principal reaches the handler, which still gets
  // only the Request (no request-level principal is forwarded).
  const admitted = await handler.fetch(request(), connection.browserPeer);
  assert.equal(admitted.status, 200);
  assert.equal(handlerCalls, 1);
  assert.equal(handlerArgs.length, 1);
  assert.equal(handlerArgs[0] instanceof Request, true);
  assert.equal(store.read().plans['plan-1'].approval, null);
  assert.equal(store.read().plans['plan-1'].revision, 1);

  // Approve through the same admitted route; forged body identity is ignored.
  const approveRequest = new Request('http://localhost' + ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', payload: { ...approve(), ...FORGED } }),
  });
  const approvedResponse = await handler.fetch(approveRequest, connection.browserPeer);
  assert.equal(approvedResponse.status, 200);
  const approved = await approvedResponse.json();
  assert.equal(approved.actorKey, LEADER);
  assert.equal(store.read().plans['plan-1'].approval.actorKey, LEADER);

  // Disposal removes the exact route (404), matching the SDK contract.
  await dispose();
  const gone = await handler.fetch(request(), connection.browserPeer);
  assert.equal(gone.status, 404);
});
