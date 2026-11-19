// M6 Owner fixed-result review panel: exact executionId + resultHash, explicit
// accept and reject-with-reason through the resultAccept/resultReject entries.
// The real component and view model run here; Host calls are stubs, so every
// reference the panel displays or sends must come from a stub response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnerResultPanel } from '../ui/tasks/owner-result-panel.mjs';
import {
  ownerResultPanelModel,
  ownerResultRows,
  ownerResultDecisionPrompt,
  ownerResultErrorText,
  ownerResultHashShort,
  ownerResultConflict,
} from '../ui/models/owner-result-panel.mjs';
import { MeshNode } from '../lib/service.mjs';
import { resultHash } from '../lib/task-result-context.mjs';

const ROOM = 'room-1';
const OTHER_ROOM = 'room-2';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

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
    if (next) props = { ...props, ...next };
    cursor = 0;
    queued = [];
    tree = OwnerResultPanel({ h, React, model: ownerResultPanelModel, ...props });
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fixtureCall(handlers) {
  const calls = { teamOverview: [], resultAccept: [], resultReject: [] };
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

function refFixture(overrides) {
  return Object.assign({
    taskId: 't1',
    executionId: 'e1',
    generation: 3,
    resultHash: H1,
    reviewStatus: 'review',
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
    taskCounts: { review: 1 },
    executionCounts: { succeeded: 1 },
    resultRefs: [refFixture()],
  }, overrides);
}

function recordFixture(overrides) {
  return Object.assign({
    roomId: ROOM,
    taskId: 't1',
    leaderKey: 'node-local/human',
    actorKey: 'node-local/human',
    generation: 3,
    reviewedExecutionId: 'e1',
    resultHash: H1,
    decision: 'accepted',
    reason: null,
  }, overrides);
}

function acceptReply(overrides) {
  const record = recordFixture(overrides);
  return { ok: true, decision: record.decision, reason: record.reason, replayed: false, record, requestId: 'req', codes: [] };
}

async function selectFirst(app) {
  const rows = all(app.tree).filter(node => typeof node?.props?.className === 'string' && node.props.className.split(' ').includes('lm-ownerResultRow'));
  assert.equal(rows.length, 1);
  rows[0].props.onClick();
  app.render();
}

test('model rows keep only server fields and mark partial rows as not actionable', () => {
  assert.equal(ownerResultHashShort(H1), H1.slice(0, 12) + '…');
  assert.match(ownerResultErrorText('STALE_GENERATION'), /代次/);
  assert.match(ownerResultErrorText('FORBIDDEN'), /无权/);
  assert.match(ownerResultErrorText('MISSING_REASON'), /原因/);
  assert.equal(ownerResultConflict('STALE_GENERATION'), true);
  assert.equal(ownerResultConflict('EXECUTION_NOT_FOUND'), true);
  assert.equal(ownerResultConflict('MISSING_REASON'), false);
  assert.equal(ownerResultConflict('FORBIDDEN'), false);

  const prompt = ownerResultDecisionPrompt({ taskId: 't9', executionId: 'e9', resultHash: H2 }, 'accepted');
  assert.ok(prompt.includes('t9'));
  assert.ok(prompt.includes('e9'));
  assert.ok(prompt.includes(H2));
  assert.ok(ownerResultDecisionPrompt({ taskId: 't9', executionId: 'e9', resultHash: H2 }, 'rejected').includes('拒绝'));

  const rows = ownerResultRows([
    refFixture({ taskId: 'b', executionId: 'e2', reviewStatus: 'accepted' }),
    refFixture({ taskId: 'a', executionId: 'e3', generation: undefined }),
    refFixture({ taskId: 'a', executionId: 'e1' }),
    null,
  ]);
  assert.deepEqual(rows.map(row => row.executionId), ['e1', 'e3']);
  assert.equal(rows[0].actionable, true);
  assert.equal(rows[0].reviewable, true);
  assert.equal(rows[1].actionable, false, 'a missing generation cannot be invented');
  assert.equal(rows[1].reviewable, true);
});

test('owner overview projects exactly the task, execution, generation and hash a decision pins', async () => {
  const node = new MeshNode({ config: { teamEnabled: true } });
  node.started = true;
  node.identity = { nodeId: 'node-local' };
  const room = { id: 'room-projection', leader: { key: 'node-local/human' }, members: [{ key: 'node-local/human' }] };
  node.roomsDoc.rooms[room.id] = room;
  const result = { status: 'succeeded', summary: 'Built candidate artifact', artifacts: [] };
  node.team = {
    store: {
      read: () => ({
        teams: { [room.id]: { revision: 2, generation: 1 } },
        tasks: {
          t1: { roomId: room.id, status: 'review', currentExecutionId: 'e1', detail: 'private path' },
          t2: { roomId: room.id, status: 'review', currentExecutionId: 'e2' },
        },
        executions: {
          e1: { executionId: 'e1', roomId: room.id, taskId: 't1', workerKey: 'node-a/worker', generation: 1, attempt: 1, state: 'succeeded', result },
        },
      }),
    },
  };
  const view = await node.ownerTeamOverview(room.id);
  assert.deepEqual(view.resultRefs, [{
    taskId: 't1',
    executionId: 'e1',
    generation: 1,
    resultHash: resultHash(result),
    reviewStatus: 'review',
  }]);
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /Built candidate artifact/);
  assert.doesNotMatch(serialized, /private path/);
  room.leader.key = 'foreign/human';
  await assert.rejects(node.ownerTeamOverview(room.id), { code: 'FORBIDDEN' });
});

