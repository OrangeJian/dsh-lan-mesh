import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTeamStore } from '../lib/team-store.mjs';
import { encodeTeamRequest, verifyTeamRequest } from '../lib/team-protocol.mjs';
import { MeshServer } from '../lib/transport.mjs';
import { sendTeamRequest } from '../lib/team-protocol.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'team-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openTeamStore({ directory });
  const policy = { nodeId: 'node-b', secret: 'test-secret', trustedPeers: ['node-a'], authorize: () => true };
  const make = (nonce = 'nonce-1234567890', extra = {}) => encodeTeamRequest({ operation: 'dispatch', body: { actorKey: 'node-a/leader', leaderKey: 'node-a/leader', workerKey: 'node-b/worker', roomId: 'room-team', taskId: 'task-1', executionId: 'exec-1', generation: 1, title: 'Build', detail: '', ...extra }, identity: 'node-a', target: 'node-b', secret: policy.secret, now: 1000000, nonce });
  const verify = (req, extra = {}) => verifyTeamRequest({ method: 'POST', path: '/lan-mesh/v1/team', ...req, policy, now: 1000000, store, ...extra });
  return { store, policy, make, verify, directory };
}

test('auth covers bytes, path, target and rejects concurrent replay', async t => {
  const f = await fixture(t);
  const req = f.make();
  await assert.rejects(f.verify({ ...req, bytes: Buffer.from('{}') }), { code: 'AUTH_FAILED' });
  await assert.rejects(f.verify(req, { path: '/other' }), { code: 'AUTH_FAILED' });
  const results = await Promise.allSettled([f.verify(req), f.verify(req)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REPLAY');
  const reopened = await openTeamStore({ directory: f.directory });
  await assert.rejects(f.verify(req, { store: reopened }), { code: 'REPLAY' });
});

test('signed malformed descriptors and oversized requests are rejected before persistence', async t => {
  const f = await fixture(t);
  await assert.rejects(f.verify(f.make('nonce-bad-descriptor', { executionId: '__proto__' })), { code: 'BAD_REQUEST' });
  await assert.rejects(f.verify({ ...f.make(), bytes: Buffer.alloc(256 * 1024 + 1) }), { code: 'TOO_LARGE' });
  assert.equal(Object.keys(f.store.read().nonces).length, 0);
});

test('old peers report unsupported without fallback execution', async t => {
  const server = new MeshServer({ describe: () => ({ nodeId: 'node-b' }), secret: () => 'secret', trustedPeers: () => [] });
  await server.listen(0);
  t.after(() => server.close());
  const request = encodeTeamRequest({ operation: 'dispatch', body: { actorKey: 'node-a/leader' }, identity: 'node-a', target: 'node-b', secret: 'secret' });
  await assert.rejects(sendTeamRequest({ peer: { address: '127.0.0.1', httpPort: server.port }, request, secret: 'secret' }), { code: 'UNSUPPORTED' });
});

test('policy and clock fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(f.verify(f.make(), { policy: { ...f.policy, secret: '' } }), { code: 'AUTH_REQUIRED' });
  await assert.rejects(f.verify(f.make(), { policy: { ...f.policy, trustedPeers: [] } }), { code: 'UNTRUSTED' });
  await assert.rejects(f.verify(f.make(), { policy: { ...f.policy, authorize: () => false } }), { code: 'FORBIDDEN' });
  await assert.rejects(f.verify(f.make(), { now: 1120001 }), { code: 'EXPIRED' });
  assert.equal((await f.verify(f.make(), { now: 1120000 })).operation, 'dispatch');
});
