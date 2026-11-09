/**
 * Render the Web panel against a stubbed Host answer.
 *
 * The panel is plain DOM-free React, so a tiny hook runtime is enough to catch
 * the failures a syntax check cannot: an endpoint name the Host does not serve,
 * a field the panel reads but the Host never sends, a pane that renders nothing.
 * It is not a browser: styles, layout and real slot behaviour are out of scope.
 *
 * The two-column panel has state that only exists after a click (a room gets
 * selected, a nav view opens), so this harness also renders, clicks a
 * class-tagged node, and renders again.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() });

/** Hook state survives across renders, the way real hooks do. */
const stateSlots = [];
const effectSlots = [];
const refSlots = [];
let cursor = 0;
let queued = [];

const sameDeps = (a, b) => {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
};

const React = {
  createElement: h,
  Fragment: 'Fragment',
  useState: (initial) => {
    const at = cursor++;
    if (!(at in stateSlots)) stateSlots[at] = typeof initial === 'function' ? initial() : initial;
    const set = (next) => {
      stateSlots[at] = typeof next === 'function' ? next(stateSlots[at]) : next;
    };
    return [stateSlots[at], set];
  },
  useEffect: (fn, deps) => {
    const at = cursor++;
    const previous = effectSlots[at];
    // Same deps as the last render: React would not re-run the effect.
    if (previous !== undefined && sameDeps(previous.deps, deps)) return;
    if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup();
    effectSlots[at] = { deps, cleanup: undefined, fn };
    queued.push(at);
  },
  useCallback: (fn, deps) => {
    const at = cursor++;
    const previous = stateSlots[at];
    if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value;
    stateSlots[at] = { deps, value: fn };
    return fn;
  },
  useMemo: (fn, deps) => {
    const at = cursor++;
    const previous = stateSlots[at];
    if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value;
    const value = fn();
    stateSlots[at] = { deps, value };
    return value;
  },
  useRef: (value) => {
    const at = cursor++;
    if (!(at in refSlots)) refSlots[at] = { current: value };
    return refSlots[at];
  },
};

const store = new Map();
const window = {
  __ModuleLoader__: {
    load: (definition) => {
      window.__loaded = definition;
    },
  },
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  },
  crypto: { randomUUID: () => 'uuid-1' },
};
const document = {
  documentElement: { lang: 'zh', dataset: {} },
  head: { appendChild() {} },
  getElementById: () => undefined,
  createElement: () => ({ set textContent(_value) {}, append() {} }),
};
const require = (name) => {
  if (name === 'react') return React;
  // The panel borrows the shell's Markdown renderer. The stub renders the raw
  // text as a child so `lastText` still sees message bodies, and tags the node
  // so a test can prove the bubble went through the renderer.
  if (name === '@deepseek-ai/dsh-client-ui-primitives')
    return { MarkdownText: (props) => h('div', { className: 'stubMarkdown' }, String(props.text ?? '')) };
  throw new Error(`unexpected require ${name}`);
};

/** One member shape the Host sends; `live` is what the chip shows. */
const member = (nodeId, sessionId, name, role, live, title = '') => ({
  nodeId,
  sessionId,
  name,
  title,
  role,
  key: `${nodeId}/${sessionId}`,
  live,
});

const localAgent = member('node-a', 'session-1', 'echo-worker', 'leader', true, 'Panel polish');
const human = member('node-a', 'human', 'Local node', 'member', true);
const remoteAgent = member('node-b', 'session-9', 'beta-worker', 'member', true, 'Beta rollout');
// A member whose machine went away: the chip must show the idle dot. It shares
// the remote agent's title on purpose: two sessions titled the same must not be
// indistinguishable in the mention picker.
const offlinePeer = member('node-c', 'session-7', 'sleepy-peer', 'member', false, 'Beta rollout');
// A session on this node that was pulled into a room but is absent from the
// agent catalogue: the rail has to build it from the room member instead.
const roomWorker = member('node-a', 'session-4', 'room-worker', 'member', true, 'Room worker');

const leaderRoom = {
  id: 'room-1',
  name: 'Alpha room',
  topic: 'ship the panel',
  role: 'leader',
  isMember: true,
  isLeader: true,
  updatedAt: '2026-01-01T10:00:00.000Z',
  members: [localAgent, human, remoteAgent, offlinePeer],
  tasks: [
    {
      id: 'task-1',
      title: 'Split the panel',
      detail: 'two columns',
      status: 'open',
      assignee: localAgent,
      assigner: localAgent,
      createdAt: '2026-01-01T09:00:00.000Z',
      updatedAt: '2026-01-01T09:00:00.000Z',
    },
  ],
};

const memberRoom = {
  id: 'room-3',
  name: 'Gamma side project',
  topic: '',
  role: 'member',
  isMember: true,
  isLeader: false,
  updatedAt: '2026-01-01T10:00:00.000Z',
  members: [localAgent, roomWorker, remoteAgent],
  tasks: [],
};

const strangerRoom = {
  id: 'room-2',
  name: 'Beta project',
  topic: 'somebody else started it',
  role: '',
  isMember: false,
  isLeader: false,
  updatedAt: '2026-01-01T10:00:00.000Z',
  members: [remoteAgent],
  tasks: [],
};

