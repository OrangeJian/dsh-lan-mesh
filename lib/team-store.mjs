import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyTeamState, teamId, teamMember, REVIEW_RECORD_KEYS } from './team-state.mjs';
import { resultHash } from './task-result-context.mjs';

function validate(state) {
  if (state?.version !== 1) throw new Error('Unsupported Team storage version');
  for (const name of ['teams', 'tasks', 'executions', 'workerExecutions', 'outbox', 'nonces']) {
    if (!state[name] || typeof state[name] !== 'object' || Array.isArray(state[name])) throw new Error(`Invalid Team ${name}`);
  }
  // M6: versioned plan drafts live in their own bucket. An M1 ledger has no
  // `plans` bucket; add the empty default in place so it opens unchanged.
  if (state.plans === undefined) state.plans = {};
  if (!state.plans || typeof state.plans !== 'object' || Array.isArray(state.plans)) throw new Error('Invalid Team plans');
  const check = (condition) => { if (!condition) throw new Error('Invalid Team storage record'); };
  const positive = value => Number.isSafeInteger(value) && value >= 1;
  const descriptor = value => {
    check(value && typeof value === 'object');
    for (const key of ['roomId', 'taskId', 'executionId']) teamId(value[key]);
    for (const key of ['leaderKey', 'workerKey', 'actorKey']) teamMember(value[key]);
    check(positive(value.generation));
  };
  for (const [key, value] of Object.entries(state.teams)) {
    teamId(key); teamMember(value.leaderKey);
    check(value.roomId === key && positive(value.generation) && positive(value.revision) && typeof value.paused === 'boolean');
  }
  for (const [key, value] of Object.entries(state.tasks)) {
    teamId(key); teamMember(value.workerKey);
    check(value.taskId === key && state.teams[value.roomId] && typeof value.title === 'string' && value.title.trim() && value.title.length <= 200 && typeof value.detail === 'string' && value.detail.length <= 4000 && positive(value.revision));
    check(['planned', 'ready', 'active', 'review', 'accepted', 'blocked', 'failed', 'cancelled'].includes(value.status));
    check(Array.isArray(value.dependsOn) && value.dependsOn.length === 0);
    check(value.currentExecutionId === null || state.executions[value.currentExecutionId]?.taskId === key);
    // M6 task-reviewer audit: optional so legacy v1 ledgers (no reviews field)
    // still open unchanged. A present audit must be the fixed shape written by
    // the reducer, with unique requestIds for idempotent replay.
    if (value.reviews !== undefined) {
      check(Array.isArray(value.reviews) && value.reviews.length >= 1 && value.reviews.length <= 200);
      const requestIds = new Set();
      for (const record of value.reviews) {
        check(record && typeof record === 'object' && !Array.isArray(record));
        check(Object.keys(record).length === REVIEW_RECORD_KEYS.length && REVIEW_RECORD_KEYS.every(k => Object.hasOwn(record, k)));
        check(typeof record.requestId === 'string' && record.requestId.trim().length > 0 && record.requestId.length <= 200 && !requestIds.has(record.requestId));
        requestIds.add(record.requestId);
        check(/^[a-f0-9]{64}$/.test(record.fingerprint) && /^[a-f0-9]{64}$/.test(record.resultHash));
        check(record.roomId === value.roomId && record.taskId === key);
        teamId(record.reviewedExecutionId); teamMember(record.leaderKey); teamMember(record.actorKey);
        check(positive(record.generation));
        check(['accepted', 'rejected'].includes(record.decision));
        check(record.reason === null || (typeof record.reason === 'string' && record.reason.length <= 4000));
        check(record.producesExecution === false);
        // Fail closed at the persistence boundary too: the audited reference
        // must still be the fixed, reviewable execution and the pinned hash
        // must still equal the authoritative result hash. Uses the SAME
        // task-result-context helper as the pure evaluator (no copy).
        const execution = state.executions[record.reviewedExecutionId];
        check(execution && execution.taskId === key && execution.roomId === value.roomId &&
          execution.generation === record.generation && execution.state === 'succeeded');
        let actualHash;
        try { actualHash = resultHash(execution.result); } catch { /* checked below */ }
        check(actualHash === record.resultHash);
      }
    }
  }
  for (const [key, value] of Object.entries(state.executions)) {
    teamId(key); teamMember(value.workerKey);
    check(value.executionId === key && state.tasks[value.taskId]?.roomId === value.roomId && state.tasks[value.taskId]?.workerKey === value.workerKey && positive(value.attempt) && positive(value.generation));
    check(['queued', 'acknowledged', 'running', 'uncertain', 'succeeded', 'failed', 'cancelled'].includes(value.state));
    check(Number.isFinite(value.admissionExpiresAt) && (value.leaseExpiresAt === null || Number.isFinite(value.leaseExpiresAt)) && Number.isSafeInteger(value.lastEventSeq) && value.lastEventSeq >= 0);
    check(value.events && typeof value.events === 'object' && !Array.isArray(value.events));
    check(Object.keys(value.events).length === value.lastEventSeq);
    for (const [seq, event] of Object.entries(value.events)) {
      check(positive(Number(seq)) && Number(seq) <= value.lastEventSeq && event.seq === Number(seq) && event.executionId === key && event.eventId === `${key}:${seq}` && typeof event.fingerprint === 'string' && typeof event.createdAt === 'string');
      teamMember(event.actorKey);
    }
  }
  for (const [key, value] of Object.entries(state.workerExecutions)) {
    teamId(key); descriptor(value.descriptor);
    check(value.descriptor.executionId === key && value.descriptor.actorKey === value.descriptor.leaderKey && typeof value.started === 'boolean' && positive(value.seq));
    check(['received', 'starting', 'running', 'uncertain', 'succeeded', 'failed', 'cancelled'].includes(value.state));
    check(typeof value.descriptor.title === 'string' && value.descriptor.title.length <= 200 && typeof value.descriptor.detail === 'string' && value.descriptor.detail.length <= 4000);
    check(value.tombstone !== true || value.state === 'cancelled');
    check(!['starting', 'running', 'succeeded', 'failed'].includes(value.state) || value.started);
    if (value.workspaceResource !== undefined) {
      const resource = value.workspaceResource;
      check(resource && resource.generation === value.descriptor.generation &&
        typeof resource.repoId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(resource.repoId) &&
        typeof resource.baseCommit === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(resource.baseCommit) &&
        typeof resource.key === 'string' && /^[a-f0-9]{32}$/.test(resource.key) &&
        ['reserved','prepared'].includes(resource.phase));
      // Optional explicit-reclamation step record. It is written only by a
      // transactional reservation that obtained separately sourced proofs of
      // quiescence and fixed result retention, bound to this exact outcome.
      if (resource.reclaim !== undefined) {
        const reclaim = resource.reclaim;
        check(reclaim && typeof reclaim === 'object' && !Array.isArray(reclaim));
        check(['reserved','released','verified'].includes(reclaim.phase));
        const evidence = reclaim.evidence;
        check(evidence && typeof evidence === 'object' && !Array.isArray(evidence));
        check(evidence.executionId === key && evidence.generation === value.descriptor.generation &&
          evidence.key === resource.key &&
          typeof evidence.resultHash === 'string' && /^[a-f0-9]{64}$/.test(evidence.resultHash));
        const quiescence = evidence.quiescence;
        const retention = evidence.retention;
        check(quiescence && typeof quiescence === 'object' && quiescence.stopped === true &&
          typeof quiescence.source === 'string' && quiescence.source.trim().length > 0 && quiescence.source.length <= 200);
        check(retention && typeof retention === 'object' && retention.retained === true &&
          typeof retention.source === 'string' && retention.source.trim().length > 0 && retention.source.length <= 200 &&
          typeof retention.reference === 'string' && retention.reference.trim().length > 0 && retention.reference.length <= 400 &&
          retention.resultHash === evidence.resultHash);
        check(reclaim.failureCode === undefined ||
          (typeof reclaim.failureCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(reclaim.failureCode)));
      }
    }
  }
  for (const value of Object.values(state.outbox)) {
    check(value && ['dispatch', 'progress', 'result', 'reconcile'].includes(value.operation));
    descriptor(value.body);
    check(typeof value.target === 'string' && value.target.length > 0);
    check(value.operation === 'dispatch' || value.operation === 'reconcile' ? state.executions[value.body.executionId] : state.workerExecutions[value.body.executionId]);
  }
  for (const [key, expiry] of Object.entries(state.nonces)) check(key.length <= 256 && Number.isFinite(expiry));
  // M6 plans bucket: fail-closed structural check. Semantic checks (fingerprint
  // recomputation, DAG, approval binding) live in the pure helpers + service;
  // here we guard the on-disk shape and the five-field approval binding.
  for (const [key, plan] of Object.entries(state.plans)) {
    teamId(key);
    check(plan && typeof plan === 'object' && !Array.isArray(plan));
    check(plan.planId === key);
    teamId(plan.roomId);
    check(state.teams[plan.roomId] && positive(plan.generation) && positive(plan.revision));
    check(typeof plan.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(plan.fingerprint));
    check(Array.isArray(plan.tasks) && plan.tasks.every(t => t && typeof t === 'object' && typeof t.taskId === 'string' && t.taskId.length > 0));
    check(plan.approval === null || plan.approval === undefined ||
      (plan.approval && typeof plan.approval === 'object' && !Array.isArray(plan.approval)));
    if (plan.approval) {
      const approval = plan.approval;
      teamMember(approval.actorKey);
      check(approval.planId === key && approval.roomId === plan.roomId && approval.generation === plan.generation &&
        approval.revision === plan.revision && approval.fingerprint === plan.fingerprint);
      check(typeof approval.approvedAt === 'string' && typeof approval.requestId === 'string' && approval.requestId.length > 0);
    }
    check(plan.requests && typeof plan.requests === 'object' && !Array.isArray(plan.requests));
    for (const [rid, record] of Object.entries(plan.requests)) {
      check(typeof rid === 'string' && rid.length > 0 && rid.length <= 128);
      check(record && typeof record === 'object' && !Array.isArray(record) && ['submit', 'approve'].includes(record.op));
      check(typeof record.intent === 'string' && /^[a-f0-9]{64}$/.test(record.intent));
      check(record.result && typeof record.result === 'object' && !Array.isArray(record.result));
    }
  }
  return state;
}

