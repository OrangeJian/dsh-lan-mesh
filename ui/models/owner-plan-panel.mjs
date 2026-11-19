/**
 * M6 Owner plan panel view model.
 *
 * Pure presentation helpers: no network, no storage, no authority. The Host
 * ledger is the only source of plan revision, generation, fingerprint and
 * approval state; this module only formats what the server returned.
 */

const CONFLICT_CODES = ['REVISION_CONFLICT', 'STALE_GENERATION', 'APPROVAL_BINDING_MISMATCH'];

function stringList(value) {
  return Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : [];
}

/**
 * Chinese label for one candidate exclusion reason. The reasons come from the
 * Host's candidate filter (lib/m6-worker-candidates.mjs); unknown codes render
 * verbatim instead of being hidden.
 */
export function ownerPlanCandidateReasonText(reason) {
  const labels = {
    UNAUTHORIZED: '不在本机授权范围',
    NO_PROFILE: '无能力声明',
    CAPABILITY_MISMATCH: '能力不匹配',
    CAPACITY_FULL: '执行槽已占用（uncertain 占槽）',
  };
  return typeof reason === 'string' && reason !== '' ? (labels[reason] ?? reason) : '';
}

/**
 * Per-task preview rows + a three-way summary from a bound preview report.
 * State is derived ONLY from the fields the Host returned: dispatchable needs
 * BOTH dependencySatisfied and candidateAvailable (the server sends all three
 * separately; neither implies the other).
 */
export function ownerPlanPreviewRows(report) {
  const reportView = report && typeof report === 'object' ? report : {};
  const candidates = reportView.candidates && typeof reportView.candidates === 'object' ? reportView.candidates : {};
  const ids = Array.isArray(reportView.dag?.order) && reportView.dag.order.length > 0
    ? reportView.dag.order
    : Object.keys(candidates);
  const rows = ids.map(taskId => {
    const candidate = candidates && typeof candidates[taskId] === 'object' && candidates[taskId] !== null ? candidates[taskId] : null;
    const recommended = stringList(candidate?.recommended);
    const excluded = (Array.isArray(candidate?.excluded) ? candidate.excluded : [])
      .filter(entry => entry && typeof entry === 'object' && typeof entry.memberKey === 'string' && entry.memberKey !== '')
      .map(entry => ({ memberKey: entry.memberKey, reason: typeof entry.reason === 'string' ? entry.reason : '', text: ownerPlanCandidateReasonText(entry.reason) }));
    const state = candidate === null ? 'unknown'
      : candidate.dispatchable === true ? 'dispatchable'
      : candidate.dependencySatisfied === true ? 'noCandidate'
      : 'blocked';
    const labels = { dispatchable: '可派发', blocked: '等待依赖验收', noCandidate: '无可用候选', unknown: '无候选数据' };
    return {
      taskId: String(taskId),
      state,
      stateLabel: labels[state],
      dependencySatisfied: candidate?.dependencySatisfied === true,
      candidateAvailable: candidate?.candidateAvailable === true,
      dispatchable: candidate?.dispatchable === true,
      recommended,
      excluded,
    };
  });
  return {
    rows,
    summary: {
      dispatchable: rows.filter(row => row.state === 'dispatchable').length,
      blocked: rows.filter(row => row.state === 'blocked').length,
      noCandidate: rows.filter(row => row.state === 'noCandidate').length,
      unknown: rows.filter(row => row.state === 'unknown').length,
    },
  };
}

/**
 * Chinese lines for the report-level explanations. Unknown codes are skipped:
 * the panel never invents an explanation the Host did not send.
 */
export function ownerPlanExplanationLines(explanations) {
  const labels = {
    DEPENDENCY_NOT_ACCEPTED: '依赖尚未验收，等待 Owner 在成果评审中接受',
    NO_CANDIDATE: '没有可派发的候选 Worker',
    CANDIDATE_FILTER_FAILED: '候选过滤失败',
    INVALID_PLAN: '计划内容不合法',
    MISSING_PLAN_TASKS: '缺少任务清单',
    INVALID_APPROVAL_CONTEXT: '批准上下文不完整',
    APPROVAL_TEAM_MISMATCH: '批准与当前 Room 不一致',
    APPROVAL_GENERATION_MISMATCH: '批准与当前 Team 代次不一致',
  };
  return (Array.isArray(explanations) ? explanations : [])
    .map(entry => {
      if (!entry || typeof entry !== 'object' || typeof entry.code !== 'string') return null;
      const label = labels[entry.code];
      if (label === undefined) return null;
      const where = typeof entry.taskId === 'string' && entry.taskId !== '' ? `（${entry.taskId}）` : '';
      const detail = typeof entry.detail === 'string' && entry.detail !== '' ? `：${entry.detail}` : '';
      return `${label}${where}${detail}`;
    })
    .filter(Boolean);
}