/** What the Host answers for each panel endpoint. */
const answers = {
  snapshot: {
    self: {
      nodeId: 'node-a',
      name: 'Local node',
      selfName: '建哥',
      port: 45871,
      discoveryPort: 45870,
      peers: 1,
      unread: 0,
      autoWake: true,
      secured: false,
    },
    peers: [],
    // The inbox is what arrived here, plus the node's own copies of what it
    // said into a room. The recipient is always this node, so the pane must
    // name the sender and the room instead of the "sent to" address.
    inbox: {
      unread: 4,
      total: 6,
      messages: [
        {
          id: 'i1',
          kind: 'room-message',
          room: 'room-1',
          // Room envelopes carry the room name in `topic` (not the goal line),
          // so the inbox pill can name the room without a second lookup.
          topic: 'Alpha room',
          from: { nodeId: 'node-b', name: 'beta-worker', title: 'Beta rollout' },
          to: 'node-a',
          text: 'beta needs a decision on the header',
          receivedAt: '2026-01-01T10:05:00.000Z',
          read: false,
        },
        {
          id: 'i2',
          kind: 'room-message',
          room: 'room-1',
          topic: 'Alpha room',
          from: { nodeId: 'node-a', name: 'Local node', sessionId: 'human', title: 'Local node' },
          to: 'node-b',
          text: 'I said this into the room',
          receivedAt: '2026-01-01T10:06:00.000Z',
          read: true,
        },
        {
          id: 'i3',
          kind: 'note',
          from: { nodeId: 'node-b', name: 'beta-worker', title: 'Beta rollout' },
          to: 'node-a',
          text: 'a direct note',
          receivedAt: '2026-01-01T10:07:00.000Z',
          read: true,
        },
        {
          id: 'i4',
          // A local agent answers on this very node. Its `from.nodeId` is the
          // local node, but the sender is the agent, not "me".
          kind: 'room-message',
          room: 'room-1',
          topic: 'Alpha room',
          from: { nodeId: 'node-a', name: 'Local node', sessionId: 'session-1', title: 'echo-worker' },
          to: 'node-a',
          text: 'the local agent answered me',
          receivedAt: '2026-01-01T10:04:00.000Z',
          read: false,
        },
        {
          // A long body must not push the rest of the inbox off screen.
          id: 'i5',
          kind: 'note',
          from: { nodeId: 'node-b', name: 'beta-worker', title: 'Beta rollout' },
          to: 'node-a',
          text: `a long note ${'that keeps going '.repeat(20)}and finally stops`,
          receivedAt: '2026-01-01T10:08:00.000Z',
          read: false,
        },
        {
          // The human own copy still has to read as "me" when it is unread.
          id: 'i6',
          kind: 'note',
          from: { nodeId: 'node-a', name: 'Local node', sessionId: 'human', title: 'Local node' },
          to: 'node-b',
          text: 'my own note',
          receivedAt: '2026-01-01T10:09:00.000Z',
          read: false,
        },
      ],
    },
    // Only what the person must act on: one unread mention and one task.
    attention: {
      messages: [
        {
          id: 'a1',
          kind: 'room-message',
          room: 'room-1',
          from: { nodeId: 'node-b', name: 'beta-worker', title: 'Beta rollout' },
          to: 'node-a',
          text: 'beta needs a decision on the header',
          mentions: ['panel'],
          receivedAt: '2026-01-01T10:05:00.000Z',
          read: false,
        },
      ],
      unread: 1,
      total: 1,
    },
    rooms: {
      count: 3,
      mine: [leaderRoom, memberRoom],
      all: [{ ...leaderRoom, isMember: true }, { ...memberRoom, isMember: true }, strangerRoom],
      unread: { 'room-1': 2 },
    },
    // A notification found several local channels and waits for a human pick.
    notify: {
      pending: [
        {
          id: 'notify-1',
          message: '任务完成：房间「Alpha room」的「Split the panel」已完成',
          createdAt: '2026-01-01T10:10:00.000Z',
          channels: [
            { id: 'im:wx_1:tgt_1', label: 'wechat · 我' },
            { id: 'webhook:default', label: 'Webhook · example.test' },
          ],
        },
      ],
    },
  },
  // A new agent is a new session inside a workspace that already exists.
  workspaces: {
    workspaces: [
      { id: 'ws-1', path: 'C:\\w\\proj', title: 'proj', sessions: ['session-1'] },
      { id: 'ws-2', path: 'C:\\w\\other', title: 'other', sessions: [] },
    ],
  },
  // The Host attaches a generated session title; the panel must show that
  // instead of the raw session id.
  sessions: {
    sessions: [
      { id: 'session-1', title: 'Panel polish', rooms: ['room-1', 'room-3'] },
      { id: 'session-3', title: 'resident two', rooms: [] },
    ],
  },
  agents: {
    self: { nodeId: 'node-a', name: 'Local node' },
    agents: [
      {
        nodeId: 'node-a',
        nodeName: 'Local node',
        id: 'session-1',
        name: 'echo-worker',
        live: true,
        imported: true,
        status: 'idle',
        cwd: 'C:\\w\\proj',
        workspace: 'proj',
        rooms: ['room-1'],
      },
      {
        // Stored but never brought in and in no room: the rail must leave it
        // alone, while the full catalogue still offers to import it.
        nodeId: 'node-a',
        nodeName: 'Local node',
        id: 'session-2',
        name: 'stored-one',
        live: false,
        imported: false,
        status: '',
        cwd: 'C:\\w\\other',
        workspace: 'other',
        rooms: [],
      },
      {
        // A resident session created here, in no room yet: still on the rail.
        nodeId: 'node-a',
        nodeName: 'Local node',
        id: 'session-3',
        title: 'resident two',
        name: 'resident-two',
        live: true,
        imported: true,
        status: 'idle',
        cwd: 'C:\\w\\proj',
        workspace: 'proj',
        rooms: [],
      },
    ],
    remote: [
      {
        nodeId: 'node-b',
        nodeName: 'Far machine',
        id: 'session-9',
        name: 'beta-worker',
        live: true,
        imported: false,
        status: 'idle',
        cwd: 'C:\\w\\far',
        workspace: 'far',
        rooms: [],
        dialled: true,
      },
    ],
  },
  // The Host lifts a member out of a room a leader owns; the pane then re-reads.
  roomKick: { removed: true, room: { ...leaderRoom } },
  roomDetail: {
    'room-1': {
      room: { ...leaderRoom, leader: localAgent, memberCount: 4, createdAt: '2026-01-01T09:00:00.000Z' },
      messages: [
        {
          id: 'm1',
          kind: 'room-message',
          room: 'room-1',
          from: { nodeId: 'node-b', name: 'beta-worker', sessionId: 'session-9' },
          to: 'node-a',
          text: 'hello from beta',
          receivedAt: '2026-01-01T10:01:00.000Z',
          read: true,
        },
        {
          id: 'm2',
          kind: 'room-task',
          room: 'room-1',
          from: { nodeId: 'node-a', sessionId: 'human', name: 'Local node' },
          to: 'node-b',
          text: 'ASSIGNED Split the panel',
          receivedAt: '2026-01-01T10:02:00.000Z',
          read: true,
        },
        {
          id: 'm3',
          kind: 'room-message',
          room: 'room-1',
          from: { nodeId: 'node-a', sessionId: 'human', name: 'Local node' },
          to: 'node-b',
          text: 'mine here',
          receivedAt: '2026-01-01T10:03:00.000Z',
          read: true,
        },
      ],
      mine: [],
      viewer: { sessionId: 'human', isMember: true, isLeader: true, role: 'leader' },
    },
    'room-3': {
      room: { ...memberRoom, leader: remoteAgent, memberCount: 2, createdAt: '2026-01-01T09:00:00.000Z' },
      messages: [],
      mine: [],
      viewer: { sessionId: 'human', isMember: true, isLeader: false, role: 'member' },
    },
  },
  notifyConfirm: { status: 'sent', summary: '已通过 wechat · 我 通知', ok: true },
  notifyDismiss: { ok: true },
};

