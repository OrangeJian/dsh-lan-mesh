// M6 Owner plan panel: list, exact version read, draft submit and explicit
// approval. These tests exercise the real component with the real view model;
// the Host calls are stubs, so every revision/fingerprint the panel shows must
// come from a stub response, never from a locally computed value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnerPlanPanel } from '../ui/tasks/owner-plan-panel.mjs';
import {
  ownerPlanPanelModel,
  ownerPlanRows,
  ownerPlanApprovalPrompt,
  ownerPlanErrorText,
  ownerPlanFingerprintShort,
  parseOwnerPlanTasks,
} from '../ui/models/owner-plan-panel.mjs';

const ROOM = 'room-1';
const OTHER_ROOM = 'room-2';
const FP1 = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);

const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() });
const all = node => (node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(all)] : []);
const text = node => (typeof node === 'string' ? node : (node?.children ?? []).map(text).join(' '));
const withClass = (tree, name) => all(tree).find(node => typeof node?.props?.className === 'string' && node.props.className.split(' ').includes(name));

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

function createApp(initialProps) {
  const states = [];
  const refs = [];
  const effects = [];
  let cursor = 0;
  let queued = [];
  let props = initialProps;
  let tree = null;
  const React = {
    useState(initial) {
      const at = cursor++;
      if (!(at in states)) states[at] = typeof initial === 'function' ? initial() : initial;
      return [states[at], next => { states[at] = typeof next === 'function' ? next(states[at]) : next; }];
    },
    useRef(initial) {
      const at = cursor++;
      if (!(at in refs)) refs[at] = { current: initial };
      return refs[at];
    },
    useEffect(fn, deps) {
      const at = cursor++;
      const previous = effects[at];
      if (previous && sameDeps(previous.deps, deps)) {
        previous.fn = fn;
        return;
      }
      const cleanup = previous?.cleanup;
      effects[at] = { deps, fn, cleanup };
      queued.push({ at, cleanup });
    },
  };
  function render(next) {
    if (next) props = next;
    cursor = 0;
    queued = [];
    tree = OwnerPlanPanel({ h, React, model: ownerPlanPanelModel, ...props });
    for (const entry of queued) {
      if (typeof entry.cleanup === 'function') entry.cleanup();
      effects[entry.at].cleanup = effects[entry.at].fn();
    }
    return tree;
  }
  return { render, get tree() { return tree; } };
}

const wait = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle(app) {
  for (let index = 0; index < 6; index += 1) await wait();
  app.render();
  for (let index = 0; index < 4; index += 1) await wait();
  app.render();
}

function fixtureCall(handlers) {
  const calls = { teamOverview: [], planList: [], planRead: [], planSubmit: [], planApprove: [] };
  const call = async (method, payload) => {
    if (!(method in calls)) throw new Error('unexpected endpoint ' + method);
    calls[method].push(payload);
    const handler = handlers[method];
    if (typeof handler === 'function') return handler(payload, calls);
    if (handler !== undefined) return handler;
    throw Object.assign(new Error('no stub for ' + method), { code: 'NOT_READY' });
  };
  return { call, calls };
}

function planFixture(overrides) {
  return Object.assign({
    planId: 'plan-1',
    roomId: ROOM,
    generation: 3,
    revision: 2,
    fingerprint: FP1,
    tasks: [{ taskId: 'A', roomId: ROOM, dependsOn: [], requiredCapabilities: ['build'], title: 'A', detail: 'a' }],
    approval: null,
    requests: {},
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }, overrides);
}

function overviewFixture(overrides) {
  return Object.assign({
    known: true,
    scope: 'local',
    roomId: ROOM,
    status: 'active',
    revision: 1,
    generation: 3,
    taskCounts: {},
    executionCounts: {},
  }, overrides);
}

function forbidden() {
  return Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
}

function typePlanId(app, value) {
  withClass(app.tree, 'lm-ownerPlanPlanId').props.onChange({ target: { value } });
  app.render();
}

function typeTasks(app, value) {
  withClass(app.tree, 'lm-ownerPlanTasksInput').props.onChange({ target: { value } });
  app.render();
}

function submitForm(app) {
  withClass(app.tree, 'lm-ownerPlanForm').props.onSubmit({ preventDefault() {} });
}