/** One process owns a store; callers must not open concurrent writers for one directory. */
export async function openTeamStore({ directory, io = fs }) {
  await io.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'team.json');
  let current;
  try {
    current = validate(JSON.parse(await io.readFile(file, 'utf8')));
  } catch (error) {
    // Normalize a brand-new ledger through validate too, so the optional M6
    // `plans` bucket is present from the first write (old ledgers get it on load).
    if (error.code === 'ENOENT') current = validate(emptyTeamState());
    else throw Object.assign(new Error(`Cannot load Team storage: ${error.message}`, { cause: error }), { code: 'TEAM_STORAGE' });
  }
  let pending = Promise.resolve();
  return {
    read: () => structuredClone(current),
    transact(fn) {
      const operation = pending.then(async () => {
        const result = await fn(structuredClone(current));
        validate(result.state);
        const temp = `${file}.${randomUUID()}.tmp`;
        let handle;
        try {
          handle = await io.open(temp, 'wx', 0o600);
          await handle.writeFile(`${JSON.stringify(result.state)}\n`, 'utf8');
          await handle.sync();
          await handle.close();
          handle = undefined;
          await io.rename(temp, file);
        } catch (error) {
          await handle?.close().catch(() => {});
          await io.unlink(temp).catch(() => {});
          throw error;
        }
        current = structuredClone(result.state);
        return structuredClone(result.value);
      });
      pending = operation.catch(() => {});
      return operation;
    },
    flush: () => pending,
  };
}