/**
 * One line summarizing the Team's task/execution states from the owner
 * overview counts the Host already returns (no invented fields; a missing or
 * empty overview renders as an empty string so the panel hides the line).
 */
export function ownerTeamCountLine(overview) {
  if (!overview || typeof overview !== 'object' || overview.known !== true || overview.status === 'absent') return '';
  const taskLabels = { planned: '待依赖', ready: '待派发', active: '执行中', review: '待评审', accepted: '已验收', blocked: '受阻', failed: '失败', cancelled: '已取消' };
  const executionLabels = { queued: '已排队', acknowledged: '已确认', running: '运行中', uncertain: '不确定（占槽）' };
  const part = (counts, labels) => {
    if (!counts || typeof counts !== 'object') return '';
    const line = Object.entries(labels)
      .filter(([status]) => Number.isSafeInteger(counts[status]) && counts[status] > 0)
      .map(([status, label]) => `${label} ${counts[status]}`)
      .join(' · ');
    return line === '' ? '' : line;
  };
  const tasks = part(overview.taskCounts, taskLabels);
  const executions = part(overview.executionCounts, executionLabels);
  return [tasks && `任务 ${tasks}`, executions && `执行 ${executions}`].filter(Boolean).join('；');
}

/** A failed write that changed the version underneath the user, not a bad input. */
export function ownerPlanConflict(code) {
  return CONFLICT_CODES.includes(code);
}

/** Stable Chinese text for the codes the plan entry can return. */
export function ownerPlanErrorText(code, fallback = '') {
  const messages = {
    FORBIDDEN: '当前无权执行该计划操作；团队权限由服务端判定。',
    NOT_OWNER: '仅本机 Owner 可执行该计划操作。',
    NOT_READY: '本机 Team 账本尚未就绪，请稍后刷新。',
    UNKNOWN_ROOM: '找不到该 Room，可能已被移除。',
    MISSING_CANONICAL_ROOM: '无法确认该 Room 的权威标识。',
    NOT_FOUND: '该计划不存在，或不属于当前 Room。',
    REVISION_CONFLICT: '计划版本已变化，已重新读取，请核对后再次提交。',
    STALE_GENERATION: 'Team 代次已变化，已重新读取，请核对后再操作。',
    APPROVAL_BINDING_MISMATCH: '批准绑定的版本或指纹与服务端不一致，已重新读取。',
    INVALID_PLAN_GRAPH: '计划依赖不合法：不能有循环或跨 Room 依赖。',
    INVALID_PLAN: '计划内容不合法，请检查任务字段。',
    PLAN_TAMPER: '计划记录校验失败，已停止操作。',
    PLAN_ID_CONFLICT: '该计划 ID 已属于其他 Room。',
    REQUEST_CONFLICT: '同一请求对应了不同内容，请刷新后重试。',
    BAD_REQUEST: '请求内容不合法，请检查计划 ID 与任务清单。',
    ROOM_CHANGED: 'Room 或 Team 状态已变化，请刷新后重试。',
    PAUSED: 'Team 已暂停，请恢复后再操作。',
    PLAN_NOT_APPROVED: '该计划尚未批准，请先批准确切版本。',
    DEPENDENCY_NOT_ACCEPTED: '依赖任务尚未验收，暂不能派发。',
    NO_DISPATCHABLE_CANDIDATE: '没有满足授权、能力与容量的候选 Worker。',
    CANDIDATES_UNAVAILABLE: '候选授权数据不可用，已按安全策略拒绝。',
    CAPACITY: '目标 Worker 的执行槽已占用（含 uncertain）。',
    UNRESOLVED_EXECUTION: '该任务仍有未决执行（含 uncertain），需人工核对后再继续。',
    LAN_MESH_FAILED: '请求失败，请稍后重试。',
  };
  return messages[code] ?? (fallback || '操作失败，请稍后重试。');
}