const asked = [];
const requested = [];
const fetch = async (route, init) => {
  const body = JSON.parse(init.body);
  const endpoint = body.payload.method;
  const payload = body.payload.payload ?? {};
  asked.push(endpoint);
  requested.push({ endpoint, payload });
  if (endpoint === 'roomJoin') {
    const joined = { ...strangerRoom, isMember: true, role: 'member' };
    answers.snapshot.rooms.mine.push(joined);
    answers.snapshot.rooms.all = answers.snapshot.rooms.all.map(room => room.id === joined.id ? joined : room);
    return { ok: true, json: async () => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { room: joined, added: true } } }) };
  }
  if (answers[endpoint] === undefined) throw new Error(`unexpected endpoint ${endpoint}`);
  const value = endpoint === 'roomDetail' ? answers.roomDetail[payload.room] : answers[endpoint];
  return {
    ok: true,
    json: async () => ({
      type: 'server-response',
      rpcId: body.rpcId,
      result: { ok: true, value },
    }),
  };
};

const context = vm.createContext({
  window,
  document,
  crypto: window.crypto,
  localStorage: window.localStorage,
  require,
  fetch,
  console,
  // The panel polls; the harness drives refreshes by hand.
  setInterval: () => 0,
  clearInterval: () => {},
});
vm.runInContext(source, context);
const loaded = window.__loaded;

