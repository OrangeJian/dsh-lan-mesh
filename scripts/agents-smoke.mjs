/**
 * Two-node agent-federation test: catalogue, cross-workspace import, remote dial.
 *
 * The agent runtime is stubbed, because the mesh must not depend on a real model
 * loop to be testable: it only needs `get`/`list`/`resume`/`create` and an agent
 * that can take a `followup`. Everything else is the real transport.
 *
 * Run: node scripts/agents-smoke.mjs
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';

const savedHome = process.env.DSH_HOME;
const roots = [];
let failures = 0;

/** Report one expectation. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` 鈥?${detail}`}`);
}

/** Make a fresh DSH_HOME for one node. */
async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'lan-mesh-agents-'));
  roots.push(dir);
  process.env.DSH_HOME = dir;
  return dir;
}

/** Wait until `test()` holds, polling every 100 ms. */
async function until(test, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return test();
}

/**
 * A stub agent runtime standing in for `ctx.agents` + `ctx.sessionPersistence`.
 * @param {object[]} stored - sessions already on disk: `{ id, cwd }`.
 */
function stubRuntime(stored) {
  const live = new Map();
  const wakeups = [];
  const resumed = [];
  const resumeOptions = [];
  const created = [];
  const createOptions = [];
  const mountedTools = [];
  /** The bare minimum an Agent ctx must offer for the mesh tools to land. */
  const agentCtx = { get: (name) => (name === 'tools' ? { register: (definition) => mountedTools.push(definition.name) } : undefined) };
  const makeAgent = (id, status = 'idle') => ({
    id,
    status,
    followup(message) {
      wakeups.push({ id, text: message.content?.[0]?.text ?? '', source: message.source });
    },
  });
  const agents = {
    list: () => [...live.values()],
    get: (id) => live.get(id),
    async resume({ resumeSessionId, agentOptions, setup }) {
      resumed.push(resumeSessionId);
      resumeOptions.push(agentOptions);
      if (setup !== undefined) await setup(agentCtx, undefined);
      const row = stored.find((item) => item.id === resumeSessionId);
      if (row === undefined) throw new Error(`no stored session ${resumeSessionId}`);
      const agent = makeAgent(row.id);
      live.set(row.id, agent);
      return {
        agent,
        async dispose() {
          live.delete(row.id);
        },
      };
    },
    async create({ sessionId, meta, agentOptions, setup }) {
      created.push({ sessionId, cwd: meta.cwd, preset: meta.agentPreset, setup: setup !== undefined });
      createOptions.push(agentOptions);
      if (setup !== undefined) await setup(agentCtx, undefined);
      const agent = makeAgent(sessionId);
      live.set(sessionId, agent);
      return {
        agent,
        async dispose() {
          live.delete(sessionId);
        },
      };
    },
  };
  const persistence = {
    list: async () => stored.map((row) => ({ header: { version: 4, id: row.id, createdAt: Date.now(), cwd: row.cwd, isSeeded: false } })),
  };
  /** Start one stored session as if the user had opened it in the UI. */
  const install = (id) => {
    const agent = makeAgent(id);
    live.set(id, agent);
    return agent;
  };
  return { agents, persistence, live, wakeups, resumed, resumeOptions, created, createOptions, mountedTools, install };
}

const base = {
  displayName: '',
  clusterSecret: '',
  autoWake: true,
  trustedPeers: [],
};

/** Stand-in for the Host's preset registry. */
const mountedPresets = [];
const presets = {
  resolve: async () => ({ id: 'standard', name: 'Standard' }),
  mount: async (_agentCtx, presetId) => {
    mountedPresets.push(presetId);
  },
};

