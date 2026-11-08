/**
 * Verifies that every tool's declared output schema accepts exactly what its
 * own `execute` returns, using the framework's own validator.
 *
 * The point is to catch the class of bug where `index.js` declares one shape and
 * `lib/service.mjs` produces another: the tool framework validates output at
 * call time, so a mismatch is a hard runtime failure for the model.
 *
 * Two properties matter and both are checked against the real implementation
 * rather than a re-implementation that could drift:
 *   - `assertSupportedJsonSchema` accepts the declared schema at registration.
 *   - `validateJsonSchemaValue` reports no violations for the returned value.
 *
 * The plugin is mounted against a stub context to capture the real tool
 * definitions, then each room tool is invoked through its own `execute`, so the
 * compared value is exactly what the framework would validate.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply } from '../index.js';
import { teamToolDefinitions } from '../lib/team-tools.mjs';

/**
 * The framework exports its own validator, so this script does not have to
 * re-implement the supported-schema rules. It cannot be a plain bare import:
 * the plugin package deliberately has no dependency on `@deepseek-ai/dsh-tools`
 * (the profile cannot resolve it from a linked package), and a verification
 * script must not change that.
 * @returns {Promise<{ assertSupportedJsonSchema: Function, validateJsonSchemaValue: Function }>}
 */
async function loadFrameworkValidator() {
  const candidates = [
    process.env.DSH_TOOLS_MODULE,
    'file:///C:/Users/jian/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  ].filter((entry) => typeof entry === 'string' && entry !== '');
  for (const candidate of candidates) {
    try {
      const url = candidate.startsWith('file:') ? candidate : pathToFileURL(candidate).href;
      const module = await import(url);
      if (typeof module.validateJsonSchemaValue === 'function' && typeof module.assertSupportedJsonSchema === 'function') {
        return module;
      }
    } catch {
      // Try the next candidate; the summary below reports a hard miss.
    }
  }
  throw new Error('cannot locate the framework schema validator (set DSH_TOOLS_MODULE)');
}

const framework = await loadFrameworkValidator();

const savedHome = process.env.DSH_HOME;
const home = await mkdtemp(join(tmpdir(), 'lan-mesh-schema-'));
process.env.DSH_HOME = home;

const failures = [];
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok });
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

const tools = new Map();
const disposers = [];
const LEADER = 'sess-check-leader';
const PEER = 'sess-check-peer';
/**
 * Minimal agent runtime, so the agent tools have something real to return.
 * The shapes matter here, not the behaviour: the point is the value the tool
 * hands the framework.
 */
const liveAgents = new Map();
const storedSessions = [{ id: 'sess-stored-workspace', cwd: 'C:\\work\\other-workspace' }];
const agentRuntime = {
  list: () => [...liveAgents.values()],
  get: (id) => liveAgents.get(id),
  async resume({ resumeSessionId }) {
    const row = storedSessions.find((item) => item.id === resumeSessionId);
    if (row === undefined) throw new Error(`no stored session ${resumeSessionId}`);
    const agent = { id: row.id, status: 'idle', followup() {} };
    liveAgents.set(row.id, agent);
    return { agent, async dispose() { liveAgents.delete(row.id); } };
  },
  async create({ sessionId, meta }) {
    const agent = { id: sessionId, status: 'idle', followup() {}, cwd: meta.cwd };
    liveAgents.set(sessionId, agent);
    return { agent, async dispose() { liveAgents.delete(sessionId); } };
  },
};
const sessionPersistence = {
  list: async () => storedSessions.map((row) => ({
    header: { version: 4, id: row.id, createdAt: Date.now(), cwd: row.cwd, isSeeded: false },
  })),
};
liveAgents.set(LEADER, { id: LEADER, status: 'idle', followup() {} });

