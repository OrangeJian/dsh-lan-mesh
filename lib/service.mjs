/**
 * The LAN mesh node: identity, discovery, transport, inbox and agent delivery.
 *
 * The service owns no UI. It exposes plain methods that the Host plugin turns
 * into tools and RPC endpoints, so the same node serves both a model step and
 * the browser panel.
 *
 * Rooms are a replicated document, not a remote service: every node keeps a
 * full copy, merges peer copies through `lib/rooms.mjs`, and persists the merge
 * result, so a node that was offline simply catches up on the next sync.
 *
 * @module dsh-lan-mesh/lib/service
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import { openTeamStore } from './team-store.mjs';
import { applyTeamCommand } from './team-state.mjs';
import { TeamCoordinator } from './team-coordinator.mjs';
import { encodeTeamRequest, encodeTeamResponse, verifyTeamRequest, sendTeamRequest } from './team-protocol.mjs';
import { normalizeRoomMessageMetadata } from './room-message.mjs';
import { Discovery } from './discovery.mjs';
import {
  MeshServer,
  PROTOCOL_VERSION,
  TransportError,
  deliverToPeer,
  fetchAgentsFromPeer,
  pullStateFromPeer,
  pushStateToPeer,
} from './transport.mjs';
import {
  agentAddress,
  catalogue,
  cleanName,
  localRow,
  normalizePeerAgents,
  resolveAgent,
  splitAddress,
} from './agents.mjs';
import {
  appendInbox,
  loadIdentity,
  loadNicknames,
  loadRoomState,
  readInbox,
  rewriteInbox,
  saveNicknames,
  saveRoomState,
  meshRootDir,
} from './store.mjs';
import {
  addMember as addRoomMemberInState,
  allRooms,
  assignTask as assignRoomTask,
  createRoom as createRoomInState,
  emptyState,
  exportState,
  findRoom,
  joinRoom as joinRoomInState,
  leaveRoom as leaveRoomInState,
  memberKey,
  membersByNode,
  mergeStates,
  normalizeState,
  removeMember as removeMemberInState,
  renameRoom as renameRoomInState,
  resolveMember,
  resolveTask,
  roomsFor,
  setTaskStatus as setTaskStatusInState,
  tasksFor,
} from './rooms.mjs';

/** How many delivered ids are remembered for duplicate suppression. */
const SEEN_LIMIT = 512;
/** How many in-memory records the panel can page through. */
const MEMORY_LIMIT = 500;
/** Bound for a peer name used in a tool result. */
const MAX_PEERS = 200;
/**
 * How long a send waits for a first announcement before giving up.
 *
 * One announcement interval: enough for a freshly started node to hear from a
 * peer that is already running, short enough that a genuinely unknown target
 * still fails quickly.
 */
const DISCOVERY_GRACE_MS = 2_500;
/** Envelope kinds this node gives room semantics to. */
const ROOM_MESSAGE_KIND = 'room-message';
const ROOM_TASK_KIND = 'room-task';
/** How many room messages `roomDetail` returns. */
const ROOM_MESSAGE_LIMIT = 20;
/**
 * Session id the panel uses when a human speaks in a room.
 *
 * A person is a room member like any other, so the panel needs a key to join
 * under. It is a fixed literal rather than a real session id because a human has
 * no agent behind it — `#wakeSession` finds nothing and simply returns false.
 */
const HUMAN_SESSION_ID = 'human';
/** Per-peer budget for one state exchange. */
const ROOM_SYNC_TIMEOUT_MS = 4_000;
/**
 * One peer as the tools and panel present it.
 * @param {object} peer - discovery record.
 * @returns {object} presentation snapshot.
 */
function peerView(peer) {
  return {
    nodeId: peer.nodeId,
    name: peer.name,
    address: peer.address,
    port: peer.httpPort,
    ageSeconds: Math.max(0, Math.round((Date.now() - peer.lastSeen) / 1000)),
  };
}

/**
 * Split a user-supplied target into its node and optional session parts.
 * `host-a`, `host-a/session-123` and `*` are all accepted.
 * @param {string} raw - target typed by the model.
 * @returns {{ node: string, session: string }}
 */
export function parseTarget(raw) {
  const value = String(raw ?? '').trim();
  const slash = value.indexOf('/');
  if (slash < 0) return { node: value, session: '' };
  return { node: value.slice(0, slash), session: value.slice(slash + 1) };
}

/**
 * Public shape of one room member.
 * @param {object} member - normalized member.
 * @param {boolean} [live] - whether the member is reachable right now.
 * @param {string} [title] - the session's own title, so the panel never has to
 *   show a raw session id.
 * @returns {object}
 */
function memberView(member, live = false, title = '') {
  return {
    nodeId: member.nodeId,
    sessionId: member.sessionId,
    name: member.name,
    nodeName: member.nodeName ?? member.nodeId,
    title,
    role: member.role,
    key: member.key,
    live,
  };
}

/**
 * Public shape of one task.
 * @param {object} task - normalized task.
 * @param {(member: object) => string} [titleOf] - session title lookup, so an
 *   assignee reads as its title instead of a session id.
 * @returns {object}
 */
function taskView(task, titleOf = () => '') {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    status: task.status,
    assignee: memberView(task.assignee, false, titleOf(task.assignee)),
    assigner: memberView(task.assigner, false, titleOf(task.assigner)),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Render one delivery failure into a single line a model can read.
 * @param {unknown} error - thrown failure.
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof TransportError) return `${error.code}: ${error.message}`;
  return String(error?.message ?? error);
}

/**
 * Every `@name` token in one message body.
 *
 * Mentions are only a label: the message is still broadcast to the whole room.
 * They exist so the panel can tell "someone talked" from "someone talked to me",
 * which is the difference between a badge worth showing and noise.
 * @param {string} text - message body.
 * @returns {string[]} lower-cased mention labels, de-duplicated.
 */
