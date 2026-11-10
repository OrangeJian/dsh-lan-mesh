/** Authoritative Team transitions. Never merge this document using Room LWW rules. */
export function emptyTeamState() {
  return { version: 1, teams: {}, tasks: {}, executions: {}, workerExecutions: {}, outbox: {}, nonces: {} };
}

function fail(code, message = code) { throw Object.assign(new Error(message), { code }); }
function text(value, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('BAD_REQUEST');
  return value.trim();
}
export function teamId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(value) || Object.hasOwn(Object.prototype, value)) fail('BAD_REQUEST');
  return value;
}
export function teamMember(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}\/[^\s/]{1,128}$/.test(value)) fail('BAD_REQUEST');
  return value;
}
export function canonicalTeamJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
const unresolved = new Set(['queued', 'acknowledged', 'running', 'uncertain']);

/** Apply one validated command atomically; callers persist before acknowledging. */
export function applyTeamCommand(input, command, { now = Date.now() } = {}) {
  const state = structuredClone(input);
  const c = command;
  const roomId = teamId(c.roomId);
  const actor = teamMember(c.actorKey);
  const time = c.type === 'expire' && Number.isFinite(c.now) ? c.now : now;
  if (!Number.isFinite(time)) fail('BAD_REQUEST');
  if (c.type === 'create-team') {
    if (state.teams[roomId]) fail('CONFLICT');
    if (actor !== c.leaderKey) fail('FORBIDDEN');
    const value = { roomId, leaderKey: actor, generation: 1, revision: 1, paused: false };
    if(c.contextSelection)value.contextSelection=structuredClone(c.contextSelection);
    state.teams[roomId] = value;
    return { state, value };
  }
  const team = state.teams[roomId];
  if (!team) fail('NOT_FOUND');
  if (c.generation !== team.generation) fail('STALE_GENERATION');
  const workerEvent = ['ack', 'progress', 'result'].includes(c.type);
  if (!workerEvent && actor !== team.leaderKey) fail('FORBIDDEN');
  if (c.type === 'pause') {
    team.paused = true;
    team.revision++;
    return { state, value: team };
  }
  if (team.paused && ['queue', 'start'].includes(c.type)) fail('PAUSED');
  const taskId = teamId(c.taskId);
  if (c.type === 'create-task') {
    if (state.tasks[taskId]) fail('CONFLICT');
    if (c.dependsOn?.length) fail('UNSUPPORTED');
    const value = { taskId, roomId, title: text(c.title), detail: c.detail ?? '', workerKey: teamMember(c.workerKey), dependsOn: [], status: 'ready', currentExecutionId: null, revision: 1 };
    if (typeof value.detail !== 'string' || value.detail.length > 4000) fail('BAD_REQUEST');
    state.tasks[taskId] = value;
    return { state, value };
  }
  const task = state.tasks[taskId];
  if (!task || task.roomId !== roomId) fail('NOT_FOUND');
  const executionId = teamId(c.executionId);
  if (c.type === 'queue') {
    if (state.executions[executionId]) fail('CONFLICT');
    const previous = Object.values(state.executions).filter(e => e.taskId === taskId);
    if (previous.some(e => unresolved.has(e.state))) fail('UNRESOLVED_EXECUTION');
    if (Object.values(state.executions).some(e => e.workerKey === task.workerKey && unresolved.has(e.state))) fail('CAPACITY');
    const value = { executionId, taskId, roomId, workerKey: task.workerKey, generation: team.generation, attempt: previous.length + 1, state: 'queued', admissionExpiresAt: time + (c.leaseMs ?? 90000), leaseExpiresAt: null, lastEventSeq: 0, events: {}, result: null };
    state.executions[executionId] = value;
    task.currentExecutionId = executionId;
    task.status = 'active';
    task.revision++;
    return { state, value };
  }
  const execution = state.executions[executionId];
  if (!execution || execution.taskId !== taskId) fail('NOT_FOUND');
  if (workerEvent) {
    if (actor !== execution.workerKey) fail('FORBIDDEN');
    if (!Number.isSafeInteger(c.seq) || c.seq < 1) fail('BAD_REQUEST');
    const fingerprint = canonicalTeamJson(c);
    if (execution.events[c.seq]) {
      if (execution.events[c.seq].fingerprint !== fingerprint) fail('EVENT_CONFLICT');
      return { state, value: execution };
    }
    if (c.seq !== execution.lastEventSeq + 1) fail('EVENT_GAP');
    if (task.currentExecutionId !== executionId) fail('STALE_EXECUTION');
    execution.events[c.seq] = { eventId: `${executionId}:${c.seq}`, executionId, actorKey: actor, type: c.type, seq: c.seq, createdAt: new Date(time).toISOString(), payload: structuredClone(c), fingerprint };
    execution.lastEventSeq = c.seq;
  }
  switch (c.type) {
    case 'ack':
      if (execution.state !== 'queued') fail('INVALID_TRANSITION');
      execution.state = 'acknowledged';
      break;
    case 'start':
      if (execution.state !== 'acknowledged') fail('INVALID_TRANSITION');
      if (!Number.isFinite(c.leaseMs) || c.leaseMs <= 0) fail('BAD_REQUEST');
      execution.state = 'running';
      execution.leaseExpiresAt = time + c.leaseMs;
      break;
    case 'progress':
      if (!['running', 'uncertain'].includes(execution.state)) fail('INVALID_TRANSITION');
      execution.note = typeof c.note === 'string' ? c.note.slice(0, 4000) : '';
      break;
    case 'result':
      if (!['running', 'uncertain'].includes(execution.state)) fail('INVALID_TRANSITION');
      if (!['succeeded', 'failed'].includes(c.result?.status)) fail('BAD_REQUEST');
      text(c.result.summary, 4000);
      execution.result = structuredClone(c.result);
      if (execution.state !== 'uncertain') {
        execution.state = c.result.status;
        task.status = c.result.status === 'succeeded' ? 'review' : 'failed';
      }
      break;
    case 'expire':
      if (!['queued', 'acknowledged', 'running'].includes(execution.state) || (execution.state === 'running' ? execution.leaseExpiresAt : execution.admissionExpiresAt) > time) fail('INVALID_TRANSITION');
      execution.state = 'uncertain';
      task.status = 'blocked';
      break;
    case 'cancel':
      if (!unresolved.has(execution.state)) fail('INVALID_TRANSITION');
      execution.state = 'uncertain';
      task.status = 'blocked';
      break;
    case 'reconcile':
      if (execution.state !== 'uncertain' || c.stopped !== true) fail('INVALID_TRANSITION');
      execution.reconciliation = text(c.reason, 4000);
      execution.state = 'cancelled';
      task.status = 'ready';
      break;
    default: fail('BAD_REQUEST');
  }
  task.revision++;
  return { state, value: execution };
}
