/**
 * LAN Mesh — let DSH agents on one local network find each other and exchange
 * messages, so a desk, a laptop and a build box can collaborate.
 *
 * Discovery is UDP broadcast; delivery is plain HTTP with optional HMAC signing
 * on a shared cluster secret. Nothing leaves the subnet and no third-party
 * service is involved.
 *
 * Above that transport sits the room layer: a room is a project, it has a leader
 * who hands out tasks, and its members are agent sessions that may live on any
 * node. Rooms replicate between nodes, so every participant sees the same
 * project state whichever machine they joined from.
 *
 * @module dsh-lan-mesh
 */
import { MeshNode } from './lib/service.mjs';
import { Notifier } from './lib/notify.mjs';
import { teamToolDefinitions } from './lib/team-tools.mjs';

export const name = 'dsh-lan-mesh';
/** Every service is optional: a node runs even with no tools, agents or UI. */
export const inject = [];
/** Exact Fetch route the browser panel posts to; `/api` is the reserved prefix. */
const ROUTE_PATH = '/api/lan-mesh';

/**
 * Resolution defaults for one config value.
 *
 * `Config` stays undeclared on purpose: a schemastery schema would be an import
 * this bundle cannot resolve when it is linked from a checkout, and cordis
 * treats a missing schema as "accept any config". The defaults therefore live
 * here and are applied to whatever the loader passes.
 */
const DEFAULTS = {
  displayName: '',
  port: 45871,
  discoveryPort: 45870,
  clusterSecret: '',
  autoWake: true,
  trustedPeers: [],
  /**
   * Optional generic webhook for out-of-band notifications. The primary
   * channel is discovered at send time from the local `@xmanrui/dsh-im`
   * service (WeChat, Feishu, ...); this hook is only an extra opt-in channel.
   * Empty means "discover whatever this machine has".
   */
  notifyWebhook: '',
};

/**
 * Read an environment override for one setting.
 *
 * A second instance on the same machine — a test node, or a staging profile —
 * cannot bind the same HTTP port as the first, and it must be able to say who it
 * is without a second config file. The override wins over the loader config so
 * `DSH_LAN_MESH_PORT=45872 dsh web` just works.
 * @param {string} name - environment variable name.
 * @returns {string | undefined} trimmed value, or undefined when unset.
 */