const opened = [];
const selectPanelCalls = [];
const registrations = [];
const navigation = {
  layout: { selectPanel: (id) => selectPanelCalls.push(id) },
  uiWorkspace: { openSession: (id) => opened.push(id) },
  // The host's session catalog: openSession() consults it and refuses ids the
  // host does not carry (a remote or archived session would fail silently).
  sessions: {
    list: {
      byId: {
        'session-1': { id: 'session-1' },
        'session-3': { id: 'session-3' },
        'session-4': { id: 'session-4' },
      },
      // Some hosts expose a `list()` method instead of the byId map; the panel
      // must read that shape too and refuse ids it does not carry.
      list: () => [{ id: 'session-1' }],
    },
  },
};
const plugin = loaded.factory(require);
// Pre-fill localStorage so MeshNavigation boots in lanmesh mode, which lets
// registerModeShadow register the sidebar.workspaces shadow layer.
window.localStorage.setItem('dsh.lanmesh.navigation', JSON.stringify({ mode: 'lanmesh' }));
const injectedSlots = [];
plugin.apply({
  effect: (fn) => fn(),
  // The panel resolves these per click; a profile without the workspace client
  // must still boot, so get() returning undefined is the normal degraded path.
  get: (name) => navigation[name],
  slots: {
    register: (definition, component) => {
      registrations.push({ definition, component });
      return () => {};
    },
    // The sidebar projects only entries registered after it declares the slot,
    // so the entry waits for that declaration; this stub declares it at once.
    inject: (key, callback) => {
      injectedSlots.push(key);
      callback();
      return () => {};
    },
  },
});
const main = registrations.find((entry) => entry.definition.name === 'main');
if (main === undefined) throw new Error('no main panel registered');
// sidebar.workspaces carries the same MeshRailHost directly (best-effort copy
// that lives alongside the real overlay rail). Tests render that one to skip
// the .lm-railOverlay wrapper.
const railEntry = registrations.find((entry) => entry.definition.name === 'sidebar.workspaces')
  ?? registrations.find((entry) => entry.definition.name === 'shell.overlay');
if (railEntry === undefined) throw new Error('no rail registered');
const Component = main.component;
const RailHost = railEntry.component;
const registration = main.definition;
const sidebar = registrations.find((entry) => entry.definition.name === 'sidebar.panellist');

const hasClass = (node, token) =>
  typeof node?.props?.className === 'string' && node.props.className.split(/\s+/).includes(token);

let lastNodes = [];
let lastText = '';

/** Two components use separate hook position spaces, like two real components. */
const resetHooks = () => {
  stateSlots.length = 0;
  effectSlots.length = 0;
  refSlots.length = 0;
  cursor = 0;
  queued = [];
};

/** Render one component tree and keep the nodes the class helpers look at. */
const renderNode = (component) => {
  cursor = 0;
  queued = [];
  const nodes = [];
  const text = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      text.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node.type === 'function') {
      walk(node.type(node.props ?? {}));
      return;
    }
    nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(component());
  lastNodes = nodes;
  lastText = text.join(' ');
};

/** Effects this render queued run right after it, like React. */
const flushEffects = () => {
  const pending = queued.splice(0, queued.length);
  for (const at of pending) {
    const slot = effectSlots[at];
    if (slot === undefined) continue;
    // A cleanup is kept on the slot and called before that slot runs again.
    const returned = slot.fn?.();
    slot.cleanup = typeof returned === 'function' ? returned : undefined;
  }
};

const settleIn = async (component, rounds = 5) => {
  for (let index = 0; index < rounds; index += 1) {
    renderNode(component);
    flushEffects();
    for (let tick = 0; tick < 8; tick += 1) await new Promise((resolve) => setImmediate(resolve));
  }
};

const settle = () => settleIn(Component);
const settleRail = () => settleIn(RailHost);

/** Mount one slot component with a fresh hook space, like switching slots. */
const switchTo = async (component) => {
  resetHooks();
  renderNode(component);
  flushEffects();
  await settleIn(component);
};

const count = (token) => lastNodes.filter((entry) => hasClass(entry, token)).length;

/** True when any kick button sits inside a member chip titled `key`. */
const chipHasKick = (key) =>
  lastNodes.some(
    (entry) => hasClass(entry, 'lm-memberChip') && entry.props?.title === key && countKickInside(entry),
  );
const countKickInside = (chip) => {
  let found = 0;
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (hasClass(node, 'lm-kickBtn')) found += 1;
    for (const child of node.children ?? []) walk(child);
  };
  for (const child of chip.children ?? []) walk(child);
  return found;
};

/** Type into the first rendered node carrying a class token, then re-render. */
const typeInto = async (token, value, caret = value.length) => {
  const node = lastNodes.find((entry) => hasClass(entry, token));
  if (node === undefined) throw new Error(`nothing to type into for .${token}`);
  if (typeof node.props.onChange !== 'function') throw new Error(`.${token} has no onChange`);
  node.props.onChange({ target: { value, selectionStart: caret } });
  await settle();
};

/** Press one key on the first rendered node carrying a class token. */
const press = async (token, key) => {
  const node = lastNodes.find((entry) => hasClass(entry, token));
  if (node === undefined) throw new Error(`nothing to press on for .${token}`);
  if (typeof node.props.onKeyDown !== 'function') throw new Error(`.${token} has no onKeyDown`);
  let prevented = false;
  node.props.onKeyDown({
    key,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  });
  await settle();
  return prevented;
};

/** Click the first rendered node carrying a class token, then re-render. */
const clickOn = async (component, token, at = 0) => {
  const nodes = lastNodes.filter((entry) => hasClass(entry, token));
  const node = nodes[at];
  if (node === undefined) throw new Error(`nothing to click for .${token}`);
  if (typeof node.props.onClick !== 'function') throw new Error(`.${token} has no onClick`);
  node.props.onClick({ preventDefault() {}, stopPropagation() {} });
  await settleIn(component);
};
const click = (token, at = 0) => clickOn(Component, token, at);
const clickRail = (token, at = 0) => clickOn(RailHost, token, at);

