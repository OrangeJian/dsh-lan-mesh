import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { prepareRunnerWorkspace, verifyRunnerWorkspace } from './runner-workspace.mjs';

const defaultIo = { lstat, realpath };

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Deterministic ownership key: only the (executionId, generation) pair maps to a resource directory. */
export function executionResourceKey(executionId, generation) {
  return createHash('sha256').update(JSON.stringify([executionId, generation])).digest('hex').slice(0, 32);
}

/** Local resource metadata on the existing Worker ledger. No task transitions. */
export async function prepareExecutionWorkspace({store, executionId, generation, binding, baseCommit, resourcesRoot, authorize}) {
  if (typeof authorize !== 'function' || !await authorize()) fail('FORBIDDEN');
  if (typeof binding?.repoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(binding.repoId) ||
      typeof baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) fail('BAD_REQUEST');
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) fail('WORKSPACE_UNAVAILABLE');
  const root = await realpath(resourcesRoot);
  const key = executionResourceKey(executionId, generation);
  const record = { generation, repoId: binding.repoId, baseCommit, key, phase: 'reserved' };
  await store.transact(async state => {
    const execution = Object.hasOwn(state.workerExecutions,executionId) ? state.workerExecutions[executionId] : undefined;
    if (!execution || execution.descriptor.generation !== generation) fail('STALE_EXECUTION');
    if (execution.workspaceResource) fail('WORKSPACE_ALREADY_RESERVED');
    if (execution.state !== 'received' || execution.started) fail('INVALID_TRANSITION');
    if (!await authorize()) fail('FORBIDDEN');
    execution.workspaceResource = record;
    return {state};
  });

  // Persist the reservation first. A failure leaves the path discoverable for reconciliation.
  const resourceRoot = join(root,key);
  if (!await authorize()) fail('FORBIDDEN');
  await mkdir(resourceRoot);
  const result = await prepareRunnerWorkspace({binding,repoId:record.repoId,baseCommit,resourceRoot});
  await store.transact(async state => {
    const execution = state.workerExecutions[executionId];
    if (execution?.descriptor.generation !== generation ||
        execution?.workspaceResource?.key !== key ||
        execution?.workspaceResource?.phase !== 'reserved' ||
        execution.state !== 'received' || execution.started) fail('STALE_EXECUTION');
    if (!await authorize()) fail('FORBIDDEN');
    execution.workspaceResource.phase = 'prepared';
    return {state};
  });
  return result;
}

// Combine the two independent observations into one conservative verdict.
// COMPLETE is the only positive outcome and requires a prepared ledger plus a
// fully verified worktree; every other path is a distinct, non-success concern.
function combine(ledgerStatus, diskStatus) {
  if (ledgerStatus === 'STALE') return 'STALE';
  if (ledgerStatus === 'PATH_ESCAPE' || diskStatus === 'PATH_ESCAPE') return 'PATH_ESCAPE';
  if (ledgerStatus === 'FOREIGN' || diskStatus === 'FOREIGN') return 'FOREIGN';
  if (ledgerStatus === 'MISMATCH' || diskStatus === 'MISMATCH') return 'MISMATCH';
  // An unknown observation can never be downgraded to PARTIAL by a reserved ledger.
  if (ledgerStatus === 'UNKNOWN' || diskStatus === 'UNKNOWN') return 'UNKNOWN';
  if (diskStatus === 'ABSENT') return 'MISSING';
  if (ledgerStatus === 'ABSENT' || ledgerStatus === 'NO_RESOURCE') return 'ORPHAN';
  if (ledgerStatus === 'reserved' && diskStatus === 'COMPLETE') return 'UNPROMOTED';
  if (ledgerStatus === 'reserved' || diskStatus === 'PARTIAL') return 'PARTIAL';
  if (ledgerStatus === 'prepared' && diskStatus === 'COMPLETE') return 'COMPLETE';
  return 'UNCERTAIN';
}

/**
 * Read-only preparation-state reconciliation for one execution resource after an
 * interrupted prepare or a restart. Ledger state and disk observation are read
 * independently and reported separately. It verifies the execution id, generation,
 * resource ownership and the full fixed commit by reusing verifyRunnerWorkspace.
 * Nothing is mutated: no mkdir, no ledger promotion/transition, no retry, no release,
 * no deletion and no dispatch. Any stale, foreign, partial, out-of-path or unknown
 * observation is reported conservatively and never resolves to COMPLETE.
 */
