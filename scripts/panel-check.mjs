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
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

let renderedMessageKeys=[];
const h = (type, props, ...children) => {if(type?.name==='ChatBubble')renderedMessageKeys.push(props?.key);return {type,props:props??{},children:children.flat()};};

/** Hook state survives across renders, the way real hooks do. */
const stateSlots = [];
const effectSlots = [];
const hookValues=()=>stateSlots.map(slot=>slot&&typeof slot==='object'&&Object.hasOwn(slot,'record')&&Object.hasOwn(slot,'value')?(slot.name?slot.record.values[slot.name]:slot.value):slot);
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
  crypto: webcrypto,
};
const styleNodes=new Map();
const document = {
  documentElement: { lang: 'zh', dataset: {} },
  head: { appendChild(node) {styleNodes.set(node.id,node);} },
  getElementById: id => styleNodes.get(id) ?? null,
  createElement: tag => ({tagName:tag.toUpperCase(),dataset:{},textContent:'',append() {}}),
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
remoteAgent.nodeName = 'Work laptop';
offlinePeer.nodeName = 'Home desktop';
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
    roomAttachmentLimits:{maxFileBytes:20971520,maxTotalBytes:209715200,maxMessageBytes:41943040,maxAttachments:8},
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
        {
          id: 'i7', kind: 'note',
          from: { nodeId: 'node-b', sessionId: 'human', title: 'Remote human' },
          text: 'a remote human note', read: false,
          receivedAt: '2026-01-01T10:10:00.000Z',
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
        status: 'running',
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
          file:{name:'legacy.txt',type:'text/plain',size:5,data:'data:text/plain;base64,aGVsbG8='},
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
        {
          // Historical skill references, all three states at once: one this node
          // holds from the same source, one it holds only as a different skill
          // that shares the name, and one it does not have at all. All three must
          // render, and only the last may say "not installed".
          id: 'm4',
          kind: 'room-message',
          room: 'room-1',
          from: { nodeId: 'node-b', name: 'beta-worker', sessionId: 'session-9' },
          to: 'node-a',
          text: 'try these',
          receivedAt: '2026-01-01T10:04:00.000Z',
          structuredMentions: [],
          skillRefs: [
            { name: 'digest', sourceNodeId: 'node-a', sourceNodeName: 'Local node' },
            { name: 'digest', sourceNodeId: 'node-b', sourceNodeName: 'Far machine' },
            { name: 'ghost-skill', sourceNodeId: 'node-z', sourceNodeName: 'Unreachable' },
          ],
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
  // A successful send: with no delivery failures the composer clears itself,
  // which is what the reference-clearing assertions below observe.
  roomSay: { delivered: [] },
  // The node's public skill catalogue. Two rows deliberately share a name to
  // stand in for the case where the source node is the only thing telling two
  // identically named skills apart.
  roomSkills: {
    status: 'ready',
    skills: [
      {
        name: 'deploy',
        description: 'Ship the current branch',
        sourceNodeId: 'node-a',
        sourceNodeName: 'Local node',
      },
      {
        name: 'deploy',
        description: 'Ship from the far machine',
        sourceNodeId: 'node-b',
        sourceNodeName: 'Far machine',
      },
      {
        name: 'digest',
        description: 'Summarise the day',
        sourceNodeId: 'node-a',
        sourceNodeName: 'Local node',
      },
    ],
  },
};

const asked = [];
const requested = [];
let agentsGate,snapshotGate,snapshotFailure=false,snapshotOverride;
let uploadFailure=false,sendFailure=false,uploadGate,joinFailure=false,emulateRoomRead=false;
const uploaded=[];
const fetch = async (route, init) => {
  if(route.startsWith('/api/lan-mesh/attachments?')){
    if(uploadGate)await uploadGate;
    if(uploadFailure)throw Error('upload offline');
    const q=new URL(route,'http://local').searchParams;
    const ref={blobId:q.get('blobId'),name:q.get('name'),size:Number(q.get('size')),mediaType:init.headers['content-type'],ownerNodeId:'node-a'};
    uploaded.push(ref);return {ok:true,json:async()=>ref};
  }
  const body = JSON.parse(init.body);
  const endpoint = body.payload.method;
  const payload = body.payload.payload ?? {};
  asked.push(endpoint);
  requested.push({ endpoint, payload });
  if(endpoint==='snapshot'){const gate=snapshotGate,override=snapshotOverride;if(gate)await gate;if(snapshotFailure)throw Error('Local service unreachable');if(override)return {ok:true,json:async()=>({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:override}})};}
  if(endpoint==='roomSay'&&sendFailure)throw Error('Leader unavailable');
  if (endpoint === 'markRead') {
    for (const message of answers.snapshot.inbox.messages) {
      if ((!payload.messageId || payload.messageId === message.id)&&(!payload.fromNodeId||payload.fromNodeId===message.from?.nodeId)) message.read = true;
    }
    answers.snapshot.inbox.unread = answers.snapshot.inbox.messages.filter(message => !message.read && !(message.from?.nodeId === 'node-a' && (!message.from.sessionId || message.from.sessionId === 'human'))).length;
    return { ok: true, json: async () => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: answers.snapshot.inbox } }) };
  }
  if (endpoint === 'agentRegistry') return {ok:true,json:async()=>({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{agents:[{agentId:'agent-fixture',name:'Registry fixture',authorityNodeId:'node-a',revision:1,bindings:[]}]}}})};
  if (endpoint === 'agents' && agentsGate) await agentsGate;
  if (endpoint === 'roomJoin') {
    if(joinFailure)throw Error('Join rejected for verification');
    const joined = { ...strangerRoom, isMember: true, role: 'member' };
    answers.snapshot.rooms.mine.push(joined);
    answers.snapshot.rooms.all = answers.snapshot.rooms.all.map(room => room.id === joined.id ? joined : room);
    return { ok: true, json: async () => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { room: joined, added: true } } }) };
  }
  if (endpoint === 'roomLifecycle') {
    const rows=answers.snapshot.rooms;
    rows.archived??=[];
    const room=[...rows.mine,...rows.archived].find(row=>row.id===payload.roomId);
    room.lifecycle={status:payload.status,generation:(room.lifecycle?.generation??0)+1};
    rows.mine=rows.mine.filter(row=>row.id!==room.id);rows.archived=rows.archived.filter(row=>row.id!==room.id);rows.all=rows.all.filter(row=>row.id!==room.id);
    if(payload.status==='archived')rows.archived.push(room);else {rows.mine.push(room);rows.mine.sort((a,b)=>a.name.localeCompare(b.name));rows.all.push({...room,isMember:true});}
    return {ok:true,json:async()=>({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{room}}})};
  }
  if (endpoint === 'roomPreferences') {
    const room = answers.snapshot.rooms.mine.find(row=>row.id===payload.roomId);
    room.localPreferences = {...room.localPreferences,...payload.patch};
    return {ok:true,json:async()=>({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:room.localPreferences}})};
  }
  if (answers[endpoint] === undefined) throw new Error(`unexpected endpoint ${endpoint}`);
  if(endpoint==='roomDetail'&&emulateRoomRead){for(const message of answers.snapshot.inbox.messages)if(message.room===payload.room)message.read=true;answers.snapshot.inbox.unread=answers.snapshot.inbox.messages.filter(message=>!message.read&&!(message.from?.nodeId==='node-a'&&(!message.from.sessionId||message.from.sessionId==='human'))).length;}
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

const intervals = new Map();
let intervalId = 0;
const context = vm.createContext({
  window,
  document,
  crypto: window.crypto,
  URL, URLSearchParams, AbortController,
  localStorage: window.localStorage,
  require,
  fetch,
  console,
  // The panel polls; the harness drives refreshes by hand.
  setInterval: (fn, ms) => { const id = ++intervalId; intervals.set(id, { fn, ms }); return id; },
  clearInterval: (id) => intervals.delete(id),
});
vm.runInContext(source.replace('    function DocumentsPane(props) {','    window.__documentsPane = DocumentsPane;\n    function DocumentsPane(props) {').replace('    function RoomPane(props) {','    window.__roomPane = RoomPane; window.__dropComposerDraft=scope=>roomComposerDrafts.drop(scope);\n    function RoomPane(props) {').replace('    function AttachmentCard(', '    window.__attachmentCard = AttachmentCard;\n    function AttachmentCard('), context);
const loaded = window.__loaded;

const opened = [];
const selectPanelCalls = [];
let sidebarToggleCount=0;
const registrations = [];
const navigation = {
  layout: { selectPanel: (id) => selectPanelCalls.push(id),toggleSidebar:()=>{sidebarToggleCount++;} },
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
let lastTree;
let lastText = '';

/** Two components use separate hook position spaces, like two real components. */
const resetHooks = () => {
  for (const slot of effectSlots) slot?.cleanup?.();
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
  renderedMessageKeys=[];
  const nodes = [];
  const text = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      text.push(String(node));
      return node;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (typeof node.type === 'function') {
      return walk(node.type(node.props ?? {}));
    }
    nodes.push(node);
    return {...node,children:(node.children??[]).map(walk)};
  };
  lastTree=walk(component());
  lastNodes = nodes;
  lastText = text.join(' ');
};

function captureDraftFixture(name){
 if(name.startsWith('tabs-')?process.env.MESH_ROOM_TABS_CAPTURE!=='1':name.startsWith('body-')?process.env.MESH_BODY_CAPTURE!=='1':name==='grouped'?process.env.MESH_ROOM_CAPTURE!=='1':process.env.MESH_DRAFT_CAPTURE!=='1')return;
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const render=node=>{
  if(node==null||typeof node==='boolean')return '';
  if(Array.isArray(node))return node.map(render).join('');
  if(typeof node!=='object')return escape(node);
  const props=node.props??{},type=node.type;if(type==='Fragment')return (node.children??[]).map(render).join('');
  const attributes=Object.entries(props).filter(([key,value])=>!key.startsWith('on')&&!['ref','key','children','style'].includes(key)&&(typeof value==='string'||typeof value==='number'||value===true)).map(([key,value])=>{
   if(type==='textarea'&&key==='value')return '';
   if(key==='src'&&String(value).startsWith('blob:'))value='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#edf0f5"/><text x="16" y="22" text-anchor="middle" font-size="18">图</text></svg>');
   return ' '+(key==='className'?'class':key==='tabIndex'?'tabindex':key)+'="'+escape(value===true?'':value)+'"';
  }).join('');
  const style=props.style?Object.entries(props.style).filter(([,v])=>v!=null).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+(typeof v==='number'&&v!==0&&!['opacity','flex','flexGrow','flexShrink','zIndex','fontWeight','lineHeight'].includes(k)?v+'px':v)).join(';'):'';
  return '<'+type+attributes+(style?' style="'+escape(style)+'"':'')+'>'+(type==='textarea'?escape(props.value??''):(node.children??[]).map(child=>render(type==='select'&&child?.type==='option'?{...child,props:{...child.props,selected:child.props.value===props.value}}:child)).join(''))+(['input','img','br','hr'].includes(type)?'':'</'+type+'>');
 };
 const directory=join(here,'..','docs','ux',name.startsWith('tabs-')?'ux2c-room-preview':name.startsWith('body-')?'ux2b-body-preview':name==='grouped'?'ux2a-message-preview':'ux1e-drafts-preview');mkdirSync(directory,{recursive:true});
 const css=source.match(/const CSS = `([\s\S]*?)`;/)[1];
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>草稿恢复组件取证</title><style>:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f6f7f9;--dsw-alias-bg-layer-2:#edf0f5;--dsw-alias-label-primary:#20242c;--dsw-alias-label-secondary:#616b79;--dsw-alias-label-tertiary:#6a7482;--dsw-alias-border-l1:#e3e7ed;--dsw-alias-border-l2:#bbc3cf;--dsw-alias-brand-primary:#315ecc;--dsw-alias-state-warn:#8a5b12}*{box-sizing:border-box}body{margin:0;height:100dvh;font:14px/1.5 Segoe UI,Microsoft YaHei,sans-serif;color:#20242c}.fixture-note{padding:8px 14px;height:36px;background:#edf0f5;font-size:12px}main{height:calc(100dvh - 36px)}'+css+'main.lm-panel{height:calc(100dvh - 36px);min-height:0}.stubMarkdown{white-space:pre-wrap}body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}@media(prefers-color-scheme:dark){:root{--dsw-alias-bg-base:#15191f;--dsw-alias-bg-layer-1:#1b2028;--dsw-alias-bg-layer-2:#242b35;--dsw-alias-label-primary:#e6eaf0;--dsw-alias-label-secondary:#acb7c7;--dsw-alias-border-l1:#343e4d;--dsw-alias-border-l2:#455166;--dsw-alias-brand-primary:#8baaff}.fixture-note{background:#242b35}}</style><div class="fixture-note">实际Room组件 / 模拟Host · '+escape(name)+' · 缩略图为静态导出占位</div><main class="lm-panel">'+render(lastTree)+'</main></html>';
 writeFileSync(join(directory,name+'.html'),html);if(name==='restored'||name==='grouped'||name==='body-collapsed')writeFileSync(join(directory,'index.html'),html);
}

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
  node.props.onClick({ preventDefault() {}, stopPropagation() {},currentTarget:{focus(){}} });
  await settleIn(component);
};
const click = (token, at = 0) => clickOn(Component, token, at);
const clickRail = (token, at = 0) => clickOn(RailHost, token, at);

