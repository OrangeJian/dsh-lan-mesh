/**
 * M6 local, pure "dry-run" orchestration preview + approved-version binding.
 *
 * Draft basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md
 *   - §4.4  proposePlan/validatePlan (pure, review-only, never writes authority)
 *   - §4.2  acyclicity + "dependency must be accepted before dispatch"
 *   - §4.3  capability filtering + single-slot capacity (uncertain occupies)
 *   - §6    opt-in / capability-does-not-authorize / generation fence
 * Frozen architecture: docs/agent-team-v0.2-design.md (Leader proposes,
 * plugin enforces); docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md.
 *
 * HARD SCOPE (by task): local pure computation only. This module reuses the two
 * prior pure helpers and adds NO I/O, NO clock, NO network, NO ledger, NO
 * protocol, NO entry point. It does NOT dispatch / start / wake / accept, does
 * not enable M6, and changes no approval / ACL / generation / identity
 * semantics. It only emits explanations and candidate recommendations for a
 * human to review; it holds no execution authority and produces no side
 * effects. Production ledger + entry wiring are a separate batch.
 *
 * TRUST MODEL: every authoritative input is supplied by the trusted caller
 * (`trusted`): explicit Team + generation, the approved plan revision + content
 * fingerprint, the ACL (authorizations), capacity (profiles + executions) and
 * the Team snapshot used by the dependency gate. A proposal is never trusted:
 *   - its self-declared fingerprint is IGNORED and recomputed from real content
 *     (so "approved version + tampered content" is detected);
 *   - a self-declared revision / Team / generation that disagrees with the
 *     trusted context is a binding failure;
 *   - capabilities matching a task never grant permission (filter helper).
 *
 * PENDING DECISIONS (recorded, not resolved here): D4 generation bump,
 * D6 exact "local authorized scope", D8 acceptance double-sign remain OPEN.
 * This helper only compares a proposal's claimed generation to the trusted
 * one; it never bumps, derives authority from capabilities, or accepts a task.
 */

import { createHash } from 'node:crypto';
import { canonicalTeamJson } from './team-state.mjs';
import { validatePlanDeps } from './m6-plan-dag.mjs';
import { filterWorkerCandidates } from './m6-worker-candidates.mjs';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isPositiveSafeInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Strict typed readers for the KNOWN business fields. A present-but-wrongly-
 * typed field fails instead of collapsing to a default: otherwise a malformed
 * plan (e.g. `requiredCapabilities: {}` or `roomId: 42`) could normalize to the
 * same digest as a well-formed plan and defeat tamper detection. Absent fields
 * follow an explicit contract: list -> [], scalar -> null.
 */
function stringList(value) {
  if (!Array.isArray(value)) fail('INVALID_PLAN');
  const result = [];
  for (const entry of value) {
    if (!isNonEmptyString(entry)) fail('INVALID_PLAN');
    result.push(entry);
  }
  return result.sort();
}

function optionalString(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string') fail('INVALID_PLAN');
  return value;
}

/**
 * Normalize only the semantic fields that define a plan, so that a cosmetic
 * key-order change does not look like tampering while any real content change
 * does. `dependsOn` and `requiredCapabilities` are set-like -> sorted.
 *
 * Field contract: taskId REQUIRED non-empty string; roomId optional
 * (absent -> null, else non-empty string); dependsOn/requiredCapabilities
 * optional (absent -> [], else array of non-empty strings);
 * acceptanceCriteria/title/detail optional (absent -> null, else string).
 * Any other runtime field (e.g. `status`) is NOT plan content and is ignored.
 */
function normalizeTask(raw) {
  if (!isObject(raw) || !isNonEmptyString(raw.taskId)) fail('INVALID_PLAN');
  if (raw.roomId !== undefined && !isNonEmptyString(raw.roomId)) fail('INVALID_PLAN');
  return {
    taskId: raw.taskId,
    roomId: raw.roomId === undefined ? null : raw.roomId,
    dependsOn: raw.dependsOn === undefined ? [] : stringList(raw.dependsOn),
    requiredCapabilities: raw.requiredCapabilities === undefined ? [] : stringList(raw.requiredCapabilities),
    acceptanceCriteria: optionalString(raw.acceptanceCriteria),
    title: optionalString(raw.title),
    detail: optionalString(raw.detail),
  };
}