let panelFetch;
// The skill registry is mounted by the Host base, not by this plugin, so the
// stub owns it. `null` models a profile without the skill layer at all: the
// endpoint must degrade to `unavailable` instead of inventing a catalogue.
let skillsRegistry = null;
let skillsLookupThrows = false;
const stub = {
  logger: { warn() {}, info() {}, debug() {} },
  get(name) {
    if (name === 'skills') {
      if (skillsLookupThrows) throw new Error('skill service unavailable');
      return skillsRegistry === null ? undefined : skillsRegistry;
    }
    if (name === 'tools') {
      return {
        register: (definition) => {
          tools.set(definition.name, definition);
          return () => tools.delete(definition.name);
        },
      };
    }
    if (name === 'agents') return agentRuntime;
    if (name === 'sessionPersistence') return sessionPersistence;
    if (name === 'dshIm') {
      // Two local channels: notifications must be held for a human, not sent.
      return {
        listBots: async () => [{ botId: 'wx_check', channel: 'wechat' }, { botId: 'fs_check', channel: 'feishu' }],
        listTargets: async () => [{ targetId: 'tgt_check', name: '我' }],
        send: async () => ({ sent: true }),
      };
    }
    return undefined;
  },
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
    return () => {};
  },
  inject(names, callback) {
    // The plugin waits for `tools` (the Host mounts it after `apply`) and for
    // `connection` (the panel route; absent here, exercised by rooms-smoke).
    const scope = {
      tools: names.includes('tools') ? this.get('tools') : undefined,
      connection: names.includes('connection') ? { fetch: { register: definition => { panelFetch = definition.fetch; return () => {}; } } } : undefined,
      effect: (fn) => this.effect(fn),
    };
    callback(scope);
    return () => {};
  },
};

/**
 * Run one tool as one session and assert its output passes the framework
 * validator against its own declared schema.
 * @param {string} name - tool name.
 * @param {object} args - tool arguments.
 * @param {string} [label] - label for the assertion.
 * @param {object} [options] - `sessionId` selects the caller, `expectError` inverts the assertion.
 */
async function run(name, args, label, options = {}) {
  const { sessionId = LEADER, expectError = false, errorPattern } = options;
  const definition = tools.get(name);
  if (definition === undefined) {
    check(`${name} is registered`, false);
    return undefined;
  }
  let value;
  try {
    value = await definition.execute(args, { agent: { id: sessionId }, signal: undefined });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (expectError) {
      const matches = errorPattern === undefined || errorPattern.test(message);
      check(`${label ?? name} is rejected with a clear reason`, matches, message.slice(0, 70));
    } else {
      check(`${label ?? name} executes`, false, message);
    }
    return undefined;
  }
  if (expectError) {
    check(`${label ?? name} is rejected`, false, 'it succeeded instead');
    return value;
  }
  const violations = framework.validateJsonSchemaValue(definition.output.schema, value);
  check(
    `${label ?? name} output satisfies its schema`,
    violations.length === 0,
    violations.slice(0, 5).join('; '),
  );
  return value;
}

/**
 * Drive one panel endpoint through the registered fetch route, so the request
 * travels the same envelope the browser uses instead of calling internals.
 * @param {string} method - endpoint name.
 * @param {object} payload - endpoint payload.
 * @returns {Promise<object>} the decoded `server-response` body.
 */
async function rpc(method, payload) {
  const response = await panelFetch(new Request('http://mesh.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `${method}-rpc`, payload: { method, payload } }),
  }));
  return response.json();
}

