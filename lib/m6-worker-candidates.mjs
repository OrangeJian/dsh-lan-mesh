/**
 * Standalone, pure candidate-Worker filter (M6 preparation batch).
 *
 * Scope discipline:
 *  - No I/O, no state, no ledger, no protocol, no entry points. No dispatch,
 *    start, wake, approval, ACL, generation or identity semantics are touched.
 *  - All inputs are supplied by a trusted caller; this function only computes.
 *    It never derives authority from capability declarations.
 *  - M1 single slot is preserved: a worker with any unresolved execution
 *    (queued/acknowledged/running/uncertain) is occupied and cannot be
 *    recommended. `uncertain` occupies a slot. Terminal states do not.
 *  - Ordering is deterministic (lexicographic by memberKey) and the function
 *    never creates executions, so it cannot expand concurrency.
 *
 * Pending decisions (recorded, not resolved here):
 *  - Plan D6: the exact meaning of "local authorized scope" and M1's
 *    REMOTE_WORKER_REQUIRED tension are OPEN. `authorizations` is therefore
 *    treated as an opaque authority set from the trusted caller; no local/remote
 *    rule is encoded, to avoid changing ACL or identity semantics.
 *  - Plan D4: generation is intentionally not an input, so no generation
 *    semantics are altered.
 */

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

const UNRESOLVED = new Set(['queued', 'acknowledged', 'running', 'uncertain']);
const EXECUTION_STATES = new Set([
  'queued', 'acknowledged', 'running', 'uncertain', 'succeeded', 'failed', 'cancelled',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function memberKeyOf(value, code) {
  if (typeof value !== 'string' || value.length === 0) fail(code);
  return value;
}

function capabilityList(value, code) {
  if (!Array.isArray(value)) fail(code);
  const result = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) fail(code);
    result.push(entry);
  }
  return result;
}

function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Filter candidate Workers for a single task slot.
 *
 * @param {object}  input
 * @param {string[]} input.authorizations  Trusted caller's authorized memberKeys (sole authority source).
 * @param {object[]} input.profiles        Capability declarations: { memberKey, capabilities: string[] }.
 * @param {object[]|object} input.executions  Existing execution snapshot: array or M1 keyed object of { workerKey, state }.
 * @param {object}  input.task             { requiredCapabilities: string[] } for the task to fill.
 * @returns {{recommended: string[], excluded: Array<{memberKey: string, reason: string}>}}
 */
export function filterWorkerCandidates(input) {
  if (!isPlainObject(input)) fail('INVALID_INPUT');

  // Fail closed when any authoritative input is absent.
  if (!Array.isArray(input.authorizations)) fail('MISSING_AUTHORIZATIONS');
  if (!Array.isArray(input.profiles)) fail('MISSING_PROFILES');
  if (!Array.isArray(input.executions) && !isPlainObject(input.executions)) fail('MISSING_EXECUTIONS');
  if (!isPlainObject(input.task)) fail('MISSING_TASK');
  if (!Object.hasOwn(input.task, 'requiredCapabilities')) fail('MISSING_REQUIRED_CAPABILITIES');

  const required = capabilityList(input.task.requiredCapabilities, 'INVALID_REQUIRED_CAPABILITIES');
  const requiredSet = new Set(required);

  // Authority set: the only source of permission. Capabilities never add to it.
  const authorized = new Set();
  for (const entry of input.authorizations) {
    const key = isPlainObject(entry) ? entry.memberKey : entry;
    authorized.add(memberKeyOf(key, 'INVALID_AUTHORIZATION'));
  }

  // Capability declarations, used for matching only.
  const capabilitiesByMember = new Map();
  for (const profile of input.profiles) {
    if (!isPlainObject(profile)) fail('INVALID_PROFILE');
    const key = memberKeyOf(profile.memberKey, 'INVALID_PROFILE');
    if (capabilitiesByMember.has(key)) fail('DUPLICATE_PROFILE');
    capabilitiesByMember.set(key, new Set(capabilityList(profile.capabilities, 'INVALID_PROFILE')));
  }

  // Occupancy from the execution snapshot (single slot; uncertain counts).
  const executionRecords = Array.isArray(input.executions) ? input.executions : Object.values(input.executions);
  const occupied = new Set();
  for (const execution of executionRecords) {
    if (!isPlainObject(execution)) fail('INVALID_EXECUTION');
    const key = memberKeyOf(execution.workerKey, 'INVALID_EXECUTION');
    if (typeof execution.state !== 'string' || !EXECUTION_STATES.has(execution.state)) fail('INVALID_EXECUTION_STATE');
    if (UNRESOLVED.has(execution.state)) occupied.add(key);
  }

  // Candidate universe = every member the trusted caller or snapshot mentioned.
  const universe = new Set([...authorized, ...capabilitiesByMember.keys(), ...occupied]);

  const recommended = [];
  const excluded = [];
  for (const memberKey of universe) {
    // Authorization is the first and only permission gate.
    if (!authorized.has(memberKey)) {
      excluded.push({ memberKey, reason: 'UNAUTHORIZED' });
      continue;
    }
    const capabilities = capabilitiesByMember.get(memberKey);
    if (!capabilities) {
      excluded.push({ memberKey, reason: 'NO_PROFILE' });
      continue;
    }
    let matches = true;
    for (const capability of requiredSet) {
      if (!capabilities.has(capability)) { matches = false; break; }
    }
    if (!matches) {
      excluded.push({ memberKey, reason: 'CAPABILITY_MISMATCH' });
      continue;
    }
    if (occupied.has(memberKey)) {
      excluded.push({ memberKey, reason: 'CAPACITY_FULL' });
      continue;
    }
    recommended.push(memberKey);
  }

  recommended.sort(compareKeys);
  excluded.sort((a, b) => compareKeys(a.memberKey, b.memberKey) || compareKeys(a.reason, b.reason));
  return { recommended, excluded };
}
