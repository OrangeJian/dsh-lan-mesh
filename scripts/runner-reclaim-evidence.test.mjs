/**
 * Targeted regression for the host-local reclamation evidence adapter.
 *
 * Direct cases exercise the adapter against a read-only durable TeamStore file
 * plus injected live-agent/archive observations. Integration cases bind the
 * adapter to the real `reclaimExecutionWorkspace` on isolated temp Git repos.
 * Nothing is scheduled, dispatched, auto-archived or deleted outside the temp
 * directories created by each case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTeamStore } from '../lib/team-store.mjs';
import {
  executionResourceKey, inspectExecutionWorkspace, prepareExecutionWorkspace,
  reclaimExecutionWorkspace,
} from '../lib/runner-resources.mjs';
import { createHostReclaimEvidenceProvider } from '../lib/runner-reclaim-evidence.mjs';
import { resultHash as hashResult } from '../lib/task-result-context.mjs';

const NODE = 'node-b';
const SESSION = 'session-evidence-1';
const EXECUTION = 'exec-evidence';
const GENERATION = 1;
const KEY = executionResourceKey(EXECUTION, GENERATION);
const REPO_ID = 'repo-evidence';
const BASE_COMMIT = 'a'.repeat(40);
const RESULT = { status: 'succeeded', summary: 'done' };
const RESULT_HASH = hashResult(RESULT);

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
    listLiveAgents: () => [],
    listArchivedSessionIds: () => [SESSION],
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

test('returns quiescence and durable-retention evidence bound to the exact request', async () => {
  await withLedger('positive', baseEntry(), async ({ ledgerFile }) => {
    const value = await makeProvider(ledgerFile)(request());
    assert.deepEqual(value, {
      quiescence: { stopped: true, source: 'host:live-agent-registry=absent;workspace-archive=yes' },
      retention: {
        retained: true,
        source: 'host:durable-team-ledger',
        reference: `${ledgerFile}#workerExecutions/${EXECUTION}/result`,
        resultHash: RESULT_HASH,
      },
    });
  });
});

test('accepts an exact live idle agent as quiescent and never prefix-resolves', async () => {
  await withLedger('idle', baseEntry(), async ({ ledgerFile }) => {
    const value = await makeProvider(ledgerFile, {
      listLiveAgents: () => [{ id: SESSION, status: 'idle' }, { id: SESSION + '-longer', status: 'running' }],
    })(request());
    assert.equal(value.quiescence.source, 'host:live-agent-registry=idle;workspace-archive=yes');
  });
});

test('refuses a running, unknown or duplicated live agent', async () => {
  await withLedger('running', baseEntry(), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile, { listLiveAgents: () => [{ id: SESSION, status: 'running' }] })(request()), { code: 'QUIESCENCE_RUNNING' });
    await assert.rejects(makeProvider(ledgerFile, { listLiveAgents: () => [{ id: SESSION, status: 'starting' }] })(request()), { code: 'QUIESCENCE_RUNNING' });
    await assert.rejects(makeProvider(ledgerFile, { listLiveAgents: () => [{ id: SESSION }] })(request()), { code: 'QUIESCENCE_RUNNING' });
    await assert.rejects(makeProvider(ledgerFile, { listLiveAgents: () => [{ id: SESSION, status: 'idle' }, { id: SESSION, status: 'idle' }] })(request()), { code: 'QUIESCENCE_AMBIGUOUS' });
  });
});

test('refuses when the session is not durably archived', async () => {
  await withLedger('unarchived', baseEntry(), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile, { listArchivedSessionIds: () => [] })(request()), { code: 'QUIESCENCE_NOT_ARCHIVED' });
  });
});

test('refuses when the live-agent or archive observation is unavailable', async () => {
  await withLedger('unavailable', baseEntry(), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile, { listLiveAgents: () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); } })(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
    await assert.rejects(makeProvider(ledgerFile, { listLiveAgents: () => null })(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
    await assert.rejects(makeProvider(ledgerFile, { listArchivedSessionIds: () => { throw new Error('boom'); } })(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
    await assert.rejects(makeProvider(ledgerFile, { listArchivedSessionIds: () => new Set([SESSION]) })(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
  });
});

test('refuses a foreign, malformed or trimmed worker key', async () => {
  await withLedger('remote', mutateEntry(entry => { entry.descriptor.workerKey = `node-x/${SESSION}`; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'QUIESCENCE_REMOTE' });
  });
  await withLedger('badkey', mutateEntry(entry => { entry.descriptor.workerKey = 'node-b'; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'QUIESCENCE_UNPROVEN' });
  });
  await withLedger('trimmed', mutateEntry(entry => { entry.descriptor.workerKey = `${NODE}/${SESSION.slice(0, 8)}`; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'QUIESCENCE_NOT_ARCHIVED' });
  });
});

test('refuses a wrong node identity, generation or resource binding', async () => {
  await withLedger('identity', baseEntry(), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile, { nodeId: 'node-a' })(request()), { code: 'QUIESCENCE_REMOTE' });
    await assert.rejects(makeProvider(ledgerFile)(request({ generation: 2, key: executionResourceKey(EXECUTION, 2) })), { code: 'STALE_EXECUTION' });
    await assert.rejects(makeProvider(ledgerFile)(request({ key: 'b'.repeat(32) })), { code: 'RESOURCE_MISMATCH' });
    await assert.rejects(makeProvider(ledgerFile)(request({ repoId: 'other-repo' })), { code: 'RESOURCE_MISMATCH' });
    await assert.rejects(makeProvider(ledgerFile)(request({ baseCommit: 'b'.repeat(40) })), { code: 'RESOURCE_MISMATCH' });
  });
});

test('refuses a missing, unreadable or malformed durable ledger', async () => {
  await withLedger('nofile', baseEntry(), async ({ dir }) => {
    await assert.rejects(makeProvider(join(dir, 'absent.json'))(request()), { code: 'RETENTION_UNAVAILABLE' });
    const provider = makeProvider(join(dir, 'absent.json'), {
      io: { readFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
    });
    await assert.rejects(provider(request()), { code: 'RETENTION_UNAVAILABLE' });
  });
  await withLedger('badjson', baseEntry(), async ({ ledgerFile }) => {
    await fs.writeFile(ledgerFile, '{not json');
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RETENTION_UNAVAILABLE' });
  });
  await withLedger('version', baseEntry(), async ({ ledgerFile }) => {
    await fs.writeFile(ledgerFile, JSON.stringify({ version: 2, workerExecutions: { [EXECUTION]: baseEntry() } }));
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RETENTION_UNAVAILABLE' });
  });
  await withLedger('absent-entry', baseEntry(), async ({ ledgerFile }) => {
    await fs.writeFile(ledgerFile, JSON.stringify({ version: 1, workerExecutions: {} }));
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RETENTION_MISSING' });
  });
});

test('refuses a non-terminal, unstarted or missing fixed result', async () => {
  await withLedger('running-state', mutateEntry(entry => { entry.state = 'running'; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'NOT_STOPPED' });
  });
  await withLedger('unstarted', mutateEntry(entry => { entry.started = false; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'NOT_STOPPED' });
  });
  await withLedger('noresult', mutateEntry(entry => { entry.result = null; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RESULT_EVIDENCE_MISSING' });
  });
  await withLedger('badresult', mutateEntry(entry => { entry.result = { summary: 'no status' }; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RESULT_EVIDENCE_MISSING' });
  });
});

test('refuses a retained result whose bytes do not hash to the request', async () => {
  await withLedger('tampered', mutateEntry(entry => { entry.result.summary = 'other'; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'EVIDENCE_BINDING_MISMATCH' });
    await assert.rejects(makeProvider(ledgerFile)(request({ resultHash: 'c'.repeat(64) })), { code: 'EVIDENCE_BINDING_MISMATCH' });
  });
  await withLedger('status-mismatch', mutateEntry(entry => {
    entry.result = { status: 'failed', summary: 'done' };
  }), async ({ ledgerFile }) => {
    const changedHash = hashResult({ status: 'failed', summary: 'done' });
    await assert.rejects(makeProvider(ledgerFile)(request({ resultHash: changedHash })), { code: 'EVIDENCE_BINDING_MISMATCH' });
  });
});

test('refuses a non-prepared or already-reclaiming resource', async () => {
  await withLedger('noresource', mutateEntry(entry => { delete entry.workspaceResource; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RESOURCE_NOT_PREPARED' });
  });
  await withLedger('reserved', mutateEntry(entry => { entry.workspaceResource.phase = 'reserved'; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RESOURCE_NOT_PREPARED' });
  });
  await withLedger('reclaiming', mutateEntry(entry => { entry.workspaceResource.reclaim = { phase: 'reserved' }; }), async ({ ledgerFile }) => {
    await assert.rejects(makeProvider(ledgerFile)(request()), { code: 'RECLAIM_IN_PROGRESS' });
  });
});

test('is read-only: the durable ledger bytes are unchanged by a successful proof', async () => {
  await withLedger('readonly', baseEntry(), async ({ ledgerFile }) => {
    const before = await fs.readFile(ledgerFile, 'utf8');
    await makeProvider(ledgerFile)(request());
    const after = await fs.readFile(ledgerFile, 'utf8');
    assert.equal(after, before);
  });
});

test('refuses incomplete provider configuration', () => {
  assert.throws(() => createHostReclaimEvidenceProvider({ nodeId: NODE, ledgerFile: 'relative.json', listLiveAgents: () => [], listArchivedSessionIds: () => [] }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostReclaimEvidenceProvider({ nodeId: NODE, ledgerFile: join(tmpdir(), 'x.json'), listLiveAgents: null, listArchivedSessionIds: () => [] }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostReclaimEvidenceProvider({ nodeId: NODE, ledgerFile: join(tmpdir(), 'x.json'), listLiveAgents: () => [], listArchivedSessionIds: null }), { code: 'BAD_CONFIG' });
});

// ------------------------------------------------------------ integration ---

async function makeWorkspaceContext(label, { liveAgents = [], archived = [SESSION] } = {}) {
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
    nodeId: NODE, ledgerFile,
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

test('integration: the real reclaim service accepts the adapter proof and verifies removal', async () => {
  await withWorkspace('positive', {}, async ctx => {
    const report = await reclaimExecutionWorkspace(ctx.options());
    assert.equal(report.reclaimed, true);
    assert.equal(report.verification.removed, true);
    assert.equal(report.resultHash, RESULT_HASH);

    const reclaim = ctx.reclaimOf();
    assert.equal(reclaim.phase, 'verified');
    assert.equal(reclaim.evidence.executionId, ctx.executionId);
    assert.equal(reclaim.evidence.generation, 1);
    assert.equal(reclaim.evidence.key, ctx.key);
    assert.equal(reclaim.evidence.resultHash, RESULT_HASH);
    assert.equal(reclaim.evidence.quiescence.source, 'host:live-agent-registry=absent;workspace-archive=yes');
    assert.equal(reclaim.evidence.retention.reference, `${ctx.ledgerFile}#workerExecutions/${ctx.executionId}/result`);
    assert.equal(reclaim.evidence.retention.resultHash, RESULT_HASH);

    const inspection = await inspectExecutionWorkspace(ctx.managed);
    assert.equal(inspection.status, 'RECLAIMED');
    assert.deepEqual(inspection.reclamation.completedSteps, ['reserve', 'release', 'verify']);
    await assert.rejects(fs.stat(ctx.workspace), { code: 'ENOENT' });
    assert.equal(ctx.registered(), false);
  });
});

test('integration: a running worker fails closed and leaves the worktree untouched', async () => {
  await withWorkspace('running', { liveAgents: [{ id: SESSION, status: 'running' }] }, async ctx => {
    const before = await fs.readFile(ctx.ledgerFile, 'utf8');
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), { code: 'EVIDENCE_UNAVAILABLE' });
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal(ctx.registered(), true);
    assert.equal((await fs.stat(ctx.workspace)).isDirectory(), true);
    assert.equal(await fs.readFile(ctx.ledgerFile, 'utf8'), before);
  });
});

test('integration: a non-archived worker fails closed and leaves the worktree untouched', async () => {
  await withWorkspace('unarchived', { archived: [] }, async ctx => {
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), { code: 'EVIDENCE_UNAVAILABLE' });
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal(ctx.registered(), true);
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