// The rail is mounted in the native sidebar and loads its own snapshot.
await switchTo(RailHost);

const checks = [
  ['boot installs current workbench CSS in the actual style slot',styleNodes.size===1&&styleNodes.get('dsh-lan-mesh-styles')?.textContent.includes('.lm-projectEntry')&&styleNodes.get('dsh-lan-mesh-styles')?.dataset.lanMeshVersion===JSON.parse(readFileSync(join(here,'..','package.json'),'utf8')).version],
  ['rail spins only for the running catalogue row', count('lm-agentSpinner') === 1 && lastNodes.some(n => hasClass(n, 'lm-agentSpinner') && n.props['aria-label'] === '运行中')],
  ['rail requests only local agents', requested.filter(r => r.endpoint === 'agents').every(r => r.payload.localOnly === true)],
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
  ['return to native conversation has an explicit accessible name', lastNodes.some(n=>hasClass(n,'lm-conversation')&&n.props['aria-label']==='返回对话')],
  ['workbench brand separates versions into expandable identity details',count('lm-workbenchHeader')===1&&count('lm-versionDetails')===1],
  ['project settings are accessible row-end actions',lastNodes.filter(n=>n.type==='summary'&&n.props['aria-label']?.startsWith('项目操作')).length===2&&!lastText.includes('房间设置')],
  ['the rail shows the configured identity', lastText.includes('建哥') && lastText.includes('node-a')],
  [
    'the rail shows inbox and the task board',
    lastText.includes('收件箱') && lastText.includes('任务看板') && count('lm-navBtn') >= 3,
  ],
  ['the projects section lists the rooms I joined', count('lm-roomRow') === 2],
  ['each joined room offers local preferences', count('lm-roomPreferences') === 2 && lastText.includes('静音时被 @ 仍提醒')],
  ['the projects section shows both joined rooms', lastText.includes('Alpha room') && lastText.includes('Gamma side project')],
  ['the projects section badges unread room messages', count('lm-roomUnread') === 1 && lastText.includes('2')],
  ['the projects section offers a new project', count('lm-projectsAdd') === 1],
  ['project discovery is a compact entry instead of persistent join cards', count('lm-discoverTrigger')===1 && count('lm-joinBtn')===0],
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

lastNodes.find(n=>hasClass(n,'lm-projectSearch')).props.onChange({target:{value:'Alpha'}});await settleRail();
checks.push(['joined project search filters without changing room identity',count('lm-roomRow')===1&&lastText.includes('Alpha room')]);
lastNodes.find(n=>hasClass(n,'lm-projectSearch')).props.onChange({target:{value:'missing project'}});await settleRail();
checks.push(['joined search distinguishes no match from no membership',count('lm-roomRow')===0&&lastText.includes('没有匹配')]);
lastNodes.find(n=>hasClass(n,'lm-projectSearch')).props.onChange({target:{value:''}});await settleRail();
checks.push(['clearing project search restores original joined rows',count('lm-roomRow')===2]);
// Drive the rail's actual timer. Slow calls cannot queue another poll, and a
// subsequent local catalogue change must replace the running indicator.
const railTimer = [...intervals.values()].find(timer => timer.ms === 4000);
const beforePoll = asked.filter(e => e === 'agents').length;
let releaseAgents;
agentsGate = new Promise(resolve => { releaseAgents = resolve; });
railTimer.fn();
railTimer.fn();
checks.push(['slow catalogue polls never overlap', asked.filter(e => e === 'agents').length === beforePoll + 1]);
releaseAgents();
agentsGate = undefined;
await settleRail();
answers.agents.agents[0].status = 'idle';
railTimer.fn();
await settleRail();
checks.push(['four-second poll clears a finished agent spinner', count('lm-agentSpinner') === 0]);
answers.agents.agents[0].status = 'running';
railTimer.fn();
await settleRail();
checks.push(['four-second poll detects a running agent', count('lm-agentSpinner') === 1]);

// Picking a channel for a held notification calls the Host's confirm endpoint,
lastNodes.find(entry=>hasClass(entry,'lm-pref-muted')).props.onChange({target:{checked:true}});
await settleRail();
checks.push(['room mute saves through Host and refreshes its indicator', asked.includes('roomPreferences') && count('lm-pref-muted')===2 && lastText.includes('静音')]);
await clickRail('lm-archiveRoom');
checks.push(['archive hides active row and archived history is collapsed by default',count('lm-roomRow')===1&&count('lm-archivedRoom')===0]);
await clickRail('lm-archivedToggle');
checks.push(['archived entry offers history and Leader restore',count('lm-archivedRoom')===1&&count('lm-restoreRoom')===1]);
await clickRail('lm-restoreRoom');
checks.push(['restore returns archived room to active list',count('lm-roomRow')===2&&count('lm-archivedRoom')===0]);

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
const afterUnmount = asked.filter(e => e === 'agents').length;
railTimer.fn();
checks.push(['unmount removes and disables the rail poll', ![...intervals.values()].includes(railTimer) && asked.filter(e => e === 'agents').length === afterUnmount]);
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
  ['room offers explicit earlier history loading',count('lm-loadEarlier')===1],
  ['room pane renders a chat area', count('lm-chat') >= 1],
  ['historical inline files retain download links',lastNodes.some(n=>n.type==='a'&&n.props.download==='legacy.txt'&&n.props.href==='data:text/plain;base64,aGVsbG8=')],
  ['room pane renders the conversation', lastText.includes('hello from beta')],
  ['room pane leaves task notices out of the chat', !lastText.includes('ASSIGNED Split the panel')],
  // The chat pane is a scroll container the pane scrolls to the bottom on entry
  // and on new arrivals; the effect must not throw when the ref is not bound
  // yet (the render-only harness), and the container keeps its scroll class.
  ['the chat pane is the scroll target', lastNodes.some((entry) => hasClass(entry, 'lm-chat') && entry.props?.ref !== undefined)],
  // The body goes through the shell's Markdown renderer, and each bubble names
  // its sender in bold so two dense messages never blur into one another.
  ['both message bodies render as markdown', count('stubMarkdown') === 3],
  ['room message bodies expose original-source copy actions',count('lm-messageCopy')===3],
  ['every bubble names its sender in bold', count('lm-bubbleWho') === 3],
  ['room author rows expose speaker kind and exact device identity', count('lm-messageKind')===3 && count('lm-messageDevice')===3 && lastText.includes('node-b')],
  ['every room message keeps an exact timestamp and stable message id', lastNodes.filter(n=>hasClass(n,'lm-bubbleRow')).every(n=>typeof n.props['data-message-id']==='string') && lastNodes.filter(n=>n.type==='time'&&hasClass(n,'lm-bubbleWhen')).length===3],
  // The speaker kind decides the tint: a remote agent and the local person must
  // not read as the same bubble.
  ['a person speaks in the human tint', count('lm-bubbleHuman') === 1],
  ['a synced agent speaks in the agent tint', count('lm-bubbleAgent') === 2],
  ['own message is the only mine bubble', count('lm-bubbleMine') === 1 && lastText.includes('mine here')],
  ['own room messages use the configured identity', lastText.includes('建哥')],
  // A message's skill references come back from the stored transcript, so a
  // reopened room still shows what the sender pointed at.
  [
    'historical messages restore their skill references',
    count('lm-skillRef') === 3 &&
      lastText.includes('digest') &&
      lastText.includes('ghost-skill'),
  ],
  // Same name, different source: this node does have a `digest`, but not the one
  // the far machine pointed at, so it must be neither "identical" nor "missing".
  [
    'a same-named skill from another node is neither matched nor called missing',
    count('lm-skillRefNamesake') === 1 &&
      lastNodes.some(
        (entry) => hasClass(entry, 'lm-skillRefNamesake') && entry.props?.title?.includes('不一定是同一个'),
      ),
  ],
  // One of the three references is genuinely absent here: it must say so rather
  // than vanish.
  [
    'a reference this node cannot resolve is marked, the others are not',
    count('lm-skillRefMissing') === 1 &&
      lastNodes.some((entry) => hasClass(entry, 'lm-skillRef') && entry.props?.title?.includes('Unreachable')),
  ],
  // The chip always names the source node: two nodes may both ship `deploy`.
  [
    'a restored reference names its source node',
    lastText.includes('来自 Local node') &&
      lastText.includes('来自 Far machine') &&
      lastText.includes('来自 Unreachable'),
  ],
);

