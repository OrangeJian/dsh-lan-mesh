/**
 * Standalone, PURE plan-dependency validator for the M6 preparation batch.
 *
 * Draft basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.2
 * (acyclicity + "dependency must be accepted before dispatch") and §4.4
 * (`validatePlan(plan, ctx) -> { ok, errors:[{code,taskId}] }`).
 *
 * Hard scope limits (by task): local pure computation only. This module has
 * NO imports and NO side effects (no I/O, no network, no clock, no Team state
 * mutation). It does not wire into any entry point, protocol, ledger, or
 * dispatch/start/wake path, and does not enable M6. It does not change
 * approval / ACL / generation / identity semantics.
 *
 * PENDING DECISION (recorded, not resolved here): the draft §4.2 proposes to
 * allow non-empty `dependsOn`, but the current authoritative reducer still
 * rejects it -- `lib/team-state.mjs:54` `if (c.dependsOn?.length) fail('UNSUPPORTED')`
 * -- and there is no `accept` command yet (§4.5 / D-items OPEN). This helper is
 * therefore independent and opt-in; enabling it in team-state/store/protocol/
 * coordinator is out of scope for this task and remains a conservative no-op.
 *
 * DIVERGENCE FROM EXISTING TEAM RULES (reported to coordinator, not reconciled):
 *  - team-state rejects ANY non-empty dependsOn as UNSUPPORTED; this helper
 *    validates a dependency graph instead (never wired to the reducer).
 *  - team-state has no cross-Team dependency gate and no cycle check; this
 *    helper adds both as pure, conservative rejections.
 *  - team-state has no `accept` command (a succeeded Worker only reaches
 *    'review'). Here only a SAME-TEAM trusted snapshot entry can supply
 *    'accepted'; an in-plan task's self-declared status is never trusted.
 */

const ACCEPTED = 'accepted';
// Team evidence must be a non-empty string: null/empty/invalid never qualifies.
const isTeam = value => typeof value === 'string' && value.length > 0;

/**
 * Validate a plan's dependency graph.
 *
 * @param {Array<{taskId:string, roomId?:string, dependsOn?:string[], status?:string}>} plan
 *   The proposal batch under test. A missing `dependsOn` means no dependencies;
 *   an explicitly non-array `dependsOn` is rejected (BAD_DEPENDS_ON).
 * @param {{roomId?:string, knownTasks?:Array<object>|Record<string,object>}} [options]
 *   `roomId`: authoritative team scope (else inferred from plan tasks); must be
 *   a non-empty string. `knownTasks`: TRUSTED Team snapshot. Its `status` is the
 *   ONLY source for the accepted gate (no fallback to proposal status), its
 *   `roomId` is the same-Team evidence and is never overridden by a plan node.
 * @returns {{ok:boolean, errors:Array<{code:string,taskId:string,dependency?:string}>,
 *            order:string[], dispatchable:string[]}}
 *   `order` is a deterministic topological order (prerequisites first, lexical
 *   tie-break) computed from IN-PLAN edges only. Out-of-plan dependencies are
 *   excluded from the graph but still gate on accepted. `dispatchable` is the
 *   subset of `order` whose every prerequisite is explicitly accepted by a
 *   same-Team trusted snapshot entry.
 */
