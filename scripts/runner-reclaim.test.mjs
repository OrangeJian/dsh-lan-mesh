/**
 * Dedicated tests for ledger-driven explicit local resource reclamation.
 * Every case uses its own isolated temp source repository, resource root and
 * ledger; nothing is scheduled, dispatched, or deleted outside those temp dirs.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openTeamStore} from '../lib/team-store.mjs';
import {executionResourceKey, inspectExecutionWorkspace, prepareExecutionWorkspace, reclaimExecutionWorkspace} from '../lib/runner-resources.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', timeout: 15000, windowsHide: true}).trim();
const identity = ['-c', 'user.name=Reclaim Test', '-c', 'user.email=reclaim@example.invalid', '-c', 'commit.gpgsign=false'];
const normalize = value => process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value;

// A trusted local provider: two separate, sourced proofs bound to the exact
// execution, generation, resource key, repo, commit and result hash it is asked about.
const validProvider = ctx => async ({executionId, generation, key, repoId, baseCommit, resultHash}) => {
  assert.equal(executionId, ctx.executionId);
  assert.equal(generation, 1);
  assert.equal(key, ctx.key);
  assert.equal(repoId, ctx.binding.repoId);
  assert.equal(baseCommit, ctx.baseCommit);
  assert.match(resultHash, /^[a-f0-9]{64}$/);
  return {
    quiescence: {stopped: true, source: `local-process-registry:${executionId}`},
    retention: {retained: true, source: `local-immutable-store:${executionId}`, reference: `retained:${resultHash}`, resultHash},
  };
};

async function makeContext(label) {
  const dir = await fs.mkdtemp(join(tmpdir(), `r2-reclaim-${label}-`));
  const repo = join(dir, 'source');
  const resourcesRoot = join(dir, 'resources');
  const hooks = join(dir, 'hooks');
  await Promise.all([
    fs.mkdir(repo, {recursive: true}),
    fs.mkdir(resourcesRoot, {recursive: true}),
    fs.mkdir(hooks, {recursive: true}),
  ]);
  git(repo, 'init', '--quiet');
  await fs.writeFile(join(repo, 'tracked.txt'), 'baseline\n');
  git(repo, 'add', '--', 'tracked.txt');
  git(repo, ...identity, '-c', `core.hooksPath=${hooks}`, 'commit', '--quiet', '-m', 'baseline');
  const baseCommit = git(repo, 'rev-parse', 'HEAD');
  const binding = {repoId: `reclaim-${label}`, root: repo};
  const ledgerDirectory = join(dir, 'ledger');
  let store = await openTeamStore({directory: ledgerDirectory});
  const executionId = `exec-${label}`;
  const descriptor = {
    roomId: `room-${label}`, taskId: `task-${label}`, executionId, generation: 1,
    leaderKey: 'node-a/leader', actorKey: 'node-a/leader', workerKey: 'node-b/worker',
    title: 'Reclaim', detail: '',
  };
  await store.transact(state => {
    state.workerExecutions[executionId] = {descriptor, state: 'received', started: false, seq: 1, result: null};
    return {state};
  });
  const key = executionResourceKey(executionId, 1);
  const ctx = {
    dir, repo, resourcesRoot, hooks, baseCommit, binding, ledgerDirectory, executionId, descriptor, key,
    workspace: join(resourcesRoot, key, 'workspace'),
    get store() { return store; },
    options(extra = {}) {
      return {
        store, executionId, generation: 1, binding, baseCommit, resourcesRoot,
        authorize: () => true, evidenceProvider: validProvider(ctx), ...extra,
      };
    },
    async reopen() { store = await openTeamStore({directory: ledgerDirectory}); return store; },
    async complete(state = 'succeeded', result = {status: 'succeeded', summary: 'done'}) {
      await store.transact(s => {
        const e = s.workerExecutions[executionId];
        e.state = state;
        e.started = true;
        e.result = result;
        return {state: s};
      });
    },
    async setResource(mutate) {
      await store.transact(s => {
        mutate(s.workerExecutions[executionId].workspaceResource);
        return {state: s};
      });
    },
    reclaimOf() { return ctx.store.read().workerExecutions[executionId].workspaceResource.reclaim; },
    registered() {
      return git(ctx.repo, 'worktree', 'list', '--porcelain').split('\n')
        .some(line => line.startsWith('worktree ') && normalize(line.slice(9).trim()) === normalize(ctx.workspace));
    },
    async cleanup() {
      // Windows can briefly hold a handle on the temp Git repo after a probe.
      for (let attempt = 0; ; attempt++) {
        try { await fs.rm(dir, {recursive: true, force: true}); return; }
        catch (error) {
          if ((error.code !== 'EBUSY' && error.code !== 'EPERM') || attempt >= 5) throw error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    },
  };
  await prepareExecutionWorkspace(ctx.options());
  return ctx;
}

async function withContext(label, fn) {
  const ctx = await makeContext(label);
  try {
    await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}

// Reserve a valid reclamation but revoke authorization exactly at canRelease,
// leaving a real, bound reserved record with the worktree still present.
async function reserveOnly(ctx) {
  let calls = 0;
  await assert.rejects(reclaimExecutionWorkspace(ctx.options({authorize: () => ++calls <= 2})), {code: 'RELEASE_NOT_AUTHORIZED'});
  assert.equal(ctx.reclaimOf().phase, 'reserved');
  assert.equal(ctx.reclaimOf().failureCode, 'RELEASE_NOT_AUTHORIZED');
  return ctx.reclaimOf();
}

test('verifies and records a fully reclaimed resource with bound evidence', async () => {
  await withContext('happy', async ctx => {
    await ctx.complete();
    const report = await reclaimExecutionWorkspace(ctx.options());
    assert.equal(report.reclaimed, true);
    assert.match(report.resultHash, /^[a-f0-9]{64}$/);
    assert.equal(report.verification.removed, true);

    const execution = ctx.store.read().workerExecutions[ctx.executionId];
    const reclaim = execution.workspaceResource.reclaim;
    assert.equal(reclaim.phase, 'verified');
    assert.equal(reclaim.evidence.executionId, ctx.executionId);
    assert.equal(reclaim.evidence.generation, 1);
    assert.equal(reclaim.evidence.key, ctx.key);
    assert.equal(reclaim.evidence.resultHash, report.resultHash);
    assert.equal(reclaim.evidence.quiescence.stopped, true);
    assert.equal(reclaim.evidence.retention.retained, true);
    assert.equal(reclaim.evidence.retention.resultHash, report.resultHash);
    await assert.rejects(fs.realpath(ctx.workspace), {code: 'ENOENT'});
    assert.equal(ctx.registered(), false);
    assert.equal(git(ctx.repo, 'rev-parse', 'HEAD'), ctx.baseCommit);

    await ctx.reopen();
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.status, 'RECLAIMED');
    assert.equal(inspection.reclamation.status, 'VERIFIED');
    assert.equal(inspection.reclamation.reappearedAfterVerified, false);
    assert.deepEqual(inspection.reclamation.completedSteps, ['reserve', 'release', 'verify']);
    assert.deepEqual(inspection.reclamation.pendingSteps, []);

    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'RECLAIM_ALREADY_DONE'});
  });
});

test('terminal state plus a summary is not enough without a trusted provider', async () => {
  await withContext('no-provider', async ctx => {
    await ctx.complete();
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({evidenceProvider: undefined})), {code: 'EVIDENCE_UNAVAILABLE'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses a provider that throws instead of producing evidence', async () => {
  await withContext('provider-throws', async ctx => {
    await ctx.complete();
    const provider = async () => { throw new Error('no source available'); };
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({evidenceProvider: provider})), {code: 'EVIDENCE_UNAVAILABLE'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses quiescence evidence with no source', async () => {
  await withContext('no-quiescence-source', async ctx => {
    await ctx.complete();
    const provider = async ({resultHash}) => ({
      quiescence: {stopped: true},
      retention: {retained: true, source: 'local-immutable-store', reference: `retained:${resultHash}`, resultHash},
    });
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({evidenceProvider: provider})), {code: 'QUIESCENCE_UNPROVEN'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses retention evidence with no source or fixed reference', async () => {
  await withContext('no-retention-source', async ctx => {
    await ctx.complete();
    const provider = async ({resultHash}) => ({
      quiescence: {stopped: true, source: 'local-process-registry'},
      retention: {retained: true, resultHash},
    });
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({evidenceProvider: provider})), {code: 'RETENTION_UNPROVEN'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses evidence whose result hash is not bound to the retained result', async () => {
  await withContext('hash-mismatch', async ctx => {
    await ctx.complete();
    const provider = async () => ({
      quiescence: {stopped: true, source: 'local-process-registry'},
      retention: {retained: true, source: 'local-immutable-store', reference: 'retained:other', resultHash: 'a'.repeat(64)},
    });
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({evidenceProvider: provider})), {code: 'EVIDENCE_BINDING_MISMATCH'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses when the result-retention evidence source is missing', async () => {
  await withContext('no-result', async ctx => {
    await ctx.complete('succeeded', null);
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'RESULT_EVIDENCE_MISSING'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses when the execution is not persistently stopped', async () => {
  await withContext('not-stopped', async ctx => {
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'NOT_STOPPED'});
    await ctx.store.transact(s => {
      const e = s.workerExecutions[ctx.executionId];
      e.state = 'cancelled';
      e.reconciliation = 'manual stop confirmed';
      return {state: s};
    });
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'NOT_STOPPED'});
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses a stale generation without touching the prepared resource', async () => {
  await withContext('stale', async ctx => {
    await ctx.complete();
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({generation: 2})), {code: 'STALE_EXECUTION'});
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
    assert.equal(ctx.reclaimOf(), undefined);
  });
});

test('revocation at canRelease blocks Git removal and records the failed step', async () => {
  await withContext('revoked', async ctx => {
    await ctx.complete();
    const reclaim = await reserveOnly(ctx);
    assert.ok(reclaim.evidence);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
    assert.equal(ctx.registered(), true);
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.reclamation.failureCode, 'RELEASE_NOT_AUTHORIZED');
    assert.deepEqual(inspection.reclamation.pendingSteps, ['release', 'verify']);
    assert.equal(inspection.reclamation.releaseObservedOnDisk, false);
  });
});

test('reclamation retains the workspace when the stop proof is withdrawn after reservation', async () => {
  await withContext('withdrawn-proof', async ctx => {
    await ctx.complete();
    const provide = validProvider(ctx);
    let observed = false;
    const evidenceProvider = async request => {
      if (observed) throw new Error('stop proof withdrawn');
      observed = true;
      return provide(request);
    };
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({ evidenceProvider })), { code: 'RELEASE_NOT_AUTHORIZED' });
    assert.equal(ctx.registered(), true);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('canRelease refuses a changed reservation identity, not just a changed phase', async () => {
  await withContext('identity-swap', async ctx => {
    await ctx.complete();
    let calls = 0;
    const authorize = async () => {
      // The third call is from canRelease; swap the bound key before it reads state.
      if (++calls === 3) await ctx.setResource(resource => {
        resource.key = 'a'.repeat(32);
        resource.reclaim.evidence.key = 'a'.repeat(32);
      });
      return true;
    };
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({authorize})), {code: 'RELEASE_NOT_AUTHORIZED'});
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(ctx.reclaimOf().failureCode, 'RELEASE_NOT_AUTHORIZED');
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
    assert.equal(ctx.registered(), true);
  });
});

test('retains a dirty worktree and records the failed step for recovery', async () => {
  await withContext('dirty', async ctx => {
    await ctx.complete();
    await fs.writeFile(join(ctx.workspace, 'tracked.txt'), 'dirty\n');
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'WORKSPACE_DIRTY'});
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(ctx.reclaimOf().failureCode, 'WORKSPACE_DIRTY');
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.deepEqual(inspection.reclamation.completedSteps, ['reserve']);
    assert.deepEqual(inspection.reclamation.pendingSteps, ['release', 'verify']);
    assert.equal(inspection.reclamation.workspacePresentOnDisk, true);
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'RECLAIM_IN_PROGRESS'});
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('crash re-entry after reservation reports reserve/release steps never completed', async () => {
  await withContext('crash-reserved', async ctx => {
    await ctx.complete();
    await reserveOnly(ctx);
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'RECLAIM_IN_PROGRESS'});
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.reclamation.status, 'RESERVED');
    assert.deepEqual(inspection.reclamation.pendingSteps, ['release', 'verify']);
    assert.equal(inspection.reclamation.workspacePresentOnDisk, true);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('crash after recorded release reports only the verify step pending', async () => {
  await withContext('crash-released', async ctx => {
    await ctx.complete();
    await reclaimExecutionWorkspace(ctx.options());
    await ctx.setResource(resource => { resource.reclaim.phase = 'released'; });
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'RECLAIM_IN_PROGRESS'});
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.reclamation.status, 'RELEASED');
    assert.deepEqual(inspection.reclamation.completedSteps, ['reserve', 'release']);
    assert.deepEqual(inspection.reclamation.pendingSteps, ['verify']);
  });
});

test('a directory reappearing after verified is never reported RECLAIMED', async () => {
  await withContext('reappeared', async ctx => {
    await ctx.complete();
    await reclaimExecutionWorkspace(ctx.options());
    assert.equal((await inspectExecutionWorkspace(ctx.options())).status, 'RECLAIMED');
    // The owned resource root persists after Git removal; only the workspace is gone.
    await fs.mkdir(ctx.workspace);
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.status, 'RECLAIMED_DIR_REAPPEARED');
    assert.notEqual(inspection.status, 'RECLAIMED');
    assert.equal(inspection.reclamation.reappearedAfterVerified, true);
    assert.equal(inspection.reclamation.workspacePresentOnDisk, true);
  });
});

test('releaseObservedOnDisk requires confirmed absence, not a path escape', async () => {
  await withContext('escape-not-released', async ctx => {
    await ctx.complete();
    await reserveOnly(ctx);
    const outside = join(ctx.dir, 'outside');
    await fs.mkdir(outside);
    await fs.rm(ctx.workspace, {recursive: true, force: true});
    await fs.symlink(outside, ctx.workspace, process.platform === 'win32' ? 'junction' : 'dir');
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.disk.status, 'PATH_ESCAPE');
    assert.equal(inspection.disk.workspaceConfirmedAbsent, false);
    assert.equal(inspection.reclamation.releaseObservedOnDisk, false);
  });
});

test('releaseObservedOnDisk is true only for a confirmed missing workspace', async () => {
  await withContext('confirmed-absent', async ctx => {
    await ctx.complete();
    await reserveOnly(ctx);
    await fs.rm(ctx.workspace, {recursive: true, force: true});
    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.disk.workspaceConfirmedAbsent, true);
    assert.equal(inspection.reclamation.releaseObservedOnDisk, true);
    assert.equal(inspection.status, 'PARTIAL');
  });
});

test('retains a foreign repository worktree and records REPO_MISMATCH', async () => {
  await withContext('foreign', async ctx => {
    await ctx.complete();
    const other = join(ctx.dir, 'other');
    await fs.mkdir(other);
    git(other, 'init', '--quiet');
    await fs.writeFile(join(other, 'tracked.txt'), 'foreign\n');
    git(other, 'add', '--', 'tracked.txt');
    git(other, ...identity, '-c', `core.hooksPath=${ctx.hooks}`, 'commit', '--quiet', '-m', 'foreign');
    await fs.rm(ctx.workspace, {recursive: true, force: true});
    git(other, ...identity, '-c', `core.hooksPath=${ctx.hooks}`, 'worktree', 'add', '--detach', '--quiet', ctx.workspace, 'HEAD');
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'REPO_MISMATCH'});
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(ctx.reclaimOf().failureCode, 'REPO_MISMATCH');
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses without authorization and leaves the ledger unmodified', async () => {
  await withContext('auth', async ctx => {
    await ctx.complete();
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({authorize: () => false})), {code: 'FORBIDDEN'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('refuses an unknown resources path without attempting removal', async () => {
  await withContext('io', async ctx => {
    await ctx.complete();
    const io = {
      ...fs,
      realpath: async path => {
        if (path === ctx.resourcesRoot) {
          const error = new Error('denied');
          error.code = 'EACCES';
          throw error;
        }
        return fs.realpath(path);
      },
    };
    await assert.rejects(reclaimExecutionWorkspace(ctx.options({io})), {code: 'WORKSPACE_UNAVAILABLE'});
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});