test('model keeps the approval prompt and rows bound to server fields', () => {
  const prompt = ownerPlanApprovalPrompt({ planId: 'plan-9', revision: 11, fingerprint: FP1 });
  assert.ok(prompt.includes('plan-9'));
  assert.ok(prompt.includes('版本 11'));
  assert.ok(prompt.includes(FP1));
  assert.equal(ownerPlanFingerprintShort(FP1), FP1.slice(0, 12) + '…');
  assert.match(ownerPlanErrorText('REVISION_CONFLICT'), /重新读取/);
  assert.match(ownerPlanErrorText('FORBIDDEN'), /无权/);
  const rows = ownerPlanRows([
    planFixture({ planId: 'b', updatedAt: '2026-11-02T00:00:00.000Z' }),
    planFixture({ planId: 'a', updatedAt: '2026-11-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(rows.map(row => row.planId), ['b', 'a']);
  assert.equal(rows[0].taskCount, 1);
  assert.equal(rows[0].approved, false);
  assert.deepEqual(parseOwnerPlanTasks('[{"taskId":"A"}]'), [{ taskId: 'A' }]);
  assert.throws(() => parseOwnerPlanTasks('{'), error => error.code === 'BAD_REQUEST');
  assert.throws(() => parseOwnerPlanTasks('{}'), error => error.code === 'BAD_REQUEST');
  assert.throws(() => parseOwnerPlanTasks('[1]'), error => error.code === 'BAD_REQUEST');
});

test('owner panel lists plans and reads the exact version on selection', async () => {
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    planList: [planFixture()],
    planRead: planFixture(),
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  const listed = text(app.tree);
  assert.ok(listed.includes('plan-1'));
  assert.ok(listed.includes('版本 2'));
  assert.ok(listed.includes('未批准'));

  withClass(app.tree, 'lm-ownerPlanRow').props.onClick();
  await settle(app);
  assert.deepEqual(calls.planRead, [{ roomId: ROOM, planId: 'plan-1' }]);
  const detail = text(app.tree);
  assert.ok(detail.includes(FP1), 'the full server fingerprint is shown');
  assert.ok(detail.includes('版本 2'));
  assert.ok(detail.includes('代次 3'));
  assert.ok(withClass(app.tree, 'lm-ownerPlanApprove'));
});

test('draft submit shows the server revision and fingerprint, not a local guess', async () => {
  let submitted = false;
  const stored = planFixture({ planId: 'plan-new', revision: 7, fingerprint: FP2, tasks: [] });
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    planList: () => (submitted ? [stored] : []),
    planRead: () => stored,
    planSubmit: () => {
      submitted = true;
      return { planId: 'plan-new', roomId: ROOM, generation: 3, revision: 7, fingerprint: FP2, approved: false };
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  typePlanId(app, 'plan-new');
  typeTasks(app, '[{"taskId":"A","roomId":"room-1","dependsOn":[],"requiredCapabilities":["build"],"title":"A","detail":"a"}]');
  submitForm(app);
  await settle(app);

  assert.equal(calls.planSubmit.length, 1);
  const payload = calls.planSubmit[0];
  assert.equal(payload.roomId, ROOM);
  assert.equal(payload.planId, 'plan-new');
  assert.equal(payload.expectedRevision, 0);
  assert.equal(payload.expectedGeneration, 3);
  assert.equal(payload.tasks[0].taskId, 'A');
  assert.equal(typeof payload.requestId, 'string');
  const shown = text(app.tree);
  assert.ok(shown.includes('服务端已保存草稿：版本 7'));
  assert.ok(shown.includes(FP2), 'the panel shows the fingerprint returned by the server');
  assert.ok(shown.includes('版本 7'));
});

test('approval requires confirming the exact displayed version and fingerprint', async () => {
  let approved = false;
  const approvalRecord = {
    planId: 'plan-1', roomId: ROOM, generation: 3, revision: 2,
    fingerprint: FP1, actorKey: 'node-local/human',
    approvedAt: '2026-11-19T00:00:00.000Z', requestId: 'req-approved',
  };
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    planList: [planFixture()],
    planRead: () => planFixture({ approval: approved ? approvalRecord : null }),
    planApprove: () => {
      approved = true;
      return approvalRecord;
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  withClass(app.tree, 'lm-ownerPlanRow').props.onClick();
  await settle(app);
  assert.equal(calls.planApprove.length, 0);

  withClass(app.tree, 'lm-ownerPlanApprove').props.onClick();
  app.render();
  const confirm = text(withClass(app.tree, 'lm-ownerPlanConfirm'));
  assert.ok(confirm.includes('版本 2'));
  assert.ok(confirm.includes(FP1));
  assert.equal(calls.planApprove.length, 0, 'showing the confirmation must not send an approval');

  withClass(app.tree, 'lm-ownerPlanConfirmBtn').props.onClick();
  await settle(app);
  assert.equal(calls.planApprove.length, 1);
  assert.deepEqual(calls.planApprove[0], {
    requestId: calls.planApprove[0].requestId,
    roomId: ROOM,
    planId: 'plan-1',
    expectedRevision: 2,
    expectedGeneration: 3,
    fingerprint: FP1,
  });
  const done = text(app.tree);
  assert.ok(done.includes('已批准版本 2'));
  assert.ok(done.includes(FP1));
  assert.equal(withClass(app.tree, 'lm-ownerPlanApprove'), undefined, 'an approved version has no approve button');
});

test('an approval version conflict re-reads the current version and never retries the write', async () => {
  let reads = 0;
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    planList: [planFixture()],
    planRead: () => {
      reads += 1;
      return reads === 1 ? planFixture() : planFixture({ revision: 4, fingerprint: FP2 });
    },
    planApprove: () => {
      throw Object.assign(new Error('binding mismatch'), { code: 'APPROVAL_BINDING_MISMATCH' });
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  withClass(app.tree, 'lm-ownerPlanRow').props.onClick();
  await settle(app);
  withClass(app.tree, 'lm-ownerPlanApprove').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerPlanConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.planApprove.length, 1, 'no silent approval retry');
  assert.equal(calls.planRead.length, 2, 'the conflict re-reads the exact plan');
  const shown = text(app.tree);
  assert.ok(shown.includes(FP2));
  assert.ok(shown.includes('版本 4'));
  assert.ok(shown.includes('原确认已失效'));
  assert.equal(withClass(app.tree, 'lm-ownerPlanConfirmBtn'), undefined, 'the old confirmation is discarded');
});

test('a submit revision conflict re-reads and reports that it did not auto-retry', async () => {
  const fresh = planFixture({ planId: 'plan-new', revision: 5, fingerprint: FP2, tasks: [] });
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    planList: [],
    planRead: fresh,
    planSubmit: () => {
      throw Object.assign(new Error('revision conflict'), { code: 'REVISION_CONFLICT' });
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  typePlanId(app, 'plan-new');
  typeTasks(app, '[{"taskId":"A","roomId":"room-1","dependsOn":[],"requiredCapabilities":[],"title":"A"}]');
  submitForm(app);
  await settle(app);

  assert.equal(calls.planSubmit.length, 1, 'no silent submit retry');
  assert.equal(calls.planRead.length, 1);
  assert.equal(calls.planRead[0].planId, 'plan-new');
  const shown = text(app.tree);
  assert.ok(shown.includes('不会自动重试'));
  assert.ok(shown.includes(FP2));
  assert.ok(shown.includes('期望版本 5'), 'the expected revision now reflects the re-read version');
});

test('revocation mid-approval surfaces the server denial and removes the actions', async () => {
  let revoked = false;
  const { call, calls } = fixtureCall({
    teamOverview: () => {
      if (revoked) throw forbidden();
      return overviewFixture();
    },
    planList: () => {
      if (revoked) throw forbidden();
      return [planFixture()];
    },
    planRead: planFixture(),
    planApprove: () => {
      revoked = true;
      throw forbidden();
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  withClass(app.tree, 'lm-ownerPlanRow').props.onClick();
  await settle(app);
  withClass(app.tree, 'lm-ownerPlanApprove').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerPlanConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.planApprove.length, 1);
  const shown = text(app.tree);
  assert.ok(shown.includes('无权'));
  assert.equal(withClass(app.tree, 'lm-ownerPlanApprove'), undefined);
  assert.equal(withClass(app.tree, 'lm-ownerPlanSubmit'), undefined);
});

test('a room switch during a pending submit drops every follow-up read for the old room', async () => {
  let releaseSubmit;
  const pending = new Promise(resolve => { releaseSubmit = resolve; });
  const planA = planFixture({ planId: 'plan-a', roomId: ROOM });
  const planB = planFixture({ planId: 'plan-b', roomId: OTHER_ROOM });
  const { call, calls } = fixtureCall({
    teamOverview: payload => overviewFixture({ roomId: payload.roomId, generation: payload.roomId === ROOM ? 3 : 4 }),
    planList: payload => (payload.roomId === ROOM ? [planA] : [planB]),
    planRead: payload => planFixture({ planId: payload.planId, roomId: payload.roomId }),
    planSubmit: () => pending,
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  typePlanId(app, 'plan-a');
  typeTasks(app, '[{"taskId":"A"}]');
  submitForm(app);

  app.render({ h, call, roomId: OTHER_ROOM });
  await settle(app);
  releaseSubmit({ planId: 'plan-a', roomId: ROOM, generation: 3, revision: 6, fingerprint: FP2, approved: false });
  await settle(app);

  assert.deepEqual(calls.planList.map(payload => payload.roomId), [ROOM, OTHER_ROOM]);
  assert.equal(calls.planRead.length, 0, 'the pending submit must not re-read the old room');
  assert.ok(!text(app.tree).includes(FP2), 'the old room result never reaches the new room');
  assert.ok(text(app.tree).includes('plan-b'));
});

test('switching rooms discards the previous room plan list and its late response', async () => {
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const planA = planFixture({ planId: 'plan-a', roomId: ROOM });
  const planB = planFixture({ planId: 'plan-b', roomId: OTHER_ROOM });
  const { call, calls } = fixtureCall({
    teamOverview: payload => overviewFixture({ roomId: payload.roomId, generation: payload.roomId === ROOM ? 3 : 4 }),
    planList: payload => (payload.roomId === ROOM ? first : [planB]),
    planRead: payload => planFixture({ planId: payload.planId, roomId: payload.roomId }),
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  app.render({ h, call, roomId: OTHER_ROOM });
  await settle(app);
  assert.ok(text(app.tree).includes('plan-b'));
  assert.ok(!text(app.tree).includes('plan-a'));

  releaseFirst([planA]);
  await settle(app);
  assert.ok(!text(app.tree).includes('plan-a'), 'the late answer for the old room is ignored');
  assert.ok(text(app.tree).includes('plan-b'));
  assert.deepEqual(calls.planList.map(payload => payload.roomId), [ROOM, OTHER_ROOM]);
  assert.equal(calls.planRead.length, 0);
});