export function validatePlanDeps(plan, options = {}) {
  const errors = [];
  const add = (code, taskId, dependency) => {
    errors.push(dependency === undefined ? { code, taskId } : { code, taskId, dependency });
  };

  if (!Array.isArray(plan)) {
    return { ok: false, errors: [{ code: 'BAD_PLAN', taskId: '' }], order: [], dispatchable: [] };
  }

  if (options.roomId !== undefined && !isTeam(options.roomId)) add('BAD_TEAM', '');

  const knownTasks = options.knownTasks;

  // Trusted snapshot: taskId -> { roomId, status }. Status here is the only
  // accepted source; roomId is the Team evidence and cannot be overridden.
  const snapshotById = new Map();
  if (knownTasks) {
    const entries = Array.isArray(knownTasks)
      ? knownTasks.map(t => [t && t.taskId, t])
      : Object.entries(knownTasks);
    for (const [id, t] of entries) {
      if (typeof id === 'string' && t && typeof t === 'object') {
        snapshotById.set(id, { roomId: t.roomId, status: t.status });
      }
    }
  }

  // Validate plan records; de-duplicate by taskId (first wins) for the graph.
  const tasks = [];
  const seenTaskIds = new Set();
  for (const raw of plan) {
    if (!raw || typeof raw !== 'object' || typeof raw.taskId !== 'string' || raw.taskId === '') {
      add('BAD_TASK', typeof raw?.taskId === 'string' ? raw.taskId : '');
      continue;
    }
    if (seenTaskIds.has(raw.taskId)) {
      add('DUPLICATE_TASK', raw.taskId);
      continue;
    }
    if (raw.dependsOn !== undefined && !Array.isArray(raw.dependsOn)) {
      add('BAD_DEPENDS_ON', raw.taskId);
    }
    if (raw.roomId !== undefined && !isTeam(raw.roomId)) {
      add('BAD_TEAM', raw.taskId);
    }
    seenTaskIds.add(raw.taskId);
    tasks.push({
      taskId: raw.taskId,
      roomId: raw.roomId,
      dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn : [],
      status: raw.status,
    });
  }
  const planIds = new Set(tasks.map(t => t.taskId));

  // Plan room: explicit option, else inferred when all plan tasks agree on one.
  const taskRooms = new Set(tasks.filter(t => isTeam(t.roomId)).map(t => t.roomId));
  const inferredRoom = taskRooms.size === 1 ? [...taskRooms][0] : undefined;
  const planRoom = isTeam(options.roomId) ? options.roomId : (isTeam(inferredRoom) ? inferredRoom : undefined);

  // Effective ownership of a plan node: a trusted snapshot room always wins.
  // An absent/invalid proposal room cannot bypass trusted ownership.
  const effectiveRoomOf = t => {
    const snap = snapshotById.get(t.taskId);
    if (snap && isTeam(snap.roomId)) return snap.roomId;
    if (isTeam(t.roomId)) return t.roomId;
    return planRoom;
  };

  // Combined lookup for reference classification. A same-ID trusted snapshot
  // keeps its roomId (the plan node never overrides it); a differing plan room
  // is a conflict. Proposal status is stored here but NEVER used by the gate.
  const byId = new Map();
  for (const [id, snap] of snapshotById) {
    byId.set(id, { taskId: id, roomId: snap.roomId, status: snap.status, source: 'known' });
  }
  for (const t of tasks) {
    byId.set(t.taskId, {
      taskId: t.taskId,
      roomId: effectiveRoomOf(t),
      status: t.status,
      source: 'plan',
    });
  }

  // Validate EVERY plan node against planRoom using EFFECTIVE (trusted-first)
  // ownership. A missing proposal roomId cannot bypass a trusted assignment.
  for (const t of tasks) {
    const snap = snapshotById.get(t.taskId);
    const trusted = snap && isTeam(snap.roomId) ? snap.roomId : undefined;
    const proposed = isTeam(t.roomId) ? t.roomId : undefined;
    if (trusted && proposed && trusted !== proposed) {
      add('SNAPSHOT_TEAM_CONFLICT', t.taskId);
    } else if (isTeam(planRoom)) {
      const effective = trusted ?? proposed;
      if (effective !== undefined && effective !== planRoom) {
        add(trusted ? 'SNAPSHOT_TEAM_CONFLICT' : 'CROSS_TEAM_TASK', t.taskId);
      }
    }
  }

  // Classify each dependency reference. Only valid IN-PLAN edges accumulate in
  // `dependents`; `depList` keeps every valid dep for the accepted gate.
  const dependents = new Map(); // in-plan prerequisite taskId -> Set<dependent taskId>
  const depList = new Map(); // dependent taskId -> [valid prerequisite taskId]
  for (const t of tasks) {
    const seenDeps = new Set();
    const valid = [];
    for (const d of t.dependsOn) {
      if (typeof d !== 'string' || d === '') {
        add('BAD_DEPENDENCY', t.taskId, String(d));
        continue;
      }
      if (seenDeps.has(d)) {
        add('DUPLICATE_DEPENDENCY', t.taskId, d);
        continue; // do not double-count an edge for a repeated entry
      }
      seenDeps.add(d);

      if (d === t.taskId) {
        add('SELF_DEPENDENCY', t.taskId, d);
        continue;
      }
      const target = byId.get(d);
      if (!target) {
        add('UNKNOWN_DEPENDENCY', t.taskId, d);
        continue;
      }

      const isInternal = planIds.has(d);
      if (isInternal) {
        // Source uses the same trusted-first effective ownership as node checks.
        const ownRoom = effectiveRoomOf(t);
        const targetRoom = isTeam(target.roomId) ? target.roomId : planRoom;
        if (isTeam(ownRoom) && isTeam(targetRoom) && ownRoom !== targetRoom) {
          add('CROSS_TEAM_DEPENDENCY', t.taskId, d);
          continue;
        }
      } else {
        // Out-of-plan dependency: require non-empty-string same-Team evidence
        // from the trusted snapshot; absence is NOT accepted.
        if (!isTeam(target.roomId) || !isTeam(planRoom)) {
          add('NO_TEAM_EVIDENCE', t.taskId, d);
          continue;
        }
        if (target.roomId !== planRoom) {
          add('CROSS_TEAM_DEPENDENCY', t.taskId, d);
          continue;
        }
      }

      valid.push(d);
      if (isInternal) {
        if (!dependents.has(d)) dependents.set(d, new Set());
        dependents.get(d).add(t.taskId);
      }
    }
    depList.set(t.taskId, valid);
  }

  // Kahn's algorithm with lexical tie-breaking. In-degree counts ONLY in-plan
  // dependencies; out-of-plan deps are never vertices. Remaining unprocessed
  // vertices constitute a cycle.
  const inDegree = new Map(tasks.map(t => [t.taskId, depList.get(t.taskId).filter(d => planIds.has(d)).length]));
  let ready = tasks.filter(t => inDegree.get(t.taskId) === 0).map(t => t.taskId).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    const next = new Set(ready);
    for (const dependentId of dependents.get(id) ?? []) {
      const degree = inDegree.get(dependentId) - 1;
      inDegree.set(dependentId, degree);
      if (degree === 0) next.add(dependentId);
    }
    ready = [...next].sort();
  }
  if (order.length !== tasks.length) add('CYCLE', '');

  // Deterministic error ordering independent of input insertion order.
  errors.sort((a, b) => {
    const ka = `${a.taskId}|${a.code}|${a.dependency ?? ''}`;
    const kb = `${b.taskId}|${b.code}|${b.dependency ?? ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const ok = errors.length === 0;

  // THE TRUST BOUNDARY: only a SAME-TEAM trusted snapshot entry can satisfy the
  // gate. No fallback to byId.status (which for in-plan tasks is the proposal's
  // self-declared status), so a plan alone can never unlock itself.
  const statusOf = id => {
    const snap = snapshotById.get(id);
    if (!snap || !isTeam(snap.roomId) || !isTeam(planRoom) || snap.roomId !== planRoom) return undefined;
    return snap.status;
  };
  const dispatchable = [];
  if (ok) {
    for (const id of order) {
      const satisfied = depList.get(id).every(d => statusOf(d) === ACCEPTED);
      if (satisfied) dispatchable.push(id);
    }
  }

  return { ok, errors, order: ok ? order : [], dispatchable };
}
