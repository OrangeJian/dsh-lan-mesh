/**
 * M6 HOST IDENTITY PROBE -- reproducible, isolated evidence gatherer.
 *
 * Reads the INSTALLED PUBLIC SDK declarations (no private API, no source under
 * src/*) and runs the in-process connection component with stubbed
 * authentication. It records exactly what identity the public SDK can and
 * cannot provide, then shows the M6 adapter bound to the verified owner-only
 * route -- without pretending a request-level principal exists.
 *
 * Recorded boundary (verified below, not assumed): a public exact-route handler
 * receives ONLY the Request. The admitted principal is consumed by
 * createSharedFetchHandler for admission (403 non-owner / 200 owner) and is NOT
 * forwarded into the handler. There is therefore no request-level principal to
 * read, and this probe does not claim request-level identity verification.
 *
 * NOT run: real browser-cookie auth, remote owner identity, physical two
 * machines, per-Room ACL changes on a live Host, or any real dispatch.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CAPABILITIES, IGNORED_IDENTITY_FIELDS, ApprovalDenied,
  authorizeM6HumanApproval,
} from '../lib/m6-host-approval-adapter.mjs';

// Resolve the installed SDK the same way the existing C0 inventory does.
let resolver = createRequire(new URL('../package.json', import.meta.url));
try {
  resolver.resolve('@deepseek-ai/dsh/package.json');
} catch {
  const root = execFileSync(
    process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npm root -g'] : ['root', '-g'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  ).trim();
  resolver = createRequire(join(root, '__m6_identity__.cjs'));
}
const hostPath = resolver.resolve('@deepseek-ai/dsh/package.json');
const host = JSON.parse(readFileSync(hostPath, 'utf8'));
const fromHost = createRequire(hostPath);

const sha256 = body => createHash('sha256').update(body).digest('hex');
function declarationFact(packageName, relative, name) {
  const metadataPath = fromHost.resolve('@deepseek-ai/' + packageName + '/package.json');
  const body = readFileSync(join(dirname(metadataPath), relative), 'utf8');
  return { name, packageName, declaration: relative, sha256: sha256(body), body };
}
const decls = [
  declarationFact('dsh-client-connection', './lib/types/index.d.ts', 'connection-index'),
  declarationFact('dsh-client-connection', './lib/types/rpc-host.d.ts', 'connection-host'),
  declarationFact('dsh-client-connection', './lib/types/rpc.d.ts', 'connection-rpc'),
  declarationFact('dsh-typert-protocol', './lib/types/types.d.ts', 'typert-types'),
];
const allDeclarations = decls.map(d => d.body).join('\n');

const sdkFacts = {
  hostVersion: host.version,
  evidenceLevel: 'installed-public-declaration-and-in-process-component',
  declarations: decls.map(({ name, packageName, declaration, sha256: hash }) => ({
    name, packageName, declaration, sha256: hash,
  })),
  publicOwnerSurface: {
    hostConnectionServiceExported: /export\s*\{\s*HostConnectionService\s*\}/.test(decls[0].body),
    browserPeerDeclared: /readonly\s+browserPeer\s*:\s*PeerScope/.test(decls[1].body + decls[2].body),
    sharedOwnerOnlyHandlerDeclared: /createSharedFetchHandler\(channel:\s*'\/api'\)/.test(decls[1].body + decls[2].body),
    ownerPrincipalKindDeclared: /readonly\s+kind:\s*'owner'/.test(decls[3].body),
    principalTypeExported: /export\s+type\s*\{\s*PrincipalMap/.test(decls[0].body) || /PrincipalMap/.test(decls[3].body),
    routeHandlerFetchSignature: "fetch: (request: Request) => Promise<Response>",
  },
  // The SDK knows *an owner principal*; it has no notion of the repo's fixed
  // 'human' session or of per-Room management permission.
  sdkProvidesHumanSessionIdentity: /HUMAN_SESSION_ID/.test(allDeclarations),
  sdkProvidesRoomPermissionModel: /ownerTeamOverview|roomLeader|RoomLeadership/.test(allDeclarations),
};
assert.equal(sdkFacts.publicOwnerSurface.hostConnectionServiceExported, true);
assert.equal(sdkFacts.publicOwnerSurface.browserPeerDeclared, true);
assert.equal(sdkFacts.publicOwnerSurface.sharedOwnerOnlyHandlerDeclared, true);
assert.equal(sdkFacts.publicOwnerSurface.ownerPrincipalKindDeclared, true);
assert.equal(sdkFacts.sdkProvidesHumanSessionIdentity, false);
assert.equal(sdkFacts.sdkProvidesRoomPermissionModel, false);

// --- In-process component probe (authentication stubbed to deny-all) ---
const { Context } = await import(pathToFileURL(fromHost.resolve('@deepseek-ai/cordis')).href);
const { HostConnectionService } = await import(
  pathToFileURL(fromHost.resolve('@deepseek-ai/dsh-client-connection')).href
);
const ctx = new Context();
const connection = new HostConnectionService(ctx, [], {
  isAuthenticated: () => false, authenticateApi: () => undefined,
});

// The real MeshNode#ownerTeamOverview shape: scope + canonical roomId + known.
const stubNode = {
  ownerTeamOverview: async roomId => ({
    scope: 'local', known: true, roomId, status: 'active', revision: 1, generation: 1,
  }),
};

const ROUTE = '/api/m6-identity-probe';
let handlerArgs = null;
let adapterDecision = null;
const dispose = connection.fetch.register({
  path: ROUTE, methods: ['POST'], requestBody: 'buffered',
  fetch: async (...args) => {
    // Record the ACTUAL invocation context instead of assuming one.
    handlerArgs = args;
    const request = args[0];
    const body = await request.json();
    // Invoked ONLY here, inside the already-admitted owner-only route. The
    // third argument is an explicit owner-admission FACT the bridge supplies;
    // it is NOT connection.browserPeer and NOT a request-level principal.
    adapterDecision = await authorizeM6HumanApproval(stubNode, body, { kind: 'owner' });
    return new Response(JSON.stringify({ ok: adapterDecision.ok, roomId: adapterDecision.roomId }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  },
});
const handler = connection.createSharedFetchHandler('/api');
const forgedRequest = () => new Request('http://localhost' + ROUTE, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-owner': 'true' },
  body: JSON.stringify({ capability: 'teamOverview', roomId: 'room-a', sessionId: 'human', via: 'panel', owner: true }),
});

const routeBoundary = {};
try {
  const nonOwner = await handler.fetch(forgedRequest(), { principal: { kind: 'api' } });
  assert.equal(nonOwner.status, 403);      // forged body/header do not matter
  assert.equal(handlerArgs, null);         // route handler never ran
  assert.equal(adapterDecision, null);     // adapter never ran
  routeBoundary.nonOwnerStatus = 403;

  const owner = await handler.fetch(forgedRequest(), connection.browserPeer);
  assert.equal(owner.status, 200);
  routeBoundary.handlerArgCount = handlerArgs.length;
  routeBoundary.handlerArgTypes = handlerArgs.map(a => a?.constructor?.name ?? typeof a);
  routeBoundary.handlerReceivesRequestLevelPrincipal = handlerArgs.length > 1;
  routeBoundary.adapterCallerSource = 'route admission fact; NOT connection.browserPeer; NOT a request-level principal';
  assert.equal(routeBoundary.handlerReceivesRequestLevelPrincipal, false);
  assert.equal(handlerArgs[0] instanceof Request, true);
  assert.equal(adapterDecision.ok, true);
  assert.equal(adapterDecision.roomId, 'room-a');

  await dispose();
  const gone = await handler.fetch(forgedRequest(), connection.browserPeer);
  assert.equal(gone.status, 404);
  routeBoundary.disposedStatus = 404;
} finally {
  await dispose();
  await connection.browserPeer.dispose();
}

// --- Direct adapter boundary checks (NOT request-level identity) ---
// These call the adapter directly to prove fail-closed behavior; they do not
// claim a request-level principal. They are deliberately separate from the
// route-bound call above.
const directChecks = [];
const forgedBody = { capability: 'teamOverview', roomId: 'room-a', sessionId: 'human', via: 'panel', owner: true };
const knownStub = { ownerTeamOverview: async roomId => ({ scope: 'local', known: true, roomId, status: 'active' }) };
const missingKnownStub = { ownerTeamOverview: async roomId => ({ scope: 'local', roomId }) };
for (const [label, stub, caller, request, code] of [
  ['agent admission refused', knownStub, { kind: 'agent', sessionId: 'human' }, forgedBody, 'NOT_OWNER'],
  ['api admission refused', knownStub, { id: 'api', principal: { kind: 'api' } }, forgedBody, 'NOT_OWNER'],
  ['unknown capability refused', knownStub, { kind: 'owner' }, { ...forgedBody, capability: 'dispatch' }, 'UNKNOWN_CAPABILITY'],
  ['missing known refused', missingKnownStub, { kind: 'owner' }, forgedBody, 'NOT_READY'],
]) {
  await assert.rejects(
    authorizeM6HumanApproval(stub, request, caller),
    error => error instanceof ApprovalDenied && error.code === code,
  );
  directChecks.push(label);
}
// Canonical id comes from the projection, never the request string.
const canonicalDecision = await authorizeM6HumanApproval(
  { ownerTeamOverview: async () => ({ scope: 'local', known: true, roomId: 'room-canonical', status: 'active' }) },
  { capability: 'teamOverview', roomId: 'Some Room Name' }, { kind: 'owner' },
);
assert.equal(canonicalDecision.roomId, 'room-canonical');
await assert.rejects(
  authorizeM6HumanApproval(
    { ownerTeamOverview: async () => ({ scope: 'local', known: true, status: 'active' }) },
    { capability: 'teamOverview', roomId: 'Some Room Name' }, { kind: 'owner' },
  ),
  error => error instanceof ApprovalDenied && error.code === 'MISSING_CANONICAL_ROOM',
);
directChecks.push('canonical roomId authoritative; missing canonical id refused (no request fallback)');
for (const key of IGNORED_IDENTITY_FIELDS) assert.equal(Object.hasOwn(adapterDecision, key), false);

console.log(JSON.stringify({
  schemaVersion: 2,
  observedAt: new Date().toISOString(),
  runtime: process.version,
  platform: process.platform,
  scope: 'installed-public-sdk-declarations-and-in-process-connection',
  sdkFacts,
  routeBoundary,
  directChecks,
  capabilities: CAPABILITIES,
  ignoredBodyIdentityFields: IGNORED_IDENTITY_FIELDS,
  requestLevelIdentityVerified: false,
  identityBasis: 'owner-only route admission (decided by createSharedFetchHandler before the handler); no request-level principal is forwarded to the handler',
  status: 'PASS',
  authentication: 'stubbed-deny-all; browser cookies and remote identity not exercised',
  notVerified: [
    'request-level-principal-verification', 'browser-cookie-authentication', 'remote-owner-identity',
    'physical-two-machine', 'live-host-room-leadership-revocation', 'real-dispatch', 'per-room-acl-on-live-host',
  ],
  conclusion: 'Public SDK supplies an owner Principal (browserPeer.principal, kind=owner) and owner-only exact-route admission, but forwards ONLY the Request into the route handler, so there is no request-level principal and request-level identity is not verified. The M6 adapter is bound to that already-admitted owner-only route and reuses the node persisted identity + current Room leadership via MeshNode#ownerTeamOverview, requiring known===true and the projection canonical roomId; no private API or new bypass is introduced.',
}, null, 2));