export async function inspectExecutionWorkspace({store, executionId, generation, binding, baseCommit, resourcesRoot, io = defaultIo}) {
  if (typeof executionId !== 'string' || !executionId) fail('BAD_REQUEST');
  if (!Number.isSafeInteger(generation) || generation < 1) fail('BAD_REQUEST');
  if (typeof binding?.repoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(binding.repoId) ||
      typeof baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) fail('BAD_REQUEST');
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) fail('WORKSPACE_UNAVAILABLE');

  const key = executionResourceKey(executionId, generation);

  // ---- Ledger observation: a plain read, never a transaction. ----
  const state = store.read();
  const execution = Object.hasOwn(state.workerExecutions, executionId) ? state.workerExecutions[executionId] : undefined;
  const descriptorGeneration = execution?.descriptor?.generation ?? null;
  const resource = execution?.workspaceResource ?? null;
  const ledger = {
    executionPresent: Boolean(execution),
    state: execution?.state ?? null,
    started: execution?.started ?? null,
    generation: descriptorGeneration,
    generationMatches: descriptorGeneration === generation,
    resource: resource ? {
      generation: resource.generation,
      phase: resource.phase,
      repoId: resource.repoId,
      baseCommit: resource.baseCommit,
      key: resource.key,
    } : null,
    resourceGenerationMatches: resource ? resource.generation === generation : false,
    keyMatches: resource ? resource.key === key : false,
    repoMatches: resource ? resource.repoId === binding.repoId : false,
    commitMatches: resource ? resource.baseCommit === baseCommit : false,
    status: undefined,
  };
  if (!execution) ledger.status = 'ABSENT';
  else if (descriptorGeneration !== generation || (resource && resource.generation !== generation)) ledger.status = 'STALE';
  else if (!resource) ledger.status = 'NO_RESOURCE';
  else if (resource.key !== key || resource.repoId !== binding.repoId || resource.baseCommit !== baseCommit) ledger.status = 'MISMATCH';
  else ledger.status = resource.phase; // 'reserved' | 'prepared'

  // ---- Disk observation: path-safe, read-only re-verification. ----
  const disk = {
    expectedRoot: join(resourcesRoot, key),
    rootExists: false,
    workspaceExists: false,
    workspace: null,
    verification: null,
    observationError: null,
    status: undefined,
  };
  let root;
  try {
    root = await io.realpath(resourcesRoot);
  } catch (error) {
    disk.observationError = error.code || 'UNKNOWN';
    // Only a genuinely absent root supports MISSING; EACCES/EIO and other
    // faults are an unknown observation, never evidence of absence.
    disk.status = error.code === 'ENOENT' ? 'ABSENT' : 'UNKNOWN';
  }
  if (root) {
    const resourceRoot = join(root, key);
    let entry;
    try {
      entry = await io.lstat(resourceRoot);
    } catch (error) {
      if (error.code === 'ENOENT') disk.status = 'ABSENT';
      else { disk.observationError = error.code || 'UNKNOWN'; disk.status = 'UNKNOWN'; }
    }
    if (entry) {
      // A symlink or a non-directory here would escape the owned root: refuse to trust it.
      if (entry.isSymbolicLink() || !entry.isDirectory()) disk.status = 'PATH_ESCAPE';
      else {
        // lstat and realpath are two calls: the entry may vanish between them.
        let observed;
        try {
          observed = await io.realpath(resourceRoot);
        } catch (error) {
          disk.observationError = error.code || 'UNKNOWN';
          disk.status = 'UNKNOWN';
        }
        if (observed) {
          // The resolved directory must be exactly the key under the resource root.
          if (relative(root, observed) !== key) disk.status = 'PATH_ESCAPE';
          else {
            disk.rootExists = true;
            const workspace = join(observed, 'workspace');
            let workspaceEntry;
            try {
              workspaceEntry = await io.lstat(workspace);
            } catch (error) {
              if (error.code === 'ENOENT') disk.status = 'PARTIAL';
              else { disk.observationError = error.code || 'UNKNOWN'; disk.status = 'UNKNOWN'; }
            }
            if (workspaceEntry) {
              // A symlinked workspace escapes the owned resource root.
              if (workspaceEntry.isSymbolicLink()) disk.status = 'PATH_ESCAPE';
              else if (!workspaceEntry.isDirectory()) disk.status = 'PARTIAL';
              else {
                disk.workspaceExists = true;
                // Resolve before trusting the path to Git; the entry may have
                // been swapped or removed since lstat.
                let resolved;
                try {
                  resolved = await io.realpath(workspace);
                } catch (error) {
                  disk.observationError = error.code || 'UNKNOWN';
                  disk.status = 'UNKNOWN';
                }
                if (resolved) {
                  // Require the resolution to remain the expected child before
                  // any Git verification is allowed to contribute evidence.
                  if (relative(observed, resolved) !== 'workspace') disk.status = 'PATH_ESCAPE';
                  else {
                    disk.workspace = resolved;
                    try {
                      const checked = await verifyRunnerWorkspace({binding, repoId: binding.repoId, baseCommit, workspace: resolved});
                      disk.verification = {repoId: checked.repoId, baseCommit: checked.baseCommit, workspace: checked.workspace};
                      disk.status = 'COMPLETE';
                    } catch (error) {
                      disk.observationError = error.code || 'UNKNOWN';
                      disk.status = error.code === 'REPO_MISMATCH' ? 'FOREIGN'
                        : error.code === 'BASE_COMMIT_MISMATCH' ? 'MISMATCH'
                        : error.code === 'WORKTREE_REQUIRED' ? 'PATH_ESCAPE'
                        : error.code === 'WORKSPACE_UNAVAILABLE' ? 'UNKNOWN'
                        : 'PARTIAL';
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    executionId,
    generation,
    key,
    ledger,
    disk,
    status: combine(ledger.status, disk.status),
  };
}
