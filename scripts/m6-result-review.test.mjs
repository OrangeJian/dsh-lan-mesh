// Regression tests for the standalone M6 result-review decision evaluator.
// Scope: local, deterministic computation only -- no reducer, store, protocol,
// tools, coordinator, dispatch/start/wake, real M6 enablement, or execution
// creation is involved. Snapshots below are synthetic read-only inputs.
// Draft basis: docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md §4.5
// and frozen architecture docs/agent-team-v0.2-design.md:41,43,51.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateResultReview } from '../lib/m6-result-review.mjs';
// Authoritative hash convention: the module reuses this exact resultHash, so
// these tests pin their references the same way the leader ledger would.
import { resultHash as authoritativeHash } from '../lib/task-result-context.mjs';

const LEADER = 'node-a/leader';
const WORKER = 'node-b/worker';
const hash = authoritativeHash;
const result = (over = {}) => ({
  status: 'succeeded',
  summary: 'Built candidate artifact',
  artifacts: [{ type: 'file', value: 'C:/worker/out.txt' }],
  ...over,
});
const team = (over = {}) => ({ roomId: 'r1', leaderKey: LEADER, generation: 1, revision: 3, paused: false, ...over });
const task = (over = {}) => ({ taskId: 't1', roomId: 'r1', status: 'review', currentExecutionId: 'e1', revision: 5, ...over });
const execution = (over = {}) => ({
  executionId: 'e1', taskId: 't1', roomId: 'r1', generation: 1,
  attempt: 2, workerKey: WORKER, state: 'succeeded', result: result(), ...over,
});
const snap = (over = {}) => ({ team: team(), task: task(), executions: { e1: execution() }, ...over });
// The proposal never self-reports identity; actorKey is a separate trusted input.
const intent = (over = {}) => ({
  decision: 'accepted',
  generation: 1,
  reviewedExecutionId: 'e1',
  resultHash: hash(result()),
  ...over,
});
const run = (over = {}, base = snap(), actorKey = LEADER) =>
  evaluateResultReview({ ...base, actorKey, intent: intent(over) });

// ---- Happy paths ----

test('current leader accepts the current review execution at its fixed hash', () => {
  const input = { ...snap(), actorKey: LEADER, intent: intent() };
  const before = structuredClone(input);
  const out = evaluateResultReview(input);

  assert.equal(out.ok, true);
  assert.equal(out.decision, 'accepted');
  assert.deepEqual(out.codes, []);
  assert.equal(out.producesExecution, false);
  assert.equal(out.redoRequiresNewExecutionId, false);
  assert.deepEqual(input, before, 'authoritative snapshots must not be mutated');
  assert.deepEqual(evaluateResultReview(input), out, 'output must be deterministic');
});

test('audit record pins trusted leader, generation, execution, hash and decision without creating an execution', () => {
  const out = run();
  assert.equal(out.record.roomId, 'r1');
  assert.equal(out.record.taskId, 't1');
  assert.equal(out.record.leaderKey, LEADER);
  assert.equal(out.record.actorKey, LEADER);
  assert.equal(out.record.generation, 1);
  assert.equal(out.record.reviewedExecutionId, 'e1');
  assert.equal(out.record.resultHash, hash(result()));
  assert.equal(out.record.decision, 'accepted');
  assert.equal(out.record.producesExecution, false);
  assert.ok(!Object.hasOwn(out.record, 'newExecutionId'), 'no execution id may be created here');
});

test('leader rejects with a recorded reason; redo requires a later independent execution id', () => {
  const out = run({ decision: 'rejected', reason: 'artifact path outside workspace' });
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'rejected');
  assert.equal(out.reason, 'artifact path outside workspace');
  assert.equal(out.record.reason, 'artifact path outside workspace');
  assert.equal(out.producesExecution, false);
  assert.equal(out.redoRequiresNewExecutionId, true);
});

// ---- Trusted identity / impersonation ----

test('non-leader trusted caller is rejected even with a correct fixed result reference', () => {
  const out = run({}, snap(), WORKER);
  assert.equal(out.ok, false);
  assert.equal(out.decision, null);
  assert.equal(out.record, null);
  assert.ok(out.codes.includes('NOT_CURRENT_LEADER'));
  assert.equal(out.producesExecution, false);
});

