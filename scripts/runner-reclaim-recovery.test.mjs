/**
 * Dedicated tests for post-restart reconciliation of resources that already
 * entered the explicit reclamation flow. A recovery call may only backfill a
 * confirmed step when authorization, ownership, generation and the fixed
 * result still validate AND both the workspace directory and its Git worktree
 * registration are independently confirmed absent. It must never delete,
 * re-run Git removal, prepare, start or dispatch. Every case uses its own
 * isolated temp source repository, resource root and ledger.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openTeamStore} from '../lib/team-store.mjs';
import {
  executionResourceKey, inspectExecutionWorkspace, prepareExecutionWorkspace,
  reclaimExecutionWorkspace, reconcileReclaimedExecutionWorkspace,
} from '../lib/runner-resources.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', timeout: 15000, windowsHide: true}).trim();
const identity = ['-c', 'user.name=Reclaim Recovery Test', '-c', 'user.email=reclaim-recovery@example.invalid', '-c', 'commit.gpgsign=false'];
const normalize = value => process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value;

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
  const dir = await fs.mkdtemp(join(tmpdir(), `r2-recovery-${label}-`));
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
  // Labels may carry whitespace to exercise Git path parsing; IDs stay valid.
  const safe = label.replace(/[^a-zA-Z0-9._:-]/g, '-');
  const binding = {repoId: `recovery-${safe}`, root: repo};
  const ledgerDirectory = join(dir, 'ledger');
  let store = await openTeamStore({directory: ledgerDirectory});
  const executionId = `exec-${safe}`;
  const descriptor = {
    roomId: `room-${safe}`, taskId: `task-${safe}`, executionId, generation: 1,
    leaderKey: 'node-a/leader', actorKey: 'node-a/leader', workerKey: 'node-b/worker',
    title: 'Reclaim recovery', detail: '',
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
        e.state = state; e.started = true; e.result = result;
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
  try { await fn(ctx); } finally { await ctx.cleanup(); }
}

// Leave a real, bound reserved record with the worktree still intact.
async function reserveOnly(ctx) {
  let calls = 0;
  await assert.rejects(reclaimExecutionWorkspace(ctx.options({authorize: () => ++calls <= 2})));
  assert.equal(ctx.reclaimOf().phase, 'reserved');
  return ctx.reclaimOf();
}

// Simulate a crash after Git removal but before the ledger recorded it: run a
// full reclamation (real Git worktree removal), then rewind just the phase.
async function crashAfterDeletion(ctx, phase) {
  await ctx.complete();
  await reclaimExecutionWorkspace(ctx.options());
  assert.equal(ctx.reclaimOf().phase, 'verified');
  await ctx.setResource(resource => { resource.reclaim.phase = phase; });
  assert.equal(ctx.reclaimOf().phase, phase);
  await assert.rejects(fs.realpath(ctx.workspace), {code: 'ENOENT'});
  assert.equal(ctx.registered(), false);
}

// ---------------------------------------------------------------------------
// Positive backfill paths
// ---------------------------------------------------------------------------

test('backfills released+verified from a reserved record after a deletion crash', async () => {
  await withContext('backfill-reserved', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    await ctx.setResource(resource => { resource.reclaim.failureCode = 'RELEASE_FAILED'; });

    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'BACKFILLED');
    assert.equal(report.fromPhase, 'reserved');
    assert.equal(report.toPhase, 'verified');
    assert.deepEqual(report.backfilledSteps, ['release', 'verify']);
    assert.equal(ctx.reclaimOf().phase, 'verified');
    assert.equal(ctx.reclaimOf().failureCode, undefined);
    // Recovery must never recreate the directory or the Git registration.
    await assert.rejects(fs.realpath(ctx.workspace), {code: 'ENOENT'});
    assert.equal(ctx.registered(), false);

    const inspection = await inspectExecutionWorkspace(ctx.options());
    assert.equal(inspection.status, 'RECLAIMED');
    assert.equal(inspection.reclamation.status, 'VERIFIED');
  });
});

test('backfills only verify from a released record', async () => {
  await withContext('backfill-released', async ctx => {
    await crashAfterDeletion(ctx, 'released');
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'BACKFILLED');
    assert.equal(report.fromPhase, 'released');
    assert.deepEqual(report.backfilledSteps, ['verify']);
    assert.equal(ctx.reclaimOf().phase, 'verified');
    await assert.rejects(fs.realpath(ctx.workspace), {code: 'ENOENT'});
    assert.equal(ctx.registered(), false);
  });
});

test('restart replay is idempotent and reports ALREADY_VERIFIED', async () => {
  await withContext('replay', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    const first = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(first.status, 'BACKFILLED');

    await ctx.reopen();
    const second = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(second.status, 'RETAINED');
    assert.equal(second.reason, 'ALREADY_VERIFIED');
    assert.equal(ctx.reclaimOf().phase, 'verified');
    assert.equal((await inspectExecutionWorkspace(ctx.options())).status, 'RECLAIMED');
  });
});

// ---------------------------------------------------------------------------
// Conservative retention: no directory / Git / ledger mutation
// ---------------------------------------------------------------------------

test('retains when the workspace directory is still present', async () => {
  await withContext('dir-present', async ctx => {
    await ctx.complete();
    await reserveOnly(ctx);
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'DIRECTORY_PRESENT');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
    assert.equal(ctx.registered(), true);
  });
});

test('retains a dirty workspace and preserves its content and registration', async () => {
  await withContext('dirty', async ctx => {
    await ctx.complete();
    await fs.writeFile(join(ctx.workspace, 'tracked.txt'), 'dirty\n');
    await assert.rejects(reclaimExecutionWorkspace(ctx.options()), {code: 'WORKSPACE_DIRTY'});
    assert.equal(ctx.reclaimOf().phase, 'reserved');

    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'DIRECTORY_PRESENT');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(await fs.readFile(join(ctx.workspace, 'tracked.txt'), 'utf8'), 'dirty\n');
    assert.equal(ctx.registered(), true);
  });
});

test('retains a Git orphan record when only the directory is gone', async () => {
  await withContext('git-orphan', async ctx => {
    await ctx.complete();
    await fs.rm(ctx.workspace, {recursive: true, force: true});
    await reserveOnly(ctx);
    assert.equal(ctx.registered(), true); // stale worktree registration remains

    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'GIT_REGISTERED');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(ctx.registered(), true); // recovery never re-runs Git removal
  });
});

test('retains an unknown I/O observation without backfilling', async () => {
  await withContext('io-unknown', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    const io = {
      ...fs,
      realpath: async path => {
        if (String(path).includes(ctx.key)) {
          const error = new Error('denied');
          error.code = 'EACCES';
          throw error;
        }
        return fs.realpath(path);
      },
    };
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options({io}));
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'IO_UNKNOWN');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('retains when no reclamation has started', async () => {
  await withContext('not-started', async ctx => {
    await ctx.complete();
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'NOT_STARTED');
    assert.equal(ctx.reclaimOf(), undefined);
    assert.equal((await fs.lstat(ctx.workspace)).isDirectory(), true);
  });
});

test('retains a partial state where the prepare phase is not complete', async () => {
  await withContext('partial', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    await ctx.setResource(resource => { resource.phase = 'reserved'; });
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'RESOURCE_NOT_PREPARED');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

// ---------------------------------------------------------------------------
// Re-validation of evidence, generation, ownership and authorization
// ---------------------------------------------------------------------------

test('retains when the fixed result no longer matches the bound evidence', async () => {
  await withContext('result-tampered', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    await ctx.store.transact(s => {
      s.workerExecutions[ctx.executionId].result = {status: 'succeeded', summary: 'different outcome'};
      return {state: s};
    });
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'EVIDENCE_MISMATCH');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('retains a stale generation and a wrong resource owner', async () => {
  await withContext('identity', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    const stale = await reconcileReclaimedExecutionWorkspace(ctx.options({generation: 2}));
    assert.equal(stale.status, 'RETAINED');
    assert.equal(stale.reason, 'STALE_EXECUTION');

    const foreign = await reconcileReclaimedExecutionWorkspace(ctx.options({binding: {...ctx.binding, repoId: 'someone-else'}}));
    assert.equal(foreign.status, 'RETAINED');
    assert.equal(foreign.reason, 'EVIDENCE_MISMATCH');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('revocation at entry refuses with FORBIDDEN and leaves the ledger intact', async () => {
  await withContext('revoked-entry', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    await assert.rejects(reconcileReclaimedExecutionWorkspace(ctx.options({authorize: () => false})), {code: 'FORBIDDEN'});
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('revocation at the last moment before commit refuses with FORBIDDEN', async () => {
  await withContext('revoked-commit', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    let calls = 0;
    // First call (entry) passes; second call (inside the write transaction) is revoked.
    const authorize = async () => ++calls <= 1;
    await assert.rejects(reconcileReclaimedExecutionWorkspace(ctx.options({authorize})), {code: 'FORBIDDEN'});
    assert.equal(calls, 2);
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('concurrent reconciliation backfills once and retains the loser', async () => {
  await withContext('concurrent', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    const [a, b] = await Promise.all([
      reconcileReclaimedExecutionWorkspace(ctx.options()),
      reconcileReclaimedExecutionWorkspace(ctx.options()),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ['BACKFILLED', 'RETAINED']);
    assert.equal(ctx.reclaimOf().phase, 'verified');
  });
});

// ---------------------------------------------------------------------------
// Pre-merge hardening: never follow a redirected resource directory, and parse
// Git worktree registration exactly (NUL-delimited, no quote escaping/trim).
// ---------------------------------------------------------------------------

test('retains when the resource directory is a link but the original path is still registered', async () => {
  await withContext('resource-link', async ctx => {
    await ctx.complete();
    await reserveOnly(ctx);
    // Replace the owned resource directory with a link to an unrelated dir.
    // Git still registers the worktree at the original path, so following the
    // link would check the decoy and falsely report the worktree removed.
    const decoy = join(ctx.dir, 'decoy');
    await fs.mkdir(decoy);
    await fs.rm(join(ctx.resourcesRoot, ctx.key), {recursive: true, force: true});
    await fs.symlink(decoy, join(ctx.resourcesRoot, ctx.key), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(ctx.registered(), true);

    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'PATH_ESCAPE');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(ctx.registered(), true); // recovery never re-runs Git removal
  });
});

test('retains a wrong-type resource directory instead of trusting it', async () => {
  await withContext('resource-file', async ctx => {
    await ctx.complete();
    await reserveOnly(ctx);
    await fs.rm(join(ctx.resourcesRoot, ctx.key), {recursive: true, force: true});
    await fs.writeFile(join(ctx.resourcesRoot, ctx.key), 'not a directory');

    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'PATH_ESCAPE');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
    assert.equal(ctx.registered(), true);
  });
});

test('retains an identity mismatch instead of checking a substituted key', async () => {
  await withContext('identity-mismatch', async ctx => {
    await crashAfterDeletion(ctx, 'reserved');
    const io = {
      ...fs,
      realpath: async path => {
        if (String(path).includes(ctx.key)) return join(ctx.resourcesRoot, 'a'.repeat(32));
        return fs.realpath(path);
      },
    };
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options({io}));
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'PATH_ESCAPE');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('detects a still-registered worktree under a path with whitespace', async () => {
  await withContext('with space', async ctx => {
    assert.match(ctx.repo, / /);
    assert.match(ctx.resourcesRoot, / /);
    await ctx.complete();
    await reserveOnly(ctx);
    // Leave only the stale Git registration; the -z comparison must still
    // match the untrimmed path instead of reporting a false absence.
    await fs.rm(ctx.workspace, {recursive: true, force: true});

    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'RETAINED');
    assert.equal(report.reason, 'GIT_REGISTERED');
    assert.equal(ctx.reclaimOf().phase, 'reserved');
  });
});

test('backfills a fully removed workspace under a path with whitespace', async () => {
  await withContext('whitespace removed', async ctx => {
    assert.match(ctx.repo, / /);
    await crashAfterDeletion(ctx, 'reserved');
    const report = await reconcileReclaimedExecutionWorkspace(ctx.options());
    assert.equal(report.status, 'BACKFILLED');
    assert.equal(ctx.reclaimOf().phase, 'verified');
    assert.equal(ctx.registered(), false);
  });
});