// The member row is collapsed by default to keep the room focused on the
// conversation; expand it before checking chips and kick buttons.
checks.push(['Room exposes four separate content tabs with one selected conversation',lastNodes.filter(n=>n.props.role==='tab').length===4&&lastNodes.filter(n=>n.props.role==='tab'&&n.props['aria-selected']===true).length===1&&lastNodes.some(n=>n.props.role==='tabpanel'&&hasClass(n,'lm-chatView'))]);
await typeInto('lm-composerInput','draft survives room tabs');
await click('lm-badgeBtn');
checks.push(['member summary enters a dedicated panel with exact device identities',count('lm-memberDevice')===4&&count('lm-composerInput')===0&&lastNodes.some(n=>n.props.role==='tabpanel'&&hasClass(n,'lm-memberPanel'))]);
captureDraftFixture('tabs-members');
const memberObservation={dots:count('lm-mdot'),idle:count('lm-mdotIdle'),kicks:count('lm-kickBtn'),invites:count('lm-inviteRow'),humanSafe:!chipHasKick('node-a/human')&&chipHasKick('node-b/session-9')&&chipHasKick('node-c/session-7')};
await click('lm-roomTab-tasks');const taskListVisible=lastText.includes('Split the panel');
captureDraftFixture('tabs-tasks');
checks.push(['tasks have a dedicated panel with original assignment form and no chat overlay',count('lm-taskList')===1&&count('lm-assignBtn')===1&&count('lm-chat')===0]);
await click('lm-roomTab-chat');
captureDraftFixture('tabs-chat');
checks.push(['switching member and task tabs retains the chat draft',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='draft survives room tabs']);
await typeInto('lm-composerInput','');
checks.push(
  // Every chip has the base dot class; the offline one adds the idle modifier.
  ['every member chip carries a dot', memberObservation.dots === 4],
  ['offline member gets the idle dot', memberObservation.idle === 1],
  ['leader sees the rename button', count('lm-renameBtn') === 1],
  ['room pane lists its tasks', taskListVisible],
  ['room pane has a composer', count('lm-sendBtn') === 1],
  // The composer is the shell-shaped card (22px radius, elevation stroke) with
  // the attachment and quick-task affordances in a toolbar under the input,
  // matching dsh-agent-team's composer instead of a bare form row.
  ['composer renders as a single card', count('lm-composerCard') === 1],
  ['composer toolbar carries the attach button', count('lm-attachBtn') === 1],
  ['skill picker is an accessible icon button', lastNodes.some(n => hasClass(n, 'lm-skillBtn') && n.props['aria-label'] === '插入技能引用' && n.children.some(c => c?.type === 'svg'))],
  ['leader can mark a message as task', lastNodes.some(n => hasClass(n, 'lm-taskPill') && n.props.disabled === false)],
  ['room pane has a back button', count('lm-backBtn') === 1],
  // v0.2.1: the leader may kick peers (never the human, never itself, and only
  // when this pane actually owns the leader role).
  ['leader sees a kick button per peer', memberObservation.kicks === 2],
  // v0.2.1: the leader may pull a local session into the room it leads.
  ['the leader sees the invite row', memberObservation.invites === 1],
  // The kick button belongs to the chip of a remote peer, never to the chip of
  // the human member (a human session is not something a leader may eject).
  [
    'the human member has no kick button',
    memberObservation.humanSafe,
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
    'cross-machine duplicate titles get machine names in the picker',
    mentionRowLabels().includes('Beta rollout · Work laptop') &&
      mentionRowLabels().includes('Beta rollout · Home desktop'),
  ],
  ['a unique title also identifies its machine', mentionRowLabels().includes('Panel polish · node-a')],
);

// A prefix narrows the list; the caret keeps the menu anchored to the token.
await typeInto('lm-composerInput', '@bet', 4);
checks.push(['a prefix narrows the picker', count('lm-mentionItem') === 2 && lastText.includes('Beta rollout')]);

// Enter takes the highlighted row and rewrites the token to the title.
const accepted = await press('lm-composerInput', 'Enter');
const selectedMention = hookValues().flatMap((slot) => Array.isArray(slot) ? slot : [])
  .find((item) => item?.memberKey === 'node-c/session-7');
checks.push(
  ['selected mention retains member identity separately from text', selectedMention?.label === 'Beta rollout'],
  ['enter accepts the highlighted member', accepted === true],
  ['accepting rewrites the token to the title', count('lm-mentionItem') === 0],
  [
    'the composer now holds the mention',
    lastNodes.some((entry) => hasClass(entry, 'lm-composerInput') && entry.props.value === '@Beta rollout '),
  ],
);

await click('lm-sendBtn');
const exactRequest = requested.filter(row => row.endpoint === 'roomSay').at(-1);
checks.push(['ordinary messages do not silently opt into context delivery',exactRequest.payload.contextSelection===undefined]);
checks.push(['composer serializes only exact selected identity and label', exactRequest?.payload.mentions?.[0]?.memberKey === 'node-c/session-7' && !('start' in exactRequest.payload.mentions[0])]);
await typeInto('lm-composerInput', '@bet');
await press('lm-composerInput', 'Enter');
const selectedText = lastNodes.find(entry => hasClass(entry, 'lm-composerInput')).props.value;
await typeInto('lm-composerInput', selectedText + '@all');
await press('lm-composerInput', 'Enter');
checks.push(['choosing all clears individual reference identities', !hookValues().some(slot => Array.isArray(slot) && slot.some(item => item?.memberKey))]);
await click('lm-sendBtn');
const allRequest = requested.filter(row => row.endpoint === 'roomSay').at(-1);
checks.push(['broadcast alongside selected individual sends readable all without exact filter', /@all(?:\s|$)/.test(allRequest?.payload.text ?? '') && allRequest?.payload.mentions === undefined]);

// Removing a selected token must remove its identity even if identical text
// remains elsewhere in the draft.
await typeInto('lm-composerInput', '');
await typeInto('lm-composerInput', '@Beta rollout @bet', 18);
await press('lm-composerInput', 'Enter');
await typeInto('lm-composerInput', '@Beta rollout ');
checks.push(['editing out the selected token drops its identity',
  !hookValues().some((slot) => Array.isArray(slot) && slot.some((item) => item?.memberKey))]);

// Same-machine duplicates need session IDs as a final discriminator.
await typeInto('lm-composerInput', '');
await typeInto('lm-composerInput', '@bet');
await press('lm-composerInput', 'Enter');
await typeInto('lm-composerInput', '@Beta rollout @Beta rollout ');
await typeInto('lm-composerInput', '@Beta rollout ');
checks.push(['deleting the selected first duplicate never transfers identity to typed text',
  !hookValues().some((slot) => Array.isArray(slot) && slot.some((item) => item?.memberKey))]);
await typeInto('lm-composerInput', '');
await typeInto('lm-composerInput', '@bet');
await press('lm-composerInput', 'Enter');
await typeInto('lm-composerInput', '@Beta rolloutX ');
checks.push(['appending to the mention label invalidates selected identity',
  !hookValues().some((slot) => Array.isArray(slot) && slot.some((item) => item?.memberKey))]);

remoteAgent.nodeName = offlinePeer.nodeName = 'Shared workstation';
offlinePeer.nodeId = 'node-b';
await typeInto('lm-composerInput', '@');
checks.push(['same-machine duplicate titles append session IDs',
  mentionRowLabels().includes('Beta rollout · Shared workstation · session-9') &&
  mentionRowLabels().includes('Beta rollout · Shared workstation · session-7')]);
offlinePeer.nodeId = 'node-c';
remoteAgent.nodeName = 'Work laptop';
offlinePeer.nodeName = 'Home desktop';

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

// ——— skill references ———
// Typing "/" at the start of a line opens the same catalogue the toolbar
// button opens. The catalogue came from the Host, not from the client.
await typeInto('lm-composerInput', '/', 1);
const skillRowLabels = () =>
  lastNodes
    .filter((entry) => hasClass(entry, 'lm-skillName'))
    .map((entry) => (entry.children ?? []).map(String).join(''));
checks.push(
  ['the Host skill catalogue is requested once the room opens', asked.includes('roomSkills')],
  ['typing a slash opens the skill picker', count('lm-skillItem') === 3],
  // Two nodes offer a skill named `deploy`. Both rows must be listed: folding
  // them would silently pick one machine on the user's behalf.
  [
    'identically named skills from two nodes are not folded',
    skillRowLabels().filter((text) => text === '/deploy').length === 2,
  ],
  [
    'every skill row names the node it came from',
    lastText.includes('来自 Local node') && lastText.includes('来自 Far machine'),
  ],
  // The composer's own toolbar carries the same affordance, so a user who does
  // not know the slash convention still finds it.
  ['the composer toolbar carries the skill button', count('lm-skillBtn') === 1],
);

// Enter confirms a reference: the token leaves the text and a chip appears.
await press('lm-composerInput', 'Enter');
const pickedSkill = hookValues().flatMap((slot) => (Array.isArray(slot) ? slot : []))
  .find((item) => item?.name === 'deploy');
checks.push(
  ['confirming a skill creates a reference with its source node', pickedSkill?.sourceNodeId === 'node-a'],
  ['confirming a skill closes the picker', count('lm-skillItem') === 0],
  ['the confirmed skill renders as a chip', count('lm-skillChip') === 1 && lastText.includes('来自 Local node')],
  // The menu consumed the token: the message reads as prose, not as a command.
  [
    'the confirmed token is removed from the draft',
    lastNodes.some((entry) => hasClass(entry, 'lm-composerInput') && entry.props.value === ''),
  ],
);

// Sending carries the reference metadata alongside the text.
await typeInto('lm-composerInput', 'ship it');
await click('lm-sendBtn');
const skillRequest = requested.filter((row) => row.endpoint === 'roomSay').at(-1);
checks.push(
  ['skill references retain readable tokens for legacy recipients', skillRequest?.payload.text.includes('/deploy')],
  [
    'sending serializes the confirmed skill reference',
    skillRequest?.payload.skillRefs?.length === 1 &&
      skillRequest.payload.skillRefs[0].name === 'deploy' &&
      skillRequest.payload.skillRefs[0].sourceNodeId === 'node-a' &&
      skillRequest.payload.skillRefs[0].sourceNodeName === 'Local node',
  ],
  // A reference is a hint: it must never travel as an instruction to run.
  [
    'a skill reference carries no execution instruction',
    Object.keys(skillRequest?.payload?.skillRefs?.[0] ?? {}).sort().join(',') === 'name,sourceNodeId,sourceNodeName',
  ],
  ['sending clears the confirmed references', !hookValues().flatMap((slot) => (Array.isArray(slot) ? slot : [])).some((item) => item?.name === 'deploy')],
);

// A reference can be dropped again before sending, and dropping it removes the
// metadata rather than only the chip.
await typeInto('lm-composerInput', '/', 1);
await press('lm-composerInput', 'Enter');
await click('lm-skillChipRemove');
checks.push(
  ['a confirmed skill can be removed', count('lm-skillChip') === 0],
  ['removing a skill clears its reference', !hookValues().flatMap((slot) => (Array.isArray(slot) ? slot : [])).some((item) => item?.name === 'deploy')],
);

// Typed text that merely looks like a command stays text. The list may have
// matched nothing; the message must still send as ordinary prose.
await typeInto('lm-composerInput', '/not-a-skill', 12);
await press('lm-composerInput', 'Escape');
await typeInto('lm-composerInput', '/plain/word', 11);
await click('lm-sendBtn');
const plainRequest = requested.filter((row) => row.endpoint === 'roomSay').at(-1);
checks.push(
  ['typed slash text is not a skill reference', plainRequest?.payload.skillRefs === undefined],
  ['typed slash text still reaches the room verbatim', plainRequest?.payload.text === '/plain/word'],
);

// The toolbar button opens the very same menu, with the search box focused on
// an empty query rather than on a slash token.
await click('lm-skillBtn');
checks.push([
  'the toolbar button opens the shared skill menu',
  count('lm-skillItem') === 3 && count('lm-skillSearch') === 1,
]);
// The search box narrows the same list the slash token filters.
await typeInto('lm-skillSearch', 'dig');
checks.push(['searching narrows the skill menu', count('lm-skillItem') === 1 && skillRowLabels()[0] === '/digest']);
await press('lm-composerInput', 'Escape');
checks.push(['escape closes the skill menu', count('lm-skillItem') === 0]);