function normalizedPlan(tasks) {
  if (!Array.isArray(tasks)) fail('INVALID_PLAN');
  return tasks.map(normalizeTask);
}

/**
 * Deterministic SHA-256 content fingerprint of a plan. This is the same value
 * the trusted approver produces when it approves a plan; it is pure and has no
 * side effects (only in-memory computation).
 *
 * @param {Array<object>} tasks
 * @returns {string} 64-char lowercase hex digest
 */
export function planFingerprint(tasks) {
  return createHash('sha256').update(canonicalTeamJson(normalizedPlan(tasks))).digest('hex');
}

function explain(code, taskId, detail) {
  const entry = { code };
  if (taskId !== undefined) entry.taskId = taskId;
  if (detail !== undefined) entry.detail = detail;
  return entry;
}

function sortExplanations(list) {
  return list.sort((a, b) => {
    const key = e => `${e.taskId ?? ''}|${e.code}|${e.detail ?? ''}`;
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Produce a read-only orchestration preview bound to the approved plan version.
 *
 * @param {object} proposal  Untrusted proposed plan; null/undefined is handled
 *   as MISSING_PLAN_TASKS. Shape:
 *   { planId, revision, roomId?, generation?, fingerprint?, tasks: TaskSpec[] }.
 *   `fingerprint` (if present) is self-declared and NEVER trusted; it is
 *   recomputed from `tasks` and compared to the approved fingerprint.
 * @param {object} trusted  Trusted caller's authoritative context:
 *   { roomId, generation (positive safe int),
 *     approvedPlan: { planId (non-empty), revision (positive safe int),
 *                     fingerprint, roomId, generation },
 *     authorizations: string[], profiles: [{memberKey,capabilities}],
 *     executions: array|object, knownTasks: array|object }
 *   The approval record must itself bind to the same Team and generation.
 * @returns {object} Report containing only explanations + candidate data:
 *   { ok, bound, team, approval, proposal, dag, candidates, explanations }.
 *   Each candidates entry carries dependencySatisfied, candidateAvailable and
 *   dispatchable separately; dispatchable requires BOTH. Preview only.
 */
export function previewPlanOrchestration(proposal, trusted) {
  const explanations = [];
  let bound = false;

  if (!isObject(trusted)) {
    explanations.push(explain('INVALID_CONTEXT'));
    return {
      ok: false,
      bound: false,
      team: { roomId: null, generation: null },
      approval: { planId: null, revision: null, fingerprint: null, roomId: null, generation: null },
      proposal: { planId: null, revision: null, fingerprint: null, claimedFingerprint: null },
      dag: { ok: false, errors: [], order: [], dispatchable: [] },
      candidates: Object.create(null),
      explanations,
    };
  }

  const teamRoom = isNonEmptyString(trusted.roomId) ? trusted.roomId : null;
  const teamGeneration = isPositiveSafeInt(trusted.generation) ? trusted.generation : null;
  const approval = isObject(trusted.approvedPlan) ? trusted.approvedPlan : null;
  const approvedPlanId = approval && isNonEmptyString(approval.planId) ? approval.planId : null;
  const approvedRevision = approval && isPositiveSafeInt(approval.revision) ? approval.revision : null;
  const approvedFingerprint = approval && isFingerprint(approval.fingerprint) ? approval.fingerprint : null;
  const approvedRoom = approval && isNonEmptyString(approval.roomId) ? approval.roomId : null;
  const approvedGeneration = approval && isPositiveSafeInt(approval.generation) ? approval.generation : null;

  // ---- Approved-version binding (tamper / revision / scope fence) ----
  // The approval record must carry a non-empty planId, a positive-safe revision
  // and generation, a valid fingerprint, and bind to BOTH the same Team and the
  // same generation as the trusted context. No field is inferred or defaulted.
  const approvalContextOk = approval !== null
    && approvedPlanId !== null
    && approvedRevision !== null
    && approvedFingerprint !== null
    && approvedRoom !== null
    && approvedGeneration !== null
    && teamRoom !== null
    && teamGeneration !== null;
  if (!approvalContextOk) explanations.push(explain('INVALID_APPROVAL_CONTEXT'));
  if (approvedRoom !== null && teamRoom !== null && approvedRoom !== teamRoom) {
    explanations.push(explain('APPROVAL_TEAM_MISMATCH', undefined,
      `trusted=${teamRoom} approved=${approvedRoom}`));
  }
  if (approvedGeneration !== null && teamGeneration !== null && approvedGeneration !== teamGeneration) {
    explanations.push(explain('APPROVAL_GENERATION_MISMATCH', undefined,
      `trusted=${teamGeneration} approved=${approvedGeneration}`));
  }

  const proposalObj = isObject(proposal) ? proposal : null;
  // A null/undefined/非-object proposal is "missing tasks", never a dereference
  // of `proposal.tasks` (which used to throw a TypeError).
  const hasTasks = proposalObj !== null && Array.isArray(proposalObj.tasks);
  const proposalTasks = hasTasks ? proposalObj.tasks : [];
  const proposalPlanId = proposalObj && isNonEmptyString(proposalObj.planId) ? proposalObj.planId : null;
  const proposalRevision = proposalObj ? proposalObj.revision : undefined;
  const claimedFingerprint = proposalObj && typeof proposalObj.fingerprint === 'string' ? proposalObj.fingerprint : null;

  let actualFingerprint = null;
  if (hasTasks) {
    try {
      actualFingerprint = planFingerprint(proposalTasks);
    } catch {
      explanations.push(explain('INVALID_PLAN'));
    }
  } else {
    explanations.push(explain('MISSING_PLAN_TASKS'));
  }

  // planId must be non-empty on both sides and identical.
  if (proposalPlanId === null || approvedPlanId === null || proposalPlanId !== approvedPlanId) {
    explanations.push(explain('PLAN_ID_MISMATCH', undefined,
      `approved=${String(approvedPlanId)} proposed=${String(proposalPlanId)}`));
  }

  // 改版 (revision change): a proposal not claiming the approved revision is
  // not bound, even if its content happens to match.
  if (approvedRevision === null || proposalRevision !== approvedRevision) {
    explanations.push(explain('REVISION_MISMATCH', undefined,
      `approved=${String(approvedRevision)} proposed=${String(proposalRevision)}`));
  }

  // 提案篡改 (proposal tampering): recompute from real content; a self-declared
  // fingerprint that merely repeats the approved one cannot mask a change.
  if (approvedFingerprint === null || actualFingerprint === null || actualFingerprint !== approvedFingerprint) {
    explanations.push(explain('FINGERPRINT_MISMATCH', undefined,
      `approved=${String(approvedFingerprint)} computed=${String(actualFingerprint)}`));
  }

  // Explicit Team / generation fence: a proposal that claims a different scope
  // than the trusted context cannot be previewed as the approved plan.
  if (proposalObj && proposalObj.roomId !== undefined && proposalObj.roomId !== teamRoom) {
    explanations.push(explain('TEAM_MISMATCH', undefined,
      `approved=${String(teamRoom)} proposed=${String(proposalObj.roomId)}`));
  }
  if (proposalObj && proposalObj.generation !== undefined && proposalObj.generation !== teamGeneration) {
    explanations.push(explain('GENERATION_MISMATCH', undefined,
      `approved=${String(teamGeneration)} proposed=${String(proposalObj.generation)}`));
  }

  const bindingBlockers = [
    'INVALID_PLAN', 'MISSING_PLAN_TASKS', 'TEAM_MISMATCH', 'GENERATION_MISMATCH',
    'PLAN_ID_MISMATCH', 'APPROVAL_TEAM_MISMATCH', 'APPROVAL_GENERATION_MISMATCH',
  ];
  bound = approvalContextOk
    && approvedRoom === teamRoom
    && approvedGeneration === teamGeneration
    && proposalPlanId !== null
    && proposalPlanId === approvedPlanId
    && proposalRevision === approvedRevision
    && actualFingerprint === approvedFingerprint
    && !explanations.some(e => bindingBlockers.includes(e.code));

  // ---- Reuse the pure DAG validator (Team snapshot is the only accepted source) ----
  const dag = validatePlanDeps(proposalTasks, {
    roomId: teamRoom === null ? undefined : teamRoom,
    knownTasks: trusted.knownTasks ?? [],
  });
  for (const error of dag.errors) {
    explanations.push(explain(error.code, error.taskId, error.dependency));
  }

  // ---- Reuse the pure candidate filter, per dispatchable task ----
  // Only when bound AND structurally valid do we surface candidate Workers;
  // otherwise there is no approved version to fill and we say so explicitly.
  const candidates = Object.create(null);
  const ids = dag.order.length ? dag.order : (Array.isArray(proposalTasks)
    ? proposalTasks.map(t => isObject(t) ? t.taskId : '').filter(isNonEmptyString)
    : []);
  const dispatchableSet = new Set(dag.dispatchable);
  const byTaskId = new Map();
  if (Array.isArray(proposalTasks)) {
    for (const task of proposalTasks) {
      if (isObject(task) && isNonEmptyString(task.taskId) && !byTaskId.has(task.taskId)) byTaskId.set(task.taskId, task);
    }
  }

  // A task is dispatch-ready ONLY when the DAG accepted-gate is satisfied AND
  // the filter produced at least one eligible Worker. Dependency satisfaction
  // and candidate availability are reported separately; neither implies the
  // other. All of this is preview data -- nothing here executes or authorizes.
  const candidateView = (dependencySatisfied, candidateAvailable, recommended = [], excluded = []) => ({
    dependencySatisfied,
    candidateAvailable,
    dispatchable: dependencySatisfied && candidateAvailable,
    recommended,
    excluded,
  });

  for (const taskId of ids) {
    const dependencySatisfied = dispatchableSet.has(taskId);
    // No candidates are surfaced unless the proposal is bound AND structurally
    // valid; a DAG error (cycle/bad ref) is already explained by the validator.
    if (!bound || !dag.ok) {
      candidates[taskId] = candidateView(false, false);
      continue;
    }
    if (!dependencySatisfied) {
      // 依赖未验收: a proposal-only 'accepted' status never unlocks a task;
      // only the trusted Team snapshot can, via validatePlanDeps.
      candidates[taskId] = candidateView(false, false);
      explanations.push(explain('DEPENDENCY_NOT_ACCEPTED', taskId));
      continue;
    }
    const task = byTaskId.get(taskId);
    let result = { recommended: [], excluded: [] };
    let filterOk = true;
    try {
      result = filterWorkerCandidates({
        authorizations: trusted.authorizations,
        profiles: trusted.profiles,
        executions: trusted.executions,
        task,
      });
    } catch (error) {
      filterOk = false;
      explanations.push(explain('CANDIDATE_FILTER_FAILED', taskId, error?.code ?? 'UNKNOWN'));
    }
    const candidateAvailable = filterOk && result.recommended.length > 0;
    candidates[taskId] = candidateView(true, candidateAvailable, result.recommended, result.excluded);
    // 容量不足 / 撤权 / capability mismatch: the filter's exclusion reasons are
    // surfaced; zero recommended means the task has NO dispatchable candidate.
    if (filterOk && result.recommended.length === 0) {
      explanations.push(explain('NO_CANDIDATE', taskId));
    }
    for (const excluded of result.excluded) {
      explanations.push(explain('EXCLUDED_CANDIDATE', taskId,
        `${excluded.memberKey}:${excluded.reason}`));
    }
  }

  sortExplanations(explanations);

  return {
    ok: bound && dag.ok,
    bound,
    team: { roomId: teamRoom, generation: teamGeneration },
    approval: {
      planId: approvedPlanId,
      revision: approvedRevision,
      fingerprint: approvedFingerprint,
      roomId: approvedRoom,
      generation: approvedGeneration,
    },
    proposal: {
      planId: proposalPlanId,
      revision: proposalRevision === undefined ? null : proposalRevision,
      fingerprint: actualFingerprint,
      claimedFingerprint,
    },
    dag: { ok: dag.ok, errors: dag.errors, order: dag.order, dispatchable: dag.dispatchable },
    candidates,
    explanations,
  };
}
