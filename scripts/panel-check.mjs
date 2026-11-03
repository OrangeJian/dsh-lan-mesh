/**
 * Render the Web panel against a stubbed Host answer.
 *
 * The panel is plain DOM-free React, so a tiny hook runtime is enough to catch
 * the failures a syntax check cannot: an endpoint name the Host does not serve,
 * a field the panel reads but the Host never sends, a pane that renders nothing.
 * It is not a browser: styles, layout and real slot behaviour are out of scope.
 *
 * The two-column panel has state that only exists after a click (a room gets
 * selected), so this harness also renders, clicks a class-tagged node, and
 * renders again.
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
  documentElement: { lang: 'zh' },
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
  members: [localAgent, remoteAgent],
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
      port: 45871,
      discoveryPort: 45870,
      peers: 1,
      unread: 0,
      autoWake: true,
      secured: false,
    },
    peers: [],
    inbox: { messages: [], unread: 0, total: 0 },
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
  sessions: { sessions: [{ id: 'session-1', title: 'Panel polish', rooms: ['room-1', 'room-3'] }] },
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
        rooms: [],
      },
      {
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
  roomDetail: {
    'room-1': {
      room: { ...leaderRoom, leader: localAgent, memberCount: 4, createdAt: '2026-01-01T09:00:00.000Z' },
      messages: [
        {
          id: 'm1',
          kind: 'room-message',
          room: 'room-1',
          from: { nodeId: 'node-b', name: 'beta-worker' },
          to: 'node-a',
          text: 'hello from beta',
          receivedAt: '2026-01-01T10:01:00.000Z',
          read: true,
        },
        {
          id: 'm2',
          kind: 'room-task',
          room: 'room-1',
          from: { nodeId: 'node-a', name: 'echo-worker' },
          to: 'node-b',
          text: 'ASSIGNED Split the panel',
          receivedAt: '2026-01-01T10:02:00.000Z',
          read: true,
        },
        {
          id: 'm3',
          kind: 'room-message',
          room: 'room-1',
          from: { nodeId: 'node-a', name: 'echo-worker' },
          to: 'node-b',
          text: 'mine here',
          receivedAt: '2026-01-01T10:03:00.000Z',
          read: true,
        },
      ],
      mine: [],
      viewer: { sessionId: 'session-1', isMember: true, isLeader: true, role: 'leader' },
    },
    'room-3': {
      room: { ...memberRoom, leader: remoteAgent, memberCount: 2, createdAt: '2026-01-01T09:00:00.000Z' },
      messages: [],
      mine: [],
      viewer: { sessionId: 'session-1', isMember: true, isLeader: false, role: 'member' },
    },
  },
};

const asked = [];
const fetch = async (route, init) => {
  const body = JSON.parse(init.body);
  const endpoint = body.payload.method;
  const payload = body.payload.payload ?? {};
  asked.push(endpoint);
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
  require,
  fetch,
  console,
  // The panel polls; the harness drives refreshes by hand.
  setInterval: () => 0,
  clearInterval: () => {},
});
vm.runInContext(source, context);
const loaded = window.__loaded;
if (loaded === undefined) throw new Error('client.js did not register itself');

/** What the panel asked the client services to do. */
const opened = [];
const selectPanelCalls = [];
const registrations = [];
const navigation = {
  layout: { selectPanel: (id) => selectPanelCalls.push(id) },
  uiWorkspace: { openSession: (id) => opened.push(id) },
};
const plugin = loaded.factory(require);
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
const Component = main.component;
const registration = main.definition;
const sidebar = registrations.find((entry) => entry.definition.name === 'sidebar.panellist');

const hasClass = (node, token) =>
  typeof node?.props?.className === 'string' && node.props.className.split(/\s+/).includes(token);

let lastNodes = [];
let lastText = '';

const renderOnce = () => {
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
  walk(Component());
  lastNodes = nodes;
  lastText = text.join(' ');
};

const settle = async (rounds = 5) => {
  for (let index = 0; index < rounds; index += 1) {
    renderOnce();
    // Effects this render queued run right after it, like React; a cleanup is
    // kept on the slot and called before that slot runs again.
    const pending = queued.splice(0, queued.length);
    for (const at of pending) {
      const slot = effectSlots[at];
      if (slot === undefined) continue;
      const returned = slot.fn?.();
      slot.cleanup = typeof returned === 'function' ? returned : undefined;
    }
    for (let tick = 0; tick < 8; tick += 1) await new Promise((resolve) => setImmediate(resolve));
  }
};

const count = (token) => lastNodes.filter((entry) => hasClass(entry, token)).length;

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
const click = async (token, at = 0) => {
  const nodes = lastNodes.filter((entry) => hasClass(entry, token));
  const node = nodes[at];
  if (node === undefined) throw new Error(`nothing to click for .${token}`);
  if (typeof node.props.onClick !== 'function') throw new Error(`.${token} has no onClick`);
  node.props.onClick({ preventDefault() {}, stopPropagation() {} });
  await settle();
};

await settle();