// A node without a skill registry says so; it never pretends to have none.
const healthyCatalogue = answers.roomSkills;
answers.roomSkills = { status: 'unavailable', skills: [], reason: 'the skill registry is not available on this node' };
// The catalogue is read once when the room mounts, so this needs its own mount.
await switchTo(Component);
await click('lm-skillBtn');
checks.push([
  'an unavailable catalogue is reported as unavailable, not as empty',
  lastText.includes('本机技能目录不可用') && count('lm-skillItem') === 0,
]);
answers.roomSkills = healthyCatalogue;
// Remounting dropped the pane's local state, so the member row the following
// checks read has to be expanded again.
await switchTo(Component);
await click('lm-badgeBtn');

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
await click('lm-roomTab-members');
const nonLeaderMembers={kicks:count('lm-kickBtn'),invites:count('lm-inviteRow')};
await click('lm-roomTab-chat');
checks.push(
  ['switching rooms re-reads the detail', asked.filter((name) => name === 'roomDetail').length >= 2],
  ['non-leader sees no rename button', count('lm-renameBtn') === 0],
  ['non-leader may leave the room', count('lm-leaveBtn') === 1],
  ['non-leader sees no kick button', nonLeaderMembers.kicks===0],
  // A human member who is not the leader may still pull a local session in; the
  // panel only mirrors the server rule, it never decides it.
  ['a human member still sees the invite row', nonLeaderMembers.invites===1],
  ['member sees the disabled task entry with an explanation', lastNodes.some(n => hasClass(n, 'lm-taskPill') && n.props.disabled === true && n.props.title.includes('只有 leader'))],
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
const senderLabels=()=>lastNodes.filter(entry=>hasClass(entry,'lm-inboxRow')).map(entry=>(entry.children?.[0]?.children?.find(child=>child?.type==='strong')?.children??[]).join(''));
await switchTo(RailHost);await clickRail('lm-nav-inbox');await switchTo(Component);
checks.push(
 ['inbox lists only unread replies including local agents and remote humans',count('lm-msg')===4&&lastText.includes('a long note')&&!lastText.includes('my own note')&&lastText.includes('a remote human note')&&lastText.includes('the local agent answered me')&&lastText.includes('beta needs a decision on the header')],
 ['inbox hides read messages',!lastText.includes('a direct note')&&!lastText.includes('I said this into the room')],
 ['inbox names the sender instead of recipient',senderLabels().includes('Beta rollout')&&senderLabels().includes('echo-worker')&&!lastText.includes('发给')],
 ['inbox excludes own human and names remote human',count('lm-msgOut')===0&&senderLabels().includes('Remote human')],
 ['inbox names source rooms without requiring full-body cards',lastNodes.filter(n=>n.type==='span'&&n.children?.includes('Alpha room')).length===2],
 ['all unread rows can select details without auto-read actions',count('lm-inboxRow')===4&&lastNodes.filter(n=>hasClass(n,'lm-inboxRow')).every(n=>typeof n.props.onClick==='function')],
 ['long reminders remain two-line previews in compact list',count('lm-inboxPreview')===4&&!lastText.includes('and finally stops')],
);
const readsBeforeInspect=requested.filter(r=>r.endpoint==='markRead').length;
await click('lm-msg',1);
checks.push(['selecting long reminder shows full body but never marks it read',count('lm-inboxFullText')===1&&lastText.includes('and finally stops')&&count('lm-msg')===4&&requested.filter(r=>r.endpoint==='markRead').length===readsBeforeInspect&&count('lm-chat')===0]);
await click('lm-msg',0);
checks.push(['selecting private reminder alone preserves unread count',count('lm-msg')===4&&answers.snapshot.inbox.messages.find(m=>m.id==='i7').read===false]);
const explicitRead=lastNodes.find(n=>n.type==='button'&&n.children?.includes('标为已读'));await explicitRead.props.onClick();await settle();
checks.push(['explicit read removes only private reminder and sends its source identity',count('lm-msg')===3&&!lastText.includes('a remote human note')&&requested.some(r=>r.endpoint==='markRead'&&r.payload.messageId==='i7'&&r.payload.fromNodeId==='node-b')]);
await click('lm-msg',1);emulateRoomRead=true;
const sourceRoom=lastNodes.find(n=>n.type==='button'&&n.children?.some(c=>typeof c==='string'&&c.startsWith('前往房间')));await sourceRoom.props.onClick();await settle();
checks.push(['source navigation enters Room and uses its normal read semantics',count('lm-chat')===1&&lastText.includes('hello from beta')&&answers.snapshot.inbox.messages.find(m=>m.id==='i4').read===true&&answers.snapshot.inbox.messages.find(m=>m.id==='i1').read===true]);
await switchTo(RailHost);await clickRail('lm-nav-inbox');await switchTo(Component);
checks.push(['returning to Inbox retains authoritative Room read state',!lastText.includes('the local agent answered me')&&count('lm-msg')===1]);
const markAllButton=lastNodes.find(n=>n.type==='button'&&n.children?.includes('全部标为已读'));await markAllButton.props.onClick();await settle();
checks.push(['batch read first explains scope and waits for confirmation',count('lm-msg')===1&&count('lm-inboxConfirm')===1]);
const confirmAll=lastNodes.find(n=>n.type==='button'&&n.children?.includes('确认全部标为已读'));await confirmAll.props.onClick();await settle();
checks.push(['confirmed batch read clears remaining unread snapshot',count('lm-msg')===0&&answers.snapshot.inbox.unread===0]);

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
await clickRail('lm-discoverTrigger');
checks.push(['discovery opens a named nonmodal project panel',count('lm-discoverPanel')===1&&count('lm-joinBtn')===1&&lastNodes.find(n=>hasClass(n,'lm-discoverPanel')).props.id==='lm-discover-projects']);
lastNodes.find(n=>hasClass(n,'lm-discoverSearch')).props.onChange({target:{value:'no such project'}});await settleRail();
checks.push(['discovery search has an explicit empty state',count('lm-joinBtn')===0&&lastText.includes('没有符合条件')]);
lastNodes.find(n=>hasClass(n,'lm-discoverPanel')).props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});await settleRail();
checks.push(['Escape closes discovery without joining',count('lm-discoverPanel')===0]);
await clickRail('lm-discoverTrigger');
checks.push(['discovery preserves search across closing',lastNodes.find(n=>hasClass(n,'lm-discoverSearch')).props.value==='no such project']);
lastNodes.find(n=>hasClass(n,'lm-discoverSearch')).props.onChange({target:{value:'Beta'}});await settleRail();
joinFailure=true;await clickRail('lm-joinBtn');
checks.push(['failed join preserves discovery, search and retryable error',count('lm-discoverPanel')===1&&count('lm-discoverError')===1&&lastNodes.find(n=>hasClass(n,'lm-discoverSearch')).props.value==='Beta']);
joinFailure=false;
await clickRail('lm-joinBtn');
const joinRequest = requested.find(entry => entry.endpoint === 'roomJoin');
checks.push(
  [
    'rail join sends the selected project and configured identity',
    joinRequest?.payload.room === 'room-2' &&
      joinRequest?.payload.sessionId === 'human' &&
      joinRequest?.payload.sessionName === '建哥',
  ],
  ['successful join closes discovery and updates joined projects', count('lm-discoverPanel')===0&&count('lm-joinBtn') === 0 && count('lm-roomRow') === 3],
  ['successful join opens the mesh panel', document.documentElement.dataset.lanMeshMode === 'lanmesh'],
);

// Multi-attachment UI behavior through actual React handlers and byte digests.
await switchTo(RailHost);await clickRail('lm-roomRow');await switchTo(Component);
await typeInto('lm-composerInput','attachment retry');
const image=new File([new Uint8Array([0,255,3])],'test.png',{type:'image/png'});
const ordinary=new File(['doc'],'notes.bin');
let releaseUpload;uploadGate=new Promise(r=>releaseUpload=r);
const input=lastNodes.find(n=>hasClass(n,'lm-fileInput'));
checks.push(['file picker accepts multiple files',input.props.multiple===true]);
input.props.onChange({target:{files:[image,ordinary],value:'selected'}});await settle();
checks.push(['pending uploads block send and show previews',lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.disabled===true&&count('lm-fileChip')===2&&lastText.includes('上传中…')]);
releaseUpload();uploadGate=null;await settle();
checks.push(['multiple uploads become ready without inline data',uploaded.length===2&&uploaded.every(r=>!r.data)&&lastText.includes('已上传')]);
sendFailure=true;await click('lm-sendBtn');
const firstAttempt=requested.filter(r=>r.endpoint==='roomSay').at(-1).payload;
checks.push(['failed send keeps draft and uploaded references',count('lm-fileChip')===2&&lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='attachment retry']);
sendFailure=false;await click('lm-sendBtn');const retried=requested.filter(r=>r.endpoint==='roomSay').at(-1).payload;
checks.push(['send retry retains exact messageId and attachment refs',firstAttempt.messageId===retried.messageId&&retried.attachments.length===2&&JSON.stringify(firstAttempt.attachments)===JSON.stringify(retried.attachments)]);
checks.push(['accepted send clears attachment draft',count('lm-fileChip')===0]);
uploadFailure=true;
lastNodes.find(n=>hasClass(n,'lm-composer')).props.onPaste({clipboardData:{files:[image]},preventDefault(){}});await settle();
checks.push(['pasted image failure is visible and blocks send',count('lm-fileChip')===1&&lastText.includes('upload offline')&&lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.disabled===true]);
uploadFailure=false;const retryButton=lastNodes.find(n=>n.type==='button'&&n.children.includes('重试'));retryButton.props.onClick();await settle();
checks.push(['retry preserves pasted original file',lastText.includes('已上传')]);
await click('lm-fileChipRemove');
lastNodes.find(n=>hasClass(n,'lm-composer')).props.onDrop({dataTransfer:{files:[ordinary]},preventDefault(){}});await settle();
await typeInto('lm-composerInput','');await click('lm-sendBtn');
checks.push(['dropped attachment-only send uses readable filename',requested.filter(r=>r.endpoint==='roomSay').at(-1).payload.text==='notes.bin']);
lastNodes.find(n=>hasClass(n,'lm-composer')).props.onDrop({dataTransfer:{items:[{webkitGetAsEntry:()=>({isDirectory:true})}],files:[]},preventDefault(){}});await settle();
checks.push(['directory drops are rejected',lastText.includes('不支持上传文件夹')]);

let pendingResolve;
let isolatedRoom='room-1';
const isolatedCall=async (method,args)=>method==='roomSay'?new Promise(resolve=>{pendingResolve=resolve;}):method==='roomDetail'?answers.roomDetail[args.room]:{status:'ready',skills:[]};
const Isolated=()=>h(window.__roomPane,{room:{id:isolatedRoom},sessionId:'human',self:answers.snapshot.self,attachmentLimits:answers.snapshot.roomAttachmentLimits,call:isolatedCall});
await switchTo(Isolated);lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'pending original',selectionStart:16}});await settleIn(Isolated);
lastNodes.find(n=>hasClass(n,'lm-fileInput')).props.onChange({target:{files:[ordinary],value:''}});await settleIn(Isolated);
const sending=lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(Isolated);
checks.push(['pending send freezes text and file intake',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.disabled===true&&lastNodes.find(n=>hasClass(n,'lm-fileInput')).props.disabled===true]);
isolatedRoom='room-3';await settleIn(Isolated);
checks.push(['room switch clears attachment chips while send is pending',count('lm-fileChip')===0]);
lastNodes.find(n=>hasClass(n,'lm-fileInput')).props.onChange({target:{files:[image],value:''}});await settleIn(Isolated);
pendingResolve({delivered:[],durableNodes:['node-a']});await sending;await settleIn(Isolated);
checks.push(['old send completion leaves the new room draft intact',count('lm-fileChip')===1]);