function mentionsIn(text) {
  const out = new Set();
  for (const match of String(text ?? '').matchAll(/@([^\s@,，。:：;；!！?？"'()（）[\]【】]+)/g)) {
    const label = match[1].trim().toLowerCase();
    if (label !== '') out.add(label);
  }
  return [...out];
}

/**
 * Lower-cased labels one room member answers to.
 *
 * What a sender can type after `@` is the display name they see (nickname /
 * title), the stored name, and the trailing part of session or node id for
 * disambiguation. All are folded here for `#namedBy`.
 * @param {object} member - a room member row.
 * @returns {Set<string>}
 */
function memberLabels(member) {
  const out = new Set();
  const push = (value) => {
    const label = String(value ?? '').trim().toLowerCase();
    if (label !== '') out.add(label);
  };
  push(member.title);
  push(member.name);
  if (typeof member.sessionId === 'string' && member.sessionId.includes('/')) push(member.sessionId.slice(member.sessionId.indexOf('/') + 1));
  else push(member.sessionId);
  if (typeof member.nodeId === 'string') push(member.nodeId);
  return out;
}

/**
 * Check whether a value looks like a file attachment from the panel.
 * @param {unknown} value - raw request.file.
 * @returns {boolean}
 */
function isFileAttachment(value) {
  if (value === null || typeof value !== 'object') return false;
  const f = value;
  return (
    typeof f.name === 'string' &&
    f.name.length > 0 &&
    typeof f.data === 'string' &&
    f.data.length > 0 &&
    f.data.startsWith('data:')
  );
}

/**
 * Normalize a file attachment to the fields we carry through the system.
 * @param {{ name: string, type?: string, size?: number, data: string }} file - raw attachment.
 * @returns {{ name: string, type: string, size: number, data: string }}
 */
function normalizeFile(file) {
  return {
    name: String(file.name ?? ''),
    type: String(file.type ?? ''),
    size: Number(file.size) || 0,
    data: String(file.data ?? ''),
  };
}

/**
 * Text handed to a session that was woken by a room message.
 * @param {object} room - room the message belongs to.
 * @param {string} fromName - display name of the sender.
 * @param {string} text - message body.
 * @returns {string}
 */
function roomMessageText(room, fromName, text) {
  return [
    `来自房间「${room.name}」的成员 ${fromName} 的消息：`,
    '',
    text,
    '',
    '请先简短回复「收到」，确认你已看到这条消息，再判断是否需要处理。',
    '需要回复时用 lan_mesh_room_say 在房间内回复；需要其他人处理时 @ 上对方。',
  ].join('\n');
}

/**
 * Text handed to a session that was just assigned a task.
 * @param {object} room - room the task lives in.
 * @param {object} task - the new task.
 * @returns {string}
 */
function roomTaskText(room, task) {
  const detail = task.detail === '' ? '' : `\n\n${task.detail}`;
  return [
    `房间「${room.name}」的 leader ${task.assigner.name} 给你分配了任务：`,
    '',
    `任务 ${task.id}：${task.title}${detail}`,
    '',
    '请开始处理；完成后用 lan_mesh_room_task（action=status, status=done）更新状态，',
    '并在房间里用 lan_mesh_room_say 回一条结论（一两句话讲清结果，@ 上分配任务的人）。',
  ].join('\n');
}

/**
 * A running mesh node.
 */
export class MeshNode {
  /**
   * @param {object} options - wiring supplied by the Host plugin.
   * @param {object} options.config - resolved configuration.
   * @param {object} [options.tools] - tool registry for model-facing tools.
   * @param {object} [options.agents] - live agent registry used for wake-ups.
   * @param {() => object | undefined} [options.getAgents] - late-bound agent registry; wins over `agents` when supplied.
   * @param {object} [options.sessionPersistence] - stored-session reader, for the agent catalogue.
   * @param {() => object | undefined} [options.getSessionPersistence] - late-bound stored-session reader.
   * @param {object} [options.agentDefaultModel] - supplies the model a new agent runs on.
   * @param {() => object | undefined} [options.getAgentDefaultModel] - late-bound model-selection service.
   * @param {object} [options.agentPresets] - supplies the preset a new agent composes with.
   * @param {() => object | undefined} [options.getAgentPresets] - late-bound preset
   *   registry, for Hosts where it is not mounted yet when the plugin applies.
   * @param {() => object[]} [options.getToolDefinitions] - late-bound mesh tool
   *   definitions, so an agent created here can be handed the same tools.
   * @param {() => object | undefined} [options.getSessionProjections] - late-bound
   *   projection registry used to read each session's `title`.
   * @param {() => object | undefined} [options.getWorkspaceRegistry] - late-bound
   *   workspace registry exposing `archivedSessionIds`, so an archived session
   *   never shows up in the agent catalogue.
   * @param {(message: string, scope?: string) => Promise<unknown>} [options.notify] -
   *   reserved out-of-band notification extension point; called when a room
   *   task completes. Channels are discovered by the Host at send time.
   * @param {() => object | undefined} [options.getNotify] - late-bound reader
   *   for notifications awaiting a human's channel choice in the panel.
   * @param {(message: string, detail?: unknown) => void} [options.log] - diagnostics.
   */
  constructor(options) {
    this.config = options.config;
    // These three are late-bound like the preset and title services: on hosts
    // that mount them after `apply`, capturing them directly would leave the
    // node permanently without session creation or stored-session listing.
    Object.defineProperty(this, 'agents', {
      configurable: true,
      enumerable: true,
      get: typeof options.getAgents === 'function' ? options.getAgents : () => options.agents,
    });
    Object.defineProperty(this, 'sessionPersistence', {
      configurable: true,
      enumerable: true,
      get: typeof options.getSessionPersistence === 'function'
        ? options.getSessionPersistence
        : () => options.sessionPersistence,
    });
    Object.defineProperty(this, 'agentDefaultModel', {
      configurable: true,
      enumerable: true,
      get: typeof options.getAgentDefaultModel === 'function'
        ? options.getAgentDefaultModel
        : () => options.agentDefaultModel,
    });
    this.agentPresets = options.agentPresets;
    this.getAgentPresets = options.getAgentPresets;
    this.getToolDefinitions = options.getToolDefinitions;
    this.getSessionProjections = options.getSessionProjections;
    this.getSessionTitle = options.getSessionTitle;
    this.getWorkspaceRegistry = options.getWorkspaceRegistry;
    this.notify = options.notify;
    this.getNotify = options.getNotify;
    this.log = options.log ?? (() => {});
    /** @type {{ nodeId: string, name: string, createdAt: string } | undefined} */
    this.identity = undefined;
    /** @type {Discovery | undefined} */
    this.discovery = undefined;
    /** @type {MeshServer | undefined} */
    this.server = undefined;
    this.started = false;
    this.closed = false;
    /** @type {object[]} */
    this.messages = [];
    /** @type {Set<string>} */
    this.seen = new Set();
    /**
     * The replicated room document. Always a valid state: an empty document is
     * a legitimate one, so every room method works without a disk file or peer.
     * @type {{ version: number, rooms: Record<string, object> }}
     */
    this.roomsDoc = emptyState();
    /**
     * Local nicknames: `self` for the person at this screen, `members` keyed by
     * room member key. A nickname never leaves this node — two people can call
     * the same session different things and both are right.
     * @type {{ self: string, members: Record<string, string> }}
     */
    this.nicknames = { self: '', members: {} };
    /** Agent that most recently used a mesh tool; the wake-up destination. */
    this.focusAgentId = '';
    /** In-flight `start()`, so a partially failed start is never repeated. */
    this.startPromise = undefined;
    /**
     * Local room mutations that peers have not acknowledged yet.
     *
     * A merge alone cannot drive replication: a node that creates a room has the
     * same document afterwards, so a pull-then-push-only sync would never tell
     * anyone. This flag makes the next `syncRooms()` push even when the pull
     * changed nothing.
     */
    this.roomsDirty = false;
    /**
     * Sessions this node resumed on someone's behalf, with the handle that owns
     * them. Only the holder of a handle may dispose an agent, so an import is
     * only truly reversible if we keep it.
     * @type {Map<string, object>}
     */
    this.handles = new Map();
    /**
     * Workspace facts for agents this node started itself.
     *
     * A freshly created session is live before it is durably listed, so
     * `sessionPersistence.list()` cannot supply its `cwd` yet; without this the
     * catalogue (and every peer that asks) would report the workspace as unknown
     * until the next restart.
     * @type {Map<string, { cwd: string, name: string }>}
     */
    this.known = new Map();
    /** Remote agent addresses (`<nodeId>/<sessionId>`) dialled from this node. */
    this.dialled = new Set();
  }

  /** The node id, or a placeholder before start settles. */
  get nodeId() {
    return this.identity?.nodeId ?? '';
  }

  /** The http port actually bound (0 before start). */
  get port() {
    return this.server?.port ?? 0;
  }

  /**
   * The room document as a detached copy.
   *
   * Callers hand this to the panel and to peers; returning the live object would
   * let one accidental mutation diverge this node from every other replica.
   * @returns {{ version: number, rooms: Record<string, object> }}
   */
  get roomState() {
    return normalizeState(this.roomsDoc);
  }

  /**
   * Start discovery and the HTTP listener.
   *
   * Concurrent callers share one startup: the plugin starts the node eagerly and
   * the first tool call starts it again, and two concurrent starts would race for
   * the same HTTP and UDP ports.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.started || this.closed) return;
    this.startPromise ??= this.#startOnce();
    try {
      await this.startPromise;
    } catch (error) {
      // Let a caller retry a startup that never reached the listener.
      this.startPromise = undefined;
      throw error;
    }
  }

  /**
   * The one body of `start()`: load identity, inbox and room state, then listen.
   * @returns {Promise<void>}
   */
  async #startOnce() {
    this.identity = await loadIdentity({
      displayName: this.config.displayName,
      port: this.config.port,
    });
    // An open mesh with wake-ups is an "any machine on this LAN can run my
    // agents" door. Not an error — some people want exactly that — but loud
    // enough that the first time they see it they make a conscious choice.
    if (this.config.clusterSecret === '' && this.config.trustedPeers.length === 0) {
      if (this.config.autoWake) {
        this.log('WARNING: lan-mesh is open (no clusterSecret, no trustedPeers) and autoWake is on — any machine on this LAN can send a message that wakes your agents');
      } else {
        this.log('WARNING: lan-mesh is open (no clusterSecret, no trustedPeers) — any machine on this LAN can read and send mesh traffic');
      }
    }
    const slot = { port: this.config.port };
    try {
      for (const record of await readInbox({ limit: MEMORY_LIMIT, ...slot })) {
        const envelope = record?.envelope;
        if (!envelope || typeof envelope.id !== 'string') continue;
        this.messages.push(this.#record(envelope, record.receivedAt, record.read === true));
      }
      this.messages.sort((left, right) => left.receivedAt - right.receivedAt);
    } catch (error) {
      this.log('cannot read the stored inbox', error);
    }
    try {
      this.roomsDoc = normalizeState(await loadRoomState(slot));
    } catch (error) {
      // Rooms are a replicated document: starting empty only costs a re-sync,
      // while refusing to start would take the whole node down.
      this.log('cannot read the stored room state; starting from an empty one', error);
      this.roomsDoc = emptyState();
    }
    await this.#refreshNodeNames();
    try {
      this.nicknames = await loadNicknames(slot);
    } catch (error) {
      this.log('cannot read the stored nicknames', error);
      this.nicknames = { self: '', members: {} };
    }

    if (this.config.teamEnabled === true) await this.#startTeam();
    const server = new MeshServer({
      describe: () => this.describe(),
      secret: () => this.config.clusterSecret,
      trustedPeers: () => this.config.trustedPeers,
      onError: (error) => this.log('mesh http', error),
      onMessage: (envelope) => this.receive(envelope),
      onState: (payload) => this.#onState(payload),
      onAgents: () => this.#onAgents(),
      onTeam: this.team ? (request) => this.#receiveTeam(request) : undefined,
    });
    try {
      await server.listen(this.config.port);
    } catch (error) {
      // Another DSH on this machine may already own the port. Falling back to an
      // OS-assigned one keeps the node reachable: peers learn the real port from
      // the announcement, so only a fixed-port dialer notices the difference.
      this.log('configured mesh http port is taken; asking the OS for a free one', error);
      try {
        await server.listen(0);
      } catch (fallbackError) {
        this.log('cannot bind any mesh http port; messages stay inbound-only', fallbackError);
        return;
      }
    }
    this.server = server;

    const discovery = new Discovery({
      nodeId: this.identity.nodeId,
      port: this.config.discoveryPort,
      describe: () => ({ name: this.identity.name, httpPort: server.port }),
      onPeer: (peer) => {
        if (this.started && !this.closed) this.syncRooms([peer.nodeId]).catch(error => this.log('cannot sync newly discovered peer', error));
      },
      onPeerLost: () => {},
      onError: (error) => this.log('mesh discovery', error),
    });
    try {
      await discovery.start();
    } catch (error) {
      // A UDP port already owned by another local node is survivable: this node
      // still answers direct sends and greets anyone who finds it.
      this.log('cannot bind the discovery port; peer discovery is off', error);
    }
    if (discovery.socket !== undefined) this.discovery = discovery;
    this.started = true;
    // A room can predate discovery or this node's startup. Panel snapshots are
    // local reads, so refresh alone cannot repair a missing replica.
    this.roomSyncTimer = setInterval(() => {
      this.syncRooms().catch(error => this.log('periodic room sync failed', error));
    }, 10000);
    this.roomSyncTimer.unref?.();
    this.syncRooms().catch(error => this.log('initial room sync failed', error));
    if (this.team) {
      this.teamTimer = setInterval(() => this.team.tick().catch(error => this.log('Team scheduling failed; retained state for recovery', error)), 1000);
      this.teamTimer.unref?.();
    }
  }

  /** Stop listening and drop every peer. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.roomSyncTimer);
    await this.roomsSyncPromise;
    clearInterval(this.teamTimer);
    this.teamAbort?.abort();
    await this.team?.close();
    // Persist before the listeners go away so a room created just before
    // shutdown cannot be lost to a racing request.
    await this.#saveRooms();
    // An imported agent outlives the node if its handle is never disposed, and a
    // resumed session holds write ownership that a later start would fight over.
    const handles = [...this.handles.values()];
    this.handles.clear();
    await Promise.allSettled(handles.map((handle) => handle.dispose()));
    const discovery = this.discovery;
    const server = this.server;
    this.discovery = undefined;
    this.server = undefined;
    await Promise.allSettled([discovery?.close(), server?.close()]);
  }

  /** This node's identity as peers and the panel see it. */
  describe() {
    return {
      ...(this.team ? { teamProtocolVersion: 1 } : {}),
      nodeId: this.nodeId,
      name: this.identity?.name ?? '',
      roomReferences: 1,
      selfName: this.nicknames?.self ?? '',
      port: this.server?.port ?? 0,
      discoveryPort: this.config.discoveryPort,
      peers: this.discovery?.size ?? 0,
      unread: this.#unreadCount(),
      autoWake: this.config.autoWake,
      secured: this.config.clusterSecret.length > 0,
    };
  }

  /**
   * Live peers, most recently seen first.
   * @returns {object[]}
   */
  peers() {
    return (this.discovery?.list() ?? []).slice(0, MAX_PEERS).map(peerView);
  }

  /**
   * Resolve a target string to concrete peers.
   * @param {string} node - node id, node name, or `*`.
   * @returns {object[]} matching discovery records.
   */
  resolvePeers(node) {
    const all = this.discovery?.list() ?? [];
    if (node === '*' || node === '') return all;
    const exact = all.filter((peer) => peer.nodeId === node);
    if (exact.length > 0) return exact;
    const lowered = node.toLowerCase();
    return all.filter((peer) => peer.name.toLowerCase() === lowered);
  }

  /**
   * Send one message and return one delivery outcome per resolved peer.
   * @param {object} request - target, text and presentation fields.
   * @param {string} [request.fromAgentId] - agent that asked, remembered as the wake destination.
   * @returns {Promise<object>} model-facing delivery report.
   */
  async send(request) {
    if (!this.started) await this.start();
    const target = parseTarget(request.target);
    if (target.node === '') throw new TransportError('target is required', 'BAD_TARGET');
    const text = String(request.text ?? '').trim();
    const file = isFileAttachment(request.file) ? normalizeFile(request.file) : null;
    if (text === '' && file === null) throw new TransportError('text or file is required', 'BAD_TEXT');
    if (request.fromAgentId) this.focusAgentId = request.fromAgentId;

    const peers = this.resolvePeers(target.node);
    if (peers.length === 0) {
      // A node that has just started has not heard an announcement yet: the first
      // one is up to ANNOUNCE_MS away. Waiting one interval turns "I just booted
      // and know nobody" into a delivered message instead of a confusing refusal.
      if (target.node !== '*' && this.discovery !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, DISCOVERY_GRACE_MS));
      }
      const retried = this.resolvePeers(target.node);
      if (retried.length === 0) {
        return {
          messageId: '',
          delivered: [],
          peers: this.peers(),
          note: this.discovery === undefined
            ? 'Peer discovery is not running on this node, so only a direct node id or address could be reached.'
            : 'No peer matched that target. Call lan_mesh_list_peers to see who is online.',
        };
      }
      return this.#deliver(target, retried, text, file, request);
    }
    return this.#deliver(target, peers, text, file, request);
  }

  /**
   * Deliver one message to an already-resolved peer set.
   * @param {{ node: string, session: string }} target - parsed target.
   * @param {object[]} peers - resolved discovery records.
   * @param {string} text - normalized message body.
   * @param {object | null} file - normalized file attachment, or null.
   * @param {object} request - original send request, for kind and topic.
   * @returns {Promise<object>} model-facing delivery report.
   */
  async #deliver(target, peers, text, file, request) {
    const messageId = randomUUID();
    const sentAt = new Date().toISOString();
    const fromAgentId = typeof request.fromAgentId === 'string' ? request.fromAgentId : '';
    const nodeName = (this.identity?.name) ?? '';
    const senderName = fromAgentId !== ''
      ? this.#titleOf({ nodeId: this.nodeId, sessionId: fromAgentId }) || nodeName
      : nodeName;
    // Build one envelope for the local copy: `to` reflects the original target
    // (* / node name / nodeId/sessionId) so the inbox tells the user who it
    // was sent to, not just "I said something".
    const localEnvelope = {
      id: messageId,
      from: {
        nodeId: this.nodeId,
        name: senderName,
        sessionId: fromAgentId,
        title: senderName,
      },
      to: target.session ? `${target.node}/${target.session}` : target.node,
      kind: request.kind ?? 'note',
      topic: request.topic ?? '',
      text,
      sentAt,
    };
    if (file !== null) localEnvelope.file = file;
    // Keep a copy of outgoing messages in the inbox so the user sees the full
    // conversation — not just what others said. Marked read immediately because
    // the sender obviously knows about their own message.
    this.messages.push(this.#record(localEnvelope, sentAt, true));
    if (this.messages.length > MEMORY_LIMIT) this.messages.splice(0, this.messages.length - MEMORY_LIMIT);
    appendInbox({ envelope: localEnvelope, receivedAt: sentAt, read: true }, { port: this.config.port })
      .catch((error) => this.log('cannot append outgoing to inbox', error));
    // Deliver in parallel: one dead peer must not make the whole send hang for
    // N × timeout seconds while every other peer has already answered.
    const delivered = await Promise.all(
      peers.map(async (peer) => {
        const envelope = {
          id: messageId,
          from: { nodeId: this.nodeId, name: this.identity?.name ?? '' },
          to: target.session ? `${peer.nodeId}/${target.session}` : peer.nodeId,
          kind: request.kind ?? 'note',
          topic: request.topic ?? '',
          text,
          sentAt,
        };
        if (file !== null) envelope.file = file;
        try {
          const result = await deliverToPeer({
            address: peer.address,
            port: peer.httpPort,
            envelope,
            secret: this.config.clusterSecret,
          });
          return {
            nodeId: peer.nodeId,
            name: peer.name,
            ok: true,
            deliveredAt: String(result.receipt?.receivedAt ?? ''),
          };
        } catch (error) {
          return {
            nodeId: peer.nodeId,
            name: peer.name,
            ok: false,
            error: error instanceof TransportError ? `${error.code}: ${error.message}` : String(error),
          };
        }
      }),
    );
    return { messageId, delivered, peers: this.peers() };
  }

  /**
   * Admit one inbound envelope: deduplicate, persist, publish and optionally wake.
   * @param {object} envelope - normalized envelope from the transport.
   * @returns {Promise<{ receivedAt: string, woken: boolean }>}
   */
  async receive(envelope) {
    if (envelope.mentions !== undefined || envelope.skillRefs !== undefined) {
      const room = findRoom(this.roomsDoc, envelope.room);
      if (envelope.kind !== ROOM_MESSAGE_KIND || !room) throw new TransportError('references require a known room', 'BAD_REFERENCES');
      if (!room.members.some((member) => member.key === memberKey(envelope.from?.nodeId, envelope.from?.sessionId))) throw new TransportError('reference sender is not a room member', 'BAD_REFERENCES');
      try { envelope = { ...envelope, ...normalizeRoomMessageMetadata(envelope, room) }; }
      catch (error) { throw new TransportError(error.message, 'BAD_REFERENCES'); }
    }
    if (this.seen.has(envelope.id)) return { receivedAt: new Date().toISOString(), woken: false };
    this.seen.add(envelope.id);
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next();
      if (oldest.done !== true) this.seen.delete(oldest.value);
    }

    const receivedAt = new Date().toISOString();
    this.messages.push(this.#record(envelope, receivedAt, false));
    if (this.messages.length > MEMORY_LIMIT) this.messages.splice(0, this.messages.length - MEMORY_LIMIT);
    try {
      await appendInbox({ envelope, receivedAt, read: false }, { port: this.config.port });
    } catch (error) {
      this.log('cannot append to the inbox log', error);
    }

    let woken = false;
    if (this.config.autoWake) {
      // A room message is not addressed to one session: whoever on this node is
      // in the room needs to hear it.
      woken = envelope.kind === ROOM_MESSAGE_KIND ? this.#wakeRoom(envelope) : this.#wake(envelope);
    }
    return { receivedAt, woken };
  }

  /**
   * Recent inbound messages, oldest first.
   *
   * `attentionOnly` narrows to what this session must actually look at — an `@`
   * naming it, or a task handed to it — which is the only thing worth putting in
   * front of a person. Agents talking to each other stays in the room transcript
   * and out of the badge.
   * @param {{ limit?: number, unreadOnly?: boolean, markRead?: boolean, attentionOnly?: boolean, sessionId?: string }} options - paging.
   * @returns {{ messages: object[], unread: number, total: number }}
   */
  inbox(options = {}) {
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(200, Math.trunc(options.limit))) : 50;
    let source = options.unreadOnly === true ? this.messages.filter((item) => !item.read) : this.messages;
    if (options.attentionOnly === true) {
      const sessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
      const labels = this.#labelsOf(sessionId) ?? new Set();
      const address = this.#roomCallerKey(sessionId);
      source = source.filter((item) => this.#waitsOn(item, labels, address, sessionId));
    }
    const messages = source.slice(-limit);
    if (options.markRead === true) {
      let flipped = 0;
      for (const item of this.messages) {
        if (item.read === true) continue;
        item.read = true;
        flipped += 1;
      }
      if (flipped > 0) this.#saveInbox().catch((error) => this.log('cannot rewrite the inbox log', error));
    }
    return { messages: messages.map((item) => ({ ...item })), unread: this.#unreadCount(), total: this.messages.length };
  }

  /** Mark every stored message as read. */
  markAllRead() {
    let flipped = 0;
    for (const item of this.messages) {
      if (item.read === true) continue;
      item.read = true;
      flipped += 1;
    }
    // Read flags live in the log lines, so "mark all read" has to rewrite the
    // file exactly like markRoomRead does. Without this a restart resurrected
    // every message that had only been cleared in memory.
    if (flipped > 0) this.#saveInbox().catch((error) => this.log('cannot rewrite the inbox log', error));
  }

  /**
   * Unread records in the delivered log.
   *
   * Derived on every read, never incremented by hand: the inbox pane lists
   * exactly the records whose `read` flag is still false, so a separate counter
   * goes stale the moment any path logs a record without bumping it (outgoing
   * copies did), and the badge ends up reporting zero above a non-empty list.
   * @returns {number}
   */
  #unreadCount() {
    let count = 0;
    for (const item of this.messages) if (item.read !== true) count += 1;
    return count;
  }

  /**
   * One structural snapshot for the browser panel.
   *
   * `rooms.mine` answers "what am I part of"; `rooms.all` answers "what exists on
   * this node", which is what a panel needs to offer `lan_mesh_room_member join`
   * for a project a peer created.
   * @param {{ sessionId?: string }} [options] - which session is looking.
   * @returns {object}
   */
  snapshot(options = {}) {
    const sessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';
    const live = Object.values(this.roomsDoc.rooms).filter((room) => room.deleted !== true);
    return {
      self: this.describe(),
      peers: this.peers(),
      inbox: this.inbox({ limit: 100 }),
      storage: { messages: this.messages.length },
      // What the person actually has to deal with, for the left rail: an unread
      // `@` naming them or a task handed to them. Everything else stays in the
      // room transcript, and once looked at it leaves this list for good.
      attention: this.inbox({ attentionOnly: true, unreadOnly: true, sessionId, limit: 20 }),
      // Notifications discovered more than one local channel and are waiting
      // for a human to pick one in the panel.
      notify: typeof this.getNotify === 'function' ? (this.getNotify() ?? { pending: [] }) : { pending: [] },
      rooms: {
        count: live.length,
        mine: sessionId === '' ? [] : this.#roomRows(roomsFor(this.roomsDoc, this.nodeId, sessionId)),
        all: this.#roomRows(allRooms(this.roomsDoc, this.nodeId, sessionId)),
        unread: this.#unreadByRoom(sessionId),
      },
    };
  }

  /**
   * Every agent session this node hosts, with the rooms it belongs to and its
   * own title, so the panel can name a session without showing its id.
   * @returns {{ id: string, title: string, name: string, rooms: string[] }[]}
   */
  sessions() {
    const agents = this.agents;
    if (!agents || typeof agents.list !== 'function') return [];
    let list;
    try {
      list = agents.list();
    } catch (error) {
      this.log('cannot list agent sessions', error);
      return [];
    }
    const rows = Array.isArray(list) ? list : [];
    const out = [];
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (id === '') continue;
      const title = this.#titleOf({ nodeId: this.nodeId, sessionId: id });
      out.push({
        id,
        title,
        name: title === '' ? `会话 ${id.replace(/^session-/, '').slice(0, 8)}` : title,
        rooms: roomsFor(this.roomsDoc, this.nodeId, id).map((room) => room.id),
      });
    }
    return out;
  }

  // --------------------------------------------------------------- agents ----

  /**
   * Every agent this node can offer: live sessions, stored sessions that an
   * import can resume, and agents peers advertise.
   *
   * Stored rows are the ones that make "import an agent from another workspace"
   * meaningful: each carries its own `cwd`, so resuming it works in that
   * workspace without moving a file.
   * @param {{ peers?: boolean }} [options] - `peers: false` skips the network.
   * @returns {Promise<object>} catalogue shaped by `lib/agents.mjs`.
   */
  async catalogueAgents(options = {}) {
    const nodeId = this.nodeId;
    const nodeName = this.identity?.name ?? '';
    const rows = [];
    // Archived sessions are hidden: a workspace in the archive is not something
    // a peer should be able to wake or import. The registry owns that flag.
    const archived = new Set();
    const registry = this.getWorkspaceRegistry?.();
    if (registry !== undefined && Array.isArray(registry.archivedSessionIds)) {
      for (const id of registry.archivedSessionIds) archived.add(id);
    }
    const live = new Map();
    for (const row of this.#liveSessions()) live.set(row.id, row);
    // Read the stored headers first: a session that is live right now still has
    // its `cwd` on disk, and without it a resumed agent would report the
    // workspace it came from as unknown the moment it starts running.
    const headers = new Map();
    const persistence = this.sessionPersistence;
    if (persistence !== undefined && typeof persistence.list === 'function') {
      let stored = [];
      try {
        stored = await persistence.list();
      } catch (error) {
        this.log('cannot list stored sessions', error);
      }
      for (const snapshot of Array.isArray(stored) ? stored : []) {
        const id = typeof snapshot?.header?.id === 'string' ? snapshot.header.id : '';
        if (id === '') continue;
        headers.set(id, snapshot.header);
      }
    }
    for (const [id, row] of live) {
      if (archived.has(id)) continue;
      // Prefer the durable header; fall back to what this node itself recorded
      // when it created or resumed the agent.
      const known = this.known.get(id);
      const title = this.#titleOf({ nodeId, sessionId: id });
      rows.push(localRow({
        nodeId,
        nodeName,
        id,
        title,
        header: headers.get(id) ?? (known ? { cwd: known.cwd } : undefined),
        live: true,
        status: row.status,
        rooms: roomsFor(this.roomsDoc, nodeId, id).map((room) => room.id),
        imported: this.handles.has(id),
        name: known?.name,
      }));
    }
    for (const [id, header] of headers) {
      if (live.has(id)) continue;
      if (archived.has(id)) continue;
      const title = this.#titleOf({ nodeId, sessionId: id });
      rows.push(localRow({
        nodeId,
        nodeName,
        id,
        title,
        header,
        live: false,
        rooms: roomsFor(this.roomsDoc, nodeId, id).map((room) => room.id),
      }));
    }
    const peers = options.peers === false ? [] : await this.fetchPeerAgents();
    return catalogue({ nodeId, nodeName, local: rows, peers, dialled: this.dialled });
  }

  /**
   * Ask every visible peer which agents it hosts.
   *
   * A peer that is unreachable is normal (it may be shutting down, or on a
   * network this node cannot dial); the listing just leaves it out.
   * @returns {Promise<object[]>} normalized peer payloads.
   */
  async fetchPeerAgents() {
    const peers = this.discovery?.list() ?? [];
    const results = await Promise.allSettled(peers.slice(0, MAX_PEERS).map((peer) => fetchAgentsFromPeer({
      address: peer.address,
      port: peer.httpPort,
      secret: this.config.clusterSecret,
      fromNodeId: this.nodeId,
      fromName: this.identity?.name ?? '',
    }).then((answer) => ({ peer, answer }))));
    const out = [];
    for (const settled of results) {
      if (settled.status !== 'fulfilled') {
        this.log('a peer did not answer the agent listing', settled.reason);
        continue;
      }
      const { peer, answer } = settled.value;
      const normalized = normalizePeerAgents(answer, peer.nodeId, peer.name);
      out.push(normalized);
    }
    return out;
  }

  /**
   * The model a freshly started agent should run on.
   *
   * Without this the system prompt template has no `{{model}}` value and every
   * turn fails instantly, which is a painful failure to diagnose across a LAN.
   * @returns {object | undefined} agent options, or undefined when unknown.
   */
  #agentOptions() {
    let selection;
    try {
      selection = this.agentDefaultModel?.currentSelection?.();
    } catch {
      selection = undefined;
    }
    const provider = typeof selection?.provider === 'string' ? selection.provider : '';
    const model = typeof selection?.model === 'string' ? selection.model : '';
    if (provider === '' || model === '') return undefined;
    const options = { provider, model };
    if (typeof selection.reasoningEffort === 'string') options.reasoningEffort = selection.reasoningEffort;
    return options;
  }

  /**
   * Bring a stored session on this node (re)to life, whatever workspace it was
   * created in.
   *
   * This is the "import an agent from another workspace" operation: resuming
   * reattaches the existing session with its own `cwd`, so the agent works where
   * it always worked — nothing is copied or moved.
   * @param {object} request - which session to bring up.
   * @param {string} request.sessionId - stored session id, or a catalogue reference.
   * @param {string} [request.sessionName] - display name, unused by the runtime.
   * @returns {Promise<object>} the row of the now-live agent.
   */
  async importAgent(request = {}) {
    await this.#ready();
    const reference = String(request.sessionId ?? '').trim();
    if (reference === '') throw new TransportError('sessionId is required', 'BAD_REQUEST');
    const catalogueNow = await this.catalogueAgents({ peers: false });
    let row = resolveAgent(catalogueNow.agents, reference);
    if (row === undefined) {
      row = catalogueNow.agents.find((item) => item.id === reference);
    }
    if (row === undefined) throw new TransportError(`unknown agent "${reference}"`, 'UNKNOWN_AGENT');
    if (row.live) {
      // Idempotent: importing an agent that is already running is a no-op, not
      // an error, because the panel cannot know a peer just started it.
      return { agent: row, resumed: false, note: 'this agent is already live on this node' };
    }
    const agents = this.agents;
    if (!agents || typeof agents.resume !== 'function') {
      throw new TransportError('this Host cannot resume sessions', 'NOT_SUPPORTED');
    }
    let handle;
    try {
      const options = { resumeSessionId: row.id };
      const agentOptions = this.#agentOptions();
      if (agentOptions !== undefined) options.agentOptions = agentOptions;
      const composition = await this.#presetSetup();
      if (composition !== undefined) options.setup = composition.setup;
      handle = await agents.resume(options);
    } catch (error) {
      throw new TransportError(`cannot resume ${row.id}: ${errorText(error)}`, 'IMPORT_FAILED');
    }
    const id = typeof handle?.agent?.id === 'string' ? handle.agent.id : row.id;
    this.handles.set(id, handle);
    this.known.set(id, { cwd: row.cwd, name: row.name });
    this.log(`resumed ${id} from workspace ${row.workspace || '(unknown)'}`);
    const after = await this.catalogueAgents({ peers: false });
    return {
      agent: after.agents.find((item) => item.id === id) ?? row,
      resumed: true,
      note: `resumed in workspace ${row.workspace || row.cwd || '(unknown)'}`,
    };
  }

  /**
   * Resolve the preset and the Agent setup that actually mounts it.
   *
   * A preset id in `meta.agentPreset` only labels the session header; the tools
   * come from `presets.mount(agentCtx, id)` at Agent construction. Skipping the
   * mount yields an agent with no file tools and no mesh tools, which cannot so
   * much as answer the message that woke it.
   * @returns {Promise<{ presetId: string, setup: (agentCtx: object, agent: object) => Promise<void> } | undefined>}
   */
  async #presetSetup() {
    const presets = this.getAgentPresets?.() ?? this.agentPresets;
    if (presets === undefined || typeof presets.mount !== 'function') {
      this.log('no agent preset registry; a new agent gets host tools only');
      return undefined;
    }
    let presetId;
    try {
      presetId = (await presets.resolve()).id;
    } catch (error) {
      this.log('cannot resolve the default agent preset', error);
      return undefined;
    }
    if (typeof presetId !== 'string' || presetId === '') return undefined;
    this.log(`composing a new agent with preset ${presetId}`);
    return {
      presetId,
      // ponytail: resume re-mounts the node default, not the preset the session
      // recorded. Fine while every node runs one preset; read the session
      // projection if mixed presets ever land on one node.
      setup: async (agentCtx) => {
        await presets.mount(agentCtx, presetId);
        this.#mountMeshTools(agentCtx);
      },
    };
  }

  /**
   * Register the mesh tools on a freshly composed agent.
   *
   * The plugin registers its tools on the Host ctx, which a preset-composed
   * agent does not inherit. Without this an imported agent cannot call
   * `lan_mesh_send`, so it can never answer the message that woke it.
   * @param {object} agentCtx - the Agent's own context.
   */
  #mountMeshTools(agentCtx) {
    const tools = agentCtx?.get?.('tools');
    if (tools === undefined || typeof tools.register !== 'function') {
      this.log('the new agent has no tools service; mesh tools were not mounted');
      return;
    }
    const definitions = this.getToolDefinitions?.() ?? [];
    for (const definition of definitions) {
      try {
        tools.register(definition);
      } catch (error) {
        this.log(`cannot mount ${definition.name} on the new agent`, error);
      }
    }
    if (definitions.length > 0) this.log(`mounted ${definitions.length} mesh tools on the new agent`);
  }

  /**
   * Create a brand-new agent session in a given workspace directory.
   *
   * The directory is the whole point: a session's `cwd` is fixed at creation and
   * later moves are a Harness concern, so starting one in the other workspace is
   * how you get an agent that belongs there.
   * @param {object} request - where to create it.
   * @param {string} request.cwd - absolute workspace directory.
   * @param {string} [request.sessionName] - display name for the catalogue row.
   * @returns {Promise<object>} the new row.
   */
  async createAgentIn(request = {}) {
    await this.#ready();
    const cwd = String(request.cwd ?? '').trim();
    if (cwd === '') throw new TransportError('cwd is required', 'BAD_REQUEST');
    if (!isAbsolute(cwd)) throw new TransportError(`cwd must be an absolute path: ${cwd}`, 'BAD_REQUEST');
    // A session's cwd is fixed at creation and never validated again, so a
    // missing directory turns into a failing turn much later, far from the
    // call that caused it. Make the directory real here instead.
    try {
      if (!statSync(cwd).isDirectory()) throw new Error('not a directory');
    } catch (error) {
      try {
        mkdirSync(cwd, { recursive: true });
      } catch (made) {
        throw new TransportError(`cannot use ${cwd} as a workspace: ${errorText(made)}`, 'BAD_REQUEST');
      }
    }
    const agents = this.agents;
    if (!agents || typeof agents.create !== 'function') {
      throw new TransportError('this Host cannot create agents', 'NOT_SUPPORTED');
    }
    const sessionId = `session-${randomUUID()}`;
    const composition = await this.#presetSetup();
    const meta = composition === undefined ? { cwd } : { cwd, agentPreset: composition.presetId };
    let handle;
    try {
      const options = { sessionId, meta };
      const agentOptions = this.#agentOptions();
      if (agentOptions !== undefined) options.agentOptions = agentOptions;
      if (composition !== undefined) options.setup = composition.setup;
      handle = await agents.create(options);
    } catch (error) {
      throw new TransportError(`cannot create an agent in ${cwd}: ${errorText(error)}`, 'CREATE_FAILED');
    }
    const id = typeof handle?.agent?.id === 'string' ? handle.agent.id : sessionId;
    this.handles.set(id, handle);
    const name = cleanName(request.sessionName, '');
    this.known.set(id, { cwd, name });
    const title = await this.#nameSession(handle?.agent, request.title);
    const row = localRow({
      nodeId: this.nodeId,
      nodeName: this.identity?.name ?? '',
      id,
      header: { cwd },
      live: true,
      rooms: [],
      imported: true,
      name,
      title,
    });
    return { agent: row, note: `created in ${cwd}` };
  }

  /**
   * Give a freshly created session its title, so it has a readable name.
   *
   * `rename` is the same call the title box in the conversation header makes: it
   * appends `session/title` and supersedes automatic generation. Failing to name
   * a session is not a reason to fail its creation — it will just fall back to
   * its own generated title.
   * @param {object} agent - the created agent, if the Host returned one.
   * @param {unknown} title - requested title.
   * @returns {Promise<string>} the title that will be shown, `''` when none.
   */
  async #nameSession(agent, title) {
    const wanted = cleanName(title, '');
    if (wanted === '') return '';
    const service = this.getSessionTitle?.();
    const session = agent?.session;
    if (service === undefined || session === undefined || typeof service.rename !== 'function') {
      this.log('no session title service; the new agent keeps its generated title');
      return '';
    }
    try {
      const snapshot = service.rename(session, wanted);
      return typeof snapshot === 'string' ? snapshot : wanted;
    } catch (error) {
      this.log(`cannot title the new session "${wanted}"`, error);
      return '';
    }
  }

  /**
   * Address one agent on a peer node and give it its first instruction.
   *
   * The mesh has no stream and no return value: a dial is an asynchronous
   * request, and the answer arrives as an ordinary mesh message. The prompt says
   * so, otherwise the remote model has no way to know it should reply.
   * @param {object} request - who to dial and what to say.
   * @param {string} request.target - `<nodeId>/<sessionId>`, or a catalogue reference.
   * @param {string} request.text - first instruction.
   * @param {string} [request.topic] - short label for the message.
   * @returns {Promise<object>} the dialled row plus the delivery report.
   */
  async dialAgent(request = {}) {
    await this.#ready();
    const target = String(request.target ?? '').trim();
    const text = String(request.text ?? '').trim();
    if (target === '') throw new TransportError('target is required', 'BAD_REQUEST');
    if (text === '') throw new TransportError('text is required', 'BAD_TEXT');
    const rows = (await this.catalogueAgents()).remote;
    const address = splitAddress(target);
    const row = address === undefined
      ? resolveAgent(rows, target)
      : rows.find((item) => item.nodeId === address.nodeId && item.id === address.sessionId);
    if (row === undefined) {
      throw new TransportError(`unknown remote agent "${target}"`, 'UNKNOWN_AGENT');
    }
    const from = this.identity?.name || this.nodeId;
    const prompt = [
      `来自局域网节点 ${from}（${this.nodeId}）的协作请求：`,
      '',
      text,
      '',
      `完成后请用 lan_mesh_send 回信，target 写 "${this.nodeId}"。`,
    ].join('\n');
    const report = await this.send({
      target: agentAddress(row.nodeId, row.id),
      text: prompt,
      topic: String(request.topic ?? '').trim(),
      kind: 'note',
    });
    const delivered = (report.delivered ?? []).some((item) => item.ok === true);
    if (delivered) this.dialled.add(agentAddress(row.nodeId, row.id));
    return { agent: { ...row, dialled: delivered }, delivery: report };
  }

  /**
   * Forget a remote agent dialled from this node.
   * @param {string} target - `<nodeId>/<sessionId>`.
   * @returns {{ removed: boolean }}
   */
  undialAgent(target) {
    const address = splitAddress(target);
    if (address === undefined) return { removed: false };
    return { removed: this.dialled.delete(agentAddress(address.nodeId, address.sessionId)) };
  }

  /**
   * Live agents on this node as `{ id, status }` rows.
   * @returns {{ id: string, status: string }[]}
   */
  #liveSessions() {
    const agents = this.agents;
    if (!agents || typeof agents.list !== 'function') return [];
    let list;
    try {
      list = agents.list();
    } catch (error) {
      this.log('cannot list agent sessions', error);
      return [];
    }
    return (Array.isArray(list) ? list : [])
      .map((agent) => {
        const id = typeof agent?.id === 'string' ? agent.id : '';
        if (id === '') return undefined;
        const status = typeof agent?.status === 'string' ? agent.status : '';
        return { id, status };
      })
      .filter((row) => row !== undefined);
  }

  // ---------------------------------------------------------------- rooms ----

  /**
   * Rooms one session belongs to, as that session's role colours them.
   *
   * Pass `{ all: true }` to see every room this node knows about instead — that
   * is how a session discovers a project a peer created and joins it.
   * @param {{ sessionId?: string, all?: boolean }} [request] - which session is looking.
   * @returns {object[]}
   */
  listRooms(request = {}) {
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : '';
    if (request?.all === true) return this.#roomRows(allRooms(this.roomsDoc, this.nodeId, sessionId));
    if (sessionId === '') return [];
    return this.#roomRows(roomsFor(this.roomsDoc, this.nodeId, sessionId));
  }

  /**
   * Give room rows live member flags.
   *
   * `lib/rooms.mjs` stays free of runtime lookups, so the reachability of every
   * member is added here, where the agent table and the peer table are visible.
   * @param {object[]} rows - room rows from `rooms.mjs`.
   * @returns {object[]}
   */
  #roomRows(rows) {
    const peers = new Set((this.discovery?.list() ?? []).map((peer) => peer.nodeId));
    const decorate = (member) => ({
      ...member,
      // The rail lists members by name; the title and the local nickname are what
      // tell two sessions on one machine apart, so they travel with the row.
      name: this.#displayName(member),
      title: this.#titleOf(member),
      live: this.#isLive(member, peers),
    });
    return rows.map((row) => ({
      ...row,
      members: row.members.map((member) => decorate(member)),
      // Task assignees come from the same projection, so they need the same flag;
      // one schema covers both lists and neither may omit it.
      tasks: row.tasks.map((task) => ({
        ...task,
        assignee: decorate(task.assignee),
        assigner: decorate(task.assigner),
      })),
    }));
  }

  /**
   * Whether a member is reachable from this node right now.
   *
   * A remote member is judged by its node, not its session: asking a peer about
   * every session on every snapshot would cost a round trip per row.
   * @param {object} member - room member.
   * @param {Set<string>} peers - node ids seen by discovery.
   * @returns {boolean}
   */
  #isLive(member, peers) {
    if (member.nodeId !== this.nodeId) return peers.has(member.nodeId);
    if (member.sessionId === HUMAN_SESSION_ID) return true;
    return this.#liveAgentId(member.sessionId) !== '';
  }

  /**
   * The name a member is shown as on this node.
   *
   * The person's own nickname wins for the human member, because the stored
   * member record was written when they joined and does not follow later edits.
   * @param {object} member - room member.
   * @returns {string}
   */
  #displayName(member) {
    if (member.sessionId === HUMAN_SESSION_ID && member.nodeId === this.nodeId) {
      const chosen = this.nicknames?.self ?? '';
      if (chosen !== '') return chosen;
    }
    return typeof member.name === 'string' ? member.name : '';
  }

  /**
   * Whether a mention token names one of this session's labels.
   *
   * People type `@Beta` for a session called "Beta rollout", so a token matches
   * when it is the whole label, its first word, or any later word — but not when
   * it merely shares a prefix ("@Bet" must not pull in "Beta").
   * @param {string} mention - lower-cased token after `@`.
   * @param {Set<string>} labels - lower-cased names this session answers to.
   * @returns {boolean}
   */
  static #namedBy(mention, labels) {
    if (labels.has(mention)) return true;
    for (const label of labels) {
      if (label.split(/\s+/).includes(mention)) return true;
      if (label.startsWith(`${mention} `)) return true;
    }
    return false;
  }

  /**
   * Unread room messages per room, counting only what this session must look at.
   *
   * A room is a shared channel: agents talk to each other in it all day. Bumping
   * a badge for every line would make the badge meaningless, so only two things
   * count — a message that names this session with `@`, and a task handed to it.
   * Counted from the delivery log rather than stored, so a node that restarts
   * still reports the messages its inbox file preserved.
   * @param {string} [sessionId] - which member is looking; all rooms when empty.
   * @returns {Record<string, number>}
   */
  #unreadByRoom(sessionId = '') {
    const labels = this.#labelsOf(sessionId) ?? new Set();
    const address = this.#roomCallerKey(sessionId);
    const out = {};
    for (const item of this.messages) {
      if (typeof item.room !== 'string' || item.room === '') continue;
      if (!this.#waitsOn(item, labels, address, sessionId)) continue;
      out[item.room] = (out[item.room] ?? 0) + 1;
    }
    return out;
  }

  /** Resolve the caller's Room identity only through a unique live prefix. */
  #roomCallerKey(sessionId) {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (id === '') return '';
    if (id.length < 64) return memberKey(this.nodeId, id);
    const storedId = id.slice(0, 64);
    const liveId = this.#liveAgentId(storedId);
    // A full Host id may claim its bounded Room identity only when that
    // stored prefix uniquely resolves back to this caller.
    if (id.length > 64 && liveId !== id) return '';
    if (liveId === '') {
      try {
        if (this.agents?.list?.().some(agent => typeof agent.id === 'string' && agent.id.startsWith(storedId))) return '';
      } catch { return ''; }
    }
    return memberKey(this.nodeId, storedId);
  }

  /**
   * Everything a peer or the person could call this session, lower-cased.
   *
   * A mention arrives as whatever the sender typed, so the match has to be made
   * against every name this session answers to: its nickname, its title, its
   * member name and its raw id.
   * @param {string} [sessionId] - session to name; always allowed for the human.
   * @returns {Set<string> | undefined} `undefined` when there is nothing to match.
   */
  #labelsOf(sessionId) {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (id === '') return undefined;
    const labels = new Set([id.toLowerCase()]);
    const key = this.#roomCallerKey(id);
    // The person's own name lives in `self`, not in `members`: nobody nicknames
    // themselves through the member list. Without this, an agent answering
    // "@老板 …" lands on the node and never reaches the person's attention list.
    if (id === HUMAN_SESSION_ID) {
      const self = this.nicknames?.self;
      if (typeof self === 'string' && self !== '') labels.add(self.toLowerCase());
      const nodeName = this.identity?.name;
      if (typeof nodeName === 'string' && nodeName !== '') labels.add(nodeName.toLowerCase());
    }
    const nick = this.nicknames?.members?.[key];
    if (typeof nick === 'string' && nick !== '') labels.add(nick.toLowerCase());
    const title = this.#titleOf({ nodeId: this.nodeId, sessionId: id });
    if (title !== '') labels.add(title.toLowerCase());
    for (const room of Object.values(this.roomsDoc.rooms)) {
      const member = room.members?.find((item) => item.key === key);
      if (member === undefined) continue;
      if (typeof member.name === 'string' && member.name !== '') labels.add(member.name.toLowerCase());
    }
    return labels;
  }

  /**
   * One room plus the recent conversation held on this node.
   * @param {{ room?: string, sessionId?: string }} request - room handle and viewer.
   * @returns {{ room: object, messages: object[], mine: object[], viewer: object }}
   */
  roomDetail(request = {}) {
    const room = this.#roomOrThrow(request?.room);
    const messages = this.messages
      .filter((item) => item.room === room.id)
      .slice(-ROOM_MESSAGE_LIMIT)
      .map((item) => ({ ...item }));
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : '';
    const key = this.#roomCallerKey(sessionId);
    const caller = key === '' ? undefined : room.members.find((member) => member.key === key);
    // Opening a room is reading it: clearing the badge here is what makes the
    // left-hand counter mean "messages I have not looked at" rather than "total".
    if (key !== '' && caller !== undefined) this.markRoomRead(room.id, sessionId);
    return {
      room: this.#roomView(room),
      messages,
      mine: key === '' ? [] : tasksFor(this.roomsDoc, room.id, key),
      viewer: {
        sessionId,
        isMember: caller !== undefined,
        isLeader: key !== '' && room.leader !== undefined && room.leader.key === key,
        role: caller?.role ?? '',
      },
    };
  }

  /**
   * Mark the room messages this session was actually waiting on as read.
   *
   * Only the ones that would have counted as unread flip: clearing the badge must
   * not silently bury an `@` the person has not seen yet.
   * @param {string} roomId - room whose messages were looked at.
   * @param {string} [sessionId] - viewer; without it every room message flips.
   * @returns {number} how many records flipped to read.
   */
  markRoomRead(roomId, sessionId = '') {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    const labels = this.#labelsOf(id) ?? new Set();
    const address = this.#roomCallerKey(id);
    let flipped = 0;
    for (const item of this.messages) {
      if (item.room !== roomId || item.read === true) continue;
      // No viewer given: the caller just wants the room swept clean.
      if (id !== '' && !this.#waitsOn(item, labels, address, id)) continue;
      item.read = true;
      flipped += 1;
    }
    if (flipped > 0) {
      // Reading a room flips the records themselves, which is what the inbox
      // badge counts; there is no separate counter to adjust.
      this.#saveInbox().catch((error) => this.log('cannot rewrite the inbox log', error));
    }
    return flipped;
  }

  /**
   * Rewrite the inbox log so read flags survive a restart.
   * @returns {Promise<void>}
   */
  async #saveInbox() {
    await rewriteInbox(
      this.messages.map((item) => ({
        envelope: {
          id: item.id,
          from: item.from,
          to: item.to,
          kind: item.kind,
          topic: item.topic,
          room: item.room,
          text: item.text,
          sentAt: item.receivedAt,
          // The rewrite is a full replace, so anything not copied here is lost
          // from the log — attachments included.
          ...(item.file === undefined ? {} : { file: item.file }),
          ...(item.structuredMentions === undefined ? {} : { mentions: item.structuredMentions }),
          ...(item.skillRefs === undefined ? {} : { skillRefs: item.skillRefs }),
        },
        receivedAt: item.receivedAt,
        read: item.read === true,
      })),
      { port: this.config.port },
    );
  }

  /**
   * Create a room and become its leader.
   * @param {object} request - room definition plus the creating session.
   * @param {string} request.name - room name, also the join handle for humans.
   * @param {string} [request.topic] - what the project is about.
   * @param {string} request.sessionId - creating session.
   * @param {string} [request.sessionName] - display name for that session.
   * @returns {Promise<{ room: object, forward: { nodeIds: string[] } }>}
   */
  async createRoom(request = {}) {
    await this.#ready();
    const leader = this.#selfMember(request.sessionId, request.sessionName);
    let created;
    try {
      created = createRoomInState(
        this.roomsDoc,
        { name: request.name, topic: request.topic, leader },
        randomUUID,
      );
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), 'BAD_REQUEST');
    }
    await this.#saveRooms();
    const sync = await this.syncRooms();
    const room = this.roomsDoc.rooms[created.id] ?? created;
    return {
      room: this.#roomView(room),
      forward: { nodeIds: sync.pushed.filter((row) => row.ok).map((row) => row.nodeId) },
    };
  }

  /**
   * Add the calling session to an existing room.
   * @param {{ room?: string, sessionId?: string, sessionName?: string }} request - room handle and joiner.
   * @returns {Promise<{ room: object, added: boolean }>}
   */
  async joinRoom(request = {}) {
    await this.#ready();
    const member = this.#selfMember(request.sessionId, request.sessionName);
    const target = this.#roomOrThrow(request.room);
    let result;
    try {
      result = joinRoomInState(this.roomsDoc, target.id, member);
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), 'BAD_REQUEST');
    }
    if (result.added) await this.#saveRooms();
    await this.syncRooms();
    const room = this.roomsDoc.rooms[target.id] ?? result.room;
    return { room: this.#roomView(room), added: result.added };
  }

  /**
   * The leader pulls a local agent session into a room. Only a local session
   * can be invited — the leader cannot manufacture a member on a peer node,
   * because that member's identity is owned by the peer.
   * @param {{ room?: string, sessionId?: string, memberSessionId?: string }} request - room, caller, and the session to add.
   * @returns {Promise<{ room: object, added: boolean }>}
   */
  async addRoomMember(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    if (target.leader === undefined || target.leader.key !== self.key) {
      throw new TransportError('only the room leader can add members', 'NOT_LEADER');
    }
    const memberSessionId = String(request.memberSessionId ?? '');
    if (memberSessionId === '' || memberSessionId === HUMAN_SESSION_ID) {
      throw new TransportError('a local agent session is required', 'BAD_REQUEST');
    }
    // The member must live on this node: a local agent or a stored session.
    const memberNodeId = String(request.memberNodeId || this.nodeId);
    if (memberNodeId !== this.nodeId) {
      throw new TransportError('can only add a session hosted on this node', 'BAD_REQUEST');
    }
    const known = this.#titleOf({ nodeId: memberNodeId, sessionId: memberSessionId });
    const member = { nodeId: memberNodeId, sessionId: memberSessionId, name: known };
    let result;
    try {
      result = addRoomMemberInState(this.roomsDoc, target.id, member);
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), 'BAD_REQUEST');
    }
    if (result.added) await this.#saveRooms();
    await this.syncRooms();
    const room = this.roomsDoc.rooms[target.id] ?? result.room;
    return { room: this.#roomView(room), added: result.added };
  }

  /**
   * Remove the calling session from a room. The leader cannot leave its own room.
   * @param {{ room?: string, sessionId?: string }} request - room handle and leaver.
   * @returns {Promise<{ removed: boolean, room: object }>}
   */
  async leaveRoom(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    let removed;
    try {
      removed = leaveRoomInState(this.roomsDoc, target.id, self.key);
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), 'NOT_LEADER');
    }
    if (removed) await this.#saveRooms();
    await this.syncRooms();
    const room = this.roomsDoc.rooms[target.id] ?? target;
    return { removed, room: this.#roomView(room) };
  }

  /**
   * The room leader kicks one member out. Its tombstone keeps the member out
   * across peer merges, exactly like a self-leave.
   * @param {{ room?: string, sessionId?: string, member?: string }} request - room, caller, and the member to remove.
   * @returns {Promise<{ removed: boolean, room: object }>}
   */
  async removeMember(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    const reference = String(request.member ?? '').trim();
    if (reference === '') throw new TransportError('member is required', 'BAD_REQUEST');
    // A raw room member key or a bare session id are both fine: resolve the
    // key the same way setNickname does, so the panel never has to reconstruct it.
    let key = reference.includes('/') ? reference : '';
    if (key === '') {
      const hit = (target.members ?? []).find(
        (member) =>
          member.sessionId === reference ||
          member.key === reference ||
          (member.name ?? '').toLowerCase() === reference.toLowerCase() ||
          this.#titleOf(member).toLowerCase() === reference.toLowerCase(),
      );
      if (hit === undefined) throw new TransportError(`cannot resolve the member "${reference}"`, 'UNKNOWN_AGENT');
      key = hit.key;
    }
    let removed;
    try {
      removed = removeMemberInState(this.roomsDoc, target.id, key, self.key);
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), error?.code === 'NOT_LEADER' ? 'NOT_LEADER' : 'BAD_REQUEST');
    }
    if (removed) await this.#saveRooms();
    await this.syncRooms();
    const room = this.roomsDoc.rooms[target.id] ?? target;
    return { removed, room: this.#roomView(room) };
  }

  /**
   * Workspaces this node knows about, for the "new agent here" picker.
   *
   * A session's `cwd` is fixed at creation, so choosing an existing workspace is
   * the difference between an agent that belongs to a project and one that has to
   * be re-homed later.
   * @returns {{ id: string, path: string, title: string, sessions: number }[]}
   */
  workspaces() {
    const registry = this.getWorkspaceRegistry?.();
    if (registry === undefined || typeof registry.list !== 'function') return [];
    let rows;
    try {
      rows = registry.list();
    } catch (error) {
      this.log('cannot list workspaces', error);
      return [];
    }
    const out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const path = typeof row?.path === 'string' ? row.path.trim() : '';
      if (path === '') continue;
      const title = typeof row?.title === 'string' && row.title.trim() !== '' ? row.title.trim() : workspaceLabel(path);
      out.push({
        id: typeof row?.id === 'string' ? row.id : path,
        path,
        title,
        sessions: Array.isArray(row?.sessionIds) ? row.sessionIds.length : 0,
      });
    }
    return out;
  }

  /**
   * Rename one member or set this node's human identity.
   *
   * A member nickname remains a local preference. The human self-name is also
   * copied into this node's room memberships and synchronized, because it is the
   * identity other participants should see in member lists and new messages.
   * @param {{ member?: string, name?: string, self?: boolean }} request - who to rename.
   * @returns {Promise<{ nicknames: object }>}
   */
  async setNickname(request = {}) {
    await this.#ready();
    const name = String(request.name ?? '').trim();
    const next = { self: this.nicknames.self, members: { ...this.nicknames.members } };
    if (request.self === true) {
      next.self = cleanName(name, '');
    } else {
      const reference = String(request.member ?? '').trim();
      if (reference === '') throw new TransportError('member is required', 'BAD_REQUEST');
      // Accept a raw key, a session id, a title or a nickname: the panel should
      // not have to reconstruct the key format to rename someone.
      let key = reference.includes('/') ? reference : '';
      if (key === '') {
        for (const room of Object.values(this.roomsDoc.rooms)) {
          const hit = (room.members ?? []).find(
            (member) =>
              member.sessionId === reference ||
              member.key === reference ||
              (member.name ?? '').toLowerCase() === reference.toLowerCase() ||
              this.#titleOf(member).toLowerCase() === reference.toLowerCase(),
          );
          if (hit !== undefined) {
            key = hit.key;
            break;
          }
        }
      }
      if (key === '') throw new TransportError(`cannot resolve the member "${reference}"`, 'UNKNOWN_AGENT');
      if (name === '') delete next.members[key];
      else next.members[key] = cleanName(name, '');
    }
    this.nicknames = next;
    await saveNicknames(next, { port: this.config.port });
    if (request.self === true) {
      const at = new Date().toISOString();
      const key = memberKey(this.nodeId, HUMAN_SESSION_ID);
      let roomsChanged = false;
      for (const room of Object.values(this.roomsDoc.rooms ?? {})) {
        let roomChanged = false;
        const display = next.self || this.identity?.name || HUMAN_SESSION_ID;
        const update = (member) => {
          if (member?.key !== key) return;
          member.name = display;
          member.nameUpdatedAt = at;
          roomChanged = true;
          roomsChanged = true;
        };
        update(room.leader);
        for (const member of room.members ?? []) update(member);
        if (roomChanged) room.updatedAt = at;
      }
      if (roomsChanged) {
        await this.#saveRooms();
        await this.syncRooms();
      }
    }
    return { nicknames: { self: next.self, members: { ...next.members } } };
  }

  /**
   * Rename a room, or rewrite what the project is about. Leader only.
   *
   * The name doubles as the human join handle, so renaming is an edit every peer
   * must converge on: it bumps `updatedAt`, which `mergeStates()` uses to decide
   * whose title wins.
   * @param {{ room?: string, sessionId?: string, name?: string, topic?: string }} request - edit request.
   * @returns {Promise<{ room: object }>}
   */
  async renameRoom(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    if (target.leader === undefined || target.leader.key !== self.key) {
      throw new TransportError('only the room leader can rename it', 'NOT_LEADER');
    }
    const patch = {};
    if (typeof request.name === 'string') patch.name = request.name;
    if (typeof request.topic === 'string') patch.topic = request.topic;
    if (Object.keys(patch).length === 0) {
      throw new TransportError('name or topic is required', 'BAD_REQUEST');
    }
    let renamed;
    try {
      renamed = renameRoomInState(this.roomsDoc, target.id, patch);
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), 'BAD_REQUEST');
    }
    await this.#saveRooms();
    await this.syncRooms();
    return { room: this.#roomView(this.roomsDoc.rooms[target.id] ?? renamed) };
  }

  /**
   * Assign a task to a room member. Only the room leader may do this.
   * @param {object} request - task definition plus the assigning session.
   * @param {string} request.room - room handle.
   * @param {string} request.sessionId - assigning session.
   * @param {string} request.assignee - member key, session id, member name or node name.
   * @param {string} request.title - one-line task title.
   * @param {string} [request.detail] - what to do, in full.
   * @returns {Promise<{ task: object, delivered: object[] }>}
   */
  async assignTask(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    const assigner = target.members.find((member) => member.key === self.key);
    if (assigner === undefined) {
      throw new TransportError(`session ${self.sessionId} is not a member of room ${target.name}`, 'BAD_REQUEST');
    }
    if (target.leader === undefined || target.leader.key !== self.key) {
      throw new TransportError('only the room leader can assign tasks', 'NOT_LEADER');
    }
    const assignee = resolveMember(
      target,
      { selfNodeId: this.nodeId, nameOf: (nodeId) => this.#nameOf(nodeId) },
      String(request.assignee ?? ''),
    );
    if (assignee === undefined) {
      throw new TransportError(
        `cannot resolve the assignee "${String(request.assignee ?? '')}" in room ${target.name}`,
        'BAD_REQUEST',
      );
    }
    let created;
    try {
      created = assignRoomTask(
        this.roomsDoc,
        target.id,
        { title: request.title, detail: request.detail, assignee, assigner },
        randomUUID,
      );
    } catch (error) {
      throw new TransportError(String(error?.message ?? error), 'BAD_REQUEST');
    }
    await this.#saveRooms();
    const delivered = await this.#deliverTask(target, assignee, created);
    await this.syncRooms();
    const room = this.roomsDoc.rooms[target.id] ?? target;
    const task = room.tasks.find((item) => item.id === created.id) ?? created;
    return { room: this.#roomView(room), task: taskView(task), delivered };
  }

  /**
   * Move one task to a new status. The leader or the task's own assignee may do it.
   * @param {object} request - status change plus the acting session.
   * @param {string} request.room - room handle.
   * @param {string} request.sessionId - acting session.
   * @param {string} request.task - task id or exact title.
   * @param {string} request.status - one of `open|doing|blocked|done`.
   * @param {string} [request.note] - progress line appended to the detail.
   * @returns {Promise<{ task: object }>}
   */
  async setTaskStatus(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    const caller = target.members.find((member) => member.key === self.key);
    if (caller === undefined) {
      throw new TransportError(`session ${self.sessionId} is not a member of room ${target.name}`, 'BAD_REQUEST');
    }
    const wanted = String(request.task ?? '').trim();
    const existing = resolveTask(target, wanted);
    const isLeader = target.leader !== undefined && target.leader.key === self.key;
    if (!isLeader && existing.assignee.key !== self.key) {
      throw new TransportError('only the room leader or the task assignee can change this status', 'NOT_LEADER');
    }
    let updated;
    try {
      updated = setTaskStatusInState(this.roomsDoc, target.id, wanted, String(request.status ?? ''), request.note);
    } catch (error) {
      // Keep a declared code so an ambiguous task handle stays distinguishable
      // from a plain bad request; the message is already user-facing.
      const code = typeof error?.code === 'string' ? error.code : 'BAD_REQUEST';
      throw new TransportError(String(error?.message ?? error), code);
    }
    await this.#saveRooms();
    await this.syncRooms();
    const room = this.roomsDoc.rooms[target.id] ?? target;
    const task = room.tasks.find((item) => item.id === updated.id) ?? updated;
    // A task reaching done is the one thing the person cares about enough to be
    // told about out of band. Channels are discovered at send time (IM service
    // mounts after `apply`); best-effort — a broken notifier must never fail the
    // status change itself.
    if (task.status === 'done' && typeof this.notify === 'function') {
      try {
        const roomName = room.name || target.id;
        const title = task.title || task.id;
        await this.notify(`任务完成：房间「${roomName}」的「${title}」已完成`, self.key);
      } catch (error) {
        this.log('cannot notify the task completion', error);
      }
    }
    return { room: this.#roomView(room), task: taskView(task) };
  }

  /**
   * Post one message to a room.
   *
   * Local members are woken on this node; each peer that hosts a member gets one
   * envelope and fans out to its own members, so a peer with ten members in the
   * room still receives a single message.
   * @param {{ room?: string, sessionId?: string, text?: string }} request - room, sender and body.
   * @returns {Promise<{ room: object, delivered: object[] }>}
   */
  async sayInRoom(request = {}) {
    await this.#ready();
    const self = this.#selfMember(request.sessionId);
    const target = this.#roomOrThrow(request.room);
    const body = String(request.text ?? '').trim();
    // File attachment: optional, must be an object with name/type/size/data.
    const file = isFileAttachment(request.file) ? normalizeFile(request.file) : null;
    if (body === '' && file === null) throw new TransportError('text or file is required', 'BAD_REQUEST');
    const sender = target.members.find((member) => member.key === self.key);
    if (sender === undefined) {
      throw new TransportError(`session ${self.sessionId} is not a member of room ${target.name}`, 'BAD_REQUEST');
    }
    let metadata;
    try { metadata = normalizeRoomMessageMetadata(request, target); }
    catch (error) { throw new TransportError(error.message, 'BAD_REFERENCES'); }
    const senderName = sender.name || self.sessionId;
    const senderTitle = this.#titleOf(sender) || senderName;
    const sentAt = new Date().toISOString();
    const base = {
      ...metadata,
      id: randomUUID(),
      // The node name alone cannot tell two agents on one machine apart, so the
      // sender's session id and title ride along for the other nodes' bubbles.
      from: {
        nodeId: this.nodeId,
        name: this.identity?.name ?? '',
        sessionId: self.sessionId,
        title: senderTitle,
      },
      kind: ROOM_MESSAGE_KIND,
      topic: target.name,
      room: target.id,
      text: body,
      sentAt,
    };
    if (file !== null) base.file = file;
    // One record for this node's copy of the conversation: the sender's own
    // message must show up in roomDetail, otherwise the panel renders half a chat.
    await this.#logOutgoing({ ...base, to: this.nodeId }, sentAt);

    const delivered = [];
    // A `@name` in the body picks who this message is for: only the named local
    // members are woken. Without one (or with `@all` / `@大家` / `@所有人`) the
    // room is a shared channel and every other local member hears it. The sender
    // never hears its own words.
    const mentions = mentionsIn(body);
    const isAll = mentions.some((token) => token === 'all' || token === '大家' || token === '所有人');
    const localMembers = membersByNode(target).get(this.nodeId) ?? [];
    const localTargets = metadata.mentions !== undefined
      ? localMembers.filter((member) => member.sessionId !== self.sessionId && metadata.mentions.some((ref) => ref.memberKey === member.key))
      : mentions.length === 0 || isAll
      ? localMembers.filter((member) => member.sessionId !== self.sessionId)
      : localMembers.filter((member) =>
          member.sessionId !== self.sessionId &&
          mentions.some((token) => MeshNode.#namedBy(token, memberLabels(member))));
    for (const member of localTargets) {
      const woken = this.config.autoWake
        ? this.#wakeSession(member.sessionId, roomMessageText(target, senderName, body), self.nodeId)
        : false;
      delivered.push({ nodeId: this.nodeId, name: member.name, ok: true, local: true, woken });
    }

    // Resolve every remote member node first, then deliver in parallel: a dead
    // node must not serialize the fan-out into one 8s timeout per peer.
    const remoteTargets = [];
    for (const [peerNodeId, members] of membersByNode(target)) {
      if (peerNodeId === this.nodeId) continue;
      const peers = this.resolvePeers(peerNodeId);
      if (peers.length === 0) {
        delivered.push({
          nodeId: peerNodeId,
          name: members[0]?.name ?? peerNodeId,
          ok: false,
          error: 'that member node is not visible on the network',
        });
        continue;
      }
      for (const peer of peers) remoteTargets.push(peer);
    }
    const remoteResults = await Promise.all(
      remoteTargets.map(async (peer) => {
        try {
          // Addressed to the node, not to one session: the peer fans out to the
          // members it actually hosts.
          const result = await deliverToPeer({
            address: peer.address,
            port: peer.httpPort,
            envelope: { ...base, to: peer.nodeId },
            secret: this.config.clusterSecret,
          });
          return {
            nodeId: peer.nodeId,
            name: peer.name,
            ok: true,
            deliveredAt: String(result.receipt?.receivedAt ?? ''),
          };
        } catch (error) {
          return { nodeId: peer.nodeId, name: peer.name, ok: false, error: errorText(error) };
        }
      }),
    );
    delivered.push(...remoteResults);
    const room = this.roomsDoc.rooms[target.id] ?? target;
    return { room: this.#roomView(room), delivered };
  }

  /**
   * Anti-entropy: pull every peer's state, merge it locally, push the result back.
   *
   * Pull-then-merge-then-push converges without a leader: the merge is
   * idempotent and commutative, so a node that was offline for a week catches up
   * on the next round. Every failure is a log line, never an exception, because
   * a single-node setup must behave exactly like a networked one.
   * @param {string[]} [peerNodeIds] - restrict the exchange to these nodes.
   * @returns {Promise<{ changed: boolean, synced: object[], pushed: object[] }>}
   */
  syncRooms(peerNodeIds) {
    if (this.closed) return Promise.resolve({ changed: false, synced: [], pushed: [] });
    if (this.roomsSyncPromise) return this.roomsSyncPromise;
    this.roomsSyncPromise = this.#syncRoomsOnce(peerNodeIds).finally(() => { this.roomsSyncPromise = undefined; });
    return this.roomsSyncPromise;
  }

  async #syncRoomsOnce(peerNodeIds) {
    if (!this.started && !this.closed) await this.start();
    await this.#refreshNodeNames();
    const wanted = Array.isArray(peerNodeIds)
      ? peerNodeIds.map((id) => String(id ?? '').trim()).filter((id) => id !== '')
      : [];
    const targets = [];
    if (wanted.length === 0) targets.push(...(this.discovery?.list() ?? []));
    else for (const id of wanted) targets.push(...this.resolvePeers(id));
    if (targets.length === 0) return { changed: false, synced: [], pushed: [] };

    const synced = [];
    let changed = this.roomsDirty;
    for (const peer of targets) {
      try {
        const answer = await pullStateFromPeer({
          address: peer.address,
          port: peer.httpPort,
          secret: this.config.clusterSecret,
          timeoutMs: ROOM_SYNC_TIMEOUT_MS,
          fromNodeId: this.nodeId,
          fromName: this.identity?.name ?? '',
        });
        const merged = mergeStates(this.roomsDoc, answer?.state);
        if (merged.changed) {
          this.roomsDoc = merged.state;
          changed = true;
        }
        synced.push({ nodeId: peer.nodeId, name: peer.name, ok: true });
      } catch (error) {
        this.log(`cannot pull the room state from ${peer.name}`, error);
        synced.push({ nodeId: peer.nodeId, name: peer.name, ok: false, error: errorText(error) });
      }
    }

    const pushed = [];
    if (changed) {
      await this.#saveRooms();
      for (const peer of targets) {
        try {
          // Push to every peer we pulled from as well: it handed us its whole
          // document but has no idea what this node knows, so its merge is the
          // only thing that can teach it our rooms.
          const result = await pushStateToPeer({
            address: peer.address,
            port: peer.httpPort,
            payload: {
              v: PROTOCOL_VERSION,
              id: randomUUID(),
              from: { nodeId: this.nodeId, name: this.identity?.name ?? '' },
              sentAt: new Date().toISOString(),
              state: exportState(this.roomsDoc),
            },
            secret: this.config.clusterSecret,
            timeoutMs: ROOM_SYNC_TIMEOUT_MS,
          });
          pushed.push({ nodeId: peer.nodeId, name: peer.name, ok: true, changed: result?.changed === true });
        } catch (error) {
          this.log(`cannot push the room state to ${peer.name}`, error);
          pushed.push({ nodeId: peer.nodeId, name: peer.name, ok: false, error: errorText(error) });
        }
      }
    }
    // Keep the flag set while any peer missed the document, so the next round
    // retries instead of silently leaving that node behind.
    if (pushed.length > 0 && pushed.every((row) => row.ok)) this.roomsDirty = false;
    return { changed, synced, pushed };
  }

  // -------------------------------------------------------------- internals --

  async #startTeam() {
    if (!this.config.clusterSecret || !this.config.trustedPeers?.length) throw new TransportError('Team requires clusterSecret and trustedPeers', 'AUTH_REQUIRED');
    if (this.config.teamRequestWindowMs !== undefined && (!Number.isSafeInteger(this.config.teamRequestWindowMs) || this.config.teamRequestWindowMs < 1)) throw new TransportError('Invalid Team request time window', 'BAD_CONFIG');
    const store = await openTeamStore({ directory: meshRootDir(this.config.port) });
    this.teamAbort = new AbortController();
    this.team = new TeamCoordinator({
      nodeId: this.nodeId, store,
      leaseMs: this.config.teamLeaseMs, heartbeatMs: this.config.teamHeartbeatMs,
      authorize: request => this.#authorizeTeam(request),
      getRoom: id => this.roomsDoc.rooms[id],
      send: async (target, request) => {
        if (!this.config.trustedPeers.includes(target)) throw new TransportError('Outbound Team peer is not trusted', 'FORBIDDEN');
        const peer = this.resolvePeers(target)[0];
        if (!peer) throw new TransportError('Team peer is offline', 'OFFLINE');
        return sendTeamRequest({ peer, signal: AbortSignal.any([this.teamAbort.signal, AbortSignal.timeout(8000)]), secret: this.config.clusterSecret, request: encodeTeamRequest({ ...request, identity: this.nodeId, target, secret: this.config.clusterSecret }) });
      },
      wake: async ({ executionId, sessionId, task, canStart }) => {
        if (!await this.#authorizeTeam({ operation: 'dispatch', body: task })) return false;
        const scope = this.config.teamAuthorizations.find(row => row.roomId === task.roomId && row.leaderKey === task.leaderKey && row.workerSessionId === sessionId);
        const prompt = [
          `Team 执行 ${executionId}；项目 ${task.roomId}；Leader ${task.leaderKey}。`,
          `任务：${task.title}`, task.detail,
          `授权工作目录：${scope.workspaceRoot}。继续遵守宿主工具权限。`,
          `执行结束后调用 lan_mesh_team_report，executionId="${executionId}"，status=succeeded 或 failed，summary 写结论；进度可用 note 汇报。`,
          '报告成功只表示提交结果，仍等待 Leader 验收。若无法安全完成，请报告失败，不自行重新执行其他任务。',
        ].join('\n');
        const agent = this.agents?.get?.(sessionId);
        if (typeof agent?.followup !== 'function' || !await canStart()) return false;
        await agent.followup({ role: 'user', id: randomUUID(), content: [{ type: 'text', text: prompt }], source: { kind: 'agent-message', form: 'relay', senderSessionId: `lan-mesh:${task.leaderKey.split('/')[0]}` } });
        return true;
      },
    });
    await this.team.recover();
  }

  async #authorizeTeam({ body: b }) {
    if (this.config.teamEnabled !== true || !this.config.clusterSecret || !this.config.trustedPeers?.length) return false;
    if (!b || typeof b.actorKey !== 'string' || typeof b.leaderKey !== 'string') return false;
    const actorNode = b.actorKey.split('/')[0];
    if (actorNode !== this.nodeId && !this.config.trustedPeers.includes(actorNode)) return false;
    if (b.workerKey && !b.workerKey.startsWith(`${this.nodeId}/`) && !this.config.trustedPeers.includes(b.workerKey.split('/')[0])) return false;
    const rows = (this.config.teamAuthorizations ?? []).filter(row => row.roomId === b.roomId && row.leaderKey === b.leaderKey && typeof row.workspaceRoot === 'string' && isAbsolute(row.workspaceRoot));
    if (b.leaderKey.startsWith(`${this.nodeId}/`)) return rows.some(row => row.workerSessionId === '');
    if (!b.workerKey?.startsWith(`${this.nodeId}/`)) return false;
    const sessionId = b.workerKey.slice(this.nodeId.length + 1);
    const row = rows.find(row => row.workerSessionId === sessionId);
    if (!row) return false;
    const local = (await this.catalogueAgents({ peers: false })).agents.find(agent => agent.nodeId === this.nodeId && agent.id === sessionId && agent.live);
    if (!local?.cwd) return false;
    try {
      const root = await realpath(row.workspaceRoot);
      const cwd = await realpath(local.cwd);
      const suffix = relative(root, cwd);
      return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
    } catch { return false; }
  }

  async #receiveTeam({ method, path, headers, bytes }) {
    let response;
    try {
      const request = await verifyTeamRequest({ method, path, headers, bytes, store: this.team.store, policy: {
        nodeId: this.nodeId, secret: this.config.clusterSecret, trustedPeers: this.config.trustedPeers,
        windowMs: this.config.teamRequestWindowMs,
        authorize: request => this.#authorizeTeam(request),
      } });
      response = { ok: true, value: await this.team.handle(request) };
    } catch (error) {
      response = { ok: false, error: { code: error.code ?? 'TEAM_FAILED', message: String(error.message) } };
    }
    return encodeTeamResponse(response, this.config.clusterSecret, String(headers['x-team-nonce'] ?? ''));
  }

  async #teamCaller(request) {
    if (this.config.teamEnabled !== true) throw new TransportError('Team execution is disabled', 'TEAM_DISABLED');
    if (typeof request.sessionId !== 'string' || !request.sessionId) throw new TransportError('Authenticated local session is required', 'BAD_REQUEST');
    await this.#ready();
    if (!this.team) throw new TransportError('Team is unavailable', 'NOT_READY');
    return `${this.nodeId}/${request.sessionId}`;
  }

  async teamCreate(request = {}) {
    const actorKey = await this.#teamCaller(request);
    const room = this.#roomOrThrow(request.roomId);
    if (room.leader?.key !== actorKey) throw new TransportError('Only Room Leader can create Team', 'FORBIDDEN');
    return this.team.create({ roomId: room.id, actorKey });
  }

  async teamDispatch(request = {}) {
    const actorKey = await this.#teamCaller(request);
    return this.team.dispatch({ roomId: request.roomId, actorKey, workerKey: request.workerKey, title: request.title, detail: request.detail ?? '' });
  }

  async teamStatus(request = {}) {
    const actorKey = await this.#teamCaller(request);
    const state = this.team.store.read();
    const room = this.#roomOrThrow(request.roomId);
    if (!room.members?.some(m => m.key === actorKey)) throw new TransportError('Room membership required', 'FORBIDDEN');
    return {
      team: state.teams[room.id] ?? null,
      tasks: Object.values(state.tasks).filter(t => t.roomId === room.id),
      executions: Object.values(state.executions).filter(e => e.roomId === room.id),
      localExecutions: Object.values(state.workerExecutions ?? {}).filter(e => e.descriptor.roomId === room.id && e.descriptor.workerKey === actorKey),
      pendingDelivery: Object.values(state.outbox).filter(e => e.body.roomId === room.id).map(e => ({ executionId: e.body.executionId, operation: e.operation, lastError: e.lastError ?? '' })),
    };
  }

  async teamReport(request = {}) {
    const actorKey = await this.#teamCaller(request);
    const value = await this.team.report({ executionId: request.executionId, actorKey, result: request.status ? { status: request.status, summary: request.summary, artifacts: request.artifacts ?? [] } : undefined, note: request.note });
    await this.team.tick();
    return value;
  }

  async teamReconcile(request = {}) {
    const actorKey = await this.#teamCaller(request);
    const e = this.team.store.read().executions[request.executionId];
    if (!e) throw new TransportError('Unknown Leader execution', 'NOT_FOUND');
    const team = this.team.store.read().teams[e.roomId];
    if (actorKey !== team.leaderKey || request.stopped !== true || typeof request.reason !== 'string' || !request.reason.trim()) throw new TransportError('Leader and explicit stopped confirmation required', 'FORBIDDEN');
    if (!['uncertain', 'cancelled'].includes(e.state)) throw new TransportError('Only uncertain execution can be reconciled', 'INVALID_TRANSITION');
    const body = { roomId: e.roomId, taskId: e.taskId, executionId: e.executionId, generation: e.generation, workerKey: e.workerKey, actorKey, leaderKey: team.leaderKey, stopped: true, reason: request.reason };
    await this.team.allowed(body, 'reconcile');
    await this.team.store.transact(state => {
      if (state.executions[e.executionId].state !== 'cancelled') state = applyTeamCommand(state, { ...body, type: 'reconcile' }).state;
      delete state.outbox[e.executionId];
      state.outbox[`reconcile:${e.executionId}`] = { target: e.workerKey.split('/')[0], operation: 'reconcile', body };
      return { state };
    });
    await this.team.tick();
    return { execution: this.team.store.read().executions[e.executionId], remotePending: Boolean(this.team.store.read().outbox[`reconcile:${e.executionId}`]) };
  }

  /**
   * Load or lazily start the node, then refuse to act without an identity.
   * @returns {Promise<void>}
   */
  async #ready() {
    if (!this.started && !this.closed) await this.start();
    if (this.nodeId === '') throw new TransportError('the mesh node has not started', 'NOT_READY');
  }

  /**
   * Write the room document through the store, never throwing.
   *
   * Every local mutation funnels through here, which is also where the document
   * is marked unreplicated: the merge alone cannot tell a peer about a room this
   * node created, because the node's own copy of the document does not change.
   * @returns {Promise<void>}
   */
  async #saveRooms() {
    this.roomsDirty = true;
    try {
      await saveRoomState(this.roomsDoc, { port: this.config.port });
    } catch (error) {
      // A read-only $DSH_HOME must not take the node down; the in-memory document
      // is still correct for this lifetime.
      this.log('cannot save the room state', error);
    }
  }

  /** Persist this machine's current display name without changing member identity. */
  async #refreshNodeNames() {
    const name = this.identity?.name ?? '';
    if (!name) return;
    let changed = false;
    for (const room of Object.values(this.roomsDoc.rooms)) {
      for (const member of [room.leader, ...room.members]) {
        if (!member || member.nodeId !== this.nodeId || member.nodeName === name) continue;
        const previous = Date.parse(member.nodeNameUpdatedAt ?? '');
        member.nodeName = name;
        member.nodeNameUpdatedAt = new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
        changed = true;
      }
    }
    if (changed) await this.#saveRooms();
  }

  /**
   * The member record for one session on this node.
   * @param {unknown} sessionId - agent session id.
   * @param {unknown} [name] - display name for that session.
   * @returns {{ nodeId: string, sessionId: string, name: string, key: string }}
   */
  #selfMember(sessionId, name) {
    const id = String(sessionId ?? '').trim();
    if (id === '') throw new TransportError('sessionId is required', 'BAD_REQUEST');
    const display = String(name ?? '').trim();
    // The human has no session of its own, so "human" alone would show up in a
    // member list as a stranger. A name the person chose for themselves wins; the
    // machine name is the fallback so it still reads as "you, on this box".
    const chosen = id === HUMAN_SESSION_ID ? this.nicknames?.self ?? '' : '';
    const fallback = id === HUMAN_SESSION_ID ? chosen || this.identity?.name || id : id;
    return {
      nodeId: this.nodeId,
      sessionId: id,
      nodeName: this.identity?.name ?? '',
      name: display === '' ? fallback : display,
      key: memberKey(this.nodeId, id),
    };
  }

  /**
   * Resolve a caller-supplied room handle, or reject with a stable code.
   *
   * Two nodes may create a project with the same human name, so a name that
   * matches more than one room is ambiguous rather than simply wrong: refusing
   * it with the candidate ids is the only answer that cannot touch the wrong
   * project.
   * @param {unknown} reference - room id or name.
   * @returns {object} normalized room.
   */
  #roomOrThrow(reference) {
    const value = String(reference ?? '');
    const room = findRoom(this.roomsDoc, value);
    if (room === undefined) throw new TransportError(`unknown room "${value}"`, 'UNKNOWN_ROOM');
    if (room.id !== value) {
      const lowered = value.toLowerCase();
      const matches = Object.values(this.roomsDoc.rooms ?? {}).filter(
        (item) => item.deleted !== true && item.name.toLowerCase() === lowered,
      );
      if (matches.length > 1) {
        const choices = matches.map((item) => `${item.name}（id ${item.id}）`).join('、');
        throw new TransportError(
          `房间名「${value}」对应 ${matches.length} 个房间：${choices}。请改用房间 id 指定。`,
          'AMBIGUOUS_ROOM',
        );
      }
    }
    return room;
  }

  /**
   * Public projection of one room.
   * @param {object} room - normalized room.
   * @returns {object}
   */
  #roomView(room) {
    const peers = new Set((this.discovery?.list() ?? []).map((peer) => peer.nodeId));
    const live = (member) => {
      if (member.nodeId !== this.nodeId) return peers.has(member.nodeId);
      // A local member is only "online" when its session is actually running;
      // the human member has no agent at all, so it counts as present whenever
      // the panel is looking at it.
      if (member.sessionId === HUMAN_SESSION_ID) return true;
      return this.#liveAgentId(member.sessionId) !== '';
    };
    const view = (member) => memberView({
      ...member,
      nodeName: member.nodeId === this.nodeId ? this.identity?.name || member.nodeName || member.nodeId
        : (this.discovery?.list() ?? []).find((peer) => peer.nodeId === member.nodeId)?.name || member.nodeName || member.nodeId,
    }, live(member), this.#titleOf(member));
    return {
      id: room.id,
      name: room.name,
      topic: room.topic,
      leader: room.leader === undefined ? undefined : view(room.leader),
      members: room.members.map(view),
      memberCount: room.members.length,
      tasks: room.tasks
        .filter((task) => task.deleted !== true)
        .map((task) => ({
          ...taskView(task, (member) => this.#titleOf(member)),
          assignee: memberView(task.assignee, live(task.assignee), this.#titleOf(task.assignee)),
          assigner: memberView(task.assigner, live(task.assigner), this.#titleOf(task.assigner)),
        })),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  /**
   * The title a session gave itself, or `''` when it has none yet.
   *
   * Only sessions hosted on this node can answer: the title lives in that
   * session's log, and folding a stored log for every member on every snapshot
   * would be far more expensive than the id it replaces. Remote members report
   * their own title through the agents endpoint instead.
   * @param {{ nodeId?: string, sessionId?: string }} member - room member.
   * @returns {string}
   */
  #titleOf(member) {
    const sessionId = typeof member?.sessionId === 'string' ? member.sessionId : '';
    const nodeId = typeof member?.nodeId === 'string' ? member.nodeId : '';
    // A nickname is what the person in front of this screen decided to call the
    // member, so it outranks the session's own title and works for a human or a
    // remote peer that cannot report a title at all.
    const nick = this.#nickOf(member);
    if (nick !== '') return nick;
    // The local human member uses the self-nickname if set, otherwise falls
    // back to the member's stored name (which is the display name they joined
    // with). This way "我" / human members show a readable label everywhere
    // — member chips, message bubbles, the mention picker — instead of the
    // raw node name or the literal string "human".
    if (sessionId === HUMAN_SESSION_ID && nodeId === this.nodeId) {
      const selfName = this.nicknames?.self ?? '';
      if (selfName !== '') return selfName;
      return typeof member.name === 'string' && member.name !== '' ? member.name : (this.identity?.name ?? '');
    }
    if (sessionId === '' || sessionId === HUMAN_SESSION_ID) return '';
    if (member.nodeId !== undefined && member.nodeId !== this.nodeId) return '';
    const projections = this.getSessionProjections?.();
    const session = this.agents?.get?.(this.#liveAgentId(sessionId))?.session;
    if (projections === undefined || session === undefined) return '';
    if (typeof projections.stateOf !== 'function') return '';
    let value;
    try {
      value = projections.stateOf(session, 'title');
    } catch (error) {
      this.log('cannot read a session title', error);
      return '';
    }
    return typeof value === 'string' ? value : '';
  }

  /**
   * The local nickname for one member, or `''` when none was set.
   * @param {{ nodeId?: string, sessionId?: string, key?: string }} member - room member.
   * @returns {string}
   */
  #nickOf(member) {
    const key =
      typeof member?.key === 'string' && member.key !== ''
        ? member.key
        : member?.nodeId !== undefined && member?.sessionId !== undefined
          ? memberKey(member.nodeId, member.sessionId)
          : '';
    if (key === '') return '';
    return this.nicknames?.members?.[key] ?? '';
  }

  /**
   * Display name for one node, for resolving a member by node name.
   * @param {string} nodeId - node to name.
   * @returns {string}
   */
  #nameOf(nodeId) {
    if (nodeId === this.nodeId) return this.identity?.name ?? '';
    const peer = (this.discovery?.list() ?? []).find((item) => item.nodeId === nodeId);
    return peer?.name ?? nodeId;
  }

  /**
   * Record one message this node sent into the conversation log.
   * @param {object} envelope - the envelope that was (or would be) sent.
   * @param {string} sentAt - ISO timestamp.
   * @returns {Promise<void>}
   */
  async #logOutgoing(envelope, sentAt) {
    // Still unread on purpose: "read" is a node-wide flag, and another session on
    // this same node may be the one the message names. The sender's own copy is
    // skipped by the mention/task predicates (see `#waitsOn`), not by this flag —
    // marking it read here used to hide a local agent's reply from the person.
    this.messages.push(this.#record(envelope, sentAt, false));
    if (this.messages.length > MEMORY_LIMIT) this.messages.splice(0, this.messages.length - MEMORY_LIMIT);
    try {
      await appendInbox({ envelope, receivedAt: sentAt, read: false }, { port: this.config.port });
    } catch (error) {
      this.log('cannot append to the inbox log', error);
    }
  }

  /**
   * Does one logged message wait on the session that is looking?
   *
   * Three things have to hold: it names this session (`@`) or hands it a task,
   * it is not this session's own echo, and the session has not already looked at
   * it. The echo check is what keeps a session from being notified about itself —
   * the read flag alone cannot do it, because the flag is per node.
   * @param {object} item - logged message.
   * @param {Set<string>} labels - names the looking session answers to.
   * @param {string} address - `nodeId/sessionId` of the looking session.
   * @param {string} sessionId - the looking session.
   * @returns {boolean}
   */
  #waitsOn(item, labels, address, sessionId) {
    if (item.read === true) return false;
    const from = item.from ?? {};
    if (from.nodeId === this.nodeId && sessionId !== '' && (from.sessionId === sessionId || (address !== '' && this.#roomCallerKey(from.sessionId) === address))) return false;
    const named = item.structuredMentions !== undefined
      ? item.structuredMentions.some((ref) => ref.memberKey === address)
      : item.mentions.some((token) => MeshNode.#namedBy(token, labels));
    const assigned = address !== '' && item.kind === ROOM_TASK_KIND && item.to === address;
    return named || assigned;
  }

  /**
   * Hand one task to its assignee, locally or over the wire.
   * @param {object} room - room the task belongs to.
   * @param {object} assignee - normalized member that owns the task.
   * @param {object} task - the created task.
   * @returns {Promise<object[]>} one delivery row per attempt.
   */
  async #deliverTask(room, assignee, task) {
    const text = roomTaskText(room, task);
    const envelope = {
      id: randomUUID(),
      from: { nodeId: this.nodeId, name: this.identity?.name ?? '' },
      to: `${assignee.nodeId}/${assignee.sessionId}`,
      kind: ROOM_TASK_KIND,
      topic: room.name,
      room: room.id,
      text,
      sentAt: new Date().toISOString(),
    };
    if (assignee.nodeId === this.nodeId) {
      await this.#logOutgoing(envelope, envelope.sentAt);
      const woken = this.config.autoWake
        ? this.#wakeSession(assignee.sessionId, text, this.nodeId)
        : false;
      return [{ nodeId: this.nodeId, name: assignee.name, ok: true, local: true, woken }];
    }
    const peers = this.resolvePeers(assignee.nodeId);
    if (peers.length === 0) {
      return [{
        nodeId: assignee.nodeId,
        name: assignee.name,
        ok: false,
        error: 'the assignee node is not visible on the network; it will learn the task on the next sync',
      }];
    }
    const rows = [];
    for (const peer of peers) {
      try {
        const result = await deliverToPeer({
          address: peer.address,
          port: peer.httpPort,
          envelope: { ...envelope, to: `${peer.nodeId}/${assignee.sessionId}` },
          secret: this.config.clusterSecret,
        });
        rows.push({
          nodeId: peer.nodeId,
          name: assignee.name,
          ok: true,
          deliveredAt: String(result.receipt?.receivedAt ?? ''),
        });
      } catch (error) {
        rows.push({ nodeId: peer.nodeId, name: peer.name, ok: false, error: errorText(error) });
      }
    }
    return rows;
  }

  /**
   * Apply one state exchange pushed by a peer, or answer a pull.
   * @param {object} payload - normalized state payload from the transport.
   * @returns {Promise<{ changed: boolean, state?: object }>}
   */
  async #onState(payload) {
    const value = payload !== null && typeof payload === 'object' ? payload : {};
    if (value.pull === true || value.state === undefined) {
      return { state: exportState(this.roomsDoc), changed: false };
    }
    const merged = mergeStates(this.roomsDoc, value.state);
    if (merged.changed) {
      this.roomsDoc = merged.state;
      await this.#saveRooms();
    }
    return { changed: merged.changed };
  }

  /**
   * Answer a peer's agent listing.
   *
   * Only locally known rows are advertised: a peer asking "who do you host" must
   * not receive this node's view of some third node, or a stale entry would look
   * like an agent that can be dialled but cannot.
   * @returns {Promise<object[]>} this node's rows.
   */
  async #onAgents() {
    const local = await this.catalogueAgents({ peers: false });
    return local.agents;
  }

  /**
   * Build the presentation record kept in memory and on disk.
   * @param {object} envelope - admitted envelope.
   * @param {string} receivedAt - ISO timestamp.
   * @param {boolean} read - whether the record was already read.
   * @returns {object}
   */
  #record(envelope, receivedAt, read) {
    return {
      id: envelope.id,
      receivedAt,
      read,
      from: {
        nodeId: envelope.from?.nodeId ?? '',
        name: envelope.from?.name ?? '',
        sessionId: envelope.from?.sessionId ?? '',
        title: envelope.from?.title ?? '',
      },
      to: envelope.to ?? '*',
      kind: envelope.kind ?? 'note',
      topic: envelope.topic ?? '',
      room: typeof envelope.room === 'string' ? envelope.room : '',
      text: envelope.text ?? '',
      // Attachments ride the envelope as base64 (`data`), so the bubble has to
      // keep them here or roomDetail would render every message without the
      // file the sender just attached.
      ...(isFileAttachment(envelope.file) ? { file: normalizeFile(envelope.file) } : {}),
      // Recomputed on load from the body, so the log needs no extra field.
      mentions: mentionsIn(envelope.text),
      ...(envelope.mentions === undefined ? {} : { structuredMentions: envelope.mentions }),
      ...(envelope.skillRefs === undefined ? {} : { skillRefs: envelope.skillRefs }),
    };
  }

  /**
   * Wake every session on this node that belongs to the room a message targets.
   * @param {object} envelope - admitted `room-message` envelope.
   * @returns {boolean} whether at least one turn was requested.
   */
  #wakeRoom(envelope) {
    if (typeof envelope.room !== 'string' || envelope.room === '') return false;
    const room = findRoom(this.roomsDoc, envelope.room);
    if (room === undefined) {
      // Two nodes can see a room at slightly different times; a message for a
      // room this node has not merged yet is still stored, just not delivered.
      this.log(`dropped a wake-up for ${envelope.room}: that room is not known on this node yet`);
      return false;
    }
    const fromName = envelope.from?.name || envelope.from?.nodeId || 'a LAN peer';
    const text = roomMessageText(room, fromName, envelope.text ?? '');
    // A typed `@name` picks who this message is for. When it names at least one
    // member on this node, only those members are woken; otherwise the room is
    // a shared channel and everyone on this node hears it (the pre-mention
    // behaviour). `@all` / `@大家` / `@所有人` deliberately match nothing here so
    // the message still fans out to everyone.
    const mentions = mentionsIn(envelope.text ?? '');
    const members = membersByNode(room).get(this.nodeId) ?? [];
    // The sender may be one of our own members (the human at this screen). It
    // must never be woken by its own words, and a same-node sender must not
    // erase every other member from the target list by a node-id comparison.
    const senderKey = [
      typeof envelope.from?.nodeId === 'string' ? envelope.from.nodeId : '',
      typeof envelope.from?.sessionId === 'string' ? envelope.from.sessionId : '',
    ].join('/');
    const isAll = mentions.some((token) => token === 'all' || token === '大家' || token === '所有人');
    const notSender = (member) => `${member.nodeId}/${member.sessionId}` !== senderKey;
    const targets = envelope.mentions !== undefined
      ? members.filter((member) => notSender(member) && envelope.mentions.some((ref) => ref.memberKey === member.key))
      : mentions.length === 0 || isAll
      ? members.filter(notSender)
      : members.filter((member) => notSender(member) &&
          mentions.some((token) => MeshNode.#namedBy(token, memberLabels(member))));
    const fallback = envelope.mentions === undefined && mentions.length > 0 && !isAll && targets.length === 0
      ? members.filter(notSender)
      : targets;
    let woken = false;
    for (const member of fallback) {
      if (this.#wakeSession(member.sessionId, text, envelope.from?.nodeId ?? '')) woken = true;
    }
    return woken;
  }

  /**
   * Wake the agent a message is addressed to, or the last agent that used this node.
   * @param {object} envelope - admitted envelope.
   * @returns {boolean} whether a turn was actually requested.
   */
  #wake(envelope) {
    try {
      const agents = this.agents;
      if (!agents || typeof agents.get !== 'function') return false;
      const sessionPart = typeof envelope.to === 'string' && envelope.to.includes('/')
        ? envelope.to.slice(envelope.to.indexOf('/') + 1)
        : '';
      const targetId = sessionPart !== '' ? sessionPart : this.focusAgentId;
      if (targetId === '') return false;
      const from = envelope.from?.name || envelope.from?.nodeId || 'a LAN peer';
      const header = envelope.topic ? `（${envelope.topic}）` : '';
      const text = [
        `来自局域网节点 ${from} 的消息${header}：`,
        '',
        envelope.text,
        '',
        '请判断是否需要回复；需要回复时使用 lan_mesh_send，目标写该节点名称或 nodeId。',
      ].join('\n');
      return this.#wakeSession(targetId, text, envelope.from?.nodeId ?? '');
    } catch (error) {
      this.log('cannot wake the target agent', error);
      return false;
    }
  }

  /**
   * Resolve a session id to the exact live agent id the Host registry indexes.
   *
   * Room members store a 64-char trim of a session id (rooms.mjs keeps id
   * fields bounded), while the Host's live registry keys agents by their full
   * id. An agent-team recycle/rollover session id is 83+ chars, so a trim is a
   * strict prefix of the full id and no longer matches. Anything at or under
   * the trim length matches itself. When the trim is not a live id on its own,
   * a lookup among the live sessions that starts with it is the only way back —
   * a unique prefix match recovers the full id; a shared prefix stays unknown
   * rather than wake the wrong agent.
   * @param {unknown} sessionId - stored or caller-supplied session id.
   * @returns {string} the exact live id, or '' when nothing matches.
   */
  #liveAgentId(sessionId) {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (id === '') return '';
    const agents = this.agents;
    if (!agents || typeof agents.get !== 'function' || typeof agents.list !== 'function') return '';
    if (agents.get(id) !== undefined) return id;
    let best = '';
    try {
      for (const agent of agents.list()) {
        const liveId = typeof agent?.id === 'string' ? agent.id.trim() : '';
        if (liveId === '' || liveId === id) continue;
        if (!liveId.startsWith(id)) continue;
        // agent-team recycle ids reuse the first 64 chars across sessions; a
        // shared prefix cannot be resolved to one id, so it stays unknown.
        if (best !== '' && best !== liveId) return '';
        best = liveId;
      }
    } catch (error) {
      this.log('cannot list live agents to resolve a session id', error);
    }
    return best;
  }

  /**
   * Request one turn from a locally hosted session.
   *
   * The `source` shape is frozen: old session logs already contain it, and a new
   * `kind` would fail their migration.
   * @param {string} sessionId - agent session to wake.
   * @param {string} text - user-visible prompt.
   * @param {string} fromNodeId - node the message came from, or '' when local.
   * @returns {boolean} whether a turn was requested.
   */
  #wakeSession(sessionId, text, fromNodeId) {
    const probe = (detail) => this.log('agent wake', detail);
    try {
      probe(`wake(${sessionId}) text=${JSON.stringify(String(text).slice(0, 40))}`);
      const agents = this.agents;
      if (!agents || typeof agents.get !== 'function') {
        probe('no agents service');
        return false;
      }
      const id = this.#liveAgentId(sessionId);
      probe(`liveAgentId(${sessionId}) => ${id}`);
      if (id === '') {
        probe('not live');
        return false;
      }
      const agent = agents.get(id);
      probe(`agents.get(${id}) => agent=${agent === undefined ? 'undefined' : `ok status=${String(agent.status)} followup=${typeof agent.followup}`}`);
      if (agent === undefined || typeof agent.followup !== 'function') {
        probe('no followup');
        return false;
      }
      agent.followup({
        role: 'user',
        id: randomUUID(),
        content: [{ type: 'text', text }],
        source: {
          kind: 'agent-message',
          form: 'relay',
          senderSessionId: `lan-mesh:${fromNodeId === '' ? 'unknown' : fromNodeId}`,
        },
      });
      probe(`followup called for ${id}`);
      return true;
    } catch (error) {
      probe(`wake error: ${String(error?.message ?? error)}`);
      this.log('cannot wake the target agent', error);
      return false;
    }
  }
}