function envValue(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Normalize the loader's config into the shape the node consumes.
 * @param {unknown} raw - config object supplied by the caller or the patch file.
 * @returns {object} resolved configuration.
 */
function resolveConfig(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {};
  const envPort = Number(envValue('DSH_LAN_MESH_PORT'));
  const envDiscoveryPort = Number(envValue('DSH_LAN_MESH_DISCOVERY_PORT'));
  const port = Number.isInteger(envPort) && envPort > 0 ? envPort : Number(value.port);
  const discoveryPort =
    Number.isInteger(envDiscoveryPort) && envDiscoveryPort > 0
      ? envDiscoveryPort
      : Number(value.discoveryPort);
  const envName = envValue('DSH_LAN_MESH_NAME');
  const envSecret = envValue('DSH_LAN_MESH_SECRET');
  return {
    displayName:
      envName ?? (typeof value.displayName === 'string' ? value.displayName : DEFAULTS.displayName),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULTS.port,
    discoveryPort:
      Number.isInteger(discoveryPort) && discoveryPort > 0 && discoveryPort <= 65535
        ? discoveryPort
        : DEFAULTS.discoveryPort,
    clusterSecret:
      envSecret ?? (typeof value.clusterSecret === 'string' ? value.clusterSecret : DEFAULTS.clusterSecret),
    autoWake: value.autoWake === undefined ? DEFAULTS.autoWake : value.autoWake !== false,
    teamEnabled: value.teamEnabled === true,
    teamLeaseMs: value.teamLeaseMs ?? 90000,
    teamHeartbeatMs: value.teamHeartbeatMs ?? 20000,
    teamRequestWindowMs: value.teamRequestWindowMs ?? 120000,
    teamAuthorizations: Array.isArray(value.teamAuthorizations) ? value.teamAuthorizations.filter(row => row && typeof row === 'object').map(row => ({ roomId: row.roomId, leaderKey: row.leaderKey, workerSessionId: row.workerSessionId, workspaceRoot: row.workspaceRoot })) : [],
    trustedPeers: Array.isArray(value.trustedPeers)
      ? value.trustedPeers.filter((item) => typeof item === 'string' && item !== '')
      : DEFAULTS.trustedPeers,
    notifyWebhook:
      typeof value.notifyWebhook === 'string' ? value.notifyWebhook.trim() : DEFAULTS.notifyWebhook,
  };
}

/** Shared empty output schema for "nothing to report". */
const EMPTY_OBJECT = { type: 'object', additionalProperties: false, properties: {} };

/** One text block, the only content kind these tools return. */
function text(value) {
  return [{ type: 'text', text: value }];
}

/**
 * Wrap one panel result in the connection response envelope.
 *
 * The browser transport insists on `{type:'server-response', rpcId, result}` and
 * on `result.error.details` being an object, so a failure is normalized here
 * rather than at every call site.
 *
 * @param rpcId - correlation id echoed back from the request.
 * @param result - `{ok:true, value}` or `{ok:false, error}`.
 * @returns a JSON `Response` for the Fetch route.
 */
function reply(rpcId, result) {
  const body =
    result.ok === false
      ? {
          ...result,
          error: {
            ...result.error,
            details: result.error?.details ?? {},
          },
        }
      : result;
  return Response.json({ type: 'server-response', rpcId, result: body });
}

/**
 * Render a delivery report for the model.
 * @param {object} value - report returned by the node.
 * @returns {string}
 */
function renderSend(value) {
  if (value.delivered.length === 0) return value.note ?? '消息没有送达任何节点。';
  return value.delivered
    .map((row) => (row.ok ? `已送达 ${row.name} (${row.nodeId})` : `送达 ${row.name} 失败：${row.error}`))
    .join('\n');
}

/**
 * Render the peer list for the model.
 * @param {object} value - peer list payload.
 * @returns {string}
 */
function renderPeers(value) {
  if (value.peers.length === 0) {
    return `本节点 ${value.self.name} (${value.self.nodeId}) 当前没有发现其他节点。确认对方机器上的 DSH 也在运行，且两台机器在同一网段。`;
  }
  return [
    `本节点 ${value.self.name} (${value.self.nodeId})，监听端口 ${value.self.port}，已发现 ${value.peers.length} 个节点：`,
    ...value.peers.map((peer) => `- ${peer.name} (${peer.nodeId}) ${peer.address}:${peer.port}，${peer.ageSeconds}s 前活跃`),
  ].join('\n');
}

/**
 * Render the inbox for the model.
 * @param {object} value - inbox payload.
 * @returns {string}
 */
function renderInbox(value) {
  if (value.messages.length === 0) return `没有消息。当前未读 ${value.unread} 条，总计 ${value.total} 条。`;
  return [
    `未读 ${value.unread} 条，总计 ${value.total} 条，以下是最新的 ${value.messages.length} 条：`,
    ...value.messages.map((item) => `- [${item.receivedAt}] 来自 ${item.from.name || item.from.nodeId}${item.topic ? `（${item.topic}）` : ''}：${item.text}`),
  ].join('\n');
}

/** Status words shown to the model instead of the wire values. */
const STATUS_LABELS = { open: '待开始', doing: '进行中', blocked: '受阻', done: '已完成' };

/**
 * Render the caller's room list, biased toward what the caller must act on.
 * @param {object} value - payload from `listRooms`.
 * @returns {string}
 */
function renderRooms(value) {
  if (value.rooms.length === 0) {
    return [
      '当前会话还没有加入任何房间。',
      '房间相当于一个项目：先 lan_mesh_room_member action=create 建一个，或者 action=join 用房间名加入已有的房间。',
    ].join('\n');
  }
  const lines = [];
  for (const room of value.rooms) {
    const mine = room.tasks.filter((task) => task.assignee.sessionId === value.sessionId && task.status !== 'done');
    lines.push(
      `- ${room.name}（id ${room.id}，${room.role === 'leader' ? '我是 leader' : '我是成员'}，${room.members.length} 人，${room.tasks.length} 个任务）`,
    );
    if (room.topic) lines.push(`  目标：${room.topic}`);
    for (const task of mine) {
      lines.push(`  指派给我：[${STATUS_LABELS[task.status] ?? task.status}] ${task.title}${task.detail ? ` — ${firstLine(task.detail)}` : ''}`);
    }
    const others = room.tasks.filter((task) => task.assignee.sessionId !== value.sessionId && task.status !== 'done');
    for (const task of others) {
      lines.push(`  ${task.assignee.name}：[${STATUS_LABELS[task.status] ?? task.status}] ${task.title}`);
    }
  }
  return [`本节点 ${value.self.name}，会话 ${value.sessionId} 所在房间 ${value.rooms.length} 个：`, ...lines].join('\n');
}

/**
 * Render one room-with-tasks result.
 * @param {object} value - payload from `assignTask` or `setTaskStatus`.
 * @returns {string}
 */
function renderTask(value) {
  const task = value.task;
  const lines = [
    `${value.room.name}：任务「${task.title}」已交给 ${task.assignee.name}（状态 ${STATUS_LABELS[task.status] ?? task.status}）。`,
  ];
  if (task.detail) lines.push(`说明：${task.detail}`);
  if (Array.isArray(value.delivered) && value.delivered.length > 0) {
    lines.push(
      `通知投递：${value.delivered.map((row) => (row.ok ? `${row.name} 已通知` : `${row.name} 未通知（${row.error}）`)).join('，')}`,
    );
  }
  return lines.join('\n');
}

/**
 * Render a room membership change or room message for the model.
 * @param {object} value - payload from membership or `sayInRoom` calls.
 * @returns {string}
 */
function renderRoomAction(value) {
  return value.summary;
}

/**
 * First line of a multi-line block, shortened.
 * @param {string} value - text.
 * @returns {string}
 */
function firstLine(value) {
  const line = value.split('\n')[0];
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

/**
 * One agent catalogue row.
 *
 * Local rows (`agents`) carry `imported`; remote rows (`remote`) carry `dialled`.
 * Both optional flags are declared here so one schema serves both lists.
 */
const AGENT_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nodeId', 'nodeName', 'id', 'name', 'live', 'status', 'cwd', 'workspace', 'rooms'],
  properties: {
    nodeId: { type: 'string' },
    nodeName: { type: 'string' },
    id: { type: 'string' },
    title: { type: 'string' },
    name: { type: 'string' },
    live: { type: 'boolean' },
    imported: { type: 'boolean' },
    dialled: { type: 'boolean' },
    status: { type: 'string' },
    cwd: { type: 'string' },
    workspace: { type: 'string' },
    rooms: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Render the agent catalogue for the model.
 * @param {object} value - payload from `lan_mesh_agents`.
 * @returns {string}
 */
function renderAgents(value) {
  const lines = [`本节点 ${value.self.name}（${value.self.nodeId}）的 agent：`];
  if (value.agents.length === 0) lines.push('（没有会话）');
  for (const row of value.agents) {
    const flags = [row.live ? '运行中' : '未启动', row.workspace || '未知 workspace'];
    if (row.status) flags.unshift(row.status);
    lines.push(`- ${row.name}（${row.id}）${flags.join(' · ')}`);
  }
  if (value.remote.length === 0) {
    lines.push('', '局域网其他节点上没有可见的 agent。');
    return lines.join('\n');
  }
  lines.push('', '局域网其他节点的 agent：');
  for (const row of value.remote) {
    const tag = row.dialled ? '已联络' : row.live ? '运行中' : '未启动';
    lines.push(`- ${row.name}（${row.nodeId}/${row.id}）${tag} · ${row.workspace || '未知 workspace'}`);
  }
  return lines.join('\n');
}

/**
 * Render an import or dial result for the model.
 * @param {object} value - payload from import/dial tools.
 * @returns {string}
 */
function renderAgentAction(value) {
  return value.summary;
}

/**
 * Member shape shared by every room output schema.
 *
 * `live` is required: a panel that cannot tell an absent member from a present
 * one would render a green dot for everyone. Remote members report their node's
 * reachability, local ones whether their session is running.
 */
const MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nodeId', 'sessionId', 'name', 'role', 'live'],
  properties: {
    nodeId: { type: 'string' },
    sessionId: { type: 'string' },
    name: { type: 'string' },
    title: { type: 'string' },
    role: { type: 'string', enum: ['leader', 'member'] },
    key: { type: 'string' },
    live: { type: 'boolean' },
  },
};

/** Task shape shared by every room output schema. */
const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'status', 'assignee', 'assigner'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    detail: { type: 'string' },
    status: { type: 'string', enum: ['open', 'doing', 'blocked', 'done'] },
    assignee: MEMBER_SCHEMA,
    assigner: MEMBER_SCHEMA,
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

/**
 * Room shape produced by the room list (`roomsFor` / `allRooms`), which is
 * projected relative to the calling session.
 */
const ROOM_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'topic', 'role', 'isMember', 'isLeader', 'members', 'tasks'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    topic: { type: 'string' },
    role: { type: 'string' },
    isMember: { type: 'boolean' },
    isLeader: { type: 'boolean' },
    members: { type: 'array', items: MEMBER_SCHEMA },
    tasks: { type: 'array', items: TASK_SCHEMA },
    updatedAt: { type: 'string' },
  },
};

