import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCandidateAuthority } from '../lib/m6-candidate-authority.mjs';

const ROOM = 'room-cand';
const LEADER = 'node-a/human';

function input(overrides = {}) {
  return {
    roomId: ROOM,
    leaderKey: LEADER,
    nodeId: 'node-a',
    trustedPeers: ['node-b', 'node-c'],
    teamAuthorizations: [
      { roomId: ROOM, leaderKey: LEADER, workerSessionId: '', workspaceRoot: 'C:/work/project' },
    ],
    teamCapabilities: [
      { roomId: ROOM, memberKey: 'node-b/w1', capabilities: ['build', 'test'] },
    ],
    roomMembers: [
      { key: LEADER },
      { key: 'node-b/w1' },
      { key: 'node-c/w2' },
    ],
    ...overrides,
  };
}

test('leader-side room grant defines the local scope and remote trusted members are authorized', () => {
  const authority = deriveCandidateAuthority(input());
  assert.equal(authority.leaderScope, true);
  // Only CURRENT Room members on remote trusted nodes; the local leader is
  // never a candidate (REMOTE_WORKER_REQUIRED path stays intact).
  assert.deepEqual(authority.authorizations, ['node-b/w1', 'node-c/w2']);
});

test('a Worker-side precise session grant never widens the candidate scope', () => {
  const authority = deriveCandidateAuthority(input({
    teamAuthorizations: [
      { roomId: ROOM, leaderKey: LEADER, workerSessionId: 'w1', workspaceRoot: 'C:/work/project' },
    ],
  }));
  assert.equal(authority.leaderScope, false);
  assert.deepEqual(authority.authorizations, []);
});

test('no Leader-side grant fails closed with an empty authorization set', () => {
  const authority = deriveCandidateAuthority(input({ teamAuthorizations: [] }));
  assert.equal(authority.leaderScope, false);
  assert.deepEqual(authority.authorizations, []);
});

test('a grant for a different leader or Room does not count', () => {
  for (const row of [
    { roomId: 'room-other', leaderKey: LEADER, workerSessionId: '', workspaceRoot: 'C:/work' },
    { roomId: ROOM, leaderKey: 'node-a/other', workerSessionId: '', workspaceRoot: 'C:/work' },
    { roomId: ROOM, leaderKey: LEADER, workerSessionId: '', workspaceRoot: 'relative/path' },
  ]) {
    const authority = deriveCandidateAuthority(input({ teamAuthorizations: [row] }));
    assert.equal(authority.leaderScope, false);
    assert.deepEqual(authority.authorizations, []);
  }
});

test('untrusted or local nodes are excluded from the authorization set', () => {
  const authority = deriveCandidateAuthority(input({
    trustedPeers: ['node-b'],
    roomMembers: [{ key: LEADER }, { key: 'node-b/w1' }, { key: 'node-c/w2' }, { key: 'node-a/w3' }],
  }));
  assert.deepEqual(authority.authorizations, ['node-b/w1']);
});

test('capability declarations are matching-only and scoped to the Room', () => {
  const authority = deriveCandidateAuthority(input({
    teamCapabilities: [
      { roomId: 'room-other', memberKey: 'node-b/elsewhere', capabilities: ['build'] },
      { roomId: ROOM, memberKey: 'node-b/w1', capabilities: ['test', 'build', 'test'] },
    ],
  }));
  assert.deepEqual(authority.profiles, [{ memberKey: 'node-b/w1', capabilities: ['build', 'test'] }]);
});

test('capability declarations never add to the authorization set', () => {
  const authority = deriveCandidateAuthority(input({
    roomMembers: [{ key: LEADER }],
    teamCapabilities: [{ roomId: ROOM, memberKey: 'node-b/w1', capabilities: ['build'] }],
  }));
  assert.deepEqual(authority.authorizations, []);
  assert.equal(authority.profiles.length, 1);
});

test('malformed inputs fail closed', () => {
  assert.throws(() => deriveCandidateAuthority(input({ roomId: 'bad id!' })), { code: 'BAD_REQUEST' });
  assert.throws(() => deriveCandidateAuthority(input({ leaderKey: 'nope' })), { code: 'BAD_REQUEST' });
  assert.throws(() => deriveCandidateAuthority(input({ trustedPeers: 'node-b' })), { code: 'BAD_REQUEST' });
  assert.throws(() => deriveCandidateAuthority(input({ roomMembers: [{ key: 'bad key' }] })), { code: 'BAD_REQUEST' });
  assert.throws(() => deriveCandidateAuthority(input({
    teamCapabilities: [{ roomId: ROOM, memberKey: 'node-b/w1', capabilities: ['build'] }, { roomId: ROOM, memberKey: 'node-b/w1', capabilities: [] }],
  })), { code: 'DUPLICATE_PROFILE' });
  assert.throws(() => deriveCandidateAuthority(input({
    teamCapabilities: [{ roomId: ROOM, memberKey: 'node-b/w1', capabilities: 'build' }],
  })), { code: 'BAD_CAPABILITIES' });
  assert.throws(() => deriveCandidateAuthority(input({
    teamCapabilities: [{ roomId: ROOM, memberKey: 'node-b/w1', capabilities: ['x'.repeat(65)] }],
  })), { code: 'BAD_CAPABILITIES' });
});