const Card=()=>h(window.__attachmentCard,{refData:{blobId:'a'.repeat(64),name:'missing.png',size:3,mediaType:'image/png'},roomId:'room-1'});
await switchTo(Card);lastNodes.find(n=>n.type==='img').props.onError();await settleIn(Card);
checks.push(['unavailable attachment preview offers retry',lastText.includes('附件暂不可用')&&lastNodes.some(n=>n.type==='button'&&n.children.includes('重试'))]);
lastNodes.find(n=>n.type==='button'&&n.children.includes('重试')).props.onClick();await settleIn(Card);
checks.push(['preview retry restores authorized image URL',lastNodes.some(n=>n.type==='img'&&n.props.src.startsWith('/api/lan-mesh/attachments?room=room-1&blobId='))]);
await lastNodes.find(n=>n.type==='button'&&n.children.includes('下载')).props.onClick();await settleIn(Card);
checks.push(['download failure is visible and retryable',lastText.includes('附件暂不可用')&&lastNodes.some(n=>n.type==='button'&&n.children.includes('重试'))]);

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


// Exercise the actual documents component with endpoint DTOs, rather than source checks.
let docConflict=false, docFailure=false, docCalls=[], contextPicked=null;
const docView={documentId:'doc-aaaaaaaaaaaa',roomId:'room-test',title:'Test',headRevisionId:'rev-aaaaaaaaaaaa',contentHash:'a'.repeat(64),content:'original',canConfirm:true,isMaintainer:true};
const docCall=async(method,payload)=>{docCalls.push({method,payload});if(method==='documents')return {status:'ready',documents:[docView]};if(method==='documentRead')return {status:'ready',document:docView,revision:{revisionId:docView.headRevisionId}};if(method==='documentPropose'){if(docFailure)throw Error('offline');return docConflict ? {status:'conflict',proposal:{proposalId:'prop-aaaaaaaaaaaa'}} : {status:'clean'};}if(method==='documentResolve')return {status:'pending',proposal:{proposalId:'prop-aaaaaaaaaaaa'}};if(method==='documentCreate'||method==='documentImport')return {status:'ready',document:docView};if(method==='documentHistory')return {status:'ready',revisions:[{revisionId:'rev-old',message:'old'}],events:[]};return {status:'ready'};};
const DocComponent=()=>window.__documentsPane({roomId:'room-test',call:docCall,isMember:true,contextDocuments:[],onContextSelect:ref=>contextPicked=ref});
const docClick=async(token)=>{const n=lastNodes.find(n=>hasClass(n,token));if(!n)throw Error('missing document control '+token);await n.props.onClick();await settleIn(DocComponent);};
await switchTo(DocComponent);
await docClick('lm-docNewBtn');
for(const [token,value] of [['lm-docTitleInput','New'],['lm-docContentInput','body']]){lastNodes.find(n=>hasClass(n,token)).props.onChange({target:{value}});await settleIn(DocComponent);}
await docClick('lm-docCreateBtn');
checks.push(['documents create passes explicit content',docCalls.some(c=>c.method==='documentCreate'&&c.payload.content==='body')]);
checks.push(['documents read renders server content',lastText.includes('original')]);
const selectContext=lastNodes.find(n=>n.type==='button'&&n.children.includes('选择此版本为上下文'));selectContext.props.onClick();
checks.push(['context pins revision and hash',contextPicked?.revisionId===docView.headRevisionId&&contextPicked?.contentHash===docView.contentHash]);
const editTab=lastNodes.filter(n=>hasClass(n,'lm-docTab'))[1];editTab.props.onClick();await settleIn(DocComponent);
const editor=lastNodes.find(n=>n.type==='textarea'&&n.props.value==='original');editor.props.onChange({target:{value:'changed'}});await settleIn(DocComponent);
docFailure=true;await docClick('lm-docSaveBtn');
checks.push(['document failed save retains draft',lastNodes.some(n=>n.type==='textarea'&&n.props.value==='changed')]);
await docClick('lm-docSaveBtn');const attempts=docCalls.filter(c=>c.method==='documentPropose');
checks.push(['document retries reuse proposal id',attempts.length===2&&attempts[0].payload.proposalId===attempts[1].payload.proposalId]);
docFailure=false;await docClick('lm-docSaveBtn');
checks.push(['document accepted save refreshes head',lastText.includes('original')]);


lastNodes.filter(n=>hasClass(n,'lm-docTab'))[3].props.onClick();await settleIn(DocComponent);
await docClick('lm-docCopyBtn');
checks.push(['history restoration opens proposal editor without changing head',lastNodes.some(n=>hasClass(n,'lm-docSaveBtn'))&&docCalls.filter(c=>c.method==='documentPropose').length===3]);
docConflict=true;await docClick('lm-docSaveBtn');
checks.push(['conflicted proposal opens manual resolution',lastNodes.some(n=>hasClass(n,'lm-docResolutionInput'))]);
await docClick('lm-docResolveBtn');
checks.push(['human resolution requires separate confirmation',docCalls.some(c=>c.method==='documentResolve')&&!docCalls.some(c=>c.method==='documentConfirm')]);
await docClick('lm-docConfirmBtn');
checks.push(['role-authorized confirmation calls endpoint',docCalls.some(c=>c.method==='documentConfirm')]);
const importInput=lastNodes.find(n=>n.props['aria-label']==='导入 Markdown');
await importInput.props.onChange({target:{files:[new File(['imported'],'safe.md')],value:'safe.md'}});await settleIn(DocComponent);
checks.push(['import sends selected file text without host path',docCalls.some(c=>c.method==='documentImport'&&c.payload.content==='imported'&&c.payload.name==='safe.md'&&!('path' in c.payload))]);


const exportButton=lastNodes.find(n=>n.type==='button'&&n.children.includes('下载 Markdown'));await exportButton.props.onClick();await settleIn(DocComponent);
checks.push(['export requests content without host destination path',docCalls.some(c=>c.method==='documentExport'&&!('path' in c.payload))]);
// Two deferred reads resolve in reverse order; only the latest selection wins.

let releaseFirst;
const rowA={...docView,documentId:'doc-aaaaaaaaaaaa',title:'A'};const rowB={...docView,documentId:'doc-bbbbbbbbbbbb',title:'B'};
const racingCall=async(method,payload)=>method==='documents'?{status:'ready',documents:[rowA,rowB]} : (payload.documentId===rowA.documentId ? await new Promise(resolve=>releaseFirst=resolve) : {status:'ready',document:{...rowB,content:'latest B'}});
const RaceComponent=()=>window.__documentsPane({roomId:'room-race',call:racingCall,isMember:true});
await switchTo(RaceComponent);
const raceRows=lastNodes.filter(n=>hasClass(n,'lm-docRow'));const firstRead=raceRows[0].props.onClick();await settleIn(RaceComponent);await raceRows[1].props.onClick();await settleIn(RaceComponent);
releaseFirst({status:'ready',document:{...rowA,content:'stale A'}});await firstRead;await settleIn(RaceComponent);
checks.push(['deferred A read cannot overwrite later B selection',lastText.includes('latest B')&&!lastText.includes('stale A')]);

let releaseSave;
const saveCall=async(method,payload)=>method==='documentPropose'?await new Promise(resolve=>releaseSave=resolve):docCall(method,payload);
const SaveComponent=()=>window.__documentsPane({roomId:'room-old',call:saveCall,isMember:true});
await switchTo(SaveComponent);lastNodes.find(n=>hasClass(n,'lm-docRow')).props.onClick();await settleIn(SaveComponent);lastNodes.filter(n=>hasClass(n,'lm-docTab'))[1].props.onClick();await settleIn(SaveComponent);
const oldSave=lastNodes.find(n=>hasClass(n,'lm-docSaveBtn')).props.onClick();await settleIn(SaveComponent);
await switchTo(DocComponent);await docClick('lm-docNewBtn');lastNodes.find(n=>hasClass(n,'lm-docContentInput')).props.onChange({target:{value:'new room draft'}});await settleIn(DocComponent);
releaseSave({status:'clean'});await oldSave;await settleIn(DocComponent);
checks.push(['old room save receipt preserves new room draft',lastNodes.some(n=>hasClass(n,'lm-docContentInput')&&n.props.value==='new room draft')]);


let creationFailures=2;const creationAttempts=[];
const retryCreate=async(method,payload)=>{if(method==='documentCreate'||method==='documentImport'){creationAttempts.push({method,payload});if(creationFailures-->0)throw Error('retry me');}return docCall(method,payload);};
const RetryComponent=()=>window.__documentsPane({roomId:'room-retry',call:retryCreate,isMember:true});await switchTo(RetryComponent);
lastNodes.find(n=>hasClass(n,'lm-docNewBtn')).props.onClick();await settleIn(RetryComponent);lastNodes.find(n=>hasClass(n,'lm-docTitleInput')).props.onChange({target:{value:'same'}});await settleIn(RetryComponent);
for(let i=0;i<3;i++){await lastNodes.find(n=>hasClass(n,'lm-docCreateBtn')).props.onClick();await settleIn(RetryComponent);}
checks.push(['create retry reuses stable request id',creationAttempts.length===3&&creationAttempts.every(c=>c.payload.requestId===creationAttempts[0].payload.requestId)&&!!creationAttempts[0].payload.requestId]);
creationFailures=1;for(let i=0;i<2;i++){await lastNodes.find(n=>n.props['aria-label']==='导入 Markdown').props.onChange({target:{files:[new File(['same'],'same.md')],value:'same'}});await settleIn(RetryComponent);}
const importAttempts=creationAttempts.filter(c=>c.method==='documentImport');checks.push(['import retry reuses stable request id',importAttempts.length===2&&!!importAttempts[0].payload.requestId&&importAttempts[0].payload.requestId===importAttempts[1].payload.requestId]);


const persistedProposal={proposalId:'prop-persistedaaa',status:'conflicted',baseContent:'persisted base',currentContent:'persisted head',proposedContent:'original remote proposal',resolutionContent:'saved human resolution'};
const persistedCall=async(method,payload)=>method==='documentRead'?{status:'ready',document:docView,proposal:persistedProposal}:docCall(method,payload);
const PersistedComponent=()=>window.__documentsPane({roomId:'room-persisted',call:persistedCall,isMember:true});await switchTo(PersistedComponent);lastNodes.find(n=>hasClass(n,'lm-docRow')).props.onClick();await settleIn(PersistedComponent);
checks.push(['remote persisted conflict renders all three original versions',lastText.includes('persisted base')&&lastText.includes('persisted head')&&lastText.includes('original remote proposal')]);
checks.push(['persisted resolution takes precedence in editor',lastNodes.some(n=>hasClass(n,'lm-docResolutionInput')&&n.props.value==='saved human resolution')]);
lastNodes.find(n=>hasClass(n,'lm-docResolutionInput')).props.onChange({target:{value:'new local resolution'}});await settleIn(PersistedComponent);
checks.push(['editing resolution preserves remote original proposal',lastText.includes('original remote proposal')&&persistedProposal.proposedContent==='original remote proposal']);
persistedProposal.resolutionContent=null;await switchTo(PersistedComponent);lastNodes.find(n=>hasClass(n,'lm-docRow')).props.onClick();await settleIn(PersistedComponent);
checks.push(['remote proposal initializes missing resolution',lastNodes.some(n=>hasClass(n,'lm-docResolutionInput')&&n.props.value==='original remote proposal')]);


