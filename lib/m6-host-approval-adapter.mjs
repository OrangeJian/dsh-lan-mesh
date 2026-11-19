/**
 * M6 human-approval LOCAL AUTHORIZATION ADAPTER (prerequisite batch only).
 *
 * This is the gate the future M6 human approval entry calls BEFORE any plan
 * approval, result review or dispatch. It reuses two already-verified
 * production paths instead of inventing a new identity or permission model:
 *
 *   1. Host identity: the owner-only Fetch route on the connection service
 *      (`index.js` `createSharedFetchHandler('/api')` + the exact `teamOverview`
 *      route). Its shared handler answers 403 for every non-owner principal
 *      before the route handler runs. IMPORTANT empirical boundary: the public
 *      route handler receives ONLY the `Request`; the admitted principal is
 *      consumed by `createSharedFetchHandler` and is NOT forwarded. So there is
 *      no request-level principal to read inside the handler. The adapter is
 *      therefore invoked only from within that owner-only route, with an
 *      explicit owner-admission fact the bridge passes -- never a value taken
 *      from the request body. This is "behind the owner-only route", not a
 *      verified request-level identity.
 *   2. Current Room management permission and the human identity itself:
 *      `MeshNode#ownerTeamOverview(roomId)` (`lib/service.mjs`). That method
 *      derives the human as `memberKey(node.identity.nodeId, 'human')` from the
 *      node's persisted identity and requires that human to be the CURRENT
 *      Room leader AND a current member. A leader change therefore revokes the
 *      authorization on the next call, and a wrong/unknown Room is refused.
 *
 * Hard limits (by task): no ledger writes, no UI wiring, no real dispatch, no
 * private APIs, no new bypass. The adapter only AUTHORIZES. It never creates
 * an execution, never mutates a Team/Task/Execution, and never returns a
 * credential. Ledger and UI entry land in a separate batch.
 *
 * Trust boundary, stated honestly: a JavaScript object cannot cryptographically
 * attest where it came from, and the public handler exposes no request-level
 * principal. Confidentiality therefore rests on the owner-only route refusing
 * non-owner principals before the adapter is reachable, plus this module
 * failing closed whenever the supplied admission fact is not owner-kind. This
 * module does NOT claim request-level identity verification. Identity is NEVER
 * taken from the request body -- fields such as `sessionId`, `actorKey`,
 * `via`, `owner` or `principal` inside the body carry no authority.
 */

import { TransportError } from './transport.mjs';

/**
 * Capabilities the M6 human entry may ask this host to authorize.
 * Deliberately read/pure-evaluation only: `dispatch` and ledger-side plan
 * approval are NOT listed, so asking for them fails closed as unknown.
 */
export const CAPABILITIES = Object.freeze(['teamOverview', 'resultReview']);

/** Body fields that look like identity but are deliberately never read. */
export const IGNORED_IDENTITY_FIELDS = Object.freeze([
  'sessionId', 'actorKey', 'via', 'owner', 'principal', 'role', 'leaderKey',
]);

/** Error thrown for every refusal, with a machine-readable `code`. */
export class ApprovalDenied extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalDenied';
    this.code = code;
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Accept only an owner admission fact supplied by the host bridge. Two shapes
 * are recognized: a `Principal` (`{kind:'owner'}`) or a `PeerScope`
 * (`{id, principal:{kind:'owner'}}`). Agents (`kind:'agent'`), API/curl
 * callers (`kind:'api'`) and self-reported body objects are all rejected here,
 * before any Room is touched. This fact authenticates the CALL PATH (the
 * owner-only route already admitted the request); it is not a request-level
 * identity read from the handler.
 */
export function isOwnerPrincipal(caller) {
  if (!isObject(caller)) return false;
  if (isObject(caller.principal)) {
    return typeof caller.id === 'string' && caller.principal.kind === 'owner';
  }
  return caller.kind === 'owner';
}

/**
 * Authorize one M6 human-approval capability on this node.
 *
 * @param {object} node - trusted MeshNode (the one the owner-only bridge uses).
 * @param {object} request - untrusted body. Only `capability` and `roomId` are
 *        read, and only as data. Identity fields are never read.
 * @param {object} caller - owner admission fact FROM THE HOST BRIDGE (owner
 *        principal / browserPeer shape), supplied because the request already
 *        passed the owner-only route. Must be owner-kind. NOT a request-level
 *        principal: the public handler does not expose one.
 * @returns {Promise<object>} a frozen authorization decision. No credentials,
 *          no execution, no state mutation.
 * @throws {ApprovalDenied} with a code, failing closed at every boundary.
 */
export async function authorizeM6HumanApproval(node, request, caller) {
  // 1. Channel fact first: only the bridge's owner principal may proceed.
  if (!isOwnerPrincipal(caller)) {
    throw new ApprovalDenied('NOT_OWNER', 'owner principal from the host bridge is required');
  }

  // 2. Capability allowlist, checked before any Room/storage access so an
  //    unknown capability cannot probe room existence.
  const capability = isObject(request) ? request.capability : undefined;
  if (typeof capability !== 'string' || !CAPABILITIES.includes(capability)) {
    throw new ApprovalDenied('UNKNOWN_CAPABILITY', 'unknown host capability');
  }

  // 3. Room reference is data (id or unique name), not identity.
  const roomId = request.roomId;
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new ApprovalDenied('BAD_ROOM', 'roomId is required');
  }

  // 4. Reuse the production identity + current Room management permission
  //    path. Any refusal from it is propagated, never softened.
  let overview;
  try {
    overview = await node.ownerTeamOverview(roomId);
  } catch (error) {
    const code = error instanceof TransportError || typeof error?.code === 'string'
      ? error.code : 'AUTHORIZATION_FAILED';
    throw new ApprovalDenied(code, `M6 human approval authorization denied: ${error?.message ?? String(error)}`);
  }
  // Fail closed unless the production path explicitly succeeds. The real
  // MeshNode#ownerTeamOverview shape always carries `known`; require it to be
  // STRICTLY true (a missing/undefined `known` is not success) and require a
  // known local view, never inferred from the absence of an error.
  if (!isObject(overview) || overview.known !== true || overview.scope !== 'local') {
    throw new ApprovalDenied(overview?.reason ?? 'NOT_READY', 'local Room authority is not verifiable');
  }

  // The authoritative Room id is the projection's canonical id. Never fall
  // back to the request's room string (it may be a display name): a projection
  // without a canonical id cannot authorize.
  const canonicalRoomId = overview.roomId;
  if (typeof canonicalRoomId !== 'string' || canonicalRoomId.length === 0) {
    throw new ApprovalDenied('MISSING_CANONICAL_ROOM', 'projection did not return a canonical room id');
  }

  // 5. Return a minimal decision. It contains NO body-derived identity and
  //    grants no execution: the caller must still go through the chosen
  //    capability's own read/pure-evaluation path.
  return Object.freeze({
    ok: true,
    capability,
    roomId: canonicalRoomId,
    scope: 'local',
    basis: 'current-local-human-room-leadership',
    producesExecution: false,
  });
}