// The rail is mounted in the native sidebar and loads its own snapshot.
await switchTo(RailHost);

const checks = [
  ['registered on the keyed main slot', registration?.name === 'main' && registration?.key === 'dsh-lan-mesh'],
  ['registers the sidebar entry', sidebar?.definition?.id === 'dsh-lan-mesh'],
  ['registers the rail in the native sidebar', railEntry?.definition?.name === 'sidebar.workspaces'],
  // The conversation seat must stay native: shadowing it with the room panel
  // is exactly what made a rail agent click show a room on the right.
  [
    'never shadows the native conversation seat',
    registrations.every((entry) => !(entry.definition.name === 'main' && entry.definition.key === 'conversation')),
  ],
  // lanmesh mode owns the left column the way Team mode does: the marker is
  // what the stylesheet uses to hide the shell's New Session button and the
  // global panel rail, so a reload boots into one mesh column.
  ['boots with the lanmesh chrome marker set', document.documentElement.dataset.lanMeshMode === 'lanmesh'],
  // v0.2.0: the panel is always the human — no session picker, no sessions call.
  ['never asks the host for its sessions', !asked.includes('sessions')],
  ['the rail renders in the native sidebar', count('lm-rail') === 1],
  ['the rail offers a way back to the conversation', count('lm-conversation') === 1 && lastText.includes('对话')],
  ['the rail shows the configured identity', lastText.includes('建哥') && lastText.includes('node-a')],
  [
    'the rail shows inbox and the task board',
    lastText.includes('收件箱') && lastText.includes('任务看板') && count('lm-navBtn') >= 3,
  ],
  ['the projects section lists the rooms I joined', count('lm-roomRow') === 2],
  ['the projects section shows both joined rooms', lastText.includes('Alpha room') && lastText.includes('Gamma side project')],
  ['the projects section badges unread room messages', count('lm-roomUnread') === 1 && lastText.includes('2')],
  ['the projects section offers a new project', count('lm-projectsAdd') === 1],
  ['the projects section shows joinable rooms', lastText.includes('Beta project') && count('lm-joinBtn') === 1],
  // Resident sessions (imported here) and sessions pulled into a room belong on
  // the rail; a stored session that is neither must not.
  [
    'the rail lists resident and room sessions',
    count('lm-agentRow') === 3 &&
      lastText.includes('echo-worker') &&
      lastText.includes('resident two') &&
      lastText.includes('Room worker') &&
      !lastText.includes('stored-one'),
  ],
  // The reserved notify extension point: several local channels means the
  // message is held for a human to pick one, instead of being sent blindly.
  ['the rail shows notifications awaiting confirmation', count('lm-notify') === 1 && lastText.includes('待确认通知')],
  ['the pending notification offers every channel', count('lm-notifyChannel') === 2 && lastText.includes('wechat')],
  ['the pending notification can be dismissed', count('lm-notifyDismiss') === 1],
];

// Picking a channel for a held notification calls the Host's confirm endpoint,
// then refreshes the snapshot (the harness keeps the pending row, which is fine:
// a real Host drops it after a successful send).
await clickRail('lm-notifyChannel');
checks.push(
  ['confirming a notification asks notifyConfirm', asked.includes('notifyConfirm')],
);
await clickRail('lm-notifyDismiss');
checks.push(
  ['dismissing a notification asks notifyDismiss', asked.includes('notifyDismiss')],
);

// The main area opens on the inbox and draws no rail of its own: the native
// sidebar owns that column now.
await switchTo(Component);
checks.push(
  ['the panel opens on the inbox', count('lm-msg') === 4 && !lastText.includes('发给')],
  ['the panel leaves the sidebar to the native slot', count('lm-rail') === 0],
);

// The Agents section's "+" opens the full catalogue, which is where importing,
// dialling and creating an agent live.
await switchTo(RailHost);
await clickRail('lm-agentsAdd');
await switchTo(Component);
checks.push(
  ['panel asks the host for its workspaces', asked.includes('workspaces')],
  ['panel asks the host for the agent list', asked.includes('agents')],
  ['renders the local agent', lastText.includes('echo-worker')],
  ['renders the stored agent', lastText.includes('stored-one')],
  ['marks the live agent as running', lastText.includes('运行中')],
  ['marks the stored agent as stored', lastText.includes('已存盘')],
  ['offers to bring a stored agent in', lastText.includes('引入')],
  ['renders the remote agent', lastText.includes('beta-worker')],
  ['marks the dialled agent as reached', lastText.includes('已联络')],
  ['renders the remote node name', lastText.includes('Far machine')],
  ['keeps the session id out of the visible text', !lastText.includes('node-b/session-9')],
  [
    'hides the remote agent address in a tooltip',
    lastNodes.some((entry) => entry.props?.title === 'node-b/session-9'),
  ],
);