let deliveryFail=true,releaseDelivery;
const deliveryCall=async(method,payload)=>method==='contextDeliveries'?(deliveryFail?{status:'error',reason:'audit offline'}:{status:'ready',deliveries:[{deliveryId:'delivery-test',recipient:'Agent Remote',status:'delivered',packet:{selectedDocumentVersions:[{documentId:docView.documentId,title:'Pinned document',revisionId:'rev-pinned',contentHash:'hash-pinned',content:'PRIVATE FULL CONTENT'}]}}]}):docCall(method,payload);
const DeliveryComponent=()=>window.__documentsPane({roomId:'room-delivery',call:deliveryCall,isMember:true});await switchTo(DeliveryComponent);
await lastNodes.find(n=>hasClass(n,'lm-contextDeliveriesToggle')).props.onClick();await settleIn(DeliveryComponent);
checks.push(['context delivery errors are visible with retry',lastText.includes('audit offline')&&lastNodes.some(n=>hasClass(n,'lm-contextDeliveriesRetry'))]);
deliveryFail=false;await lastNodes.find(n=>hasClass(n,'lm-contextDeliveriesRetry')).props.onClick();await settleIn(DeliveryComponent);
checks.push(['delivery audit renders recipient and pinned version only',lastText.includes('Agent Remote')&&lastText.includes('delivered')&&lastText.includes('Pinned document')&&lastText.includes('rev-pinned')&&lastText.includes('hash-pinned')&&!lastText.includes('PRIVATE FULL CONTENT')]);
lastNodes.find(n=>hasClass(n,'lm-contextDeliveriesToggle')).props.onClick();await settleIn(DeliveryComponent);checks.push(['delivery audit can collapse',!lastText.includes('Agent Remote')]);
const DeferredDelivery=()=>window.__documentsPane({roomId:'room-old-audit',call:async(method,payload)=>method==='contextDeliveries'?await new Promise(resolve=>releaseDelivery=resolve):docCall(method,payload),isMember:true});
await switchTo(DeferredDelivery);const loadingDelivery=lastNodes.find(n=>hasClass(n,'lm-contextDeliveriesToggle')).props.onClick();await settleIn(DeferredDelivery);checks.push(['delivery audit displays loading state',lastText.includes('正在加载投递记录')]);
await switchTo(DeliveryComponent);releaseDelivery({status:'ready',deliveries:[{deliveryId:'stale',recipient:'STALE AGENT',status:'delivered'}]});await loadingDelivery;await settleIn(DeliveryComponent);checks.push(['old room delivery response cannot leak into new room',!lastText.includes('STALE AGENT')]);


const docMentionCalls=[];
const mentionDocument={documentId:'doc-bbbbbbbbbbbb',roomId:'room-doc-mention',title:'Design reference',headRevisionId:'rev-bbbbbbbbbbbb'};
let docMentionFailure=false,docMentionRelease;
let docMentionRows=[mentionDocument];
const docMentionCall=async(method,payload)=>{
 docMentionCalls.push({method,payload});
 if(method==='roomDetail')return {room:{id:'room-doc-mention',name:'Document mention',members:[],tasks:[]},viewer:{isMember:true,isLeader:false},messages:[]};
 if(method==='roomSkills')return {status:'ready',skills:[]};
 if(method==='documents')return {status:'ready',documents:docMentionRows};
 if(method==='documentRead'){if(docMentionRelease)await new Promise(resolve=>docMentionRelease=resolve);if(docMentionFailure)throw Error('document offline');return {status:'ready',document:{...docMentionRows.find(row=>row.documentId===payload.documentId),contentHash:'b'.repeat(64),content:'Pinned content'},revision:{revisionId:payload.revisionId}};}
 if(method==='roomSay')return {delivered:[],room:{id:'room-doc-mention'}};
 return {};
};
const MentionDocumentsComponent=()=>window.__roomPane({room:{id:'room-doc-mention',name:'Document mention'},sessionId:'human',self:{nodeId:'node-a'},call:docMentionCall});
window.__dropComposerDraft({nodeId:'node-a',sessionId:'human',roomId:'room-doc-mention'});await switchTo(MentionDocumentsComponent);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Design',selectionStart:7}});await settleIn(MentionDocumentsComponent);
const documentCandidate=lastNodes.find(n=>hasClass(n,'lm-mentionDocument'));
checks.push(['at menu offers document candidates with an explicit kind',!!documentCandidate&&lastText.includes('文档')&&lastText.includes('Design reference')]);
if(documentCandidate){
 await documentCandidate.props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
 checks.push(['document pick reads its exact candidate revision',docMentionCalls.some(row=>row.method==='documentRead'&&row.payload.revisionId===mentionDocument.headRevisionId)]);
 checks.push(['document pick renders a pinned named reference',count('lm-contextDocument')===1&&lastText.includes('Design reference')]);
 lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'Please use the selected document',selectionStart:32}});await settleIn(MentionDocumentsComponent);await lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(MentionDocumentsComponent);
 const sent=docMentionCalls.find(row=>row.method==='roomSay');
 checks.push(['document reference sends only stable context fields and never a member mention',sent?.payload.contextSelection?.selectedDocumentVersions[0]?.contentHash==='b'.repeat(64)&&Object.keys(sent.payload.contextSelection.selectedDocumentVersions[0]).sort().join(',')==='contentHash,documentId,revisionId'&&!sent.payload.mentions]);
}


window.__dropComposerDraft({nodeId:'node-a',sessionId:'human',roomId:'room-doc-mention'});await switchTo(MentionDocumentsComponent);docMentionFailure=true;
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Design',selectionStart:7}});await settleIn(MentionDocumentsComponent);
lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
checks.push(['failed document pick preserves typed token and shows a retryable error',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='@Design'&&count('lm-contextDocument')===0&&lastText.includes('document offline')]);
docMentionFailure=false;docMentionRelease=()=>{};
lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
const sentBeforePending=docMentionCalls.filter(row=>row.method==='roomSay').length;
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onKeyDown({key:'Enter',shiftKey:false,isComposing:false,preventDefault(){}});await settleIn(MentionDocumentsComponent);
checks.push(['pending document selection cannot send an incomplete context',docMentionCalls.filter(row=>row.method==='roomSay').length===sentBeforePending&&lastText.includes('正在固定文档版本')]);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'new input while reading',selectionStart:23}});await settleIn(MentionDocumentsComponent);
const releaseDocument=docMentionRelease;docMentionRelease=undefined;releaseDocument();await settleIn(MentionDocumentsComponent);
checks.push(['late document read cannot overwrite edited draft',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='new input while reading'&&count('lm-contextDocument')===0]);
window.__dropComposerDraft({nodeId:'node-a',sessionId:'human',roomId:'room-doc-mention'});await switchTo(MentionDocumentsComponent);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Design',selectionStart:7}});await settleIn(MentionDocumentsComponent);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onKeyDown({key:'Tab',preventDefault(){}});await settleIn(MentionDocumentsComponent);
checks.push(['keyboard selects a pinned document instead of sending',count('lm-contextDocument')===1]);
const removeReference=lastNodes.find(n=>n.props?.['aria-label']==='移除文档引用');removeReference?.props.onClick();await settleIn(MentionDocumentsComponent);
checks.push(['one document reference can be removed without editing text',count('lm-contextDocument')===0]);


window.__dropComposerDraft({nodeId:'node-a',sessionId:'human',roomId:'room-doc-mention'});await switchTo(MentionDocumentsComponent);docMentionRelease=()=>{};
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Design',selectionStart:7}});await settleIn(MentionDocumentsComponent);
lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
const oldRoomRelease=docMentionRelease;docMentionRelease=undefined;
const OtherMentionRoom=()=>window.__roomPane({room:{id:'room-other',name:'Other'},sessionId:'human',self:{nodeId:'node-a'},call:async(method)=>method==='roomDetail'?{room:{id:'room-other',members:[],tasks:[]},viewer:{isMember:true},messages:[]}:method==='documents'?{status:'ready',documents:[]}:{status:'ready',skills:[]}});
await switchTo(OtherMentionRoom);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'other room draft',selectionStart:16}});await settleIn(OtherMentionRoom);
oldRoomRelease();await settleIn(OtherMentionRoom);
checks.push(['old room document read cannot leak into a new room draft',count('lm-contextDocument')===0&&lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='other room draft']);


docMentionRows=Array.from({length:9},(_,i)=>({documentId:'doc-c'+String(i).padStart(11,'0'),roomId:'room-doc-mention',title:'Limit'+i,headRevisionId:'rev-c'+String(i).padStart(11,'0')}));
window.__dropComposerDraft({nodeId:'node-a',sessionId:'human',roomId:'room-doc-mention'});await switchTo(MentionDocumentsComponent);
for(let i=0;i<8;i++){
 const value='@Limit'+i;lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value,selectionStart:value.length}});await settleIn(MentionDocumentsComponent);
 lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
}
checks.push(['document picks support eight distinct fixed references',count('lm-contextDocument')===8]);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Limit8',selectionStart:7}});await settleIn(MentionDocumentsComponent);
const readsAtLimit=docMentionCalls.filter(row=>row.method==='documentRead').length;
lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
checks.push(['ninth document is rejected without losing references or fetching content',count('lm-contextDocument')===8&&lastText.includes('最多引用8份文档')&&docMentionCalls.filter(row=>row.method==='documentRead').length===readsAtLimit]);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Limit0',selectionStart:7}});await settleIn(MentionDocumentsComponent);
lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(MentionDocumentsComponent);
checks.push(['reselecting a document is deduplicated even at the reference limit',count('lm-contextDocument')===8]);
docMentionRows=[mentionDocument];