test('intent self-reported actorKey cannot impersonate the leader', () => {
  // The proposal claims the leader identity, but the trusted caller is a worker.
  const out = run({ actorKey: LEADER }, snap(), WORKER);
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('NOT_CURRENT_LEADER'));
  assert.equal(out.record, null);
});

test('trusted caller identity wins over a different self-reported intent actor', () => {
  // The proposal claims a worker, but the trusted caller is the real leader.
  const out = run({ actorKey: WORKER }, snap(), LEADER);
  assert.equal(out.ok, true);
  assert.equal(out.record.actorKey, LEADER, 'record must use the trusted actorKey, not the intent value');
});

// ---- Authority / generation / current-execution fences ----

test('stale generation is rejected', () => {
  const out = run({ generation: 0 });
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('STALE_GENERATION'));
});

test('an old (non-current) result is rejected even if its hash is valid', () => {
  // Task has moved on to execution e2; e1 is an old result.
  const base = snap({ task: task({ currentExecutionId: 'e2', status: 'review' }) });
  const out = run({}, base);
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('STALE_RESULT'));
});

test('an old-generation execution cannot decide the current task', () => {
  const base = snap({ executions: { e1: execution({ generation: 0 }) } });
  const out = run({}, base);
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('STALE_GENERATION'));
});

test('a result only decides while the task is in review', () => {
  for (const status of ['ready', 'active', 'accepted', 'blocked', 'failed', 'cancelled']) {
    const out = run({}, snap({ task: task({ status }) }));
    assert.equal(out.ok, false, `status=${status}`);
    assert.ok(out.codes.includes('NOT_IN_REVIEW'), `status=${status}`);
  }
});

// ---- Tampering / unfixed references ----

test('a tampered result hash is rejected', () => {
  const out = run({ resultHash: 'f'.repeat(64) });
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('RESULT_HASH_MISMATCH'));
});

test('a tampered authoritative result payload is rejected against the pinned hash', () => {
  const pinned = hash(result());
  const tampered = result({ summary: 'TAMPERED' });
  const base = snap({ executions: { e1: execution({ result: tampered }) } });
  const out = run({ resultHash: pinned }, base);
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('RESULT_HASH_MISMATCH'));
});

test('unfixed references are rejected: missing/invalid executionId and hash', () => {
  const cases = [
    [{ reviewedExecutionId: '' }, 'UNFIXED_EXECUTION_REF'],
    [{ reviewedExecutionId: undefined }, 'UNFIXED_EXECUTION_REF'],
    [{ reviewedExecutionId: 'bad id!' }, 'UNFIXED_EXECUTION_REF'],
    [{ resultHash: '' }, 'UNFIXED_HASH_REF'],
    [{ resultHash: 'ABC' }, 'UNFIXED_HASH_REF'],
    [{ resultHash: undefined }, 'UNFIXED_HASH_REF'],
  ];
  for (const [over, code] of cases) {
    const out = run(over);
    assert.equal(out.ok, false, JSON.stringify(over));
    assert.ok(out.codes.includes(code), `expected ${code} for ${JSON.stringify(over)}`);
  }
});

test('a missing execution snapshot or out-of-scope execution is rejected', () => {
  const missing = run({}, snap({ executions: {} }));
  assert.equal(missing.ok, false);
  assert.ok(missing.codes.includes('EXECUTION_NOT_FOUND'));

  const wrongTask = run({}, snap({ executions: { e1: execution({ taskId: 'other' }) } }));
  assert.equal(wrongTask.ok, false);
  assert.ok(wrongTask.codes.includes('EXECUTION_SCOPE_MISMATCH'));

  const wrongRoom = run({}, snap({ executions: { e1: execution({ roomId: 'other' }) } }));
  assert.equal(wrongRoom.ok, false);
  assert.ok(wrongRoom.codes.includes('EXECUTION_SCOPE_MISMATCH'));
});

test('a keyed execution whose entry key disagrees with its explicit executionId is rejected', () => {
  const out = run({}, snap({ executions: { e1: execution({ executionId: 'e2' }) } }));
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('BAD_EXECUTIONS'), 'a mismatched key/id must not be silently overridden');
  assert.equal(out.record, null);
});

// ---- Decision / reason integrity ----

