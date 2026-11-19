import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { prepareRunnerWorkspace, releaseRunnerWorkspace, verifyRunnerWorkspace, verifyRunnerWorkspaceRemoved } from './runner-workspace.mjs';
import { canonicalTeamJson } from './team-state.mjs';

const defaultIo = { lstat, realpath };

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Stable digest of the retained result, used to bind evidence to one outcome. */
function resultDigest(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      typeof result.summary !== 'string' || !result.summary) return null;
  return createHash('sha256').update(canonicalTeamJson(result)).digest('hex');
}

/**
 * Re-validate that a reclamation record is still internally consistent and
 * bound to the exact execution, generation, resource owner and fixed result it
 * was reserved against. Returns a stable refusal reason, or null when sound.
 * Only 'reserved'/'released' are actionable from recovery; 'verified' is an
 * idempotent replay and every other state is partial or inconsistent.
 */
function reclaimConsistency({execution, executionId, generation, key, binding, baseCommit}) {
  const resource = execution?.workspaceResource;
  const reclaim = resource?.reclaim;
  if (!execution || execution.descriptor.generation !== generation || resource?.generation !== generation) return 'STALE_EXECUTION';
  if (!reclaim) return 'NOT_STARTED';
  if (reclaim.phase === 'verified') return 'ALREADY_VERIFIED';
  if (reclaim.phase !== 'reserved' && reclaim.phase !== 'released') return 'PARTIAL_STATE';
  if (execution.state !== 'succeeded' && execution.state !== 'failed') return 'NOT_STOPPED';
  if (resource.phase !== 'prepared') return 'RESOURCE_NOT_PREPARED';
  if (resource.key !== key || resource.repoId !== binding.repoId || resource.baseCommit !== baseCommit) return 'EVIDENCE_MISMATCH';
  const digest = resultDigest(execution.result);
  if (!digest) return 'RESULT_EVIDENCE_MISSING';
  const evidence = reclaim.evidence;
  if (!evidence || evidence.executionId !== executionId || evidence.generation !== generation ||
      evidence.key !== key || evidence.resultHash !== digest ||
      evidence.quiescence?.stopped !== true ||
      typeof evidence.quiescence?.source !== 'string' || !evidence.quiescence.source.trim() ||
      evidence.retention?.retained !== true ||
      typeof evidence.retention?.source !== 'string' || !evidence.retention.source.trim() ||
      typeof evidence.retention?.reference !== 'string' || !evidence.retention.reference.trim() ||
      evidence.retention?.resultHash !== digest) return 'EVIDENCE_MISMATCH';
  return null;
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
function combine(ledger, disk, reclaim) {
  const ledgerStatus = ledger.status;
  const diskStatus = disk.status;
  // A verified reclamation stays successful only while the workspace remains
  // absent. A directory that reappears afterwards is a fresh conservative
  // concern, not a completed reclamation, even if its new state is unreadable.
  if (reclaim?.phase === 'verified' && ledgerStatus === 'prepared') {
    return disk.workspaceExists ? 'RECLAIMED_DIR_REAPPEARED' : 'RECLAIMED';
  }
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
    // Only a confirmed ENOENT at a checked path counts as absence. PATH_ESCAPE,
    // UNKNOWN and an unexamined path must never imply the workspace was removed.
    workspaceConfirmedAbsent: false,
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
    if (error.code === 'ENOENT') disk.workspaceConfirmedAbsent = true;
  }
  if (root) {
    const resourceRoot = join(root, key);
    let entry;
    try {
      entry = await io.lstat(resourceRoot);
    } catch (error) {
      if (error.code === 'ENOENT') { disk.status = 'ABSENT'; disk.workspaceConfirmedAbsent = true; }
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
              if (error.code === 'ENOENT') { disk.status = 'PARTIAL'; disk.workspaceConfirmedAbsent = true; }
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

  const reclaim = resource?.reclaim ?? null;
  return {
    executionId,
    generation,
    key,
    ledger,
    disk,
    reclamation: reclamationReport(reclaim, disk),
    status: combine(ledger, disk, reclaim),
  };
}

// Recovery view of the explicit reclamation steps. The ledger is authoritative
// for which steps were recorded; the disk observation is reported alongside it
// so a crash after Git removal but before a ledger write is visible as a gap.
function reclamationReport(reclaim, disk) {
  const steps = ['reserve', 'release', 'verify'];
  if (!reclaim) return {
    status: 'NOT_STARTED', phase: null, completedSteps: [], pendingSteps: [],
    evidence: null, failureCode: null,
    workspacePresentOnDisk: disk.workspaceExists,
    releaseObservedOnDisk: false, reappearedAfterVerified: false,
  };
  const order = { reserved: 1, released: 2, verified: 3 };
  const completed = steps.slice(0, order[reclaim.phase]);
  return {
    status: reclaim.phase.toUpperCase(), phase: reclaim.phase,
    completedSteps: completed, pendingSteps: steps.slice(completed.length),
    evidence: reclaim.evidence ?? null,
    failureCode: reclaim.failureCode ?? null,
    workspacePresentOnDisk: disk.workspaceExists,
    // Only a confirmed ENOENT on a checked path can evidence a prior release;
    // a path escape, an I/O fault or an unexamined path cannot.
    releaseObservedOnDisk: order[reclaim.phase] < 2 && disk.workspaceConfirmedAbsent,
    reappearedAfterVerified: reclaim.phase === 'verified' && disk.workspaceExists,
  };
}

/**
 * Explicit, ledger-driven local resource reclamation. This is the write-side
 * counterpart of inspectExecutionWorkspace; nothing here is scheduled or runs
 * automatically, and a caller must supply authorization on every step.
 *
 * A terminal state plus a result summary is NOT sufficient. A trusted local
 * evidenceProvider must separately prove quiescence and a fixed retained
 * result reference; each proof must name its own source. Both are bound to
 * (executionId, generation, resource key, result hash) and persisted with the
 * reservation. No provider or no source means default refusal.
 *
 * Cancelled/uncertain executions, partial/unpromoted or foreign resources,
 * dirty worktrees, path escapes, I/O faults, concurrency and crash re-entry
 * all refuse conservatively and leave the worktree intact. The three steps
 * (reserve -> release -> verify) are each committed separately so recovery can
 * name any step that was never completed; release uses non-forced Git removal.
 */
export async function reclaimExecutionWorkspace({store,executionId,generation,binding,baseCommit,resourcesRoot,authorize,evidenceProvider,io = defaultIo}) {
  if (typeof authorize !== 'function' || !await authorize()) fail('FORBIDDEN');
  // Default denial: without a trusted local evidence source nothing is reclaimed.
  if (typeof evidenceProvider !== 'function') fail('EVIDENCE_UNAVAILABLE');
  if (typeof executionId !== 'string' || !executionId) fail('BAD_REQUEST');
  if (!Number.isSafeInteger(generation) || generation < 1) fail('BAD_REQUEST');
  if (typeof binding?.repoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(binding.repoId) ||
      typeof baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) fail('BAD_REQUEST');
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) fail('WORKSPACE_UNAVAILABLE');

  let root;
  try {
    root = await io.realpath(resourcesRoot);
  } catch {
    fail('WORKSPACE_UNAVAILABLE');
  }
  const key = executionResourceKey(executionId, generation);
  const resourceRoot = join(root, key);

  // Step 1: verify every evidence source and transactionally reserve reclamation.
  const reserved = await store.transact(async state => {
    const execution = Object.hasOwn(state.workerExecutions,executionId) ? state.workerExecutions[executionId] : undefined;
    if (!execution || execution.descriptor.generation !== generation) fail('STALE_EXECUTION');
    const resource = execution.workspaceResource;
    if (!resource) fail('NO_RESOURCE');
    if (resource.generation !== generation || resource.key !== key ||
        resource.repoId !== binding.repoId || resource.baseCommit !== baseCommit) fail('RESOURCE_MISMATCH');
    if (resource.phase !== 'prepared') fail('RESOURCE_NOT_PREPARED');
    if (resource.reclaim) fail(resource.reclaim.phase === 'verified' ? 'RECLAIM_ALREADY_DONE' : 'RECLAIM_IN_PROGRESS');
    // A terminal state is only a baseline; it never proves quiescence or retention.
    if (execution.state !== 'succeeded' && execution.state !== 'failed') fail('NOT_STOPPED');
    const digest = resultDigest(execution.result);
    if (!digest) fail('RESULT_EVIDENCE_MISSING');

    let provided;
    try {
      provided = await evidenceProvider({executionId, generation, key, resultHash: digest, repoId: binding.repoId, baseCommit});
    } catch {
      fail('EVIDENCE_UNAVAILABLE');
    }
    const quiescence = provided?.quiescence;
    const retention = provided?.retention;
    if (!quiescence || quiescence.stopped !== true ||
        typeof quiescence.source !== 'string' || !quiescence.source.trim() || quiescence.source.length > 200) fail('QUIESCENCE_UNPROVEN');
    if (!retention || retention.retained !== true ||
        typeof retention.source !== 'string' || !retention.source.trim() || retention.source.length > 200 ||
        typeof retention.reference !== 'string' || !retention.reference.trim() || retention.reference.length > 400) fail('RETENTION_UNPROVEN');
    if (retention.resultHash !== digest) fail('EVIDENCE_BINDING_MISMATCH');

    const evidence = {
      executionId, generation, key, resultHash: digest,
      quiescence: { stopped: true, source: quiescence.source },
      retention: { retained: true, source: retention.source, reference: retention.reference, resultHash: digest },
    };
    if (!await authorize()) fail('FORBIDDEN');
    resource.reclaim = { phase: 'reserved', evidence };
    return { state, value: { key, resultHash: digest } };
  });

  // Keep a stable failure code on the reservation so recovery can report which
  // step never completed, then rethrow the original conservative refusal.
  const recordFailure = async error => {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : 'RELEASE_FAILED';
    await store.transact(state => {
      const reclaim = state.workerExecutions[executionId]?.workspaceResource?.reclaim;
      if (reclaim && reclaim.phase !== 'verified') reclaim.failureCode = code;
      return { state };
    });
  };

  let released, verification;
  try {
    // Step 2: the existing non-forced Git removal. Re-check current authorization
    // and the complete reservation identity at the last moment: a phase check
    // alone cannot detect revocation, a swapped execution or changed evidence.
    released = await releaseRunnerWorkspace({
      binding, repoId: binding.repoId, baseCommit, resourceRoot,
      canRelease: async () => {
        if (!await authorize()) return false;
        const state = store.read();
        const execution = state.workerExecutions[executionId];
        const resource = execution?.workspaceResource;
        const reclaim = resource?.reclaim;
        if (!execution || execution.descriptor.generation !== generation) return false;
        if (execution.state !== 'succeeded' && execution.state !== 'failed') return false;
        if (!resource || resource.generation !== generation || resource.key !== key ||
            resource.repoId !== binding.repoId || resource.baseCommit !== baseCommit ||
            resource.phase !== 'prepared') return false;
        if (!reclaim || reclaim.phase !== 'reserved') return false;
        const digest = resultDigest(execution.result);
        const evidence = reclaim.evidence;
        if (!(digest && evidence &&
          evidence.executionId === executionId && evidence.generation === generation &&
          evidence.key === key && evidence.resultHash === digest &&
          evidence.quiescence?.stopped === true && evidence.quiescence?.source &&
          evidence.retention?.retained === true && evidence.retention?.source &&
          evidence.retention?.reference && evidence.retention?.resultHash === digest)) return false;
        try {
          const current = await evidenceProvider({
            executionId, generation, key, resultHash: digest,
            repoId: binding.repoId, baseCommit, phase: 'release',
          });
          if (current?.quiescence?.stopped !== true ||
              current.quiescence.source !== evidence.quiescence.source ||
              current?.retention?.retained !== true ||
              current.retention.source !== evidence.retention.source ||
              current.retention.reference !== evidence.retention.reference ||
              current.retention.resultHash !== digest || !await authorize()) return false;
          return JSON.stringify(store.read().workerExecutions[executionId]) === JSON.stringify(execution);
        } catch {
          return false;
        }
      },
    });

    // Step 3: commit that release happened before verifying, so a crash here is
    // reported as a missing verify step rather than an untracked deletion.
    await store.transact(async state => {
      const reclaim = state.workerExecutions[executionId]?.workspaceResource?.reclaim;
      if (reclaim?.phase !== 'reserved') fail('RECLAIM_STATE_CHANGED');
      if (!await authorize()) fail('FORBIDDEN');
      reclaim.phase = 'released';
      return { state };
    });

    // Step 4: independent read-only verification of the removal.
    verification = await verifyRunnerWorkspaceRemoved({binding,repoId:binding.repoId,baseCommit,resourcesRoot,key});

    // Step 5: commit the verified step.
    await store.transact(async state => {
      const reclaim = state.workerExecutions[executionId]?.workspaceResource?.reclaim;
      if (reclaim?.phase !== 'released') fail('RECLAIM_STATE_CHANGED');
      if (!await authorize()) fail('FORBIDDEN');
      reclaim.phase = 'verified';
      return { state };
    });
  } catch (error) {
    // A failure while recording must never mask the original conservative refusal.
    try { await recordFailure(error); } catch {}
    throw error;
  }

  return {
    executionId, generation, key, reclaimed: true,
    resultHash: reserved.resultHash, released, verification,
  };
}

/**
 * Post-restart reconciliation of a resource that already entered explicit
 * reclamation. Unlike reclaimExecutionWorkspace this function NEVER mutates the
 * filesystem and NEVER re-runs Git removal, prepare, start or dispatch. Its
 * only possible write is a single atomic ledger transaction that backfills
 * confirmed reclamation steps.
 *
 * The backfill is allowed only when, at the moment of writing, current
 * authorization, resource ownership, the original generation and the fixed
 * retained result still validate AND an independent read-only proof confirms
 * BOTH the workspace directory and its Git worktree registration are absent.
 * A present directory, a stale Git registration, any unknown I/O fault, a
 * partial record or inconsistent evidence returns an explicit RETAINED status
 * and leaves the ledger untouched.
 */
export async function reconcileReclaimedExecutionWorkspace({store, executionId, generation, binding, baseCommit, resourcesRoot, authorize, io = defaultIo}) {
  if (typeof authorize !== 'function' || !await authorize()) fail('FORBIDDEN');
  if (typeof executionId !== 'string' || !executionId) fail('BAD_REQUEST');
  if (!Number.isSafeInteger(generation) || generation < 1) fail('BAD_REQUEST');
  if (typeof binding?.repoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(binding.repoId) ||
      typeof baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) fail('BAD_REQUEST');
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) fail('WORKSPACE_UNAVAILABLE');

  const key = executionResourceKey(executionId, generation);
  const report = {
    executionId, generation, key,
    status: 'RETAINED', reason: null,
    fromPhase: null, toPhase: null, backfilledSteps: [],
    removal: null,
  };
  const retain = reason => { report.reason = reason; return report; };
  const removalProof = () => verifyRunnerWorkspaceRemoved({binding, repoId: binding.repoId, baseCommit, resourcesRoot, key, io});
  const mapRemovalError = error => error.code === 'WORKSPACE_STILL_PRESENT' ? 'DIRECTORY_PRESENT'
    : error.code === 'WORKTREE_STILL_REGISTERED' ? 'GIT_REGISTERED'
    : error.code === 'PATH_ESCAPE' ? 'PATH_ESCAPE'
    : 'IO_UNKNOWN';

  // Read-only admission checks: no transaction is opened unless a write is due.
  const state = store.read();
  const execution = Object.hasOwn(state.workerExecutions, executionId) ? state.workerExecutions[executionId] : undefined;
  const problem = reclaimConsistency({execution, executionId, generation, key, binding, baseCommit});
  if (problem) return retain(problem);
  const fromPhase = execution.workspaceResource.reclaim.phase;
  report.fromPhase = fromPhase;

  let removal;
  try {
    removal = await removalProof();
  } catch (error) {
    return retain(mapRemovalError(error));
  }
  report.removal = {
    workspaceConfirmedAbsent: true,
    gitRegistrationConfirmedAbsent: true,
    resourceRootExists: removal.resourceRootExists,
  };

  // Atomically record the confirmed steps. Re-validate authorization, the full
  // evidence identity and the removal inside the transaction so a revocation,
  // a concurrent replay or a reappearing directory cannot slip through between
  // the read-only observation and the commit. A retention race aborts without
  // writing; authorization revocation is a real refusal and propagates.
  try {
    await store.transact(async current => {
      if (!await authorize()) fail('FORBIDDEN');
      const currentExecution = Object.hasOwn(current.workerExecutions, executionId) ? current.workerExecutions[executionId] : undefined;
      const issue = reclaimConsistency({execution: currentExecution, executionId, generation, key, binding, baseCommit});
      if (issue) {
        throw Object.assign(new Error(`Retention race: ${issue}`), {code: 'RECOVERY_RETENTION', reason: issue});
      }
      try {
        await removalProof();
      } catch (error) {
        throw Object.assign(new Error('Retention race: removal unconfirmed'), {code: 'RECOVERY_RETENTION', reason: mapRemovalError(error)});
      }
      const reclaim = currentExecution.workspaceResource.reclaim;
      reclaim.phase = 'verified';
      if (reclaim.failureCode !== undefined) delete reclaim.failureCode;
      return {state: current};
    });
  } catch (error) {
    if (error?.code === 'RECOVERY_RETENTION') return retain(error.reason);
    throw error;
  }

  report.status = 'BACKFILLED';
  report.toPhase = 'verified';
  report.backfilledSteps = fromPhase === 'reserved' ? ['release', 'verify'] : ['verify'];
  return report;
}
