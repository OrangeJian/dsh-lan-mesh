/**
 * M6 HOST IDENTITY PROBE -- reproducible, isolated evidence gatherer.
 *
 * Reads the INSTALLED PUBLIC SDK declarations (no private API, no source under
 * src/*) and runs the in-process connection component with stubbed
 * authentication. It records exactly what identity the public SDK can and
 * cannot provide, then shows the M6 adapter failing closed on that evidence.
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
  const metadataPath = fromHost.resolve(`@deepseek-ai/${packageName}/package.json`);
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
const ROUTE = '/api/m6-identity-probe';
let handlerCalls = 0;
const dispose = connection.fetch.register({
  path: ROUTE, methods: ['POST'], requestBody: 'buffered',
  fetch: async () => { handlerCalls++; return new Response('ok'); },
});
const handler = connection.createSharedFetchHandler('/api');
const forgedRequest = () => new Request(`http://localhost${ROUTE}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-owner': 'true' },
  body: JSON.stringify({ owner: true, sessionId: 'human', role: 'owner' }),
});
const routeCases = [];
const adapterCases = [];
try {
  const ownerPrincipal = connection.browserPeer?.principal;
  assert.equal(ownerPrincipal?.kind, 'owner');

  const nonOwner = await handler.fetch(forgedRequest(), { principal: { kind: 'api' } });
  assert.equal(nonOwner.status, 403); // forged body/header do not matter
  assert.equal(handlerCalls, 0);
  routeCases.push('non-owner principal rejected 403 before handler despite forged owner body/header');

  const owner = await handler.fetch(forgedRequest(), connection.browserPeer);
  assert.equal(owner.status, 200);
  assert.equal(handlerCalls, 1);
  routeCases.push('public SDK browserPeer owner principal admitted to exact route');

  await dispose();
  const gone = await handler.fetch(forgedRequest(), connection.browserPeer);
  assert.equal(gone.status, 404);
  routeCases.push('disposed exact route unavailable (404)');

  // --- Adapter fail-closed evidence, using the SDK's real owner principal ---
  const adapterCalls = [];
  const stubNode = { ownerTeamOverview: async roomId => {
    adapterCalls.push(roomId);
    return { scope: 'local', known: true, roomId, status: 'active', revision: 1, generation: 1 };
  } };
  const forgedBody = {
    capability: 'teamOverview', roomId: 'room-a',
    sessionId: 'human', actorKey: 'node-local/fake', via: 'panel', owner: true,
  };
  for (const caller of [{ principal: { kind: 'api' }, id: 'api' }, { kind: 'agent', sessionId: 'human' }]) {
    await assert.rejects(
      authorizeM6HumanApproval(stubNode, forgedBody, caller),
      error => error instanceof ApprovalDenied && error.code === 'NOT_OWNER',
    );
  }
  adapterCases.push('agent/api principals refused NOT_OWNER with forged human body');

  await assert.rejects(
    authorizeM6HumanApproval(stubNode, { ...forgedBody, capability: 'dispatch' }, connection.browserPeer),
    error => error instanceof ApprovalDenied && error.code === 'UNKNOWN_CAPABILITY',
  );
  adapterCases.push('dispatch is not an authorized host capability (unknown, fail closed)');

  const decision = await authorizeM6HumanApproval(stubNode, forgedBody, connection.browserPeer);
  assert.equal(decision.ok, true);
  assert.equal(decision.producesExecution, false);
  for (const key of IGNORED_IDENTITY_FIELDS) assert.equal(Object.hasOwn(decision, key), false);
  adapterCases.push('SDK owner principal + forged body authorizes read-only decision with no body identity / no execution');
  assert.deepEqual(adapterCalls, ['room-a']);
} finally {
  await dispose();
  await connection.browserPeer.dispose();
}

console.log(JSON.stringify({
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  runtime: process.version,
  platform: process.platform,
  scope: 'installed-public-sdk-declarations-and-in-process-connection',
  sdkFacts,
  routeCases,
  adapterCases,
  capabilities: CAPABILITIES,
  ignoredBodyIdentityFields: IGNORED_IDENTITY_FIELDS,
  status: 'PASS',
  authentication: 'stubbed-deny-all; browser cookies and remote identity not exercised',
  notVerified: [
    'browser-cookie-authentication', 'remote-owner-identity', 'physical-two-machine',
    'live-host-room-leadership-revocation', 'real-dispatch', 'per-room-acl-on-live-host',
  ],
  conclusion: 'Public SDK supplies an owner Principal (browserPeer.principal, kind=owner) and owner-only exact-route admission, but NO human/session identity and NO per-Room permission model. The M6 adapter therefore reuses the node persisted identity + current Room leadership via MeshNode#ownerTeamOverview and fails closed; no private API or new bypass is introduced.',
}, null, 2));
