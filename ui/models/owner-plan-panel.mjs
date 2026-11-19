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
});
