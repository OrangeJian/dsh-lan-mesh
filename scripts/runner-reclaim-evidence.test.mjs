/**
 * Targeted regression for the host-local reclamation evidence adapter.
 *
 * The explicit-stop requirement is the point of this batch: an idle/absent
 * live agent and a durable archive membership are observations, not proof that
 * the execution and its child processes stopped. The adapter must refuse them
 * and accept only a fixed-shape attestation bound to executionId, generation,
 * resource key, result hash and a concrete Host runtime instance.
 *
 * Direct cases use a read-only durable TeamStore file plus injected stop and
 * observation sources. Integration cases call the real reclaim service only
 * on paths that must refuse before removal; no successful reclamation or
 * deletion is executed by this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTeamStore } from '../lib/team-store.mjs';
import { executionResourceKey, prepareExecutionWorkspace, reclaimExecutionWorkspace } from '../lib/runner-resources.mjs';
import { createHostReclaimEvidenceProvider } from '../lib/runner-reclaim-evidence.mjs';
import { resultHash as hashResult } from '../lib/task-result-context.mjs';

const NODE = 'node-b';
const HOST_INSTANCE = 'host-runtime-7f3c';
const SESSION = 'session-evidence-1';
const EXECUTION = 'exec-evidence';
const GENERATION = 1;
const KEY = executionResourceKey(EXECUTION, GENERATION);
const REPO_ID = 'repo-evidence';
const BASE_COMMIT = 'a'.repeat(40);
const RESULT = { status: 'succeeded', summary: 'done' };
const RESULT_HASH = hashResult(RESULT);
const STOP_SOURCE = 'test-host-stop-attestation:pid+starttime';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
const identity = ['-c', 'user.name=Evidence Test', '-c', 'user.email=evidence@example.invalid', '-c', 'commit.gpgsign=false'];
const normalize = value => process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value;

function baseEntry() {
  return {
    descriptor: {
      roomId: 'room-evidence', taskId: 'task-evidence', executionId: EXECUTION,
      generation: GENERATION, leaderKey: 'node-a/leader', actorKey: 'node-a/leader',
      workerKey: `${NODE}/${SESSION}`, title: 'Evidence', detail: '',
    },
    state: 'succeeded', started: true, seq: 2, result: structuredClone(RESULT),
    workspaceResource: {
      generation: GENERATION, repoId: REPO_ID, baseCommit: BASE_COMMIT,
      key: KEY, phase: 'prepared',
    },
  };
}

function mutateEntry(mutate) {
  const entry = baseEntry();
  mutate(entry);
  return entry;
}

function stopProof(overrides = {}) {
  return {
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: HOST_INSTANCE,
    stopped: true, source: STOP_SOURCE,
    ...overrides,
  };
}

async function makeLedger(label, entry = baseEntry()) {
  const dir = await fs.mkdtemp(join(tmpdir(), `r2-evidence-${label}-`));
  const ledgerFile = join(dir, 'team.json');
  await fs.writeFile(ledgerFile, JSON.stringify({ version: 1, workerExecutions: { [EXECUTION]: entry } }));
  return { dir, ledgerFile, cleanup: () => removeDir(dir) };
}

function makeProvider(ledgerFile, overrides = {}) {
  return createHostReclaimEvidenceProvider({
    nodeId: NODE,
    ledgerFile,
    hostInstanceId: HOST_INSTANCE,
    readStopProof: () => stopProof(),
    ...overrides,
  });
}

function request(overrides = {}) {
  return {
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, repoId: REPO_ID, baseCommit: BASE_COMMIT,
    ...overrides,
  };
}

async function rejectsWith(promise, code, observed) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    if (observed !== undefined) assert.equal(error.observed, observed);
    return true;
  });
}

async function removeDir(dir) {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rm(dir, { recursive: true, force: true }); return; }
    catch (error) {
      if ((error.code !== 'EBUSY' && error.code !== 'EPERM') || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

async function withLedger(label, entry, fn) {
  const ctx = await makeLedger(label, entry);
  try { await fn(ctx); } finally { await ctx.cleanup(); }
}

// ---------------------------------------------------------------- adapter ---

test('returns evidence only from an explicit stop attestation bound to all identities', async () => {
  await withLedger('positive', baseEntry(), async ({ ledgerFile }) => {
    const value = await makeProvider(ledgerFile)(request());
    assert.equal(value.quiescence.stopped, true);
    assert.equal(value.quiescence.source, STOP_SOURCE);
    assert.deepEqual(value.retention, {
      retained: true,
      source: 'host:durable-team-ledger',
      reference: `${ledgerFile}#workerExecutions/${EXECUTION}/result`,
      resultHash: RESULT_HASH,
    });
  });
});

test('idle or absent plus archived still refuses without an explicit stop attestation', async () => {
  await withLedger('observations-only', baseEntry(), async ({ ledgerFile }) => {
    for (const [label, live] of [
      ['idle', [{ id: SESSION, status: 'idle' }]],
      ['absent', []],
    ]) {
      const provider = makeProvider(ledgerFile, {
        readStopProof: () => null,
        listLiveAgents: () => live,
        listArchivedSessionIds: () => [SESSION],
      });
      await rejectsWith(provider(request()), 'QUIESCENCE_UNPROVEN', `${label}+archived`);
    }
  });
});

test('a legacy observation-shaped proof is refused even when idle and archived', async () => {
  await withLedger('legacy-proof', baseEntry(), async ({ ledgerFile }) => {
    const provider = makeProvider(ledgerFile, {
      readStopProof: () => ({ stopped: true, source: 'host:live-agent-registry=idle;workspace-archive=yes' }),
      listLiveAgents: () => [{ id: SESSION, status: 'idle' }],
      listArchivedSessionIds: () => [SESSION],
    });
    await rejectsWith(provider(request()), 'QUIESCENCE_UNPROVEN', 'idle+archived');
  });
});

test('refuses an attestation for a different execution, generation, key or hash', async () => {
  await withLedger('binding', baseEntry(), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile, { readStopProof: () => stopProof({ executionId: 'exec-other' }) })(request()), 'QUIESCENCE_BINDING_MISMATCH');
    await rejectsWith(makeProvider(ledgerFile, { readStopProof: () => stopProof({ generation: 2 }) })(request()), 'QUIESCENCE_BINDING_MISMATCH');
    await rejectsWith(makeProvider(ledgerFile, { readStopProof: () => stopProof({ key: 'b'.repeat(32) }) })(request()), 'QUIESCENCE_BINDING_MISMATCH');
    await rejectsWith(makeProvider(ledgerFile, { readStopProof: () => stopProof({ resultHash: 'c'.repeat(64) }) })(request()), 'QUIESCENCE_BINDING_MISMATCH');
  });
});

test('refuses an attestation from another Host runtime instance', async () => {
  await withLedger('host-instance', baseEntry(), async ({ ledgerFile }) => {
    await rejectsWith(
      makeProvider(ledgerFile, { readStopProof: () => stopProof({ hostInstanceId: 'host-runtime-other' }) })(request()),
      'QUIESCENCE_BINDING_MISMATCH',
    );
    await rejectsWith(
      makeProvider(ledgerFile, { hostInstanceId: 'host-runtime-other' })(request()),
      'QUIESCENCE_BINDING_MISMATCH',
    );
  });
});

test('refuses a malformed, negative or unbound attestation', async () => {
  await withLedger('malformed-proof', baseEntry(), async ({ ledgerFile }) => {
    const cases = [
      null,
      { stopped: true, source: STOP_SOURCE },
      { ...stopProof(), extra: true },
      stopProof({ stopped: false }),
      stopProof({ source: '' }),
      stopProof({ source: 'x'.repeat(201) }),
    ];
    const missingKey = stopProof();
    delete missingKey.key;
    cases.push(missingKey);
    for (const proof of cases) {
      await rejectsWith(makeProvider(ledgerFile, { readStopProof: () => proof })(request()), 'QUIESCENCE_UNPROVEN');
    }
    // A present but non-integer generation is a binding mismatch, not a
    // malformed shape.
    await rejectsWith(
      makeProvider(ledgerFile, { readStopProof: () => stopProof({ generation: '1' }) })(request()),
      'QUIESCENCE_BINDING_MISMATCH',
    );
  });
});

test('refuses when the stop source is unavailable', async () => {
  await withLedger('stop-unavailable', baseEntry(), async ({ ledgerFile }) => {
    await rejectsWith(
      makeProvider(ledgerFile, { readStopProof: () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); } })(request()),
      'QUIESCENCE_UNAVAILABLE',
    );
    await rejectsWith(makeProvider(ledgerFile, { readStopProof: async () => { throw new Error('boom'); } })(request()), 'QUIESCENCE_UNAVAILABLE');
  });
});

test('refuses a foreign or malformed worker key', async () => {
  await withLedger('remote', mutateEntry(entry => { entry.descriptor.workerKey = `node-x/${SESSION}`; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'QUIESCENCE_REMOTE');
  });
  await withLedger('badkey', mutateEntry(entry => { entry.descriptor.workerKey = 'node-b'; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'QUIESCENCE_UNPROVEN');
  });
});

test('refuses a wrong request identity or resource binding', async () => {
  await withLedger('identity', baseEntry(), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request({ generation: 2, key: executionResourceKey(EXECUTION, 2) })), 'STALE_EXECUTION');
    await rejectsWith(makeProvider(ledgerFile)(request({ key: 'b'.repeat(32) })), 'RESOURCE_MISMATCH');
    await rejectsWith(makeProvider(ledgerFile)(request({ repoId: 'other-repo' })), 'RESOURCE_MISMATCH');
    await rejectsWith(makeProvider(ledgerFile)(request({ baseCommit: 'b'.repeat(40) })), 'RESOURCE_MISMATCH');
  });
});

test('refuses a missing, unreadable or malformed durable ledger', async () => {
  await withLedger('nofile', baseEntry(), async ({ dir }) => {
    await rejectsWith(makeProvider(join(dir, 'absent.json'))(request()), 'RETENTION_UNAVAILABLE');
    const provider = makeProvider(join(dir, 'absent.json'), {
      io: { readFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
    });
    await rejectsWith(provider(request()), 'RETENTION_UNAVAILABLE');
  });
  await withLedger('badjson', baseEntry(), async ({ ledgerFile }) => {
    await fs.writeFile(ledgerFile, '{not json');
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RETENTION_UNAVAILABLE');
  });
  await withLedger('version', baseEntry(), async ({ ledgerFile }) => {
    await fs.writeFile(ledgerFile, JSON.stringify({ version: 2, workerExecutions: { [EXECUTION]: baseEntry() } }));
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RETENTION_UNAVAILABLE');
  });
  await withLedger('absent-entry', baseEntry(), async ({ ledgerFile }) => {
    await fs.writeFile(ledgerFile, JSON.stringify({ version: 1, workerExecutions: {} }));
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RETENTION_MISSING');
  });
});

test('refuses a non-terminal, unstarted or missing fixed result', async () => {
  await withLedger('running-state', mutateEntry(entry => { entry.state = 'running'; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'NOT_STOPPED');
  });
  await withLedger('unstarted', mutateEntry(entry => { entry.started = false; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'NOT_STOPPED');
  });
  await withLedger('noresult', mutateEntry(entry => { entry.result = null; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RESULT_EVIDENCE_MISSING');
  });
  await withLedger('badresult', mutateEntry(entry => { entry.result = { summary: 'no status' }; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RESULT_EVIDENCE_MISSING');
  });
});

test('refuses a retained result whose bytes do not hash to the request', async () => {
  await withLedger('tampered', mutateEntry(entry => { entry.result.summary = 'other'; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'EVIDENCE_BINDING_MISMATCH');
    await rejectsWith(makeProvider(ledgerFile)(request({ resultHash: 'c'.repeat(64) })), 'EVIDENCE_BINDING_MISMATCH');
  });
  await withLedger('status-mismatch', mutateEntry(entry => {
    entry.result = { status: 'failed', summary: 'done' };
  }), async ({ ledgerFile }) => {
    await rejectsWith(
      makeProvider(ledgerFile)(request({ resultHash: hashResult({ status: 'failed', summary: 'done' }) })),
      'EVIDENCE_BINDING_MISMATCH',
    );
  });
});

test('refuses a non-prepared or already-reclaiming resource', async () => {
  await withLedger('noresource', mutateEntry(entry => { delete entry.workspaceResource; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RESOURCE_NOT_PREPARED');
  });
  await withLedger('reserved', mutateEntry(entry => { entry.workspaceResource.phase = 'reserved'; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RESOURCE_NOT_PREPARED');
  });
  await withLedger('reclaiming', mutateEntry(entry => { entry.workspaceResource.reclaim = { phase: 'reserved' }; }), async ({ ledgerFile }) => {
    await rejectsWith(makeProvider(ledgerFile)(request()), 'RECLAIM_IN_PROGRESS');
  });
});

test('is read-only: the durable ledger bytes are unchanged by a successful proof', async () => {
  await withLedger('readonly', baseEntry(), async ({ ledgerFile }) => {
    const before = await fs.readFile(ledgerFile, 'utf8');
    await makeProvider(ledgerFile)(request());
    assert.equal(await fs.readFile(ledgerFile, 'utf8'), before);
  });
});

test('refuses incomplete configuration, including the old observation-only shape', () => {
  const base = {
    nodeId: NODE, ledgerFile: join(tmpdir(), 'x.json'), hostInstanceId: HOST_INSTANCE,
    readStopProof: () => stopProof(),
  };
  assert.throws(() => createHostReclaimEvidenceProvider({ ...base, hostInstanceId: undefined }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostReclaimEvidenceProvider({ ...base, hostInstanceId: 'not a host instance' }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostReclaimEvidenceProvider({ ...base, readStopProof: undefined }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostReclaimEvidenceProvider({
    nodeId: NODE,
    ledgerFile: join(tmpdir(), 'x.json'),
    listLiveAgents: () => [{ id: SESSION, status: 'idle' }],
    listArchivedSessionIds: () => [SESSION],
  }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostReclaimEvidenceProvider({ ...base, ledgerFile: 'relative.json' }), { code: 'BAD_CONFIG' });
});

// ------------------------------------------------------------ integration ---

async function makeWorkspaceContext(label, { liveAgents = [], archived = [SESSION], stopProofSource } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), `r2-evidence-int-${label}-`));
  const repo = join(dir, 'source');
  const resourcesRoot = join(dir, 'resources');
  const hooks = join(dir, 'hooks');
  await Promise.all([
    fs.mkdir(repo, { recursive: true }),
    fs.mkdir(resourcesRoot, { recursive: true }),
    fs.mkdir(hooks, { recursive: true }),
  ]);
  git(repo, 'init', '--quiet');
  await fs.writeFile(join(repo, 'tracked.txt'), 'baseline\n');
  git(repo, 'add', '--', 'tracked.txt');
  git(repo, ...identity, '-c', `core.hooksPath=${hooks}`, 'commit', '--quiet', '-m', 'baseline');
  const baseCommit = git(repo, 'rev-parse', 'HEAD');
  const binding = { repoId: `evidence-${label}`, root: repo };
  const ledgerDirectory = join(dir, 'ledger');
  const store = await openTeamStore({ directory: ledgerDirectory });
  const executionId = `exec-${label}`;
  const descriptor = {
    roomId: `room-${label}`, taskId: `task-${label}`, executionId, generation: 1,
    leaderKey: 'node-a/leader', actorKey: 'node-a/leader', workerKey: `${NODE}/${SESSION}`,
    title: 'Evidence integration', detail: '',
  };
  await store.transact(state => {
    state.workerExecutions[executionId] = { descriptor, state: 'received', started: false, seq: 1, result: null };
    return { state };
  });
  const key = executionResourceKey(executionId, 1);
  const managed = { store, executionId, generation: 1, binding, baseCommit, resourcesRoot, authorize: () => true };
  await prepareExecutionWorkspace(managed);
  await store.transact(state => {
    const execution = state.workerExecutions[executionId];
    execution.state = 'succeeded';
    execution.started = true;
    execution.result = structuredClone(RESULT);
    return { state };
  });
  const ledgerFile = join(ledgerDirectory, 'team.json');
  const evidenceProvider = createHostReclaimEvidenceProvider({
    nodeId: NODE, ledgerFile, hostInstanceId: HOST_INSTANCE,
    readStopProof: stopProofSource ?? (() => stopProof()),
    listLiveAgents: () => liveAgents,
    listArchivedSessionIds: () => archived,
  });
  return {
    dir, repo, resourcesRoot, ledgerFile, store, executionId, key, binding, baseCommit,
    workspace: join(resourcesRoot, key, 'workspace'),
    managed, evidenceProvider,
    options: extra => ({ ...managed, evidenceProvider, ...extra }),
    reclaimOf() { return this.store.read().workerExecutions[executionId].workspaceResource.reclaim; },
    registered() {
      return git(repo, 'worktree', 'list', '--porcelain').split('\n')
        .some(line => line.startsWith('worktree ') && normalize(line.slice(9).trim()) === normalize(this.workspace));
    },
    cleanup: () => removeDir(dir),
  };
}

async function withWorkspace(label, options, fn) {
  const ctx = await makeWorkspaceContext(label, options);
  try { await fn(ctx); } finally { await ctx.cleanup(); }
}

test('integration: idle plus archived without an explicit stop proof fails closed and removes nothing', async () => {
  await withWorkspace('observations-only', {
    liveAgents: [{ id: SESSION, status: 'idle' }],
    archived: [SESSION],
    stopProofSource: () => null,
  }, async ctx => {
    const before = await fs.readFile(ctx.ledgerFile, 'utf8');
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), { code: 'EVIDENCE_UNAVAILABLE' });
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal(ctx.registered(), true);
    assert.equal((await fs.stat(ctx.workspace)).isDirectory(), true);
    assert.equal(await fs.readFile(ctx.ledgerFile, 'utf8'), before);
  });
});

test('integration: matching host proof is checked again against the durable reservation', async () => {
  let observations = 0;
  await withWorkspace('verified-release', {
    stopProofSource: identity => { observations++; return stopProof(identity); },
  }, async ctx => {
    await reclaimExecutionWorkspace(ctx.options());
    assert.equal(observations, 2);
    assert.equal(ctx.reclaimOf().phase, 'verified');
    assert.equal(ctx.registered(), false);
  });
});

test('integration: a tampered durable result fails closed before any removal', async () => {
  await withWorkspace('tampered', {}, async ctx => {
    const state = JSON.parse(await fs.readFile(ctx.ledgerFile, 'utf8'));
    state.workerExecutions[ctx.executionId].result.summary = 'rewritten';
    await fs.writeFile(ctx.ledgerFile, JSON.stringify(state));
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), { code: 'EVIDENCE_UNAVAILABLE' });
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal(ctx.registered(), true);
    assert.equal((await fs.stat(ctx.workspace)).isDirectory(), true);
  });
});