// A rail room row brings the body forward and opens that room directly.
await switchTo(RailHost);
await clickRail('lm-roomRow');
await switchTo(Component);
if (!asked.includes('roomDetail')) throw new Error('selecting a room never asked for roomDetail');
checks.push(
  ['selecting a room opens its detail', lastText.includes('ship the panel')],
  ['room pane renders a chat area', count('lm-chat') >= 1],
  ['room pane renders the conversation', lastText.includes('hello from beta')],
  ['room pane leaves task notices out of the chat', !lastText.includes('ASSIGNED Split the panel')],
  // The chat pane is a scroll container the pane scrolls to the bottom on entry
  // and on new arrivals; the effect must not throw when the ref is not bound
  // yet (the render-only harness), and the container keeps its scroll class.
  ['the chat pane is the scroll target', lastNodes.some((entry) => hasClass(entry, 'lm-chat') && entry.props?.ref !== undefined)],
  // The body goes through the shell's Markdown renderer, and each bubble names
  // its sender in bold so two dense messages never blur into one another.
  ['both message bodies render as markdown', count('stubMarkdown') === 2],
  ['every bubble names its sender in bold', count('lm-bubbleWho') === 2],
  // The speaker kind decides the tint: a remote agent and the local person must
  // not read as the same bubble.
  ['a person speaks in the human tint', count('lm-bubbleHuman') === 1],
  ['a synced agent speaks in the agent tint', count('lm-bubbleAgent') === 1],
  ['own message is the only mine bubble', count('lm-bubbleMine') === 1 && lastText.includes('mine here')],
  ['own room messages use the configured identity', lastText.includes('建哥')],
);

// The member row is collapsed by default to keep the room focused on the
// conversation; expand it before checking chips and kick buttons.
await click('lm-badgeBtn');
// Tasks are also collapsed by default; expand the section to check the list.
await click('lm-tasksToggle');
checks.push(
  // Every chip has the base dot class; the offline one adds the idle modifier.
  ['every member chip carries a dot', count('lm-mdot') === 4],
  ['offline member gets the idle dot', count('lm-mdotIdle') === 1],
  ['leader sees the rename button', count('lm-renameBtn') === 1],
  ['room pane lists its tasks', lastText.includes('Split the panel')],
  ['room pane has a composer', count('lm-sendBtn') === 1],
  // The composer is the shell-shaped card (22px radius, elevation stroke) with
  // the attachment and quick-task affordances in a toolbar under the input,
  // matching dsh-agent-team's composer instead of a bare form row.
  ['composer renders as a single card', count('lm-composerCard') === 1],
  ['composer toolbar carries the attach button', count('lm-attachBtn') === 1],
  ['room pane has a back button', count('lm-backBtn') === 1],
  // v0.2.1: the leader may kick peers (never the human, never itself, and only
  // when this pane actually owns the leader role).
  ['leader sees a kick button per peer', count('lm-kickBtn') === 2],
  // The kick button belongs to the chip of a remote peer, never to the chip of
  // the human member (a human session is not something a leader may eject).
  [
    'the human member has no kick button',
    !chipHasKick('node-a/human') && chipHasKick('node-b/session-9') && chipHasKick('node-c/session-7'),
  ],
);

// Typing "@" opens the member picker; the rows are labelled with session
// titles, never with the raw session id.
await typeInto('lm-composerInput', '@');
const mentionRowLabels = () =>
  lastNodes
    .filter((entry) => hasClass(entry, 'lm-mentionName'))
    .map((entry) => (entry.children ?? []).map(String).join(''));
checks.push(
  // v0.3.0: the mention list only appears when typing @; @all is the first
  // entry in the popup menu rather than a permanent chip above the composer.
  ['typing at sign opens the member picker', count('lm-mentionItem') === 5],
  [
    '@all is the first entry in the picker',
    mentionRowLabels()[0] === '@所有成员',
  ],
  ['the picker labels rows with titles', lastText.includes('Panel polish') && lastText.includes('Beta rollout')],
  // A row with a unique title must not leak its session id at all.
  ['a unique title never leaks its session id', !mentionRowLabels().some((text) => text.includes('session-1'))],
  // Two sessions sharing a title are told apart by a session-id suffix, and
  // only those two rows grow one.
  [
    'duplicate titles get a session id suffix in the picker',
    mentionRowLabels().includes('Beta rollout · session-9') &&
      mentionRowLabels().includes('Beta rollout · session-7'),
  ],
  ['a unique title stays unsuffixed', mentionRowLabels().includes('Panel polish')],
);

// A prefix narrows the list; the caret keeps the menu anchored to the token.
await typeInto('lm-composerInput', '@bet', 4);
checks.push(['a prefix narrows the picker', count('lm-mentionItem') === 2 && lastText.includes('Beta rollout')]);

// Enter takes the highlighted row and rewrites the token to the title.
const accepted = await press('lm-composerInput', 'Enter');
checks.push(
  ['enter accepts the highlighted member', accepted === true],
  ['accepting rewrites the token to the title', count('lm-mentionItem') === 0],
  [
    'the composer now holds the mention',
    lastNodes.some((entry) => hasClass(entry, 'lm-composerInput') && entry.props.value === '@Beta rollout '),
  ],
);