/** Stand-in for the Host's default-model service. */
const defaultModel = {
  currentSelection: () => ({ provider: 'workbuddy', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' }),
};

/** The mesh tool definitions a composed agent is supposed to inherit. */
const meshTools = [{ name: 'lan_mesh_send' }, { name: 'lan_mesh_inbox' }];

try {
  await home();
  const alphaRuntime = stubRuntime([
    { id: 'session-alpha-live', cwd: 'C:\\work\\project-a' },
    { id: 'session-alpha-stored', cwd: 'C:\\work\\project-b' },
  ]);
  alphaRuntime.install('session-alpha-live');
  const alpha = new MeshNode({
    config: { ...base, displayName: 'alpha', port: 45911, discoveryPort: 45921 },
    agents: alphaRuntime.agents,
    sessionPersistence: alphaRuntime.persistence,
    agentDefaultModel: defaultModel,
    agentPresets: presets,
    getToolDefinitions: () => meshTools,
    log: (message, error) => console.log(`  [alpha] ${message}${error === undefined ? '' : `: ${error}`}`),
  });
  await alpha.start();

  await home();
  const betaRuntime = stubRuntime([
    { id: 'session-beta-live', cwd: 'C:\\work\\project-c' },
    { id: 'session-beta-stored', cwd: 'C:\\work\\project-d' },
  ]);
  betaRuntime.install('session-beta-live');
  const beta = new MeshNode({
    config: { ...base, displayName: 'beta', port: 45912, discoveryPort: 45921 },
    agents: betaRuntime.agents,
    sessionPersistence: betaRuntime.persistence,
    log: (message, error) => console.log(`  [beta] ${message}${error === undefined ? '' : `: ${error}`}`),
  });
  await beta.start();

  console.log('\ndiscovery');
  check('both nodes see each other', await until(() => alpha.peers().length > 0 && beta.peers().length > 0));

  console.log('\ncatalogue');
  const localOnly = await alpha.catalogueAgents({ peers: false });
  const localIds = localOnly.agents.map((row) => row.id);
  check('live session is listed', localIds.includes('session-alpha-live'), localIds.join(','));
  check('stored session is listed', localIds.includes('session-alpha-stored'), localIds.join(','));
  const liveRow = localOnly.agents.find((row) => row.id === 'session-alpha-live');
  const storedRow = localOnly.agents.find((row) => row.id === 'session-alpha-stored');
  check('live row is marked live', liveRow.live === true);
  check('stored row is not live', storedRow.live === false);
  check('stored row carries its workspace label', storedRow.workspace === 'project-b', storedRow.workspace);
  check('stored row carries its cwd', storedRow.cwd === 'C:\\work\\project-b', storedRow.cwd);
  check('live rows come first', localOnly.agents[0].live === true, localIds.join(','));

  const withPeers = await (async () => {
    let latest = await alpha.catalogueAgents();
    for (let attempt = 0; attempt < 20 && latest.remote.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      latest = await alpha.catalogueAgents();
    }
    return latest;
  })();
  const remoteIds = withPeers.remote.map((row) => `${row.nodeId}/${row.id}`);
  check('peer agents are listed', withPeers.remote.some((row) => row.id === 'session-beta-live'), remoteIds.join(','));
  check('peer stored agents are listed too', withPeers.remote.some((row) => row.id === 'session-beta-stored'), remoteIds.join(','));
  check('peer rows are attributed to the peer node', withPeers.remote.every((row) => row.nodeId === beta.nodeId), remoteIds.join(','));
  check('peer rows are not dialled yet', withPeers.remote.every((row) => row.dialled !== true), remoteIds.join(','));

  console.log('\nimport from another workspace');
  const imported = await alpha.importAgent({ sessionId: 'session-alpha-stored' });
  check('import reports a resume', imported.resumed === true);
  check('the runtime was asked to resume it', alphaRuntime.resumed.includes('session-alpha-stored'), alphaRuntime.resumed.join(','));
  check('the imported row is live now', imported.agent.live === true);
  check('the imported row kept its workspace', imported.agent.workspace === 'project-b', imported.agent.workspace);
  // A resumed agent with no model selection fails every turn on a missing
  // `{{model}}`, so the default selection must ride along.
  check(
    'the resume carries the default model',
    alphaRuntime.resumeOptions[0]?.model === 'deepseek-v4.1-flash'
      && alphaRuntime.resumeOptions[0]?.provider === 'workbuddy',
    JSON.stringify(alphaRuntime.resumeOptions[0]),
  );
  const again = await alpha.importAgent({ sessionId: 'session-alpha-stored' });
  check('importing a live agent is idempotent', again.resumed === false);
  check('the runtime was asked once', alphaRuntime.resumed.length === 1, alphaRuntime.resumed.join(','));

  let unknownError = '';
  try {
    await alpha.importAgent({ sessionId: 'session-does-not-exist' });
  } catch (error) {
    unknownError = String(error?.code ?? error?.message ?? error);
  }
  check('importing an unknown session is a coded error', unknownError === 'UNKNOWN_AGENT', unknownError);

  console.log('\nnew agent in a workspace');
  // A nested path proves the directory is made on demand: a session's cwd is
  // fixed at creation, so a missing one only fails later inside a turn.
  const projectRoot = join(roots[0], 'workspaces', 'project-e');
  const created = await alpha.createAgentIn({ cwd: projectRoot, sessionName: '鏂颁汉' });
  check('the workspace directory was created', existsSync(projectRoot), projectRoot);
  check('the runtime was asked to create it', alphaRuntime.created.some((row) => row.cwd === projectRoot), JSON.stringify(alphaRuntime.created));
  check('the new agent is live', created.agent.live === true);
  check('the new agent knows its workspace', created.agent.workspace === 'project-e', created.agent.workspace);
  check('the requested name is used', created.agent.name === '鏂颁汉', created.agent.name);
  check(
    'the create carries the default model',
    alphaRuntime.createOptions[0]?.model === 'deepseek-v4.1-flash',
    JSON.stringify(alphaRuntime.createOptions[0]),
  );
  // A session with no preset gets no file or mesh tools, so it cannot even
  // answer the message that woke it. Labelling the header is not enough: the
  // preset has to be mounted while the Agent is being built.
  check(
    'the create carries the default preset',
    alphaRuntime.created[0]?.preset === 'standard',
    JSON.stringify(alphaRuntime.created[0]),
  );
  check(
    'the create mounts the preset',
    alphaRuntime.created[0]?.setup === true && mountedPresets.includes('standard'),
    JSON.stringify(mountedPresets),
  );
  check(
    'the composed agent receives the mesh tools',
    alphaRuntime.mountedTools.includes('lan_mesh_send') && alphaRuntime.mountedTools.includes('lan_mesh_inbox'),
    JSON.stringify(alphaRuntime.mountedTools),
  );
  const existingDir = await alpha.createAgentIn({ cwd: projectRoot });
  check('an existing workspace directory is reused', existingDir.agent.workspace === 'project-e', existingDir.agent.workspace);
  let relativeError = '';
  try {
    await alpha.createAgentIn({ cwd: 'relative\\path' });
  } catch (error) {
    relativeError = String(error?.code ?? error?.message ?? error);
  }
  check('a relative cwd is refused', relativeError === 'BAD_REQUEST', relativeError);

  console.log('\ndial a peer agent');
  const dialled = await alpha.dialAgent({
    target: `${beta.nodeId}/session-beta-live`,
    text: '璇锋鏌ヤ竴涓?beta 鑺傜偣涓婄殑鏋勫缓鑴氭湰',
    topic: '鏋勫缓',
  });
  check('the dial was delivered', dialled.agent.dialled === true, JSON.stringify(dialled.delivery.delivered));
  check('the dial is remembered', alpha.dialled.has(`${beta.nodeId}/session-beta-live`), [...alpha.dialled].join(','));
  const afterDial = await alpha.catalogueAgents();
  check('the catalogue now shows it as dialled', afterDial.remote.find((row) => row.id === 'session-beta-live')?.dialled === true);
  const woke = await until(() => betaRuntime.wakeups.some((row) => row.id === 'session-beta-live'));
  check('the peer agent was woken', woke, JSON.stringify(betaRuntime.wakeups));
  const wakeText = betaRuntime.wakeups.find((row) => row.id === 'session-beta-live')?.text ?? '';
  check('the wake-up carries the request', wakeText.includes('璇锋鏌ヤ竴涓?beta 鑺傜偣涓婄殑鏋勫缓鑴氭湰'), wakeText);
  check('the wake-up tells it where to reply', wakeText.includes(alpha.nodeId), wakeText);
  check('the wake-up uses the frozen source shape', betaRuntime.wakeups[0]?.source?.form === 'relay', JSON.stringify(betaRuntime.wakeups[0]?.source));

  let dialError = '';
  try {
    await alpha.dialAgent({ target: `${beta.nodeId}/session-nope`, text: 'hi' });
  } catch (error) {
    dialError = String(error?.code ?? error?.message ?? error);
  }
  check('dialling an unknown agent is a coded error', dialError === 'UNKNOWN_AGENT', dialError);

  console.log('\nundial');
  check('undial removes the address', alpha.undialAgent(`${beta.nodeId}/session-beta-live`).removed === true);
  check('undial of an unknown address is a no-op', alpha.undialAgent('nope').removed === false);

  console.log('\nshutdown');
  await alpha.close();
  await beta.close();
  check('imported agents are disposed on close', alphaRuntime.live.has('session-alpha-stored') === false);
} finally {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
  process.env.DSH_HOME = savedHome;
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\nagents interop ok');
  }
}
