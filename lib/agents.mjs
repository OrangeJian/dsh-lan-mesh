/**
 * Agent catalogue projection: pure functions only.
 *
 * This module never touches sockets, timers, disk, or the agent runtime. It turns
 * three already-collected facts into the rows the tools and the panel show:
 *
 *   - `live`    — sessions this node currently hosts an agent for,
 *   - `stored`  — persisted sessions on this node that have no live agent,
 *   - `remote`  — agent listings a peer node sent over the mesh.
 *
 * The distinction that makes "import an agent from another workspace" work is
 * `stored`: those sessions exist on disk with their own `cwd`, so resuming one
 * brings its workspace with it instead of moving any files.
 */

/** Rows returned by one catalogue read; bounds the tool output, not storage. */
export const MAX_AGENT_ROWS = 200;

/** Same limit the rest of the mesh uses for free text. */
const MAX_NAME = 120;

/** A session id is safe to use as a mesh addressing segment only in this shape. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_$.-]{1,200}$/;

/** Agent listing protocol version, kept beside the envelope version it rides on. */
export const AGENT_PROTOCOL = 1;

/**
 * Clamp free text used as a display name.
 * @param {unknown} value - candidate name.
 * @param {string} fallback - used when the candidate is empty.
 * @returns {string}
 */