// Escape dismisses without touching the draft.
await typeInto('lm-composerInput', '@b', 2);
await press('lm-composerInput', 'Escape');
checks.push(
  ['escape closes the picker', count('lm-mentionItem') === 0],
  [
    'escape keeps the draft intact',
    lastNodes.some((entry) => hasClass(entry, 'lm-composerInput') && entry.props.value === '@b'),
  ],
);

// An "@" glued to a word is an email address, not a mention.
await typeInto('lm-composerInput', 'mail@bet', 8);
checks.push(['an at sign inside a word is not a mention', count('lm-mentionItem') === 0]);

// The member shortcut must actually reach the client services.
const panelsBeforeOpen = selectPanelCalls.length;
await click('lm-openSession');
checks.push(
  ['opening a session calls uiWorkspace.openSession', opened.length === 1 && opened[0] === 'session-1'],
  // Opening the native conversation must release the column first: the panel
  // is what owns `main`, so the conversation needs `selectPanel(null)` to be
  // visible. It must never re-select the plugin panel.
  [
    'opening a session releases the panel instead of re-selecting it',
    selectPanelCalls.length === panelsBeforeOpen + 1 && selectPanelCalls[panelsBeforeOpen] === null,
  ],
);

// A session the host catalog does not carry (remote, archived, or vanished)
// must not reach openSession — the host would retain it silently and fail.
// openSession() reads the catalog at click time, so dropping the id from it
// turns the same local-agent button into a refused click.
delete navigation.sessions.list.byId['session-1'];
await click('lm-openSession');
checks.push(
  [
    'a catalog-unknown session is refused up front',
    opened.length === 1 && selectPanelCalls.length === panelsBeforeOpen + 1,
  ],
);
navigation.sessions.list.byId['session-1'] = { id: 'session-1' };

// The host may expose the session catalogue as a `list()` method instead of the
// byId map. The panel must accept that shape: a known id still opens, and the
// catalog look-up cannot throw for either shape.
const sessionsBackup = navigation.sessions;
navigation.sessions = { list: () => [{ id: 'session-1' }] };
await click('lm-openSession');
checks.push(
  ['a sessions.list() catalogue still opens a known session', opened.length === 2 && opened[1] === 'session-1'],
);
navigation.sessions = sessionsBackup;

// An id the list()-shaped catalogue does not carry is refused exactly like the
// byId shape refused it.
navigation.sessions = { list: () => [{ id: 'other-session' }] };
await click('lm-openSession');
checks.push(
  [
    'a list()-shaped catalogue refuses unknown ids',
    opened.length === 2 && selectPanelCalls.length === panelsBeforeOpen + 2,
  ],
);
navigation.sessions = sessionsBackup;

// The leader kicks a peer: the RPC must carry the member key and the pane
// reloads instead of leaving the room.
await click('lm-kickBtn', 1);
checks.push(
  ['kicking calls roomKick with the peer key', asked.includes('roomKick')],
);
// The back button returns to the room list without leaving the room.
await click('lm-backBtn');
checks.push(
  ['back returns to the room list', count('lm-roomRow') >= 2 && !lastText.includes('ship the panel')],
  ['back does not leave the room', lastText.includes('Alpha room')],
);

// Switching to a room this session only belongs to hides the leader controls.
await click('lm-roomRow', 1);
checks.push(
  ['switching rooms re-reads the detail', asked.filter((name) => name === 'roomDetail').length >= 2],
  ['non-leader sees no rename button', count('lm-renameBtn') === 0],
  ['non-leader may leave the room', count('lm-leaveBtn') === 1],
  ['non-leader sees no kick button', count('lm-kickBtn') === 0],
  ['empty conversation says so', lastText.includes('房间里还没有消息')],
);

// The task board aggregates tasks across the human's rooms.
await click('lm-backBtn');
await switchTo(RailHost);
await clickRail('lm-nav-board');
await switchTo(Component);
checks.push(
  ['board aggregates the open task', lastText.includes('Split the panel') && lastText.includes('Alpha room')],
  ['board shows the across-rooms header', lastText.includes('跨房间任务汇总')],
);

// The inbox is what reached this node, so the useful header is who spoke and
// in which room — the recipient is always this node and stays out of the text.
const senderLabels = () =>
  lastNodes
    .filter((entry) => hasClass(entry, 'lm-msgFrom'))
    .map((entry) => (entry.children ?? []).map((child) => (child?.children ?? []).join('')).join(''));