test('reject decision requires a non-empty reason within limit', () => {
  assert.ok(run({ decision: 'rejected' }).codes.includes('MISSING_REASON'));
  assert.ok(run({ decision: 'rejected', reason: '   ' }).codes.includes('MISSING_REASON'));
  assert.ok(run({ decision: 'rejected', reason: 'x'.repeat(4001) }).codes.includes('BAD_REASON'));
  assert.equal(run({ decision: 'rejected', reason: 'clear reason' }).ok, true);
});

test('unknown decision is rejected', () => {
  const out = run({ decision: 'maybe' });
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('BAD_DECISION'));
});

test('only a succeeded execution result is reviewable', () => {
  for (const state of ['queued', 'acknowledged', 'running', 'uncertain', 'failed', 'cancelled']) {
    const out = run({}, snap({ executions: { e1: execution({ state }) } }));
    assert.equal(out.ok, false, `state=${state}`);
    assert.ok(out.codes.includes('RESULT_NOT_REVIEWABLE'), `state=${state}`);
  }
});

test('free-form checks are not persisted into the audit record', () => {
  const out = run({ checks: [{ arbitrary: { nested: 'caller object' } }] });
  assert.equal(out.ok, true, 'an unused field must not change the decision');
  assert.ok(!Object.hasOwn(out.record, 'checks'), 'no arbitrary object may enter a ledger-bound record');
});

// ---- Fail-closed structural inputs ----

test('fail-closed when an authoritative snapshot is absent', () => {
  const cases = [
    [{ actorKey: LEADER, task: task(), executions: {}, intent: intent() }, 'MISSING_TEAM'],
    [{ actorKey: LEADER, team: team(), executions: {}, intent: intent() }, 'MISSING_TASK'],
    [{ actorKey: LEADER, team: team(), task: task(), intent: intent() }, 'MISSING_EXECUTIONS'],
    [{ actorKey: LEADER, team: team(), task: task(), executions: {} }, 'MISSING_INTENT'],
  ];
  for (const [over, code] of cases) {
    const out = evaluateResultReview(over);
    assert.equal(out.ok, false);
    assert.ok(out.codes.includes(code), `expected ${code}`);
    assert.equal(out.record, null);
  }
});

test('fail-closed when the trusted caller identity is absent or malformed', () => {
  const noActor = evaluateResultReview({ ...snap(), intent: intent() });
  assert.equal(noActor.ok, false);
  assert.ok(noActor.codes.includes('MISSING_ACTOR'));

  const badActor = evaluateResultReview({ ...snap(), actorKey: 'not-a-member', intent: intent() });
  assert.equal(badActor.ok, false);
  assert.ok(badActor.codes.includes('BAD_ACTOR'));
});

test('team/task referenced to different rooms cannot decide', () => {
  const out = run({}, snap({ task: task({ roomId: 'other' }) }));
  assert.equal(out.ok, false);
  assert.ok(out.codes.includes('TASK_TEAM_MISMATCH'));
});

// ---- Determinism / convention / deferred decisions ----

test('codes are sorted and deduplicated; output independent of snapshot container form', () => {
  const bad = run({ generation: 9, decision: 'rejected' }, snap(), WORKER);
  assert.deepEqual(bad.codes, [...new Set(bad.codes)].sort());

  const asObject = run();
  const asArray = evaluateResultReview({ ...snap({ executions: [execution()] }), actorKey: LEADER, intent: intent() });
  assert.deepEqual(asArray, asObject, 'array and keyed snapshot forms must agree');
});

test('canonical hash convention matches the authoritative resultHash', () => {
  // Builds the pinned reference exactly as the leader ledger would.
  const pinned = hash(result());
  assert.equal(pinned, hash({ artifacts: result().artifacts, summary: result().summary, status: result().status }));
  assert.equal(run({ resultHash: pinned }).ok, true);
});

test('D8 double-sign is not pre-decided: an extra signature field neither helps nor blocks', () => {
  const withSign = run({ secondSignature: 'human-2' });
  const withoutSign = run();
  assert.equal(withSign.ok, withoutSign.ok);
  assert.deepEqual(withSign, withoutSign, 'the module must not gate on a second signature');
  assert.ok(run().pendingDecisions.some(s => s.includes('D8')), 'D8 must be reported as pending');
});