export function cleanName(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return fallback;
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1)}…` : text;
}

/**
 * Whether a session id may appear in a `<nodeId>/<sessionId>` mesh address.
 * @param {unknown} value - candidate session id.
 * @returns {boolean}
 */
export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

/**
 * The workspace label for a session's `cwd`.
 *
 * Two sessions in the same directory must produce the same label, and the label
 * must survive a peer that uses a different path separator.
 * @param {unknown} cwd - absolute working directory, if known.
 * @returns {string}
 */
export function workspaceLabel(cwd) {
  const path = typeof cwd === 'string' ? cwd.trim().replace(/\\+/g, '/') : '';
  if (path === '') return '';
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  const base = index === -1 ? trimmed : trimmed.slice(index + 1);
  // "C:" style roots have no trailing segment; keep the drive letter usable.
  return base === '' ? trimmed : base;
}

/**
 * One catalogue row for a locally known agent or session.
 * @param {object} options - row inputs.
 * @param {string} options.nodeId - this node.
 * @param {string} options.nodeName - this node's display name.
 * @param {string} options.id - session id.
 * @param {object} [options.header] - session header, for cwd.
 * @param {boolean} options.live - whether an agent is hosted right now.
 * @param {string} [options.status] - live agent status, when live.
 * @param {string[]} [options.rooms] - room ids this session belongs to.
 * @param {string} [options.title] - the session's own title, when one was generated.
 * @param {boolean} [options.imported] - resumed by an import rather than by the user.
 * @returns {object}
 */
export function localRow(options) {
  const id = typeof options.id === 'string' ? options.id : '';
  const cwd = typeof options.header?.cwd === 'string' ? options.header.cwd : '';
  const short = id.replace(/^session-/, '').slice(0, 8);
  const title = cleanName(options.title, '');
  return {
    nodeId: options.nodeId,
    nodeName: options.nodeName,
    id,
    title,
    name: cleanName(options.name, title === '' ? `会话 ${short}` : title),
    live: options.live === true,
    imported: options.imported === true,
    status: typeof options.status === 'string' ? options.status : '',
    cwd,
    workspace: workspaceLabel(cwd),
    rooms: Array.isArray(options.rooms) ? options.rooms.filter((room) => typeof room === 'string') : [],
  };
}

/**
 * One catalogue row for an agent a peer node advertised.
 * @param {object} options - row inputs.
 * @param {string} options.nodeId - owning node.
 * @param {string} options.nodeName - owning node's display name.
 * @param {object} options.agent - the peer's agent record.
 * @param {boolean} [options.dialled] - already dialled from this node.
 * @returns {object}
 */
export function remoteRow(options) {
  const agent = options.agent ?? {};
  const id = typeof agent.id === 'string' ? agent.id : '';
  const cwd = typeof agent.cwd === 'string' ? agent.cwd : '';
  const title = cleanName(agent.title, '');
  return {
    nodeId: options.nodeId,
    nodeName: options.nodeName,
    id,
    title,
    name: cleanName(agent.name, title === '' ? `会话 ${id.slice(0, 8)}` : title),
    live: agent.live === true,
    imported: false,
    status: typeof agent.status === 'string' ? agent.status : '',
    cwd,
    workspace: cleanName(agent.workspace, workspaceLabel(cwd)),
    rooms: Array.isArray(agent.rooms) ? agent.rooms.filter((room) => typeof room === 'string') : [],
    dialled: options.dialled === true,
  };
}

/**
 * The mesh address for one remote agent.
 * @param {string} nodeId - owning node.
 * @param {string} sessionId - that node's session.
 * @returns {string}
 */
export function agentAddress(nodeId, sessionId) {
  return `${nodeId}/${sessionId}`;
}

/**
 * Normalize a peer's advertised agent list.
 *
 * A peer is untrusted input: anything malformed is dropped rather than coerced,
 * because a wrong `cwd` would let an "import" resume the wrong workspace.
 * @param {unknown} payload - whatever arrived over the wire.
 * @param {string} nodeId - the node that sent it, which overrides its claim.
 * @param {string} nodeName - that node's display name.
 * @returns {{ nodeId: string, nodeName: string, agents: object[] }}
 */
export function normalizePeerAgents(payload, nodeId, nodeName) {
  const rows = Array.isArray(payload?.agents) ? payload.agents : [];
  const agents = [];
  for (const row of rows) {
    if (agents.length >= MAX_AGENT_ROWS) break;
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!isSessionId(id)) continue;
    if (agents.some((agent) => agent.id === id)) continue;
    agents.push({
      id,
      title: cleanName(row.title, ''),
      name: cleanName(row.name, `会话 ${id.slice(0, 8)}`),
      live: row.live === true,
      status: typeof row?.status === 'string' ? row.status : '',
      cwd: typeof row?.cwd === 'string' ? row.cwd : '',
      workspace: cleanName(row?.workspace, workspaceLabel(row?.cwd)),
      rooms: Array.isArray(row?.rooms)
        ? row.rooms.filter((room) => typeof room === 'string').slice(0, 64)
        : [],
    });
  }
  return {
    nodeId: typeof nodeId === 'string' ? nodeId : '',
    nodeName: cleanName(nodeName, typeof nodeId === 'string' ? nodeId : 'peer'),
    agents,
  };
}

/**
 * Build the whole catalogue.
 *
 * Live rows come first (an agent you can talk to now is the most useful row),
 * then stored rows that an import can bring up, then peers. Rows are capped so a
 * node with thousands of sessions still answers in bounded time.
 * @param {object} options - catalogue inputs.
 * @param {string} options.nodeId - this node's id.
 * @param {string} options.nodeName - this node's display name.
 * @param {object[]} options.local - rows from {@link localRow}.
 * @param {{ nodeId: string, nodeName: string, agents: object[] }[]} [options.peers] - peer payloads.
 * @param {Set<string>} [options.dialled] - addresses already dialled from here.
 * @returns {{ self: { nodeId: string, name: string }, agents: object[], remote: object[] }}
 */
export function catalogue(options) {
  const local = Array.isArray(options.local) ? options.local : [];
  const live = local.filter((row) => row.live === true);
  const stored = local.filter((row) => row.live !== true);
  const ordered = [...live, ...stored].slice(0, MAX_AGENT_ROWS);
  const dialled = options.dialled instanceof Set ? options.dialled : new Set();
  const remote = [];
  for (const peer of Array.isArray(options.peers) ? options.peers : []) {
    const row = normalizePeerAgents({ agents: peer?.agents }, peer?.nodeId, peer?.nodeName);
    if (row.nodeId === '' || row.nodeId === options.nodeId) continue;
    for (const agent of row.agents.slice(0, MAX_AGENT_ROWS)) {
      remote.push(remoteRow({
        nodeId: row.nodeId,
        nodeName: row.nodeName,
        agent,
        dialled: dialled.has(agentAddress(row.nodeId, agent.id)),
      }));
    }
  }
  return {
    self: { nodeId: options.nodeId, name: options.nodeName },
    agents: ordered,
    remote: remote.slice(0, MAX_AGENT_ROWS),
  };
}

/**
 * Resolve an agent reference the way a human would write it.
 *
 * `"<nodeId>/<sessionId>"` addresses a peer's agent; a bare id or a name is
 * resolved against the rows in hand. A name that matches more than one row is an
 * ambiguity error rather than a silent first-match, which is the same rule the
 * room and task resolvers follow.
 * @param {object[]} rows - local rows then remote rows.
 * @param {string} reference - id, name, or `<nodeId>/<sessionId>`.
 * @returns {object | undefined} the single matching row.
 * @throws when the reference is ambiguous.
 */
export function resolveAgent(rows, reference) {
  const wanted = typeof reference === 'string' ? reference.trim() : '';
  if (wanted === '') return undefined;
  const byId = rows.find((row) => row.id === wanted);
  if (byId !== undefined) return byId;
  const exact = rows.filter((row) => row.name === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const choices = exact.map((row) => `${row.nodeId}/${row.id}`).join('、');
    const error = new Error(`探员名「${wanted}」对应 ${exact.length} 个 agent：${choices}。请改用会话 id 指定。`);
    error.code = 'AMBIGUOUS_AGENT';
    throw error;
  }
  const loose = rows.filter((row) => row.name.toLowerCase() === wanted.toLowerCase());
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    const choices = loose.map((row) => `${row.nodeId}/${row.id}`).join('、');
    const error = new Error(`探员名「${wanted}」对应 ${loose.length} 个 agent：${choices}。请改用会话 id 指定。`);
    error.code = 'AMBIGUOUS_AGENT';
    throw error;
  }
  return undefined;
}

/**
 * Split a `<nodeId>/<sessionId>` address.
 * @param {unknown} value - candidate address.
 * @returns {{ nodeId: string, sessionId: string } | undefined}
 */
export function splitAddress(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const index = text.indexOf('/');
  if (index <= 0) return undefined;
  const nodeId = text.slice(0, index);
  const sessionId = text.slice(index + 1);
  if (sessionId === '' || !isSessionId(sessionId)) return undefined;
  return { nodeId, sessionId };
}