await switchTo(RailHost);
await clickRail('lm-nav-inbox');
await switchTo(Component);
checks.push(
  [
    'inbox lists only the unread messages',
    count('lm-msg') === 4 &&
      lastText.includes('a long note') &&
      lastText.includes('my own note') &&
      lastText.includes('the local agent answered me') &&
      lastText.includes('beta needs a decision on the header'),
  ],
  // Read rows must drop out of the surface entirely.
  [
    'inbox hides read messages',
    !lastText.includes('a direct note') && !lastText.includes('I said this into the room'),
  ],
  [
    'inbox names the sender instead of the recipient',
    senderLabels().includes('Beta rollout') && senderLabels().includes('echo-worker') && !lastText.includes('发给'),
  ],
  ['inbox marks only the human own copy as mine', count('lm-msgOut') === 1 && senderLabels().includes('我')],
  [
    'inbox tags room messages with their room',
    count('lm-msgRoomTag') === 2 && lastText.includes('#Alpha room'),
  ],
  // A point-to-point note has no room to jump to, so only the room rows act.
  ['inbox only makes room messages clickable', count('lm-msgJump') === 2],
  // The long body is clamped and offers its own toggle, so one verbose message
  // cannot push the rest out of the pane.
  [
    'long messages start clamped with an expand toggle',
    count('lm-msgTextClamp') === 1 && count('lm-msgToggle') === 1 && lastText.includes('展开'),
  ],
);

await click('lm-msgToggle');
checks.push([
  'the expand toggle opens the body without leaving the inbox',
  count('lm-msgTextClamp') === 0 &&
    count('lm-msgToggle') === 1 &&
    lastText.includes('收起') &&
    count('lm-chat') === 0,
]);

// Clicking a room row must open that room, not just mark it read.
await click('lm-msgJump');
if (!asked.includes('roomDetail')) throw new Error('the inbox jump never asked for roomDetail');
checks.push([
  'clicking an inbox room message opens that room',
  count('lm-chat') === 1 && lastText.includes('hello from beta'),
]);

// A rail Agent row opens the native conversation in the main area. The rail
// itself lives in the sidebar, so it stays exactly where it is.
const panelsBeforeAgent = selectPanelCalls.length;
await switchTo(RailHost);
await clickRail('lm-agentRow', 2);
checks.push(
  ['clicking a rail agent opens that conversation', opened[opened.length - 1] === 'session-4'],
  // The room panel owns `main`; the click must hand it back so the native
  // conversation is what the person sees on the right, never the room.
  [
    'a rail agent click releases the panel to the conversation',
    selectPanelCalls.length === panelsBeforeAgent + 1 && selectPanelCalls[panelsBeforeAgent] === null,
  ],
);

// The rail's "对话" row hands the whole column back: mode leaves lanmesh, so
// the chrome marker clears and the shell's New Session button and panel rail
// come back. Team mode behaves the same way through its own marker.
await clickRail('lm-conversation');
checks.push([
  'the rail exit clears the lanmesh chrome marker',
  document.documentElement.dataset.lanMeshMode === undefined,
]);

// Joining from the actual native-sidebar host must forward the callback, use
// the human identity and refresh the joined project list.
await switchTo(RailHost);
await clickRail('lm-joinBtn');
const joinRequest = requested.find(entry => entry.endpoint === 'roomJoin');
checks.push(
  [
    'rail join sends the selected project and configured identity',
    joinRequest?.payload.room === 'room-2' &&
      joinRequest?.payload.sessionId === 'human' &&
      joinRequest?.payload.sessionName === '建哥',
  ],
  ['joined project moves out of the joinable list', count('lm-joinBtn') === 0 && count('lm-roomRow') === 3],
  ['successful join opens the mesh panel', document.documentElement.dataset.lanMeshMode === 'lanmesh'],
);

// A hostile context proves the entry cannot fail the Web boot: cordis throws on
// an undeclared service, and the whole app dies when apply() rejects.
const strictRegistrations = [];
let bootError = '';
try {
  plugin.apply({
    effect: (fn) => fn(),
    get: () => {
      throw new Error('cannot get property "uiWorkspace" without inject');
    },
    slots: {
      register: (definition, component) => {
        strictRegistrations.push({ definition, component });
        return () => {};
      },
      inject: (_key, callback) => {
        callback();
        return () => {};
      },
    },
  });
} catch (error) {
  bootError = error.message;
}
checks.push(
  ['apply survives a context without the navigation services', bootError === ''],
  [
    'a degraded boot still registers the fixed slots',
    strictRegistrations.some((entry) => entry.definition.name === 'main') &&
      strictRegistrations.some((entry) => entry.definition.name === 'sidebar.panellist'),
  ],
);

// A fiber only activates once every declared service resolves, so adding an
// optional service here is the white-screen bug of docs/development.md §4.13.
checks.push([
  'only slots is declared as a boot dependency',
  Array.isArray(plugin.inject) && plugin.inject.length === 1 && plugin.inject[0] === 'slots',
]);

// The sidebar builds its panel list from entries registered after it declares
// the slot; a direct register into an undeclared slot stays pending forever and
// the icon silently disappears (docs/development.md §4.14).
checks.push([
  'both fixed and shadow entries wait for their slot owner to declare it',
  injectedSlots.includes('main') &&
    injectedSlots.includes('sidebar.panellist') &&
    injectedSlots.includes('sidebar.workspaces'),
]);

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
}
if (process.env.PANEL_DEBUG === '1') {
  console.log('TEXT>>', lastText);
  console.log('asked:', asked.join(','));
}
console.log(`panel check: ${checks.length - failed}/${checks.length} assertions passed`);
console.log(failed === 0 ? 'panel check ok' : `panel check FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