try {
  for (const definition of teamToolDefinitions(Object.fromEntries(['Create', 'Dispatch', 'Status', 'Report', 'Reconcile'].map(action => [`team${action}`, async () => ({ executionId: 'schema-test' })])))) {
    framework.assertSupportedJsonSchema(definition.parameters);
    framework.assertSupportedJsonSchema(definition.output.schema);
    const value = await definition.execute({}, { agent: { id: LEADER } });
    check(`${definition.name} schema and output are supported`, framework.validateJsonSchemaValue(definition.output.schema, value).length === 0);
  }
  apply(stub, { port: 45907, discoveryPort: 45937, displayName: 'schema-check', autoWake: false });

  console.log('registration');
  for (const name of ['lan_mesh_rooms', 'lan_mesh_room_member', 'lan_mesh_room_task', 'lan_mesh_room_say']) {
    const definition = tools.get(name);
    check(`${name} is registered`, definition !== undefined);
    if (definition === undefined) continue;
    // The registry runs this same assertion when the definition is registered;
    // re-running it here proves the schema is inside the supported subset rather
    // than silently ignored.
    try {
      framework.assertSupportedJsonSchema(definition.output.schema);
      check(`${name} output schema is a supported shape`, true);
    } catch (error) {
      check(`${name} output schema is a supported shape`, false, String(error?.message ?? error));
    }
  }

  console.log('\nroom tool outputs');
  const created = await run('lan_mesh_room_member', { action: 'create', room: 'Schema Project', topic: 'check' }, 'room_member create');
  const roomId = created?.room?.id ?? '';
  await run('lan_mesh_room_member', { action: 'join', room: roomId, member_name: 'Peer' }, 'room_member join', { sessionId: PEER });
  const again = await run('lan_mesh_room_member', { action: 'join', room: roomId }, 'room_member join twice', { sessionId: PEER });
  check('joining twice reports no change', again?.added === false);
  await run('lan_mesh_rooms', {}, 'rooms');
  const assigned = await run('lan_mesh_room_task', { action: 'assign', room: roomId, assignee: 'Peer', title: 'verify the projection', detail: 'compare shapes' }, 'room_task assign');
  const taskId = assigned?.task?.id ?? '';
  await run('lan_mesh_room_task', { action: 'status', room: roomId, task: taskId, status: 'doing', note: 'on it' }, 'room_task status', { sessionId: PEER });
  const mention = { memberKey: again.room.members.find(member => member.sessionId === PEER).key, label: 'Peer' };
  const skillRef = { name: 'missing-skill', sourceNodeId: 'remote-source', sourceNodeName: 'Remote' };
  const referenceArgs = { room: roomId, text: '@Peer /missing-skill hello room', mentions: [mention], skillRefs: [skillRef] };
  check('room_say parameters expose references', framework.validateJsonSchemaValue(tools.get('lan_mesh_room_say').parameters, referenceArgs).length === 0, framework.validateJsonSchemaValue(tools.get('lan_mesh_room_say').parameters, referenceArgs).join('; '));
  await run('lan_mesh_room_say', referenceArgs, 'room_say');
  const rpcResponse = await panelFetch(new Request('http://mesh.invalid/', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'ref-rpc',payload:{method:'roomSay',payload:{...referenceArgs,sessionId:LEADER}}})}));
  const rpcBody = await rpcResponse.json();
  check('roomSay RPC accepts structured metadata', rpcBody.result?.ok === true, JSON.stringify(rpcBody).slice(0,300));
  const inbox = await run('lan_mesh_inbox', { unread_only: false }, 'reference inbox');
  check('inbox output preserves exact references', inbox?.messages.some(message => message.structuredMentions?.[0]?.memberKey === mention.memberKey && message.skillRefs?.[0]?.name === skillRef.name));
  await run('lan_mesh_room_member', { action: 'leave', room: roomId }, 'room_member leave', { sessionId: PEER });

  console.log('\nroom skill catalogue endpoint');
  const selfNodeId = (created?.room?.members ?? []).find(member => member.sessionId === LEADER)?.nodeId ?? '';
  // No skill layer in this profile: the panel must say so rather than show an
  // empty catalogue, which would read as "this node has no skills".
  const noRegistry = await rpc('roomSkills', {});
  check('a profile without a skill layer reports unavailable', noRegistry.result?.ok === true && noRegistry.result.value?.status === 'unavailable', JSON.stringify(noRegistry).slice(0, 200));
  check('an unavailable catalogue carries no invented rows', Array.isArray(noRegistry.result?.value?.skills) && noRegistry.result.value.skills.length === 0);
  skillsRegistry = {
    async list() {
      return [
        // Sorted output is the endpoint's job; the double entry proves the
        // (sourceNodeId, name) de-duplication key.
        { name: 'deploy', description: 'Ship the branch', invocation: { modelInvocable: true, userInvocable: true }, path: 'C:/secret/deploy/SKILL.md', resourceBase: 'C:/secret/deploy' },
        { name: 'deploy', description: 'Ship the branch again', invocation: { modelInvocable: true, userInvocable: true }, path: 'C:/secret/deploy/SKILL.md' },
        { name: 'internal-only', description: 'not for humans', invocation: { modelInvocable: true, userInvocable: false }, path: 'C:/secret/internal/SKILL.md' },
        { name: 'digest', description: 'Summarise the day', invocation: { modelInvocable: true, userInvocable: true } },
      ];
    },
  };
  const validRegistry = skillsRegistry;
  skillsRegistry = { async list() { return [
    { name: 'x'.repeat(129), invocation: { userInvocable: true } },
    { name: 'bad\nname', invocation: { userInvocable: true } },
    { name: 'valid-name', description: 'safe', invocation: { userInvocable: true } },
  ]; } };
  const boundedCatalogue = await rpc('roomSkills', {});
  check('catalogue only offers names accepted by reference protocol', boundedCatalogue.result?.value?.skills?.length === 1 && boundedCatalogue.result.value.skills[0].name === 'valid-name');
  skillsRegistry = validRegistry;
  const catalogue = await rpc('roomSkills', {});
  const rows = catalogue.result?.value?.skills ?? [];
  check('an available catalogue is reported as ready', catalogue.result?.value?.status === 'ready', JSON.stringify(catalogue).slice(0, 200));
  check('only user-invocable skills are advertised', rows.length === 2 && rows.every(row => row.name !== 'internal-only'), rows.map(row => row.name).join(','));
  check('identically named skills are not folded twice over', rows.filter(row => row.name === 'deploy').length === 1);
  check('skill rows are ordered by name', rows.map(row => row.name).join(',') === 'deploy,digest');
  check('skill rows name the node that owns them', selfNodeId !== '' && rows.every(row => row.sourceNodeId === selfNodeId && typeof row.sourceNodeName === 'string'));
  check('skill rows expose no filesystem path', !JSON.stringify(rows).includes('secret') && !JSON.stringify(rows).includes('SKILL.md'), JSON.stringify(rows).slice(0, 200));
  check('skill rows carry only the advertised fields', rows.every(row => Object.keys(row).sort().join(',') === 'description,name,sourceNodeId,sourceNodeName'), JSON.stringify(Object.keys(rows[0] ?? {})));
  skillsRegistry = { async list() { throw new Error('registry exploded'); } };
  const broken = await rpc('roomSkills', {});
  check('a throwing registry degrades to unavailable', broken.result?.value?.status === 'unavailable' && broken.result.value.skills.length === 0, JSON.stringify(broken).slice(0, 200));
  skillsRegistry = { async list() { return 'not-an-array'; } };
  const malformed = await rpc('roomSkills', {});
  check('a malformed registry result degrades to unavailable', malformed.result?.value?.status === 'unavailable', JSON.stringify(malformed).slice(0, 200));
  skillsRegistry = null;

  skillsLookupThrows = true;
  const lookupFailure = await rpc('roomSkills', {});
  check('a failing skill service lookup degrades to unavailable', lookupFailure.result?.value?.status === 'unavailable');
  skillsLookupThrows = false;

  console.log('\nerror paths are rejections, not malformed values');
  await run(
    'lan_mesh_room_task',
    { action: 'assign', room: roomId, assignee: 'Peer', title: 'nope' },
    'a former member cannot assign',
    { sessionId: PEER, expectError: true, errorPattern: /not a member/ },
  );
  await run(
    'lan_mesh_room_member',
    { action: 'leave', room: roomId },
    'a leader cannot leave its own room',
    { sessionId: LEADER, expectError: true, errorPattern: /leader cannot leave/ },
  );
  await run(
    'lan_mesh_room_member',
    { action: 'join', room: 'no-such-room' },
    'an unknown room is reported',
    { sessionId: PEER, expectError: true, errorPattern: /unknown room/ },
  );

  console.log('\nagent tool outputs');
  for (const name of ['lan_mesh_agents', 'lan_mesh_agent_import', 'lan_mesh_agent_dial', 'lan_mesh_notify']) {
    check(`${name} is registered`, tools.get(name) !== undefined);
  }
  const channels = await run('lan_mesh_notify', { action: 'channels' }, 'notify channels');
  check('notify discovers every local channel', (channels?.channels ?? []).length === 2);
  const held = await run('lan_mesh_notify', { action: 'send', text: '任务完成通知' }, 'notify send holds with two channels');
  check('notify holds the message when several channels exist', held?.status === 'pending');
  await run('lan_mesh_notify', { action: 'confirm', id: held?.id ?? '', channel: held?.channels?.[0]?.id ?? '' }, 'notify confirm');
  await run('lan_mesh_notify', { action: 'dismiss', id: held?.id ?? '' }, 'notify dismiss');
  const listed2 = await run('lan_mesh_agents', {}, 'agents');
  check('agents lists the live caller', (listed2?.agents ?? []).some((row) => row.id === LEADER && row.live === true));
  check('agents lists a stored session from another workspace', (listed2?.agents ?? []).some((row) => row.id === 'sess-stored-workspace' && row.workspace === 'other-workspace'));
  const broughtIn = await run('lan_mesh_agent_import', { session: 'sess-stored-workspace' }, 'agent_import session');
  check('the imported row reports live with its workspace', broughtIn?.agent?.live === true && broughtIn?.agent?.workspace === 'other-workspace');
  const madeAgent = await run('lan_mesh_agent_import', { cwd: 'C:\\work\\fresh-workspace' }, 'agent_import cwd');
  check('a new agent lands in the asked workspace', madeAgent?.agent?.workspace === 'fresh-workspace');
  await run('lan_mesh_agent_dial', { target: 'nobody/session-x', text: 'hi' }, 'dialling an unknown agent', {
    expectError: true,
    errorPattern: /unknown (remote )?agent|cannot resolve/i,
  });
  await run('lan_mesh_agent_import', { cwd: 'relative/path' }, 'a relative cwd is refused', {
    expectError: true,
    errorPattern: /absolute/i,
  });

  console.log('\nprojection split');
  const listed = await run('lan_mesh_rooms', {}, 'rooms after changes');
  const row = listed?.rooms?.[0];
  check('room list row carries the caller-relative role', row?.isLeader === true && row?.isMember === true);
  check('room list row omits the room-level leader block', row?.leader === undefined);
  check('room list row omits memberCount', row?.memberCount === undefined);
  check('mutation view carries leader and memberCount', created?.room?.leader !== undefined && created?.room?.memberCount === 1);
  check('mutation view omits the caller-relative flag', created?.room?.isLeader === undefined);
  check(
    'members expose a node/session key',
    (created?.room?.members ?? []).every((member) => typeof member.key === 'string' && member.key.includes('/')),
  );
} finally {
  for (const dispose of disposers) {
    try {
      await dispose();
    } catch {
      // A disposer failure must not hide the results already collected.
    }
  }
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
}

const passed = results.filter((item) => item.ok).length;
console.log(`\n${failures.length === 0 ? 'schema check ok' : `schema check failed (${failures.length})`} — ${passed}/${results.length}`);
if (failures.length > 0) process.exitCode = 1;