const checks = [
  ['registered on the keyed main slot', registration?.name === 'main' && registration?.key === 'dsh-lan-mesh'],
  ['registers the sidebar entry', sidebar?.definition?.id === 'dsh-lan-mesh'],
  ['asks the host for its sessions', asked.includes('sessions')],
  // Left rail: identity, joined rooms, unread badge, join list, new-room entry.
  ['rail shows this node identity', lastText.includes('Local node') && lastText.includes('node-a')],
  ['rail shows the joined room', lastText.includes('Alpha room')],
  ['rail shows the other joined room', lastText.includes('Gamma side project')],
  ['rail badges unread room messages', count('lm-roomUnread') === 1 && lastText.includes('2')],
  ['rail offers rooms that can be joined', lastText.includes('Beta project') && count('lm-joinBtn') === 1],
  ['rail has the new-room entry', count('lm-newRoomEntry') === 1],
  // What is waiting on the person sits at the top of the rail.
  ['rail lists only what waits on the person', count('lm-attentionRow') === 1],
  ['the attention row names the sender by title', lastText.includes('Beta rollout')],
  // A new agent is a new session in an existing workspace, so the panel offers
  // the workspaces the host already knows instead of a free-text path.
  ['panel asks the host for its workspaces', asked.includes('workspaces')],
  ['the workspace picker lists existing workspaces', count('lm-select') >= 1],
  // Right pane before a room is picked keeps the node view.
  ['right pane asks the host for the agent list', asked.includes('agents')],
  ['renders the local agent', lastText.includes('echo-worker')],
  ['renders the stored agent', lastText.includes('stored-one')],
  ['marks the live agent as running', lastText.includes('运行中')],
  ['marks the stored agent as stored', lastText.includes('已存盘')],
  ['offers to bring a stored agent in', lastText.includes('引入')],
  ['renders the remote agent', lastText.includes('beta-worker')],
  ['marks the dialled agent as reached', lastText.includes('已联络')],
  ['renders the remote node name', lastText.includes('Far machine')],
  // The raw session id is no longer rendered as text; it survives only as the
  // hover title, so a reader never has to parse "node-b/session-9".
  ['keeps the session id out of the visible text', !lastText.includes('node-b/session-9')],
  [
    'hides the remote agent address in a tooltip',
    lastNodes.some((entry) => entry.props?.title === 'node-b/session-9'),
  ],
];

// Picking a room the session leads turns the right pane into that room.
await click('lm-roomRow');
if (!asked.includes('roomDetail')) throw new Error('selecting a room never asked for roomDetail');

checks.push(
  ['selecting a room opens its detail', lastText.includes('ship the panel')],
  ['room pane renders a chat area', count('lm-chat') >= 1],
  ['room pane renders the conversation', lastText.includes('hello from beta')],
  ['room pane leaves task notices out of the chat', !lastText.includes('ASSIGNED Split the panel')],
  // The body goes through the shell's Markdown renderer, and each bubble names
  // its sender in bold so two dense messages never blur into one another.
  ['both message bodies render as markdown', count('stubMarkdown') === 2],
  ['every bubble names its sender in bold', count('lm-bubbleWho') === 2],
  ['own message is the only mine bubble', count('lm-bubbleMine') === 1 && lastText.includes('mine here')],
  // Every chip has the base dot class; the offline one adds the idle modifier.
  ['every member chip carries a dot', count('lm-mdot') === 4],
  ['offline member gets the idle dot', count('lm-mdotIdle') === 1],
  ['leader sees the rename button', count('lm-renameBtn') === 1],
  ['only the local agent can be opened as a session', count('lm-openSession') === 1],
  ['room pane lists its tasks', lastText.includes('Split the panel')],
  ['room pane has a composer', count('lm-sayBtn') === 1],
);

// Typing "@" opens the member picker; the rows are labelled with session
// titles, never with the raw session id.
await typeInto('lm-textarea', '@');
const mentionRowLabels = () =>
  lastNodes
    .filter((entry) => hasClass(entry, 'lm-mentionName'))
    .map((entry) => (entry.children ?? []).map(String).join(''));
checks.push(
  ['typing at sign opens the member picker', count('lm-mentionItem') === 4],
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
await typeInto('lm-textarea', '@bet', 4);
checks.push(['a prefix narrows the picker', count('lm-mentionItem') === 2 && lastText.includes('Beta rollout')]);

// Enter takes the highlighted row and rewrites the token to the title.
const accepted = await press('lm-textarea', 'Enter');
checks.push(
  ['enter accepts the highlighted member', accepted === true],
  ['accepting rewrites the token to the title', count('lm-mentionItem') === 0],
  [
    'the composer now holds the mention',
    lastNodes.some((entry) => hasClass(entry, 'lm-textarea') && entry.props.value === '@Beta rollout '),
  ],
);

// Escape dismisses without touching the draft.
await typeInto('lm-textarea', '@b', 2);
await press('lm-textarea', 'Escape');
checks.push(
  ['escape closes the picker', count('lm-mentionItem') === 0],
  [
    'escape keeps the draft intact',
    lastNodes.some((entry) => hasClass(entry, 'lm-textarea') && entry.props.value === '@b'),
  ],
);

// An "@" glued to a word is an email address, not a mention.
await typeInto('lm-textarea', 'mail@bet', 8);
checks.push(['an at sign inside a word is not a mention', count('lm-mentionItem') === 0]);

// The identity line shows the session title instead of the session id.
checks.push([
  'rail shows the session title, not its id',
  lastText.includes('Panel polish') && !lastText.includes('session-1'),
]);

// The member shortcut must actually reach the client services.
await click('lm-openSession');
checks.push(
  ['opening a session calls uiWorkspace.openSession', opened.length === 1 && opened[0] === 'session-1'],
  ['opening a session leaves the panel', selectPanelCalls.length === 1 && selectPanelCalls[0] === null],
);

// Switching to a room this session only belongs to hides the leader controls.
await click('lm-roomRow', 1);

checks.push(
  ['switching rooms re-reads the detail', asked.filter((name) => name === 'roomDetail').length >= 2],
  ['non-leader sees no rename button', count('lm-renameBtn') === 0],
  ['non-leader may leave the room', count('lm-leaveBtn') === 1],
  ['empty conversation says so', lastText.includes('房间里还没有消息')],
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
    'a degraded boot still registers both slots',
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
  'both entries wait for their slot owner to declare it',
  injectedSlots.includes('main') && injectedSlots.includes('sidebar.panellist'),
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