test('panel lists only review rows and shows the exact execution id and full hash', async () => {
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture({
      resultRefs: [refFixture(), refFixture({ taskId: 't0', executionId: 'e0', reviewStatus: 'accepted' })],
    }),
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);

  assert.deepEqual(calls.teamOverview, [{ roomId: ROOM }]);
  const listed = text(app.tree);
  assert.ok(listed.includes('t1'));
  assert.ok(!listed.includes('e0'), 'accepted results are not offered for review');
  await selectFirst(app);
  const detail = text(app.tree);
  assert.ok(detail.includes('e1'));
  assert.ok(detail.includes(H1), 'the full server hash is shown');
  assert.ok(withClass(app.tree, 'lm-ownerResultAccept'));
  assert.ok(withClass(app.tree, 'lm-ownerResultReject'));
});

test('accept requires confirming the exact displayed execution and hash', async () => {
  let accepted = false;
  const { call, calls } = fixtureCall({
    teamOverview: () => overviewFixture({ resultRefs: accepted ? [] : [refFixture()] }),
    resultAccept: () => {
      accepted = true;
      return acceptReply();
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);

  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  assert.equal(calls.resultAccept.length, 0, 'nothing is sent before the exact confirmation');
  assert.ok(text(app.tree).includes(H1));
  assert.ok(text(app.tree).includes('确认接受任务 t1 的执行 e1'));

  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.resultAccept.length, 1);
  const payload = calls.resultAccept[0];
  assert.equal(payload.roomId, ROOM);
  assert.equal(payload.taskId, 't1');
  assert.equal(payload.executionId, 'e1');
  assert.equal(payload.resultHash, H1);
  assert.equal(payload.generation, 3);
  assert.equal(typeof payload.requestId, 'string');
  assert.equal(Object.hasOwn(payload, 'reason'), false, 'an accept never carries a reason');
  assert.ok(text(app.tree).includes('已接受任务 t1 的执行 e1'));
  assert.ok(text(app.tree).includes(H1));
  assert.equal(withClass(app.tree, 'lm-ownerResultRow'), undefined, 'the accepted execution leaves the queue');
});

test('reject requires a non-empty reason and pins the same reference', async () => {
  let rejected = false;
  const { call, calls } = fixtureCall({
    teamOverview: () => overviewFixture({ resultRefs: rejected ? [] : [refFixture()] }),
    resultReject: () => {
      rejected = true;
      return acceptReply({ decision: 'rejected', reason: 'artifact mismatch' });
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);

  withClass(app.tree, 'lm-ownerResultReject').props.onClick();
  app.render();
  assert.equal(withClass(app.tree, 'lm-ownerResultConfirmBtn').props.disabled, true, 'an empty reason cannot confirm');
  const reasonInput = withClass(app.tree, 'lm-ownerResultReason');
  reasonInput.props.onChange({ target: { value: '   ' } });
  app.render();
  assert.equal(withClass(app.tree, 'lm-ownerResultConfirmBtn').props.disabled, true, 'a blank reason cannot confirm');
  reasonInput.props.onChange({ target: { value: '  artifact mismatch  ' } });
  app.render();
  assert.equal(withClass(app.tree, 'lm-ownerResultConfirmBtn').props.disabled, false);

  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.resultReject.length, 1);
  assert.equal(calls.resultReject[0].reason, 'artifact mismatch');
  assert.equal(calls.resultReject[0].executionId, 'e1');
  assert.equal(calls.resultReject[0].resultHash, H1);
  assert.equal(calls.resultAccept.length, 0);
  assert.ok(text(app.tree).includes('已拒绝任务 t1 的执行 e1'));
});

test('a result from an old Team generation is shown but cannot be decided', async () => {
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture({ generation: 4, resultRefs: [refFixture({ generation: 3 })] }),
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);

  assert.ok(text(app.tree).includes('旧 Team 代次'));
  assert.equal(withClass(app.tree, 'lm-ownerResultAccept'), undefined);
  assert.equal(withClass(app.tree, 'lm-ownerResultReject'), undefined);
  assert.equal(calls.resultAccept.length, 0);
  assert.equal(calls.resultReject.length, 0);
});

test('a stale-generation refusal re-reads the current overview and never retries blindly', async () => {
  let attempts = 0;
  const { call, calls } = fixtureCall({
    teamOverview: () => overviewFixture({ generation: attempts === 0 ? 3 : 4, resultRefs: attempts === 0 ? [refFixture()] : [] }),
    resultAccept: () => {
      attempts += 1;
      throw Object.assign(new Error('STALE_GENERATION'), { code: 'STALE_GENERATION' });
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);
  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.resultAccept.length, 1, 'the failed request is not resent automatically');
  assert.equal(calls.teamOverview.length, 2, 'the panel re-reads after the fence failure');
  assert.ok(text(app.tree).includes('不会自动重试'));
  assert.equal(withClass(app.tree, 'lm-ownerResultConfirm'), undefined);
});

test('a response that does not bind the confirmed reference is rejected and re-read', async () => {
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    resultAccept: () => acceptReply({ resultHash: H2 }),
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);
  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.ok(text(app.tree).includes('响应与确认的成果不一致'));
  assert.equal(calls.teamOverview.length, 2);
  assert.equal(calls.resultAccept.length, 1);
});

test('the same request id is reused only for the same confirmed intent', async () => {
  let fail = true;
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    resultAccept: () => {
      if (fail) throw Object.assign(new Error('temporary'), { code: 'LAN_MESH_FAILED' });
      return acceptReply();
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);
  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.resultAccept.length, 1);
  assert.ok(text(app.tree).includes('请求失败'), 'the failure stays visible');
  assert.equal(withClass(app.tree, 'lm-ownerResultConfirm'), undefined, 'confirmation is cleared after a failure');

  fail = false;
  await selectFirst(app);
  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.resultAccept.length, 2);
  assert.equal(calls.resultAccept[1].requestId, calls.resultAccept[0].requestId, 'the retry keeps its request id');
  assert.ok(text(app.tree).includes('已接受任务 t1 的执行 e1'));
});

