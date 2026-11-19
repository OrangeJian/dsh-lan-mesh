/**
 * M6 Owner fixed-result review panel view model.
 *
 * Pure presentation helpers only: no network, no storage, no authority and no
 * hash computation. Every executionId, resultHash, generation and review
 * status shown by the panel comes from a Host response; this module only
 * formats and filters what the server returned.
 */

const HASH_RE = /^[a-f0-9]{64}$/;
const REVIEWABLE = 'review';

// A decision failure that means the fixed result moved underneath the user.
// The panel re-READS the current overview for these and never retries blindly.
const RESULT_CONFLICT_CODES = [
  'STALE_GENERATION',
  'STALE_RESULT',
  'RESULT_HASH_MISMATCH',
  'RESULT_NOT_REVIEWABLE',
  'NOT_IN_REVIEW',
  'ROOM_CHANGED',
  'EXECUTION_NOT_FOUND',
  'EXECUTION_SCOPE_MISMATCH',
];

/** True when the failure invalidates the confirmed execution/result pair. */
export function ownerResultConflict(code) {
  return RESULT_CONFLICT_CODES.includes(code);
}

/** Stable Chinese text for the codes the result-review entry can return. */
export function ownerResultErrorText(code, fallback = '') {
  const messages = {
    FORBIDDEN: '当前无权评审该 Room 的成果；团队权限由服务端判定。',
    NOT_OWNER: '仅本机 Owner 可执行成果评审。',
    NOT_READY: '本机 Team 账本尚未就绪，请稍后刷新。',
    UNKNOWN_ROOM: '找不到该 Room，可能已被移除。',
    MISSING_CANONICAL_ROOM: '无法确认该 Room 的权威标识。',
    BAD_REQUEST: '请求内容不合法，请刷新后重新选择成果。',
    NOT_FOUND: '该任务或执行已不存在，请刷新。',
    NOT_CURRENT_LEADER: '当前 Team Leader 已变化，不能评审该成果。',
    NOT_LOCAL_LEADER: '只有本机当前的 Team Leader 可以评审。',
    ROOM_CHANGED: 'Room 的负责人或成员已变化，请刷新后核对。',
    STALE_GENERATION: 'Team 代次已变化，该结果已失效，已重新读取。',
    STALE_RESULT: '该执行已不是任务的当前结果，已重新读取。',
    EXECUTION_NOT_FOUND: '找不到该执行，可能已被替换，已重新读取。',
    EXECUTION_SCOPE_MISMATCH: '该执行不属于此 Room 或任务，已重新读取。',
    RESULT_NOT_REVIEWABLE: '该执行不是可评审的成功结果，已重新读取。',
    RESULT_HASH_MISMATCH: '结果指纹与服务端不一致，已重新读取，请核对后重试。',
    RESULT_MISSING: '该执行没有可评审的结果内容，已重新读取。',
    MISSING_REASON: '拒绝必须填写原因。',
    NOT_IN_REVIEW: '该任务已不在待评审状态，已重新读取。',
    CONFLICT: '同一请求对应了不同内容，请刷新后重新评审。',
    LAN_MESH_FAILED: '请求失败，请稍后重试。',
  };
  return messages[code] ?? (fallback || '操作失败，请稍后重试。');
}

/**
 * Fixed-result rows from the owner overview projection.
 *
 * Only fields the server actually returned are kept. A row is actionable only
 * when the task, execution, generation and a canonical lowercase sha256 hash
 * are all present; nothing is invented for a partial row.
 */
export function ownerResultRows(refs) {
  return (Array.isArray(refs) ? refs : [])
    .filter(ref => ref && typeof ref === 'object')
    .map(ref => {
      const taskId = typeof ref.taskId === 'string' ? ref.taskId : '';
      const executionId = typeof ref.executionId === 'string' ? ref.executionId : '';
      const resultHash = typeof ref.resultHash === 'string' ? ref.resultHash : '';
      const generation = Number.isSafeInteger(ref.generation) && ref.generation > 0 ? ref.generation : null;
      const reviewStatus = typeof ref.reviewStatus === 'string' ? ref.reviewStatus : '';
      return {
        taskId,
        executionId,
        resultHash,
        generation,
        reviewStatus,
        reviewable: reviewStatus === REVIEWABLE,
        actionable: taskId !== '' && executionId !== '' && HASH_RE.test(resultHash) && generation !== null,
      };
    })
    .filter(row => row.reviewable)
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.executionId.localeCompare(right.executionId));
}

/** Short fingerprint for dense rows; the detail view always shows it in full. */
export function ownerResultHashShort(resultHash) {
  return typeof resultHash === 'string' && resultHash.length > 12 ? `${resultHash.slice(0, 12)}…` : String(resultHash ?? '');
}

/** The exact sentence a person must confirm before a decision is sent. */
export function ownerResultDecisionPrompt(row, decision) {
  const verb = decision === 'rejected' ? '拒绝' : '接受';
  return `确认${verb}任务 ${row.taskId} 的执行 ${row.executionId}，结果指纹 ${row.resultHash}。`;
}

/**
 * Helpers the panel needs, passed explicitly like every other UI fragment so
 * the same component can be rendered in isolation by its own tests.
 */
export const ownerResultPanelModel = Object.freeze({
  conflict: ownerResultConflict,
  errorText: ownerResultErrorText,
  rows: ownerResultRows,
  hashShort: ownerResultHashShort,
  decisionPrompt: ownerResultDecisionPrompt,
});