/**
 * Room shape produced by a room mutation or detail read (`MeshNode#roomView`),
 * which describes the room itself rather than the caller's role in it.
 */
const ROOM_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'topic', 'members', 'memberCount', 'tasks'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    topic: { type: 'string' },
    leader: MEMBER_SCHEMA,
    members: { type: 'array', items: MEMBER_SCHEMA },
    memberCount: { type: 'number' },
    tasks: { type: 'array', items: TASK_SCHEMA },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

/**
 * One delivery report row, shared by the room tools that notify members.
 * The node fills these rows itself, so every field it may set must be declared.
 */
const DELIVERED_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'ok'],
    properties: {
      nodeId: { type: 'string' },
      name: { type: 'string' },
      ok: { type: 'boolean' },
      error: { type: 'string' },
      deliveredAt: { type: 'string' },
      local: { type: 'boolean' },
      woken: { type: 'boolean' },
    },
  },
};

/**
 * Register the mesh against the context.
 * @param {object} ctx - Host context.
 * @param {object} config - resolved plugin configuration.
 */
/**
 * Notification is a reserved extension point, not a hardcoded channel.
 *
 * When something is worth telling a human (a room task is done, or an agent
 * explicitly calls `lan_mesh_notify`), `Notifier` discovers whatever this
 * machine has — the local `@xmanrui/dsh-im` service (WeChat / Feishu / ...)
 * plus an optional generic webhook — and:
 *   - 1 channel  -> sends immediately
 *   - >1 channels -> holds the message for a human to confirm in the panel
 *   - 0 channels -> logs and gives up
 *
 * Discovery happens at send time (services mount after `apply` runs), and every
 * failure is swallowed: a missing notifier must never take the mesh down.
 * See lib/notify.mjs.
 */