/** Parse the draft task textarea; structural checks only, the Host validates the plan. */
export function parseOwnerPlanTasks(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? ''));
  } catch {
    throw Object.assign(new Error('tasks must be JSON'), { code: 'BAD_REQUEST' });
  }
  if (!Array.isArray(value) || value.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
    throw Object.assign(new Error('tasks must be a JSON array of objects'), { code: 'BAD_REQUEST' });
  }
  return value;
}

/** Short fingerprint for dense rows; detail views always show the full value. */
export function ownerPlanFingerprintShort(fingerprint) {
  return typeof fingerprint === 'string' && fingerprint.length > 12 ? `${fingerprint.slice(0, 12)}…` : String(fingerprint ?? '');
}

/** Room list rows, newest first, with no invented fields. */
export function ownerPlanRows(plans) {
  return (Array.isArray(plans) ? plans : [])
    .filter(plan => plan && typeof plan === 'object' && typeof plan.planId === 'string' && plan.planId !== '')
    .map(plan => ({
      planId: plan.planId,
      roomId: typeof plan.roomId === 'string' ? plan.roomId : '',
      revision: plan.revision,
      generation: plan.generation,
      fingerprint: typeof plan.fingerprint === 'string' ? plan.fingerprint : '',
      approved: plan.approval !== null && plan.approval !== undefined,
      taskCount: Array.isArray(plan.tasks) ? plan.tasks.length : 0,
      updatedAt: typeof plan.updatedAt === 'string' ? plan.updatedAt : '',
    }))
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '') || left.planId.localeCompare(right.planId));
}

/** Exact stored version; task objects are kept as returned so a bump resubmits the same content. */
export function ownerPlanDetail(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    planId: plan.planId,
    roomId: plan.roomId,
    revision: plan.revision,
    generation: plan.generation,
    fingerprint: typeof plan.fingerprint === 'string' ? plan.fingerprint : '',
    approved: plan.approval !== null && plan.approval !== undefined,
    approval: plan.approval && typeof plan.approval === 'object' ? { ...plan.approval } : null,
    tasks: Array.isArray(plan.tasks) ? plan.tasks.filter(task => task && typeof task === 'object' && !Array.isArray(task)).map(task => ({ ...task })) : [],
    createdAt: typeof plan.createdAt === 'string' ? plan.createdAt : '',
    updatedAt: typeof plan.updatedAt === 'string' ? plan.updatedAt : '',
  };
}

/** Display rows for the exact version's tasks. */
export function ownerPlanTaskRows(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map((task, index) => ({
    key: `${String(task.taskId ?? 'task')}-${index}`,
    taskId: String(task.taskId ?? ''),
    title: typeof task.title === 'string' && task.title !== '' ? task.title : String(task.taskId ?? ''),
    detail: typeof task.detail === 'string' ? task.detail : '',
    dependsOn: stringList(task.dependsOn),
    requiredCapabilities: stringList(task.requiredCapabilities),
  }));
}

/** The exact sentence a person must confirm before an approval is sent. */
export function ownerPlanApprovalPrompt(plan) {
  return `确认批准计划 ${plan.planId} 的版本 ${plan.revision}，指纹 ${plan.fingerprint}。`;
}


/**
 * Helpers the panel needs, passed explicitly like every other UI fragment so
 * the same component can be rendered in isolation by its own tests.
 */
export const ownerPlanPanelModel = Object.freeze({
  conflict: ownerPlanConflict,
  errorText: ownerPlanErrorText,
  parseTasks: parseOwnerPlanTasks,
  fingerprintShort: ownerPlanFingerprintShort,
  rows: ownerPlanRows,
  detail: ownerPlanDetail,
  taskRows: ownerPlanTaskRows,
  approvalPrompt: ownerPlanApprovalPrompt,
  candidateReasonText: ownerPlanCandidateReasonText,
  previewRows: ownerPlanPreviewRows,
  explanationLines: ownerPlanExplanationLines,
  teamCountLine: ownerTeamCountLine,
});
