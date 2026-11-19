/**
 * M6 trusted candidate-authority derivation (host-managed data only).
 *
 * Draft basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md
 *   - §4.3 candidate universe is the LOCAL authorized scope (handoff:67);
 *   - §6 capability declarations are used for MATCHING ONLY and never
 *     authorize anything (v0.2:39).
 *
 * D6 RESOLUTION (recorded here as implemented, per the handoff decision):
 * the two halves of `teamAuthorizations` have different purposes and are
 * never conflated:
 *   - The LEADER-side room grant (`workerSessionId: ''` row matching
 *     roomId + leaderKey) defines this node's local orchestration scope for
 *     the Room. It is the authorization gate for candidate enumeration.
 *   - The WORKER-side precise per-session grants stay where they are: they
 *     are only consumed by the unchanged Worker local admission
 *     (`#authorizeTeam`) at dispatch time. They are never enumerated, never
 *     copied into the candidate set and never widen it.
 * Therefore a memberKey is a candidate authority here iff it is a CURRENT
 * Room member on a remote, trusted-peers node AND the Leader-side room grant
 * is present. Capability declarations (`teamCapabilities`) contribute
 * NOTHING to this set.
 *
 * HARD SCOPE: pure computation over caller-supplied snapshots. No I/O, no
 * clock, no ledger, no protocol. The caller (host) is responsible for
 * passing CURRENT data; this module never caches and never derives authority
 * from capability declarations. Capacity is NOT computed here (M1 single
 * slot stays in the reducer/coordinator; `uncertain` occupies).
 */

import { isAbsolute } from 'node:path';
import { teamId, teamMember } from './team-state.mjs';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const MAX_CAPABILITY = 64;
const MAX_CAPABILITIES_PER_MEMBER = 32;
const MAX_PROFILES = 256;

const nodeOf = key => key.split('/')[0];

function capabilityList(value, memberKey) {
  if (!Array.isArray(value)) fail('BAD_CAPABILITIES');
  const result = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_CAPABILITY) {
      fail('BAD_CAPABILITIES');
    }
    result.add(entry);
  }
  if (result.size > MAX_CAPABILITIES_PER_MEMBER) fail('BAD_CAPABILITIES');
  return [...result].sort();
}

/**
 * Derive the trusted candidate inputs for M6 preview / scheduling.
 *
 * @param {object} input
 * @param {string} input.roomId  canonical Room id.
 * @param {string} input.leaderKey  authoritative Team leaderKey (from the ledger).
 * @param {string} input.nodeId  this node's mesh node id.
 * @param {string[]} input.trustedPeers  this node's trusted peer node ids.
 * @param {object[]} input.teamAuthorizations  host config rows:
 *   { roomId, leaderKey, workerSessionId, workspaceRoot }.
 * @param {object[]} input.teamCapabilities  host-managed capability
 *   declarations: { roomId, memberKey, capabilities: string[] }.
 * @param {object[]} input.roomMembers  current Room members: [{ key }].
 * @returns {{leaderScope: boolean, authorizations: string[],
 *            profiles: Array<{memberKey: string, capabilities: string[]}>}}
 *   `leaderScope` false (no current Leader-side room grant) forces an EMPTY
 *   authorization set: candidates are then all excluded UNAUTHORIZED, which
 *   fails closed. `authorizations` is sorted; `profiles` is sorted by
 *   memberKey and is the ONLY capability source handed to the matcher.
 */
export function deriveCandidateAuthority(input) {
  if (!isObject(input)) fail('BAD_REQUEST');
  const roomId = teamId(input.roomId);
  const leaderKey = teamMember(input.leaderKey);
  if (typeof input.nodeId !== 'string' || input.nodeId === '') fail('BAD_REQUEST');
  const trustedPeers = Array.isArray(input.trustedPeers) ? input.trustedPeers : fail('BAD_REQUEST');

  // --- Leader-side local orchestration scope (the D6 authorization gate) ---
  // Only the empty-session grant counts; a Worker-side precise-session row in
  // this config describes THIS node as a Worker and is a different purpose.
  const leaderScope = (Array.isArray(input.teamAuthorizations) ? input.teamAuthorizations : [])
    .some(row => isObject(row)
      && row.roomId === roomId
      && row.leaderKey === leaderKey
      && row.workerSessionId === ''
      && typeof row.workspaceRoot === 'string'
      && isAbsolute(row.workspaceRoot));

  // --- Current authorization set: remote, trusted, current Room members ---
  const authorizations = [];
  if (leaderScope) {
    for (const member of Array.isArray(input.roomMembers) ? input.roomMembers : fail('BAD_REQUEST')) {
      if (!isObject(member)) fail('BAD_REQUEST');
      const key = teamMember(member.key);
      const node = nodeOf(key);
      // A local worker is rejected by the unchanged REMOTE_WORKER_REQUIRED
      // rule, so it is not a candidate authority here either.
      if (node === input.nodeId) continue;
      if (!trustedPeers.includes(node)) continue;
      if (!authorizations.includes(key)) authorizations.push(key);
    }
  }
  authorizations.sort();

  // --- Host-managed capability declarations (matching only) ---
  const profiles = [];
  const seen = new Set();
  const rows = Array.isArray(input.teamCapabilities) ? input.teamCapabilities : fail('BAD_REQUEST');
  for (const row of rows) {
    if (!isObject(row)) fail('BAD_PROFILE');
    if (row.roomId !== roomId) continue;
    const memberKey = teamMember(row.memberKey);
    if (seen.has(memberKey)) fail('DUPLICATE_PROFILE');
    seen.add(memberKey);
    profiles.push({ memberKey, capabilities: capabilityList(row.capabilities, memberKey) });
  }
  if (profiles.length > MAX_PROFILES) fail('BAD_PROFILE');
  profiles.sort((a, b) => (a.memberKey < b.memberKey ? -1 : a.memberKey > b.memberKey ? 1 : 0));

  return { leaderScope, authorizations, profiles };
}