test('a repeated confirm click sends only one request', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { call, calls } = fixtureCall({
    teamOverview: overviewFixture(),
    resultAccept: async () => { await gate; return acceptReply(); },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);
  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  const confirm = withClass(app.tree, 'lm-ownerResultConfirmBtn');
  confirm.props.onClick();
  confirm.props.onClick();
  release();
  await settle(app);

  assert.equal(calls.resultAccept.length, 1);
  assert.ok(text(app.tree).includes('已接受任务 t1 的执行 e1'));
});

test('losing permission shows a denied state and offers no decision', async () => {
  let allowed = true;
  const { call, calls } = fixtureCall({
    teamOverview: () => {
      if (!allowed) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
      return overviewFixture();
    },
    resultAccept: () => {
      allowed = false;
      throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
    },
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  await settle(app);
  await selectFirst(app);
  withClass(app.tree, 'lm-ownerResultAccept').props.onClick();
  app.render();
  withClass(app.tree, 'lm-ownerResultConfirmBtn').props.onClick();
  await settle(app);

  assert.equal(calls.resultAccept.length, 1);
  assert.equal(calls.teamOverview.length, 2, 'a permission failure re-reads instead of assuming');
  assert.ok(text(app.tree).includes('当前无权评审该 Room 的成果'));
  assert.equal(withClass(app.tree, 'lm-ownerResultAccept'), undefined);
  assert.equal(withClass(app.tree, 'lm-ownerResultRow'), undefined);
});

test('switching Rooms drops late answers from the previous Room', async () => {
  const pending = deferred();
  const { call, calls } = fixtureCall({
    teamOverview: payload => (payload.roomId === ROOM ? pending.promise : overviewFixture({ roomId: OTHER_ROOM, resultRefs: [refFixture({ taskId: 't2', executionId: 'e2', resultHash: H2 })] })),
  });
  const app = createApp({ h, call, roomId: ROOM });
  app.render();
  app.render({ roomId: OTHER_ROOM });
  await settle(app);

  const other = text(app.tree);
  assert.ok(other.includes('t2'));
  assert.ok(other.includes('执行 e2'));
  assert.ok(other.includes(ownerResultHashShort(H2)));
  assert.ok(!other.includes('e1'));
  await selectFirst(app);
  assert.ok(text(app.tree).includes(H2), 'the other Room result is bound to its own full hash');

  pending.resolve(overviewFixture());
  await settle(app);
  const latest = text(app.tree);
  assert.ok(latest.includes('t2'), 'the old Room answer must not replace the current list');
  assert.ok(!latest.includes('t1'));
  assert.ok(!latest.includes('e1'));
  assert.deepEqual(calls.teamOverview.map(payload => payload.roomId), [ROOM, OTHER_ROOM]);
});
