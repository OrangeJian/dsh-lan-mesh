// Dedicated tests for the pure M6 plan-record helpers.
// Scope: no I/O, no ledger, no clock, no dispatch/result transitions. Reuses
// the content fingerprint (m6-plan-preview) and DAG (m6-plan-dag) verbatim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFingerprint } from '../lib/m6-plan-preview.mjs';
import {
  preparePlanContent,
  requestIntent,
  submitIntent,
  approveIntent,
  buildApproval,
  verifyPlanRecord,
} from '../lib/m6-plan-ledger.mjs';

const TASKS = [
  { taskId: 'A', roomId: 'room-1', dependsOn: [], requiredCapabilities: ['build'], title: 'A', detail: 'a' },
  { taskId: 'B', roomId: 'room-1', dependsOn: ['A'], requiredCapabilities: ['test'], title: 'B', detail: 'b' },
];

test('preparePlanContent reuses planFingerprint and the DAG validator', () => {
  const out = preparePlanContent(TASKS, 'room-1');
  assert.equal(out.fingerprint, planFingerprint(TASKS));
  assert.deepEqual(out.order, ['A', 'B']);
  // No knownTasks at submit time: only dependency-free tasks are dispatchable;
  // structural validity (ok) is what gates persistence, not dispatchability.
  assert.deepEqual(out.dispatchable, ['A']);
});

test('preparePlanContent rejects cyclic, cross-team and malformed plans', () => {
  const cycle = [
    { taskId: 'A', roomId: 'room-1', dependsOn: ['B'] },
    { taskId: 'B', roomId: 'room-1', dependsOn: ['A'] },
  ];
  assert.throws(() => preparePlanContent(cycle, 'room-1'), e => e.code === 'INVALID_PLAN_GRAPH');
  const crossTeam = [{ taskId: 'A', roomId: 'room-2', dependsOn: [] }];
  assert.throws(() => preparePlanContent(crossTeam, 'room-1'), e => e.code === 'INVALID_PLAN_GRAPH');
  const unknown = [{ taskId: 'A', roomId: 'room-1', dependsOn: ['missing'] }];
  assert.throws(() => preparePlanContent(unknown, 'room-1'), e => e.code === 'INVALID_PLAN_GRAPH');
  const malformed = [{ taskId: 'A', roomId: 42, dependsOn: [] }];
  assert.throws(() => preparePlanContent(malformed, 'room-1'), e => e.code === 'INVALID_PLAN');
  assert.throws(() => preparePlanContent(null, 'room-1'), e => e.code === 'INVALID_PLAN');
});

test('requestIntent is deterministic, key-order invariant and op/field sensitive', () => {
  const fields = { roomId: 'room-1', planId: 'plan-1', expectedRevision: 2, expectedGeneration: 1, fingerprint: 'f'.repeat(64) };
  const a = requestIntent('submit', fields);
  assert.equal(a, requestIntent('submit', { ...fields }));
  assert.equal(a, submitIntent(fields));
  assert.notEqual(a, approveIntent(fields), 'op must be part of the intent');
  assert.notEqual(a, requestIntent('submit', { ...fields, expectedRevision: 3 }));
  assert.notEqual(a, requestIntent('submit', { ...fields, roomId: 'room-2' }));
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('buildApproval binds all five fields and strictly validates inputs', () => {
  const approval = buildApproval({
    planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 3,
    fingerprint: 'f'.repeat(64), actorKey: 'node-a/leader',
    approvedAt: '2026-11-19T00:00:00.000Z', requestId: 'req-1',
  });
  assert.deepEqual(approval, {
    planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 3,
    fingerprint: 'f'.repeat(64), actorKey: 'node-a/leader',
    approvedAt: '2026-11-19T00:00:00.000Z', requestId: 'req-1',
  });
  const base = { planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 3, fingerprint: 'f'.repeat(64), actorKey: 'node-a/leader', approvedAt: 'x', requestId: 'r' };
  assert.throws(() => buildApproval({ ...base, generation: 0 }), e => e.code === 'BAD_REQUEST');
  assert.throws(() => buildApproval({ ...base, fingerprint: 'xyz' }), e => e.code === 'BAD_REQUEST');
  assert.throws(() => buildApproval({ ...base, actorKey: 'bad' }), e => e.code === 'BAD_REQUEST');
});

test('verifyPlanRecord detects recomputed-fingerprint tampering and approval drift', () => {
  const fingerprint = planFingerprint(TASKS);
  const record = {
    planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 1,
    fingerprint, tasks: structuredClone(TASKS),
    approval: null,
    requests: {},
  };
  assert.equal(verifyPlanRecord(record), record);
  const tampered = structuredClone(record);
  tampered.tasks[1].detail = 'changed';
  assert.throws(() => verifyPlanRecord(tampered), e => e.code === 'PLAN_TAMPER');
  const drift = structuredClone(record);
  drift.approval = {
    planId: 'plan-1', roomId: 'room-1', generation: 1, revision: 2, // stale revision
    fingerprint, actorKey: 'node-a/leader', approvedAt: 'x', requestId: 'r',
  };
  assert.throws(() => verifyPlanRecord(drift), e => e.code === 'APPROVAL_BINDING_MISMATCH');
});