/** Entry point of the panel Fetch route. Kept separate so the route body stays readable. */
async function fetchPanelRequest(httpRequest, handleEndpoint, log) {
  if (httpRequest.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const contentType = httpRequest.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 });
  }
  let body;
  try {
    body = await httpRequest.json();
  } catch {
    return new Response('body is not JSON', { status: 400 });
  }
  const rpcId = typeof body?.rpcId === 'string' && body.rpcId !== '' ? body.rpcId : 'invalid-request';
  const envelope = body?.payload;
  if (
    body === null ||
    typeof body !== 'object' ||
    body.type !== 'client-request' ||
    typeof body.rpcId !== 'string' ||
    envelope === null ||
    typeof envelope !== 'object' ||
    typeof envelope.method !== 'string' ||
    !Object.hasOwn(envelope, 'payload')
  ) {
    return reply(rpcId, {
      ok: false,
      error: { code: 'gateway/bad-request', message: 'Invalid LAN Mesh panel request.', details: {} },
    });
  }
  return reply(rpcId, await handleEndpoint(envelope.method, envelope.payload));
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const log = (message, detail) => {
    const text = detail === undefined ? message : `${message}: ${String(detail?.message ?? detail)}`;
    const logger = ctx.logger;
    try {
      if (typeof logger?.warn === 'function') logger.warn(`dsh-lan-mesh: ${text}`);
      else if (typeof logger === 'function') logger(`dsh-lan-mesh: ${text}`);
    } catch {
      // Diagnostics must never be the reason a mesh fails to start.
    }
  };
  // Notifications are a reserved extension point: discover local channels at
  // send time (the IM service mounts after `apply`), never hardcode one.
  const notifier = new Notifier({
    config,
    getIm: () => ctx.get('dshIm'),
    log,
  });
  const node = new MeshNode({
    config,
    // Resolved lazily: `apply` runs before every Host service is mounted, so a
    // service captured here can be undefined forever — and an undefined `agents`
    // is exactly what made "new agent in a workspace" fail with NOT_SUPPORTED.
    getAgents: () => ctx.get('agents'),
    getSessionPersistence: () => ctx.get('sessionPersistence'),
    getAgentDefaultModel: () => ctx.get('agentDefaultModel'),
    getAgentPresets: () => ctx.get('agentPresets'),
    // Titles live behind a projection registry that is not mounted yet either.
    getSessionProjections: () => ctx.get('sessionProjections'),
    // Naming a new session and offering a workspace picker are the same story:
    // both services appear after `apply` has already run.
    getSessionTitle: () => ctx.get('sessionTitle'),
    getWorkspaceRegistry: () => ctx.get('workspaceRegistry'),
    // Same laziness, and the array is filled further down: the closure is only
    // read when an Agent is composed, which is after this line has run.
    getToolDefinitions: () => toolDefinitions,
    // Generic out-of-band notifier (task done, or lan_mesh_notify). One local
    // channel sends automatically; several wait for a human to pick one.
    notify: (message, scope) => notifier.notify(message, scope),
    getNotify: () => notifier.describe(),
    log,
  });
  /** Resolve the calling agent id so a wake-up reaches the right session. */
  const callerId = (exec) => (typeof exec?.agent?.id === 'string' ? exec.agent.id : '');
  /**
   * The name a member is shown as, derived from the session id when the caller
   * did not supply one.
   * @param {object} exec - tool run context.
   * @param {string} [explicit] - caller-supplied display name.
   * @returns {string}
   */
  const callerName = (exec, explicit) => {
    const wanted = typeof explicit === 'string' ? explicit.trim() : '';
    if (wanted !== '') return wanted;
    const id = callerId(exec);
    return id === '' ? '会话' : `会话 ${id.slice(0, 8)}`;
  };

  // Filled once the tools service is mounted; the Agent setup reads it later.
  const toolDefinitions = [];
  // The tools service is not mounted yet when `apply` runs on every Host, and
  // `ctx.get` does not wait for it: a direct read can be undefined forever,
  // which silently drops every tool. `inject` waits, and the property access
  // gives a properly bound service.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (scope) => {
      const tools = scope.tools;
      if (tools === undefined || typeof tools.register !== 'function') return undefined;
      return scope.effect(() => {
      /**
       * Register one definition and remember it, so an Agent created later can
       * be handed the same tools: a preset-composed Agent only sees the rows in
       * its preset, and this plugin is not one of them.
       * @param {object} definition - tool definition.
       * @returns {() => void} disposer.
       */
      const registerTool = (definition) => {
        toolDefinitions.push(definition);
        return tools.register(definition);
      };
      const disposers = [
        registerTool({
          name: 'lan_mesh_list_peers',
          description:
            '列出同一局域网内已发现的其他 DSH 节点（名称、nodeId、地址、最近活跃时间）。给其他 agent 发消息前先用它确认目标名称。',
          parameters: EMPTY_OBJECT,
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['self', 'peers'],
              properties: {
                self: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['nodeId', 'name', 'port'],
                  properties: {
                    nodeId: { type: 'string' },
                    name: { type: 'string' },
                    port: { type: 'integer' },
                  },
                },
                peers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['nodeId', 'name', 'address', 'port', 'ageSeconds'],
                    properties: {
                      nodeId: { type: 'string' },
                      name: { type: 'string' },
                      address: { type: 'string' },
                      port: { type: 'integer' },
                      ageSeconds: { type: 'integer' },
                    },
                  },
                },
              },
            },
            render: (_args, value) => text(renderPeers(value)),
          },
          async execute(_args, exec) {
            await node.start();
            node.focusAgentId = callerId(exec);
            return {
              self: { nodeId: node.nodeId, name: node.describe().name, port: node.port },
              peers: node.peers(),
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_send',
          description:
            '给同一局域网内的另一个 DSH 节点发一条消息。target 用 lan_mesh_list_peers 里的名称或 nodeId；写成 "<nodeId>/<sessionId>" 可以把消息直接投递给对方指定会话；写 "*" 表示广播给所有已发现节点。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['target', 'text'],
            properties: {
              target: { type: 'string', description: '目标节点名称、nodeId、nodeId/sessionId，或 * 表示全体。' },
              text: { type: 'string', description: '要发送的正文，纯文本。' },
              topic: { type: 'string', description: '可选主题，帮助对方判断上下文。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['delivered'],
              properties: {
                messageId: { type: 'string' },
                note: { type: 'string' },
                delivered: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['nodeId', 'name', 'ok'],
                    properties: {
                      nodeId: { type: 'string' },
                      name: { type: 'string' },
                      ok: { type: 'boolean' },
                      error: { type: 'string' },
                      deliveredAt: { type: 'string' },
                    },
                  },
                },
              },
            },
            render: (_args, value) => text(renderSend(value)),
          },
          async execute(args, exec) {
            const report = await node.send({ ...args, fromAgentId: callerId(exec) });
            return {
              messageId: report.messageId,
              ...(report.note === undefined ? {} : { note: report.note }),
              delivered: report.delivered.map((row) => ({
                nodeId: row.nodeId,
                name: row.name,
                ok: row.ok,
                ...(row.error === undefined ? {} : { error: row.error }),
                ...(row.deliveredAt === undefined ? {} : { deliveredAt: row.deliveredAt }),
              })),
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_inbox',
          description:
            '读取本节点收到的局域网消息。默认只列未读；unread_only 为 false 时列出全部最近消息。读完自动标记为已读。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              limit: { type: 'integer', description: '返回条数上限，默认 20，最大 200。' },
              unread_only: { type: 'boolean', description: '默认 true，只返回未读消息。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['unread', 'total', 'messages'],
              properties: {
                unread: { type: 'integer' },
                total: { type: 'integer' },
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'receivedAt', 'from', 'text'],
                    properties: {
                      id: { type: 'string' },
                      receivedAt: { type: 'string' },
                      from: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['nodeId', 'name'],
                        properties: { nodeId: { type: 'string' }, name: { type: 'string' } },
                      },
                      kind: { type: 'string' },
                      topic: { type: 'string' },
                      text: { type: 'string' },
                    },
                  },
                },
              },
            },
            render: (_args, value) => text(renderInbox(value)),
          },
          async execute(args, exec) {
            await node.start();
            node.focusAgentId = callerId(exec);
            const result = node.inbox({
              limit: Number.isFinite(args.limit) ? args.limit : 20,
              unreadOnly: args.unread_only !== false,
              markRead: true,
            });
            return {
              unread: result.unread,
              total: result.total,
              messages: result.messages.map((item) => ({
                id: item.id,
                receivedAt: item.receivedAt,
                from: { nodeId: item.from.nodeId, name: item.from.name },
                kind: item.kind,
                topic: item.topic,
                text: item.text,
              })),
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_rooms',
          description:
            '列出当前会话加入的所有房间（房间=项目）及其成员和任务：leader 会看到每个人手上的任务，成员主要看指派给自己的。接到"项目/房间/协作任务"相关请求时先调用它。',
          parameters: EMPTY_OBJECT,
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['self', 'sessionId', 'rooms'],
              properties: {
                self: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['nodeId', 'name'],
                  properties: { nodeId: { type: 'string' }, name: { type: 'string' } },
                },
                sessionId: { type: 'string' },
                rooms: { type: 'array', items: ROOM_ROW_SCHEMA },
              },
            },
            render: (_args, value) => text(renderRooms(value)),
          },
          async execute(_args, exec) {
            await node.start();
            const sessionId = callerId(exec);
            node.focusAgentId = sessionId;
            return {
              self: { nodeId: node.nodeId, name: node.describe().name },
              sessionId,
              rooms: node.listRooms({ sessionId }),
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_room_member',
          description:
            '管理房间成员关系。action=create 新建房间并把自己设为 leader（房间=项目，leader 负责给成员分配任务）；action=join 用房间名或 id 把自己加入已有房间；action=leave 退出房间（leader 不能退出自己建的房间）。房间状态会同步给局域网内其他节点。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'room'],
            properties: {
              action: { type: 'string', enum: ['create', 'join', 'leave'], description: '要执行的动作。' },
              room: { type: 'string', description: 'create 时是新房间的名字；join/leave 时是房间名或房间 id。' },
              topic: { type: 'string', description: 'create 时可选的项目目标，一句话说明这个项目要做什么。' },
              member_name: { type: 'string', description: '可选，我在这个房间里的显示名，默认从会话 id 生成。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'room'],
              properties: {
                summary: { type: 'string' },
                added: { type: 'boolean' },
                room: ROOM_VIEW_SCHEMA,
              },
            },
            render: (_args, value) => text(renderRoomAction(value)),
          },
          async execute(args, exec) {
            await node.start();
            const sessionId = callerId(exec);
            node.focusAgentId = sessionId;
            const sessionName = callerName(exec, args.member_name);
            if (args.action === 'create') {
              const created = await node.createRoom({
                name: String(args.room ?? ''),
                topic: typeof args.topic === 'string' ? args.topic : '',
                sessionId,
                sessionName,
              });
              return {
                summary: `已创建房间「${created.room.name}」（id ${created.room.id}），你是 leader。用 lan_mesh_room_member action=join 让其他会话加入，然后用 lan_mesh_room_task 分配任务。`,
                added: true,
                room: created.room,
              };
            }
            if (args.action === 'join') {
              const joined = await node.joinRoom({
                room: String(args.room ?? ''),
                sessionId,
                sessionName,
              });
              return {
                summary: joined.added
                  ? `已加入房间「${joined.room.name}」（id ${joined.room.id}），当前 ${joined.room.members.length} 人。`
                  : `你已经在这个房间「${joined.room.name}」里了，无需重复加入。`,
                added: joined.added,
                room: joined.room,
              };
            }
            const left = await node.leaveRoom({ room: String(args.room ?? ''), sessionId });
            return {
              summary: left.removed
                ? `已退出房间「${left.room.name}」。`
                : `你不在这个房间「${left.room.name}」里，无需退出。`,
              added: false,
              room: left.room,
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_room_task',
          description:
            '在房间里分配任务或更新任务状态。action=assign 由 leader 把任务指派给某个成员（assignee 可写成员名、会话 id 或节点名）；action=status 把自己手上任务的进度改为 open/doing/blocked/done，可附一句说明。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'room'],
            properties: {
              action: { type: 'string', enum: ['assign', 'status'], description: '要执行的动作。' },
              room: { type: 'string', description: '房间名或房间 id。' },
              assignee: { type: 'string', description: 'assign 时必填：成员名、会话 id 或节点名。' },
              title: { type: 'string', description: 'assign 时必填：一句话任务标题。' },
              detail: { type: 'string', description: 'assign 时可选：任务详情、验收标准或上下文。' },
              task: { type: 'string', description: 'status 时必填：任务 id 或任务标题。' },
              status: {
                type: 'string',
                enum: ['open', 'doing', 'blocked', 'done'],
                description: 'status 时必填：任务新状态。',
              },
              note: { type: 'string', description: 'status 时可选：一句进度说明，会追加到任务详情。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'room', 'task'],
              properties: {
                summary: { type: 'string' },
                room: ROOM_VIEW_SCHEMA,
                task: TASK_SCHEMA,
                delivered: DELIVERED_SCHEMA,
              },
            },
            render: (_args, value) => text(value.summary),
          },
          async execute(args, exec) {
            await node.start();
            const sessionId = callerId(exec);
            node.focusAgentId = sessionId;
            if (args.action === 'assign') {
              const result = await node.assignTask({
                room: String(args.room ?? ''),
                sessionId,
                assignee: String(args.assignee ?? ''),
                title: String(args.title ?? ''),
                detail: typeof args.detail === 'string' ? args.detail : '',
              });
              return {
                summary: renderTask({ room: result.room, task: result.task, delivered: result.delivered }),
                room: result.room,
                task: result.task,
                delivered: result.delivered,
              };
            }
            const result = await node.setTaskStatus({
              room: String(args.room ?? ''),
              sessionId,
              task: String(args.task ?? ''),
              status: String(args.status ?? ''),
              note: typeof args.note === 'string' ? args.note : '',
            });
            return {
              summary: `${result.room.name}：任务「${result.task.title}」现在是${STATUS_LABELS[result.task.status] ?? result.task.status}。`,
              room: result.room,
              task: result.task,
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_room_say',
          description:
            '在房间里发一条消息。只有同一房间的成员会收到，本节点和局域网内其他节点上的房间成员都会收到；用于同步进展、提问或交接。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['room', 'text'],
            properties: {
              room: { type: 'string', description: '房间名或房间 id。' },
              text: { type: 'string', description: '要发送的正文，纯文本。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'room'],
              properties: {
                summary: { type: 'string' },
                room: ROOM_VIEW_SCHEMA,
                delivered: DELIVERED_SCHEMA,
              },
            },
            render: (_args, value) => text(value.summary),
          },
          async execute(args, exec) {
            await node.start();
            const sessionId = callerId(exec);
            node.focusAgentId = sessionId;
            const result = await node.sayInRoom({
              room: String(args.room ?? ''),
              sessionId,
              text: String(args.text ?? ''),
            });
            const remote = Array.isArray(result.delivered) ? result.delivered : [];
            const remoteNote =
              remote.length === 0
                ? '本房间目前只在本节点上有成员。'
                : `远端投递：${remote.map((row) => (row.ok ? `${row.name} 已收到` : `${row.name} 未收到（${row.error}）`)).join('，')}`;
            return {
              summary: `已在房间「${result.room.name}」发言，${result.room.members.length - 1} 位成员会收到。${remoteNote}`,
              room: result.room,
              delivered: remote,
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_agents',
          description:
            '列出本节点上的 agent 会话（运行中与已存盘但未启动的，各自带 workspace 目录），以及局域网其他节点上可供联络的 agent。想从别的 workspace 或别人的机器引入 agent 时先用它确认 id。',
          parameters: EMPTY_OBJECT,
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['self', 'agents', 'remote'],
              properties: {
                self: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['nodeId', 'name'],
                  properties: {
                    nodeId: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                agents: { type: 'array', items: AGENT_ROW_SCHEMA },
                remote: { type: 'array', items: AGENT_ROW_SCHEMA },
              },
            },
            render: (_args, value) => text(renderAgents(value)),
          },
          async execute(_args, exec) {
            await node.start();
            node.focusAgentId = callerId(exec);
            return await node.catalogueAgents();
          },
        }),
        registerTool({
          name: 'lan_mesh_agent_import',
          description:
            '把 agent 引入本节点。给 session 则把一个已存盘但没在跑的会话重新启动起来（它的 workspace 目录是会话自带的，这就是"从其他 workspace 引入 agent"，不移动任何文件）；给 cwd 则在该 workspace 目录新建一个 agent 会话。已在跑的会话直接返回，不报错。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              session: { type: 'string', description: 'lan_mesh_agents 返回的会话 id（也接受会话名）。与 cwd 二选一。' },
              cwd: { type: 'string', description: '绝对目录路径；在该 workspace 新建 agent。与 session 二选一。' },
              name: { type: 'string', description: '可选显示名，仅用于列表展示。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'agent', 'resumed'],
              properties: {
                summary: { type: 'string' },
                agent: AGENT_ROW_SCHEMA,
                resumed: { type: 'boolean' },
              },
            },
            render: (_args, value) => text(value.summary),
          },
          async execute(args, exec) {
            await node.start();
            node.focusAgentId = callerId(exec);
            const session = String(args.session ?? '').trim();
            const cwd = String(args.cwd ?? '').trim();
            const sessionName = typeof args.name === 'string' ? args.name : '';
            if (session === '' && cwd === '') {
              throw new Error('需要给 session（重启已有会话）或 cwd（在该目录新建 agent）之一');
            }
            if (cwd !== '') {
              const created = await node.createAgentIn({ cwd, sessionName });
              return {
                summary: `已在 ${cwd} 新建 agent ${created.agent.name}（${created.agent.id}）。`,
                agent: created.agent,
                resumed: false,
              };
            }
            const result = await node.importAgent({ sessionId: session, sessionName });
            return {
              summary: result.resumed
                ? `已启动 ${result.agent.name}（${result.agent.id}），workspace ${result.agent.workspace || result.agent.cwd}。`
                : `${result.agent.name}（${result.agent.id}）本来就在运行。`,
              agent: result.agent,
              resumed: result.resumed === true,
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_agent_dial',
          description:
            '直接联系局域网其他机器上的某个 agent：先列出对方节点上的 agent，再用本工具把第一句指令投过去。它完成后会用 lan_mesh_send 回信（异步，不等返回）。也可以额外新建一个指定 workspace 的 agent 时用 create 参数。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['target', 'text'],
            properties: {
              target: { type: 'string', description: '远端 agent 地址，形如 "<nodeId>/<sessionId>"（用 lan_mesh_agents 的 remote 列表取得）。' },
              text: { type: 'string', description: '第一句指令，纯文本。' },
              topic: { type: 'string', description: '可选主题。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'agent', 'delivered'],
              properties: {
                summary: { type: 'string' },
                agent: AGENT_ROW_SCHEMA,
                delivered: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'ok'],
                    properties: {
                      nodeId: { type: 'string' },
                      name: { type: 'string' },
                      ok: { type: 'boolean' },
                      error: { type: 'string' },
                      deliveredAt: { type: 'string' },
                    },
                  },
                },
              },
            },
            render: (_args, value) => text(value.summary),
          },
          async execute(args, exec) {
            await node.start();
            node.focusAgentId = callerId(exec);
            const result = await node.dialAgent({
              target: String(args.target ?? ''),
              text: String(args.text ?? ''),
              topic: typeof args.topic === 'string' ? args.topic : '',
            });
            const delivered = (result.delivery.delivered ?? []).map((row) => ({
              nodeId: row.nodeId,
              name: row.name,
              ok: row.ok,
              ...(row.error === undefined ? {} : { error: row.error }),
              ...(row.deliveredAt === undefined ? {} : { deliveredAt: row.deliveredAt }),
            }));
            const ok = delivered.some((row) => row.ok);
            return {
              summary: ok
                ? `已把指令投给 ${result.agent.nodeName} 上的 ${result.agent.name}（${result.agent.id}），它完成后会用 lan_mesh_send 回信到本节点。`
                : `无法投递到 ${result.agent.nodeId}/${result.agent.id}：${delivered.map((row) => row.error ?? '失败').join('，')}`,
              agent: result.agent,
              delivered,
            };
          },
        }),
        registerTool({
          name: 'lan_mesh_notify',
          description:
            '预留的「通知人」操作：执行时自主查找本机可用的通知渠道（微信 im、飞书、或配置的 webhook），只有一个就自动发，有多个就把消息挂起、让用户在面板里二次确认选哪个。也用来列出渠道、确认或忽略挂起通知。房间任务被置为 done 时会自动触发同样的通知。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: [],
            properties: {
              action: {
                type: 'string',
                enum: ['send', 'channels', 'confirm', 'dismiss'],
                description: 'send（默认）：按 text 发起通知；channels：列出本机可用渠道；confirm：对挂起通知选渠道发送；dismiss：丢弃挂起通知。',
              },
              text: { type: 'string', description: 'action=send 时的通知正文。' },
              id: { type: 'string', description: 'action=confirm/dismiss 时的挂起通知编号。' },
              channel: { type: 'string', description: 'action=confirm 时选中的渠道 id（用 channels 或挂起消息里的列表取得）。' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['summary', 'status', 'channels', 'pending'],
              properties: {
                summary: { type: 'string' },
                status: { type: 'string' },
                id: { type: 'string' },
                ok: { type: 'boolean' },
                error: { type: 'string' },
                channel: { type: 'string' },
                channels: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'label', 'kind'],
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      kind: { type: 'string' },
                    },
                  },
                },
                pending: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'message', 'createdAt', 'channels'],
                    properties: {
                      id: { type: 'string' },
                      message: { type: 'string' },
                      createdAt: { type: 'string' },
                      channels: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['id', 'label'],
                          properties: { id: { type: 'string' }, label: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
            render: (_args, value) => text(value.summary),
          },
          async execute(args, exec) {
            await node.start();
            node.focusAgentId = callerId(exec);
            const action = typeof args.action === 'string' && args.action !== '' ? args.action : 'send';
            const view = () => ({ channels: [], pending: notifier.describe().pending });
            let base;
            if (action === 'channels') {
              base = {
                summary: `本机可用通知渠道 ${0} 个。`,
                status: 'channels',
                channels: await notifier.listChannels(),
                pending: notifier.describe().pending,
              };
              base.summary = `本机可用通知渠道 ${base.channels.length} 个。`;
            } else if (action === 'send') {
              const result = await notifier.notify(String(args.text ?? ''), callerId(exec));
              base = {
                summary: result.summary,
                status: result.status,
                channels: (result.channels ?? []).map((row) => ({ ...row, kind: '' })),
                pending: notifier.describe().pending,
                ...(result.id === undefined ? {} : { id: result.id }),
              };
            } else if (action === 'confirm') {
              const result = await notifier.confirm(String(args.id ?? ''), String(args.channel ?? ''));
              base = {
                summary: result.summary ?? (result.ok === false ? `确认失败：${result.error}` : '已确认。'),
                status: result.status ?? (result.ok === false ? 'failed' : 'dismissed'),
                ok: result.ok !== false,
                channels: view().channels,
                pending: notifier.describe().pending,
                ...(result.error === undefined ? {} : { error: result.error }),
              };
            } else if (action === 'dismiss') {
              const result = notifier.dismiss(String(args.id ?? ''));
              base = {
                summary: result.ok ? '已忽略该待确认通知。' : '没有这个待确认通知。',
                status: result.ok ? 'dismissed' : 'failed',
                ok: result.ok,
                channels: view().channels,
                pending: notifier.describe().pending,
              };
            } else {
              base = { summary: `未知操作 ${action}。`, status: 'failed', channels: [], pending: notifier.describe().pending };
            }
            return base;
          },
        }),
      ];
        if (config.teamEnabled) for (const definition of teamToolDefinitions(node)) disposers.push(registerTool(definition));
        return () => {
          for (const dispose of disposers) dispose?.();
        };
      });
    });
  }

  // The panel talks to the host over an exact Fetch route under the reserved
  // `/api` prefix. That registry lives on the connection service itself and, as
  // a bonus, only admits owner principals — the browser session that already
  // authenticated for this UI — so the panel cannot be driven from another tab
  // or from a plain curl on the LAN.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (scope) => {
      const connection = scope.connection;
      if (connection?.fetch === undefined || typeof connection.fetch.register !== 'function') return;
      return connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (httpRequest) => {
          try {
            return await fetchPanelRequest(httpRequest, handleEndpoint, log);
          } catch (error) {
            log('panel fetch handler failed', error);
            return new Response(
              JSON.stringify({
                type: 'server-response',
                rpcId: 'invalid-request',
                result: { ok: false, error: { code: 'LAN_MESH_FAILED', message: String(error?.message ?? error), details: {} } },
              }),
              { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
            );
          }
        },
      });
    });
  }

  /**
   * Answer one panel endpoint.
   *
   * Endpoints stay plain names (`snapshot`, `roomJoin`, …) rather than paths: the
   * panel switches on the returned value, and a bad name is a normal error the
   * UI can show instead of a transport failure.
   *
   * @param endpoint - endpoint name sent by the panel.
   * @param payload - untrusted request payload.
   * @returns the `{ok, value}` / `{ok, error}` result the panel expects.
   */
  async function handleEndpoint(endpoint, payload) {
    const request = payload !== null && typeof payload === 'object' ? payload : {};
    const str = (key) => String(request[key] ?? '');
    const opt = (key) => (typeof request[key] === 'string' ? request[key] : '');
    const failed = (code, message) => ({ ok: false, error: { code, message, details: {} } });
    try {
      await node.start();
      // ponytail: watchdog only; if `start` ever hangs, the panel gets a visible
      // timeout instead of a forever-pending request. Remove once stable.
      const startWatchdog = AbortSignal.timeout(15000);
      await Promise.race([
        node.start(),
        new Promise((_, reject) => {
          startWatchdog.addEventListener('abort', () => reject(new Error('node.start timed out')));
        }),
      ]);
      switch (endpoint) {
        case 'snapshot':
          return { ok: true, value: node.snapshot({ sessionId: opt('sessionId') }) };
        case 'send':
          return {
            ok: true,
            value: await node.send({ target: str('target'), text: str('text'), topic: opt('topic') }),
          };
        case 'markRead':
          node.markAllRead();
          return { ok: true, value: node.inbox({ limit: 100 }) };
        case 'roomRead':
          return { ok: true, value: { flipped: node.markRoomRead(str('room'), opt('sessionId')) } };
        case 'sessions':
          return { ok: true, value: { sessions: node.sessions() } };
        case 'rooms':
          return {
            ok: true,
            value: { rooms: node.listRooms({ sessionId: opt('sessionId'), all: request.all === true }) },
          };
        case 'roomCreate':
          return {
            ok: true,
            value: await node.createRoom({
              name: str('name'),
              topic: opt('topic'),
              sessionId: str('sessionId'),
              sessionName: opt('sessionName'),
            }),
          };
        case 'roomJoin':
          return {
            ok: true,
            value: await node.joinRoom({
              room: str('room'),
              sessionId: str('sessionId'),
              sessionName: opt('sessionName'),
            }),
          };
        case 'roomLeave':
          return { ok: true, value: await node.leaveRoom({ room: str('room'), sessionId: str('sessionId') }) };
        case 'roomKick':
          return {
            ok: true,
            value: await node.removeMember({ room: str('room'), sessionId: str('sessionId'), member: str('member') }),
          };
        case 'roomInvite':
          return {
            ok: true,
            value: await node.addRoomMember({
              room: str('room'),
              sessionId: str('sessionId'),
              memberSessionId: str('memberSessionId'),
              memberNodeId: opt('memberNodeId'),
            }),
          };
        case 'roomRename':
          return {
            ok: true,
            value: await node.renameRoom({
              room: str('room'),
              sessionId: str('sessionId'),
              ...(typeof request.name === 'string' ? { name: request.name } : {}),
              ...(typeof request.topic === 'string' ? { topic: request.topic } : {}),
            }),
          };
        case 'roomAssign':
          return {
            ok: true,
            value: await node.assignTask({
              room: str('room'),
              sessionId: str('sessionId'),
              assignee: str('assignee'),
              title: str('title'),
              detail: opt('detail'),
            }),
          };
        case 'roomStatus':
          return {
            ok: true,
            value: await node.setTaskStatus({
              room: str('room'),
              sessionId: str('sessionId'),
              task: str('task'),
              status: str('status'),
              note: opt('note'),
            }),
          };
        case 'roomSay':
          return {
            ok: true,
            value: await node.sayInRoom({ room: str('room'), sessionId: str('sessionId'), text: str('text') }),
          };
        case 'roomDetail':
          return { ok: true, value: await node.roomDetail({ room: str('room'), sessionId: str('sessionId') }) };
        case 'agents':
          return { ok: true, value: await node.catalogueAgents() };
        case 'agentImport':
          return {
            ok: true,
            value: str('cwd') !== ''
              ? await node.createAgentIn({ cwd: str('cwd'), sessionName: opt('name'), title: opt('title') })
              : await node.importAgent({ sessionId: str('session'), sessionName: opt('name') }),
          };
        case 'workspaces':
          return { ok: true, value: { workspaces: node.workspaces() } };
        case 'nickname':
          return {
            ok: true,
            value: await node.setNickname({
              member: opt('member'),
              name: str('name'),
              self: request.self === true,
            }),
          };
        case 'agentDial':
          return {
            ok: true,
            value: await node.dialAgent({ target: str('target'), text: str('text'), topic: opt('topic') }),
          };
        case 'agentUndial':
          return { ok: true, value: node.undialAgent(str('target')) };
        case 'notifyChannels':
          return { ok: true, value: { channels: await notifier.listChannels(), pending: notifier.describe().pending } };
        case 'notifySend':
          return { ok: true, value: await notifier.sendDirect(str('channel'), str('text')) };
        case 'notifyConfirm':
          return { ok: true, value: await notifier.confirm(str('id'), str('channel')) };
        case 'notifyDismiss':
          return { ok: true, value: notifier.dismiss(str('id')) };
        default:
          return failed('UNKNOWN_ENDPOINT', `unknown endpoint ${endpoint}`);
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      const declared = typeof error?.code === 'string' ? error.code : '';
      const code = /leader/i.test(message)
        ? 'NOT_LEADER'
        : declared === 'AMBIGUOUS_ROOM' || declared === 'AMBIGUOUS_TASK' || declared === 'AMBIGUOUS_AGENT'
          ? declared
          : declared === 'UNKNOWN_AGENT'
            ? 'UNKNOWN_AGENT'
            : /unknown room/i.test(message)
              ? 'UNKNOWN_ROOM'
              : 'LAN_MESH_FAILED';
      return { ok: false, error: { code, message, details: {} } };
    }
  }
  const prompt = ctx.get('systemPrompt');
  if (prompt !== undefined && typeof prompt.section === 'function') {
    ctx.effect(() =>
      prompt.section({
        name: 'dsh-lan-mesh:usage',
        order: prompt.getSectionOrder('TOOL_WEB_FETCH') + 10,
        text: [
          '局域网协作（LAN Mesh）：同一局域网里的其他 DSH 实例可能正在协作。',
          '- 需要联系其他机器上的 agent 时，先调用 lan_mesh_list_peers 看在线节点，再用 lan_mesh_send 发消息；',
          '- 房间相当于项目：接到项目/协作类请求时先 lan_mesh_rooms 看自己已在哪些房间；用 lan_mesh_room_member 建房或加入；',
          '- 房间的 leader 负责用 lan_mesh_room_task action=assign 分配任务，成员用 action=status 更新进度；房间内沟通用 lan_mesh_room_say，只有同房间成员会收到；',
          '- 收到别人发来的消息会以用户消息形式出现在会话里，按需回复即可；',
          '- 需要通知人时用 lan_mesh_notify：它会自主查找本机可用通知渠道（微信 im 等），只有一个就自动发，多个则挂起让用户在面板二次确认；房间任务被置 done 时会自动触发；',
          '- 只把要对方处理的内容发出去，不要把本机路径、密钥或未公开的上下文一并发送。',
        ].join('\n'),
        interpolate: false,
      }),
    );
  }

  // Start eagerly so the node is discoverable before the first tool call, but
  // never let a port conflict take the whole plugin down.
  ctx.effect(() => {
    let live = true;
    node.start().catch((error) => log('cannot start', error));
    return () => {
      live = false;
      void live;
      void node.close();
    };
  });
}