await switchTo(Component);
checks.push(['main content keeps a native return entry when sidebar is unavailable',count('lm-mainReturn')===1&&lastNodes.find(n=>hasClass(n,'lm-mainReturn')).props['aria-label']==='返回对话']);
const beforeMainReturn=selectPanelCalls.length;
await click('lm-mainReturn');
checks.push(['main return releases plugin main slot and restores native chrome',selectPanelCalls.length>beforeMainReturn&&selectPanelCalls.slice(beforeMainReturn).every(id=>id===null)&&document.documentElement.dataset.lanMeshMode===undefined]);
await switchTo(RailHost);await clickRail('lm-nav-network');await switchTo(Component);
checks.push(['network workspace uses current snapshot identity and discovered devices',count('lm-networkWorkbench')===1&&count('lm-networkNode')>=1&&lastText.includes('node-a')&&!lastText.includes('允许派发：是')]);
await switchTo(RailHost);await clickRail('lm-nav-manage');await switchTo(Component);
checks.push(['management exposes actual UI version and existing session-management route',count('lm-managementWorkspace')===1&&lastText.includes(JSON.parse(readFileSync(join(here,'..','package.json'),'utf8')).version)&&count('lm-managementAgents')===1]);
checks.push(['management loads and renders local Registry definitions',requested.some(row=>row.endpoint==='agentRegistry')&&lastText.includes('Registry fixture')]);
await click('lm-managementAgents');checks.push(['management opens the existing agent catalogue',count('lm-agentImport')>0||lastText.includes('stored-one')]);
await switchTo(RailHost);await clickRail('lm-nav-network');await switchTo(Component);
const mainPoll=[...intervals.values()].filter(timer=>timer.ms===4000).at(-1);
snapshotFailure=true;mainPoll.fn();await settle();
checks.push(['failed refresh retains network data and explains stale snapshot at the top',count('lm-shellStale')===1&&count('lm-networkWorkbench')===1&&lastText.includes('上次成功读取')]);
snapshotFailure=false;await click('lm-shellRetry');checks.push(['retry recovers the retained snapshot without a stale banner',count('lm-shellStale')===0&&count('lm-networkWorkbench')===1]);
snapshotFailure=true;await switchTo(Component);
checks.push(['first snapshot failure is not presented as an empty workspace',count('lm-shellReadState')===1&&count('lm-networkWorkbench')===0&&count('lm-mainReturn')===1&&lastText.includes('无法读取')]);
snapshotFailure=false;await click('lm-shellRetry');checks.push(['first-load retry restores selected workspace',count('lm-networkWorkbench')===1&&count('lm-shellReadState')===0]);
let releaseSnapshot;snapshotGate=new Promise(resolve=>releaseSnapshot=resolve);await switchTo(Component);
checks.push(['initial pending read shows loading while native exit stays available',count('lm-shellSkeleton')===2&&count('lm-mainReturn')===1&&lastText.includes('正在读取')]);
const snapshotsBeforePoll=asked.filter(method=>method==='snapshot').length;const pendingPoll=[...intervals.values()].filter(timer=>timer.ms===4000).at(-1);pendingPoll.fn();pendingPoll.fn();await settle();
checks.push(['overlapping snapshot polls share one pending request',asked.filter(method=>method==='snapshot').length===snapshotsBeforePoll]);
snapshotGate=null;releaseSnapshot();await settle();
checks.push(['pending initial read resolves into the selected workspace',count('lm-networkWorkbench')===1&&count('lm-shellSkeleton')===0]);
let releaseOldSnapshot;snapshotGate=new Promise(resolve=>releaseOldSnapshot=resolve);snapshotOverride=structuredClone(answers.snapshot);snapshotOverride.self.name='OLD SNAPSHOT';snapshotOverride.self.selfName='OLD SNAPSHOT';await switchTo(Component);
snapshotGate=null;snapshotOverride=undefined;await switchTo(Component);releaseOldSnapshot();await settle();
checks.push(['snapshot from an unmounted workspace cannot overwrite the new view',count('lm-networkWorkbench')===1&&!lastText.includes('OLD SNAPSHOT')]);
const togglesBefore=sidebarToggleCount;await click('lm-sidebarToggle');
checks.push(['workbench sidebar control invokes the public host toggle',sidebarToggleCount===togglesBefore+1]);
const sidebarAction=navigation.layout.toggleSidebar;delete navigation.layout.toggleSidebar;await click('lm-sidebarToggle');
checks.push(['missing sidebar API leaves workspace switcher and native return usable',count('lm-navigationNotice')===1&&count('lm-workspaceSwitch')===1&&count('lm-mainReturn')===1]);navigation.layout.toggleSidebar=sidebarAction;
lastNodes.find(n=>hasClass(n,'lm-workspaceSwitch')).props.onChange({target:{value:'room:room-1'}});await settle();
checks.push(['compact navigation opens the exact listed room',count('lm-roomPane')===1&&lastText.includes('hello from beta')]);
const detailsBeforeForeign=requested.filter(r=>r.endpoint==='roomDetail').length;lastNodes.find(n=>hasClass(n,'lm-workspaceSwitch')).props.onChange({target:{value:'room:foreign'}});await settle();
checks.push(['compact selector rejects an unlisted room identity',requested.filter(r=>r.endpoint==='roomDetail').length===detailsBeforeForeign]);
const retainedCalls=[],retainedTasks=[];let retainedFailure=true,retainedSendGate;
const retainedDoc={documentId:'doc-eeeeeeeeeeee',roomId:'room-draft-a',title:'Draft design',headRevisionId:'rev-eeeeeeeeeeee'};
const retainedCall=async(method,payload)=>{
 if(method==='roomDetail')return {room:{id:payload.room,name:payload.room,members:[{...human,role:'leader'},remoteAgent],leader:{...human,role:'leader'},tasks:[]},viewer:{isMember:true,isLeader:true},messages:[]};
 if(method==='roomSkills')return {status:'ready',skills:[{name:'deploy',description:'Deploy hint',sourceNodeId:'node-a',sourceNodeName:'Local node'}]};
 if(method==='documents')return {status:'ready',documents:[retainedDoc]};
 if(method==='documentRead')return {status:'ready',document:{...retainedDoc,contentHash:'e'.repeat(64)},revision:{revisionId:retainedDoc.headRevisionId}};
 if(method==='roomAssign'){retainedTasks.push(payload);return {delivered:[],task:{id:'task-retained'}};}
 if(method==='roomSay'){retainedCalls.push(payload);const gate=retainedSendGate;if(gate)await gate;if(retainedFailure)throw Error('retry after navigation');return {delivered:[],room:{id:payload.room}};}
 return {};
};
const DraftRoomA=()=>h(window.__roomPane,{room:{id:'room-draft-a'},sessionId:'human',self:answers.snapshot.self,attachmentLimits:answers.snapshot.roomAttachmentLimits,call:retainedCall});
const DraftRoomB=()=>h(window.__roomPane,{room:{id:'room-draft-b'},sessionId:'human',self:answers.snapshot.self,attachmentLimits:answers.snapshot.roomAttachmentLimits,call:retainedCall});
await switchTo(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Draft',selectionStart:6}});await settleIn(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-mentionDocument')).props.onMouseDown({preventDefault(){}});await settleIn(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'/deploy',selectionStart:7}});await settleIn(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onKeyDown({key:'Enter',shiftKey:false,preventDefault(){}});await settleIn(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'@Beta',selectionStart:5}});await settleIn(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onKeyDown({key:'Enter',shiftKey:false,preventDefault(){}});await settleIn(DraftRoomA);
const preservedText=lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value+'retained message';
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:preservedText,selectionStart:preservedText.length}});await settleIn(DraftRoomA);
let releaseRetainedUpload;uploadGate=new Promise(resolve=>releaseRetainedUpload=resolve);const uploadsBeforeRetain=uploaded.length;
const retainedImage=new File([new Uint8Array([1,4,8,16])],'retained.png',{type:'image/png'});
lastNodes.find(n=>hasClass(n,'lm-fileInput')).props.onChange({target:{files:[retainedImage],value:'picked'}});await settleIn(DraftRoomA);
captureDraftFixture('pending');
checks.push(['retained draft starts with pinned document, skill and pending image',count('lm-contextDocument')===1&&count('lm-skillChip')===1&&count('lm-fileChip')===1]);
await switchTo(DraftRoomB);lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'independent room B',selectionStart:18}});await settleIn(DraftRoomB);
uploadGate=null;releaseRetainedUpload();await settleIn(DraftRoomB);
checks.push(['detached upload does not leak draft or attachment into another room',count('lm-fileChip')===0&&lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='independent room B']);
await switchTo(DraftRoomA);
captureDraftFixture('restored');
await clickOn(DraftRoomA,'lm-roomTab-docs');
checks.push(['documents remain available as an independent Room tab',count('lm-docsView')===1&&count('lm-chat')===0]);
captureDraftFixture('tabs-docs');
await clickOn(DraftRoomA,'lm-roomTab-chat');
checks.push(['selected context has a readable summary without changing reference payload',count('lm-contextSummary')===1&&lastText.includes('本次发送上下文')]);
checks.push(['returning restores text, fixed references and completed image without reupload',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value===preservedText&&count('lm-contextDocument')===1&&count('lm-skillChip')===1&&count('lm-fileChip')===1&&lastText.includes('已上传')&&uploaded.length===uploadsBeforeRetain+1]);
await lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(DraftRoomA);
checks.push(['failed retained draft keeps its message and image',retainedCalls.length===1&&lastText.includes('retry after navigation')&&count('lm-fileChip')===1]);
await switchTo(DraftRoomB);checks.push(['other room draft restores independently',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='independent room B']);
await switchTo(DraftRoomA);retainedFailure=false;await lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(DraftRoomA);
const firstRetained=retainedCalls[0],secondRetained=retainedCalls[1];
checks.push(['retry after navigation preserves message ID, attachment and exact identities',firstRetained?.messageId===secondRetained?.messageId&&JSON.stringify(firstRetained?.attachments)===JSON.stringify(secondRetained?.attachments)&&secondRetained?.mentions?.[0]?.memberKey===remoteAgent.key&&secondRetained?.skillRefs?.[0]?.sourceNodeId==='node-a'&&secondRetained?.contextSelection?.selectedDocumentVersions?.[0]?.revisionId===retainedDoc.headRevisionId]);
await switchTo(DraftRoomB);await switchTo(DraftRoomA);
checks.push(['accepted send is not restored as an unsent message',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value===''&&count('lm-fileChip')===0&&count('lm-skillChip')===0&&uploaded.length===uploadsBeforeRetain+1]);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'background accepted',selectionStart:19}});await settleIn(DraftRoomA);
let releaseBackground;retainedSendGate=new Promise(resolve=>releaseBackground=resolve);const backgroundSend=lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(DraftRoomA);await switchTo(DraftRoomB);
retainedSendGate=null;releaseBackground();await backgroundSend;await settleIn(DraftRoomB);await switchTo(DraftRoomA);
checks.push(['successful send while away is cleared from the retained draft',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='']);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'old submitted message',selectionStart:21}});await settleIn(DraftRoomA);
let releaseOldSend;retainedSendGate=new Promise(resolve=>releaseOldSend=resolve);const oldSend=lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(DraftRoomA);await switchTo(DraftRoomB);await switchTo(DraftRoomA);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'new draft after returning',selectionStart:25}});await settleIn(DraftRoomA);
retainedSendGate=null;releaseOldSend();await oldSend;await settleIn(DraftRoomA);
checks.push(['late acceptance never clears a newer draft written after returning',lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.value==='new draft after returning']);
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'quick task while away',selectionStart:21}});lastNodes.find(n=>hasClass(n,'lm-taskPill')).props.onClick();await settleIn(DraftRoomA);
let releaseQuick;retainedSendGate=new Promise(resolve=>releaseQuick=resolve);const quickOne=lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(DraftRoomA);await switchTo(DraftRoomB);await switchTo(DraftRoomA);
const quickTwo=lastNodes.find(n=>hasClass(n,'lm-sendBtn')).props.onClick();await settleIn(DraftRoomA);retainedSendGate=null;releaseQuick();await Promise.all([quickOne,quickTwo]);await settleIn(DraftRoomA);
checks.push(['background quick-task uses the existing endpoint exactly once despite concurrent retry',retainedTasks.length===1&&retainedTasks[0].room==='room-draft-a'&&retainedCalls.at(-1).messageId===retainedCalls.at(-2).messageId&&lastNodes.find(n=>hasClass(n,'lm-taskPill')).props['aria-pressed']===false]);
const groupedTranscript=[0,1,2,3,4].map(index=>({id:'group-'+index,kind:'room-message',from:{nodeId:'node-b',sessionId:'session-9',title:'Reviewer'},text:'Line one\nLine two',sentAt:new Date(Date.UTC(2026,10,15,10,index)).toISOString()}));
groupedTranscript.push({...groupedTranscript[4],id:'other-device',from:{nodeId:'node-c',sessionId:'session-9',title:'Reviewer'}});
let holdGroupedRead=false,releaseGroupedRead;
let historyReadFailure=true;const historyRequests=[];
const groupedCall=async(method,payload)=>{if(method==='roomHistory'){historyRequests.push(payload);if(historyReadFailure)throw Error('history temporarily unavailable');return {messages:[{id:'older-one',kind:'room-message',from:{nodeId:'node-b',sessionId:'session-9'},text:'earlier retained history',sentAt:'2026-11-14T09:00:00Z'},groupedTranscript[0]],cursor:'',scope:'local'};}if(method==='roomDetail'){const result={room:{id:payload.room,members:[],tasks:[]},messages:[...groupedTranscript]};if(holdGroupedRead){holdGroupedRead=false;await new Promise(resolve=>releaseGroupedRead=resolve);}return result;}return method==='roomSkills'?{status:'ready',skills:[]}:{};};
const GroupedRoom=()=>h(window.__roomPane,{room:{id:'room-grouped'},sessionId:'human',self:answers.snapshot.self,call:groupedCall,peers:[{nodeId:'node-b',name:'Shared device'},{nodeId:'node-c',name:'Shared device'}]});
await switchTo(GroupedRoom);
checks.push(['five adjacent messages share an author header while a namesake on another device starts a new group',count('lm-bubbleRow')===6&&count('lm-bubbleWho')===2&&count('lm-messageContinuation')===4&&lastText.includes('Shared device · node-b')&&lastText.includes('Shared device · node-c')]);
checks.push(['grouping retains six individual exact times and original multiline bodies',lastNodes.filter(n=>n.type==='time'&&hasClass(n,'lm-bubbleWhen')).length===6&&lastNodes.filter(n=>hasClass(n,'lm-bubbleRow')).every(n=>n.props['data-message-id'])&&count('stubMarkdown')===6]);
checks.push(['chat observes reader scroll and attachment layout without using document scrolling',typeof lastNodes.find(n=>hasClass(n,'lm-chat')).props.onScroll==='function'&&typeof lastNodes.find(n=>hasClass(n,'lm-chat')).props.onLoad==='function']);
captureDraftFixture('grouped');
const readingViewport={scrollTop:100,scrollHeight:1200,clientHeight:400};
lastNodes.find(n=>hasClass(n,'lm-chat')).props.ref.current=readingViewport;
lastNodes.find(n=>hasClass(n,'lm-chat')).props.onScroll({currentTarget:readingViewport});await settleIn(GroupedRoom);
groupedTranscript.push({...groupedTranscript[0],id:'new-arrival',text:'new incoming reply',sentAt:'2026-11-15T10:06:00Z'});
const roomPoll=[...intervals.values()].find(timer=>timer.ms===2000);roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['new arrival leaves history position unchanged and exposes local jump action',readingViewport.scrollTop===100&&count('lm-jumpLatest')===1&&lastText.includes('1 条新消息')]);
roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['repeated room polling does not inflate new-message count',lastText.includes('1 条新消息')&&!lastText.includes('2 条新消息')]);
lastNodes.find(n=>hasClass(n,'lm-chat')).props.onLoad();checks.push(['image layout while reading history does not force follow',readingViewport.scrollTop===100]);
lastNodes.find(n=>hasClass(n,'lm-jumpLatest')).props.onClick();await settleIn(GroupedRoom);
checks.push(['explicit jump reaches latest and clears local new-message hint',readingViewport.scrollTop===1200&&count('lm-jumpLatest')===0]);
readingViewport.scrollTop=800;lastNodes.find(n=>hasClass(n,'lm-chat')).props.onScroll({currentTarget:readingViewport});
groupedTranscript.push({...groupedTranscript[0],id:'following-arrival',sentAt:'2026-11-15T10:07:00Z'});roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['reader at latest continues following without a new-message hint',readingViewport.scrollTop===1200&&count('lm-jumpLatest')===0]);
holdGroupedRead=true;roomPoll.fn();await settleIn(GroupedRoom);
groupedTranscript.push({...groupedTranscript[0],id:'latest-before-old-response',text:'latest result survives late response',sentAt:'2026-11-15T10:08:00Z'});roomPoll.fn();await settleIn(GroupedRoom);
releaseGroupedRead();await settleIn(GroupedRoom);
checks.push(['late older room response never replaces a newer transcript or its reading state',lastText.includes('latest result survives late response')]);
groupedTranscript.push({...groupedTranscript[0],id:'long-reading',text:Array(20).fill('完整正文与换行需要保留').join('\n'),sentAt:'2026-11-15T10:09:00Z'});roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['long Room text is folded with full Markdown source still supplied',count('lm-messageTextCollapsed')===1&&lastNodes.some(n=>hasClass(n,'stubMarkdown')&&n.children.includes(groupedTranscript.at(-1).text))]);
captureDraftFixture('body-collapsed');
lastNodes.find(n=>hasClass(n,'lm-messageExpand')).props.onClick();await settleIn(GroupedRoom);
captureDraftFixture('body-expanded');
checks.push(['long text expands without replacing the original message or its id',count('lm-messageTextCollapsed')===0&&lastNodes.find(n=>hasClass(n,'lm-messageExpand')).props['aria-expanded']===true&&lastNodes.some(n=>n.props['data-message-id']==='long-reading')]);
await lastNodes.find(n=>hasClass(n,'lm-messageCopy')).props.onClick();await settleIn(GroupedRoom);
checks.push(['production message copy shows honest unavailable feedback when Clipboard API is absent',lastText.includes('当前环境不支持复制，请手动选择正文')]);
while(groupedTranscript.length<41){const index=groupedTranscript.length;groupedTranscript.push({...groupedTranscript[0],id:'retained-history-'+index,text:'retained history '+index,sentAt:new Date(Date.UTC(2026,10,15,11,index)).toISOString()});}roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['Room renders more than twenty retained messages including the earliest stable id',count('lm-bubbleRow')===41&&lastNodes.some(n=>n.props['data-message-id']==='group-0')&&lastNodes.some(n=>n.props['data-message-id']==='retained-history-40')]);
await lastNodes.find(n=>hasClass(n,'lm-loadEarlier')).props.onClick();await settleIn(GroupedRoom);
checks.push(['earlier history failure retains all current messages and allows retry',count('lm-bubbleRow')===41&&lastText.includes('history temporarily unavailable')&&!lastNodes.find(n=>hasClass(n,'lm-loadEarlier')).props.disabled]);
historyReadFailure=false;await lastNodes.find(n=>hasClass(n,'lm-loadEarlier')).props.onClick();await settleIn(GroupedRoom);
checks.push(['history prepends exact older identity, deduplicates overlap and keeps reading count separate',count('lm-bubbleRow')===42&&lastNodes.find(n=>hasClass(n,'lm-bubbleRow')).props['data-message-id']==='older-one'&&count('lm-jumpLatest')===0&&historyRequests[0].before?.id==='group-0']);
roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['subsequent live poll never erases already loaded older history',count('lm-bubbleRow')===42&&lastText.includes('earlier retained history')&&lastText.includes('已到本机当前保留记录的开头')]);
groupedTranscript.push({...groupedTranscript[0],id:'clash',from:{nodeId:'node-b',sessionId:'session-9'},text:'first origin'}, {...groupedTranscript[0],id:'clash',from:{nodeId:'node-c',sessionId:'session-9'},text:'second origin'});roomPoll.fn();await settleIn(GroupedRoom);
checks.push(['same message id from different origins keeps separate React keys, anchors and arrival counts',lastNodes.filter(n=>n.props['data-message-id']==='clash').length===2&&renderedMessageKeys.includes(JSON.stringify(['node-b','clash']))&&renderedMessageKeys.includes(JSON.stringify(['node-c','clash']))&&lastText.includes('2 条新消息')]);
const archivedTabCall=async(method,args)=>method==='teamOverview'?{known:true,status:'archived',taskCounts:{review:1},executionCounts:{uncertain:1}}:method==='roomDetail'?{room:{id:args.room,name:'Archived tabs',members:[human,remoteAgent],tasks:[{id:'old-task',title:'Existing archived task',status:'done',assignee:human}],lifecycle:{status:'archived'}},viewer:{isMember:true,isLeader:true},messages:[]}:method==='roomSkills'?{status:'ready',skills:[]}:{status:'ready',documents:[]};
const ArchivedTabsRoom=()=>h(window.__roomPane,{room:{id:'room-archived-tabs'},sessionId:'human',self:answers.snapshot.self,call:archivedTabCall});
await switchTo(ArchivedTabsRoom);await clickOn(ArchivedTabsRoom,'lm-roomTab-tasks');
checks.push(['archived tasks remain viewable while new task assignment is absent',lastText.includes('Existing archived task')&&count('lm-assignBtn')===0]);
checks.push(['owner task tab renders Team status without replacing Room tasks',count('lm-ownerTeamOverview')===1&&lastText.includes('待人工核对 1')&&lastText.includes('Existing archived task')]);
await clickOn(ArchivedTabsRoom,'lm-roomTab-members');
checks.push(['archived members remain viewable without invite or kick controls',count('lm-memberDevice')===2&&count('lm-inviteRow')===0&&count('lm-kickBtn')===0]);
let ownerNode='node-b';const ownerCall=async(method,args)=>method==='roomDetail'?{room:{id:args.room,members:[human],tasks:[{id:'same-human-owner',title:'Exact owner task',status:'open',assignee:{nodeId:ownerNode,sessionId:'human',name:'Same human'}}]},viewer:{isMember:true,isLeader:false},messages:[]}:method==='roomSkills'?{status:'ready',skills:[]}:{status:'ready',documents:[]};
const TaskOwnerRoom=()=>h(window.__roomPane,{room:{id:'room-task-owner'},sessionId:'human',self:answers.snapshot.self,call:ownerCall});
await switchTo(TaskOwnerRoom);await clickOn(TaskOwnerRoom,'lm-roomTab-tasks');
checks.push(['same human session on a different node never grants task controls',count('lm-statusBtns')===0&&count('lm-ownerTeamOverview')===0&&lastText.includes('Exact owner task')]);
ownerNode='node-a';[...intervals.values()].find(timer=>timer.ms===2000).fn();await settleIn(TaskOwnerRoom);
checks.push(['exact local human owner retains existing task controls',count('lm-statusBtns')===1]);
let resultSend;
const resultRef={executionId:'exec-pinned',resultHash:'a'.repeat(64),reviewStatus:'review'};
const resultCall=async(method,args)=>{
 if(method==='teamOverview')return {known:true,status:'active',resultRefs:[resultRef]};
 if(method==='roomSay'){resultSend=args;return {delivered:[]};}
 if(method==='roomDetail')return {room:{id:args.room,members:[human],tasks:[]},viewer:{isMember:true,isLeader:true},messages:[]};
 return {};
};
const ResultRoom=()=>h(window.__roomPane,{room:{id:'room-result-ref'},sessionId:'human',self:answers.snapshot.self,call:resultCall});
await switchTo(ResultRoom);await clickOn(ResultRoom,'lm-roomTab-tasks');
await clickOn(ResultRoom,'lm-selectTaskResult');await clickOn(ResultRoom,'lm-roomTab-chat');
const resultVisible=lastText.includes('成果 · exec-pinned');
lastNodes.find(n=>hasClass(n,'lm-composerInput')).props.onChange({target:{value:'Check this result',selectionStart:17}});
await settleIn(ResultRoom);await clickOn(ResultRoom,'lm-sendBtn');
checks.push(['selected Team result reaches Room send with its exact hash',resultVisible&&JSON.stringify(resultSend?.contextSelection?.selectedTaskResults)===JSON.stringify([{executionId:resultRef.executionId,resultHash:resultRef.resultHash}])]);
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
