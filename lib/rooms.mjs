/**
 * Rooms: the project layer above the mesh transport.
 *
 * A node discovers peers; a room is what people actually work in. One room is
 * one project: it has a leader who hands out tasks, and members — agent sessions
 * that may live on any node in the mesh. Membership and task state are replicated
 * between nodes by anti-entropy: every node keeps a full copy, merges what it
 * hears, and the merge rules are commutative so the copies converge no matter
 * who talks to whom first.
 *
 * Everything here is pure state transformation over plain objects. No sockets,
 * no timers, no disk: the service owns those, which keeps the merge rules
 * testable on their own.
 *
 * @module dsh-lan-mesh/lib/rooms
 */

/** Version of the room document written to disk and shared between nodes. */
export const ROOM_STATE_VERSION = 1;
/** Longest accepted room name, in characters. */
export const MAX_ROOM_NAME = 80;
/** Longest accepted task title, in characters. */
export const MAX_TASK_TITLE = 200;
/** Longest accepted task detail, in characters. */
export const MAX_TASK_DETAIL = 4_000;
/** How many tasks one room keeps before the oldest finished ones are dropped. */
export const MAX_TASKS_PER_ROOM = 200;
/** How many rooms one node keeps. */
export const MAX_ROOMS = 100;
/** Task statuses, in the order they progress. */
export const TASK_STATUSES = ['open', 'doing', 'blocked', 'done'];
/** Longest accepted room id, matching the node id shape. */
const ROOM_ID_PATTERN = /^room-[a-z0-9][a-z0-9-]{3,59}$/;
/** Longest accepted member/task id. */
const ID_LIMIT = 64;

/**
 * The empty replicated state.
 * @returns {{ version: number, rooms: Record<string, object> }}
 */
export function emptyState() {
  return { version: ROOM_STATE_VERSION, rooms: {} };
}

/**
 * Collapse arbitrary text into one clean line.
 * @param {unknown} value - untrusted input.
 * @param {number} limit - maximum length.
 * @returns {string}
 */
function clean(value, limit) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/**
 * Collapse arbitrary text but keep paragraph breaks, for task details.
 * @param {unknown} value - untrusted input.
 * @param {number} limit - maximum length.
 * @returns {string}
 */
function cleanBlock(value, limit) {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/**
 * The key identifying one agent session inside a room.
 *
 * A person may join the same project from two sessions on two machines, so a
 * member is a node/session pair and never just a person's name.
 * @param {string} nodeId - node the session lives on.
 * @param {string} sessionId - the agent's session id.
 * @returns {string}
 */
export function memberKey(nodeId, sessionId) {
  return `${nodeId}/${sessionId}`;
}

/**
 * Normalize one member record.
 * @param {object} raw - candidate member.
 * @returns {{ nodeId: string, sessionId: string, name: string, role: string, joinedAt: string, key: string } | undefined}
 */
function normalizeMember(raw) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const nodeId = clean(raw.nodeId, ID_LIMIT);
  const sessionId = clean(raw.sessionId, ID_LIMIT);
  if (nodeId === '' || sessionId === '') return undefined;
  const role = raw.role === 'leader' ? 'leader' : 'member';
  return {
    nodeId,
    sessionId,
    name: clean(raw.name, 64) || sessionId,
    role,
    joinedAt: typeof raw.joinedAt === 'string' ? raw.joinedAt : new Date(0).toISOString(),
    key: memberKey(nodeId, sessionId),
  };
}

/**
 * Normalize one task record.
 * @param {object} raw - candidate task.
 * @returns {object | undefined}
 */
function normalizeTask(raw) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const id = clean(raw.id, ID_LIMIT);
  const title = clean(raw.title, MAX_TASK_TITLE);
  if (id === '' || title === '') return undefined;
  const assignee = normalizeMember(raw.assignee);
  if (assignee === undefined) return undefined;
  const status = TASK_STATUSES.includes(raw.status) ? raw.status : 'open';
  return {
    id,
    title,
    detail: cleanBlock(raw.detail, MAX_TASK_DETAIL),
    assignee,
    assigner: normalizeMember(raw.assigner) ?? assignee,
    status,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    deleted: raw.deleted === true,
  };
}

/**
 * Normalize one room record, dropping members and tasks that do not validate.
 * @param {object} raw - candidate room.
 * @returns {object | undefined}
 */
function normalizeRoom(raw) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const id = clean(raw.id, ID_LIMIT);
  const name = clean(raw.name, MAX_ROOM_NAME);
  if (!ROOM_ID_PATTERN.test(id) || name === '') return undefined;
  // Departures are tombstones: a merge unions members, so without a record of
  // when someone left, a peer that still lists them would keep re-adding them.
  const left = {};
  if (raw.left !== null && typeof raw.left === 'object') {
    for (const [key, at] of Object.entries(raw.left)) {
      const memberKeyValue = clean(key, ID_LIMIT * 2 + 1);
      if (memberKeyValue === '' || !memberKeyValue.includes('/')) continue;
      if (typeof at !== 'string' || at === '') continue;
      left[memberKeyValue] = at;
    }
  }
  const members = [];
  const seen = new Set();
  if (Array.isArray(raw.members)) {
    for (const item of raw.members) {
      const member = normalizeMember(item);
      if (member === undefined || seen.has(member.key)) continue;
      // Someone who left after they joined is gone until they join again.
      const departed = left[member.key];
      if (departed !== undefined && departed >= member.joinedAt) continue;
      seen.add(member.key);
      members.push(member);
    }
  }
  const tasks = [];
  const taskIds = new Set();
  if (Array.isArray(raw.tasks)) {
    for (const item of raw.tasks) {
      const task = normalizeTask(item);
      if (task === undefined || taskIds.has(task.id)) continue;
      taskIds.add(task.id);
      tasks.push(task);
    }
  }
  return {
    id,
    name,
    topic: clean(raw.topic, 200),
    leader: normalizeMember(raw.leader),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    deleted: raw.deleted === true,
    members,
    left,
    tasks,
  };
}

/**
 * Normalize a whole state document, as received from disk or from a peer.
 * @param {unknown} raw - untrusted document.
 * @returns {{ version: number, rooms: Record<string, object> }}
 */
export function normalizeState(raw) {
  const state = emptyState();
  if (raw === null || typeof raw !== 'object') return state;
  const rooms = /** @type {Record<string, unknown>} */ (raw).rooms;
  if (rooms === null || typeof rooms !== 'object') return state;
  for (const value of Object.values(rooms)) {
    const room = normalizeRoom(value);
    if (room === undefined) continue;
    state.rooms[room.id] = room;
  }
  return state;
}

/**
 * Resolve a timestamp, falling back to now when the input is unusable.
 * @param {unknown} value - ISO string or Date.
 * @param {string} [fallback] - timestamp to use when absent.
 * @returns {string}
 */
function stamp(value, fallback) {
  if (typeof value === 'string' && value !== '') return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return fallback ?? new Date().toISOString();
}

/**
 * Pick the earlier of two ISO timestamps.
 * @param {string} left - first timestamp.
 * @param {string} right - second timestamp.
 * @returns {string}
 */
function earliest(left, right) {
  return left <= right ? left : right;
}

/**
 * Pick the later of two ISO timestamps.
 * @param {string} left - first timestamp.
 * @param {string} right - second timestamp.
 * @returns {string}
 */
function latest(left, right) {
  return left >= right ? left : right;
}

/**
 * Build a fresh room id.
 * @param {() => string} randomUuid - uuid source, injected for tests.
 * @returns {string}
 */
function newRoomId(randomUuid) {
  return `room-${randomUuid().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Create a room and make the caller its leader.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {object} input - room definition.
 * @param {string} input.name - room name, also the join handle for humans.
 * @param {string} [input.topic] - what the project is about.
 * @param {{ nodeId: string, sessionId: string, name?: string }} input.leader - creating session.
 * @param {() => string} randomUuid - uuid source.
 * @param {string} [now] - ISO timestamp.
 * @returns {object} the created room.
 */
export function createRoom(state, input, randomUuid, now) {
  const at = stamp(now);
  const name = clean(input.name, MAX_ROOM_NAME);
  if (name === '') throw new Error('room name is required');
  if (Object.keys(state.rooms).length >= MAX_ROOMS) throw new Error(`at most ${MAX_ROOMS} rooms are supported`);
  let id = newRoomId(randomUuid);
  while (state.rooms[id] !== undefined) id = newRoomId(randomUuid);
  const leader = {
    nodeId: clean(input.leader?.nodeId, ID_LIMIT),
    sessionId: clean(input.leader?.sessionId, ID_LIMIT),
    name: clean(input.leader?.name, 64) || clean(input.leader?.sessionId, ID_LIMIT),
    role: 'leader',
    joinedAt: at,
  };
  if (leader.nodeId === '' || leader.sessionId === '') throw new Error('a leader session is required');
  const room = {
    id,
    name,
    topic: clean(input.topic, 200),
    leader: { ...leader, key: memberKey(leader.nodeId, leader.sessionId) },
    createdAt: at,
    updatedAt: at,
    deleted: false,
    members: [{ ...leader, key: memberKey(leader.nodeId, leader.sessionId) }],
    left: {},
    tasks: [],
  };
  state.rooms[id] = room;
  return room;
}

/**
 * Find a room by id, or by name when the caller typed a human name.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state.
 * @param {string} reference - room id or name.
 * @returns {object | undefined}
 */
export function findRoom(state, reference) {
  const value = clean(reference, MAX_ROOM_NAME);
  if (value === '') return undefined;
  const direct = state.rooms[value];
  if (direct !== undefined && direct.deleted !== true) return direct;
  const lowered = value.toLowerCase();
  return Object.values(state.rooms).find(
    (room) => room.deleted !== true && room.name.toLowerCase() === lowered,
  );
}

/**
 * Add one session to a room.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room being joined.
 * @param {{ nodeId: string, sessionId: string, name?: string }} member - joining session.
 * @param {string} [now] - ISO timestamp.
 * @returns {{ room: object, added: boolean }}
 */
export function joinRoom(state, roomId, member, now) {
  const at = stamp(now);
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) throw new Error(`unknown room ${roomId}`);
  const normalized = normalizeMember({ ...member, role: 'member', joinedAt: at });
  if (normalized === undefined) throw new Error('a joining session needs a node and a session id');
  if (room.leader !== undefined && room.leader.key === normalized.key) return { room, added: false };
  if (room.members.some((item) => item.key === normalized.key)) return { room, added: false };
  // Re-joining after a departure clears the tombstone, even if the clocks of the
  // two nodes disagree about which happened first.
  if (room.left !== undefined) delete room.left[normalized.key];
  room.members.push(normalized);
  room.updatedAt = at;
  return { room, added: true };
}

/**
 * Add an arbitrary member to a room, for the leader who pulls a local agent in.
 *
 * Same shape as `joinRoom`, but the joining member is supplied by the leader
 * rather than the calling session. The member must be hosted on this node: the
 * leader can only reach into sessions it already has.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room being joined.
 * @param {{ nodeId: string, sessionId: string, name?: string }} member - member being added.
 * @param {string} [now] - ISO timestamp.
 * @returns {{ room: object, added: boolean }}
 */
export function addMember(state, roomId, member, now) {
  const at = stamp(now);
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) throw new Error(`unknown room ${roomId}`);
  const normalized = normalizeMember({ ...member, role: 'member', joinedAt: at });
  if (normalized === undefined) throw new Error('a member needs a node and a session id');
  if (room.leader !== undefined && room.leader.key === normalized.key) return { room, added: false };
  if (room.members.some((item) => item.key === normalized.key)) return { room, added: false };
  if (room.left !== undefined) delete room.left[normalized.key];
  room.members.push(normalized);
  room.updatedAt = at;
  return { room, added: true };
}

/**
 * Remove one session from a room. The leader cannot leave its own room.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room being left.
 * @param {string} key - member key.
 * @param {string} [now] - ISO timestamp.
 * @returns {boolean} whether a member was removed.
 */
export function leaveRoom(state, roomId, key, now) {
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) return false;
  if (room.leader !== undefined && room.leader.key === key) throw new Error('the leader cannot leave the room it created');
  const before = room.members.length;
  room.members = room.members.filter((item) => item.key !== key);
  if (room.members.length === before) return false;
  const at = stamp(now);
  if (room.left === undefined) room.left = {};
  // The tombstone must never precede the join it cancels, otherwise a peer
  // whose clock runs ahead would resurrect the member on the next merge.
  const member = room.members.find((item) => item.key === key);
  room.left[key] = member === undefined ? at : latest(at, member.joinedAt);
  room.updatedAt = at;
  return true;
}

/**
 * Kick one member out of a room. Only the room leader may do it, and the
 * leader itself cannot be kicked. The tombstone semantics match `leaveRoom`,
 * so a kicked member stays out across peer merges until it joins again.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room the member is being kicked from.
 * @param {string} key - member key of the removed member.
 * @param {string} actorKey - member key of the leader acting.
 * @param {string} [now] - ISO timestamp.
 * @returns {boolean} whether a member was removed.
 */
export function removeMember(state, roomId, key, actorKey, now) {
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) return false;
  if (room.leader === undefined || room.leader.key !== actorKey) {
    throw new Error('only the room leader can remove a member');
  }
  if (key === actorKey) throw new Error('the leader cannot remove itself');
  const before = room.members.length;
  room.members = room.members.filter((item) => item.key !== key);
  if (room.members.length === before) return false;
  const at = stamp(now);
  if (room.left === undefined) room.left = {};
  const member = room.members.find((item) => item.key === key);
  room.left[key] = member === undefined ? at : latest(at, member.joinedAt);
  room.updatedAt = at;
  return true;
}

/**
 * Add one task to a room.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room the task belongs to.
 * @param {object} input - task definition.
 * @param {{ nodeId: string, sessionId: string, name?: string }} input.assignee - session that owns the task.
 * @param {{ nodeId: string, sessionId: string, name?: string }} input.assigner - session that handed it out.
 * @param {string} input.title - one-line task title.
 * @param {string} [input.detail] - what to do, in full.
 * @param {() => string} randomUuid - uuid source.
 * @param {string} [now] - ISO timestamp.
 * @returns {object} the created task.
 */
export function assignTask(state, roomId, input, randomUuid, now) {
  const at = stamp(now);
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) throw new Error(`unknown room ${roomId}`);
  const title = clean(input.title, MAX_TASK_TITLE);
  if (title === '') throw new Error('task title is required');
  const assignee = normalizeMember(input.assignee);
  const assigner = normalizeMember(input.assigner);
  if (assignee === undefined || assigner === undefined) throw new Error('both assignee and assigner sessions are required');
  // A task id doubles as the merge key, so a repeated id would make two tasks
  // overwrite each other and let a trim drop unrelated work. Regenerate instead.
  const taken = new Set(room.tasks.map((item) => item.id));
  let id = `task-${randomUuid().replace(/-/g, '').slice(0, 12)}`;
  while (taken.has(id)) id = `task-${randomUuid().replace(/-/g, '').slice(0, 12)}`;
  const task = {
    id,
    title,
    detail: cleanBlock(input.detail, MAX_TASK_DETAIL),
    assignee: { ...assignee, key: assignee.key },
    assigner: { ...assigner, key: assigner.key },
    status: 'open',
    createdAt: at,
    updatedAt: at,
    deleted: false,
  };
  room.tasks.push(task);
  if (room.tasks.length > MAX_TASKS_PER_ROOM) {
    // Finished tasks are the first to go: an open task is still someone's work.
    const finished = room.tasks.filter((item) => item.status === 'done' || item.deleted === true);
    const drop = new Set(finished.slice(0, room.tasks.length - MAX_TASKS_PER_ROOM).map((item) => item.id));
    if (drop.size > 0) room.tasks = room.tasks.filter((item) => !drop.has(item.id));
  }
  room.updatedAt = at;
  return task;
}

/**
 * Resolve one task handle to a task.
 *
 * A handle is a task id or an exact title. Titles are not unique — two sessions
 * can legitimately record the same one-line task in one room — so an ambiguous
 * title is refused with the candidate ids rather than silently acting on the
 * first match. Acting on the wrong task is worse than asking again: the update
 * would land on a task the caller never named, and the caller would only find
 * out by re-reading the room.
 * @param {object} room - room whose tasks are searched.
 * @param {string} reference - task id or exact title.
 * @returns {object} the resolved task.
 */
export function resolveTask(room, reference) {
  const wanted = clean(reference, MAX_TASK_TITLE);
  const byId = room.tasks.find((item) => item.id === wanted);
  if (byId !== undefined) return byId;
  const lowered = wanted.toLowerCase();
  const matches = wanted === '' ? [] : room.tasks.filter((item) => item.title.toLowerCase() === lowered);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`unknown task ${JSON.stringify(wanted)}`);
  const choices = matches.map((item) => `${item.id}（${item.status}）`).join('、');
  const error = new Error(
    `任务标题「${wanted}」在这个房间里对应 ${matches.length} 个任务：${choices}。请改用任务 id 指定。`,
  );
  error.code = 'AMBIGUOUS_TASK';
  throw error;
}

/**
 * Move one task to a new status.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room the task belongs to.
 * @param {string} taskId - task id, or its exact title.
 * @param {string} status - one of {@link TASK_STATUSES}.
 * @param {string} [note] - appended to the detail as a progress line.
 * @param {string} [now] - ISO timestamp.
 * @returns {object} the updated task.
 */
export function setTaskStatus(state, roomId, taskId, status, note, now) {
  const at = stamp(now);
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) throw new Error(`unknown room ${roomId}`);
  if (!TASK_STATUSES.includes(status)) throw new Error(`status must be one of ${TASK_STATUSES.join(', ')}`);
  const task = resolveTask(room, taskId);
  task.status = status;
  task.updatedAt = at;
  const line = clean(note, 500);
  if (line !== '') task.detail = cleanBlock(`${task.detail}${task.detail === '' ? '' : '\n'}\n[${at}] ${line}`, MAX_TASK_DETAIL);
  room.updatedAt = at;
  return task;
}

/**
 * Rename a room, or change what the project is about.
 *
 * The name doubles as the human join handle, so two rooms sharing a name make a
 * typed name ambiguous — `findRoom` refuses to guess. Ids stay stable, so a
 * rename never breaks a member that joined by id.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room to edit.
 * @param {{ name?: string, topic?: string }} input - new fields; omitted ones are kept.
 * @param {string} [now] - ISO timestamp.
 * @returns {object} the updated room.
 */
export function renameRoom(state, roomId, input, now) {
  const room = state.rooms[roomId];
  if (room === undefined || room.deleted === true) throw new Error(`unknown room ${roomId}`);
  let changed = false;
  if (input.name !== undefined) {
    const name = clean(input.name, MAX_ROOM_NAME);
    if (name === '') throw new Error('room name is required');
    if (name !== room.name) {
      room.name = name;
      changed = true;
    }
  }
  if (input.topic !== undefined) {
    const topic = clean(input.topic, 200);
    if (topic !== room.topic) {
      room.topic = topic;
      changed = true;
    }
  }
  if (changed) room.updatedAt = stamp(now);
  return room;
}

/**
 * Remove a room, keeping a tombstone so the deletion survives replication.
 * @param {{ version: number, rooms: Record<string, object> }} state - current state, mutated in place.
 * @param {string} roomId - room to retire.
 * @param {string} [now] - ISO timestamp.
 * @returns {boolean} whether the room existed.
 */
export function retireRoom(state, roomId, now) {
  const room = state.rooms[roomId];
  if (room === undefined) return false;
  room.deleted = true;
  room.updatedAt = stamp(now);
  return true;
}

/**
 * Merge two room documents so every node converges on the same view.
 *
 * The rules are deliberately asymmetric and idempotent: the same pair of inputs
 * always yields the same output, so two nodes that merge in the opposite order
 * agree. Members are unioned; a conflicting leader is decided by who was there
 * first; a conflicting task is decided by the newest `updatedAt`.
 * @param {{ version: number, rooms: Record<string, object> }} local - this node's state.
 * @param {unknown} remote - document received from a peer or from disk.
 * @returns {{ state: object, changed: boolean }}
 */
export function mergeStates(local, remote) {
  const incoming = normalizeState(remote);
  const state = normalizeState(local);
  let changed = false;

  for (const [id, other] of Object.entries(incoming.rooms)) {
    const current = state.rooms[id];
    if (current === undefined) {
      state.rooms[id] = other;
      changed = true;
      continue;
    }
    // The newest edit wins the name: a rename bumps `updatedAt`, so ordering the
    // two documents by that stamp is what keeps two nodes agreeing on the title.
    if (other.updatedAt > current.updatedAt) {
      changed = true;
      if (other.name !== '' && other.name !== current.name) current.name = other.name;
      if (other.topic !== '') current.topic = other.topic;
    }

    current.deleted = current.deleted === true || other.deleted === true;
    current.updatedAt = latest(current.updatedAt, other.updatedAt);
    current.createdAt = earliest(current.createdAt, other.createdAt);

    if (current.leader === undefined) current.leader = other.leader;
    else if (other.leader !== undefined && other.leader.key !== current.leader.key) {
      current.leader = current.leader.joinedAt <= other.leader.joinedAt ? current.leader : other.leader;
    }

    const members = new Map(current.members.map((item) => [item.key, item]));
    for (const member of other.members) {
      const existing = members.get(member.key);
      if (existing === undefined) {
        members.set(member.key, member);
        changed = true;
        continue;
      }
      if (member.joinedAt < existing.joinedAt) existing.joinedAt = member.joinedAt;
      if (existing.name === '') existing.name = member.name;
    }
    current.members = [...members.values()];

    // Union the departure tombstones first, then drop anyone whose departure is
    // newer than their join: a leave heard twice must not undo a later rejoin.
    const left = { ...(current.left ?? {}) };
    for (const [key, at] of Object.entries(other.left ?? {})) {
      const existing = left[key];
      if (existing === undefined || at > existing) {
        left[key] = at;
        if (existing !== at) changed = true;
      }
    }
    if (Object.keys(left).length > 0) {
      current.members = current.members.filter((member) => {
        const departed = left[member.key];
        return departed === undefined || departed < member.joinedAt;
      });
    }
    current.left = left;

    const tasks = new Map(current.tasks.map((item) => [item.id, item]));
    for (const task of other.tasks) {
      const existing = tasks.get(task.id);
      if (existing === undefined) {
        tasks.set(task.id, task);
        changed = true;
        continue;
      }
      if (task.updatedAt > existing.updatedAt) {
        tasks.set(task.id, task);
        changed = true;
      }
    }
    current.tasks = [...tasks.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  if (changed) state.version = ROOM_STATE_VERSION;
  return { state, changed };
}

/**
 * What a peer needs to catch up: the whole document, minus nothing.
 *
 * Rooms are small (tens of members, hundreds of tasks), so full-state
 * anti-entropy costs less code than a delta protocol and cannot go out of sync
 * through a lost message.
 * @param {{ version: number, rooms: Record<string, object> }} state - this node's state.
 * @returns {{ version: number, rooms: Record<string, object> }}
 */
export function exportState(state) {
  return { version: ROOM_STATE_VERSION, rooms: state.rooms };
}

/**
 * Rooms one session belongs to, with that session's role.
 * @param {{ version: number, rooms: Record<string, object> }} state - this node's state.
 * @param {string} nodeId - node the session lives on.
 * @param {string} sessionId - the agent's session id.
 * @returns {object[]}
 */
export function roomsFor(state, nodeId, sessionId) {
  const key = memberKey(nodeId, sessionId);
  const rows = [];
  for (const room of Object.values(state.rooms)) {
    if (room.deleted === true) continue;
    const member = room.members.find((item) => item.key === key);
    if (member === undefined) continue;
    rows.push(roomRow(room, member, key));
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Every room this node knows about, whether or not the caller joined it.
 *
 * A room is shared as soon as one node creates it, so a panel that only listed
 * the caller's own rooms would leave a peer nothing to join.
 * @param {{ version: number, rooms: Record<string, object> }} state - this node's state.
 * @param {string} nodeId - node the caller lives on.
 * @param {string} [sessionId] - calling session, or empty for an anonymous view.
 * @returns {object[]}
 */
export function allRooms(state, nodeId, sessionId) {
  const key = sessionId === undefined ? '' : memberKey(nodeId, sessionId);
  const rows = [];
  for (const room of Object.values(state.rooms)) {
    if (room.deleted === true) continue;
    const member = key === '' ? undefined : room.members.find((item) => item.key === key);
    rows.push(roomRow(room, member, key));
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * One room, projected for a caller that may or may not be a member.
 * @param {object} room - normalized room.
 * @param {object | undefined} member - the caller's membership, when it has one.
 * @param {string} key - the caller's member key.
 * @returns {object}
 */
function roomRow(room, member, key) {
  return {
    id: room.id,
    name: room.name,
    topic: room.topic,
    role: member?.role ?? '',
    isMember: member !== undefined,
    isLeader: room.leader !== undefined && room.leader.key === key,
    members: room.members.map(publicMember),
    tasks: room.tasks.filter((task) => task.deleted !== true).map(publicTask),
    updatedAt: room.updatedAt,
  };
}

/**
 * Public shape of one member.
 * @param {object} member - normalized member.
 * @returns {object}
 */
function publicMember(member) {
  return { nodeId: member.nodeId, sessionId: member.sessionId, name: member.name, role: member.role, key: member.key };
}

/**
 * Public shape of one task.
 * @param {object} task - normalized task.
 * @returns {object}
 */
function publicTask(task) {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    status: task.status,
    assignee: publicMember(task.assignee),
    assigner: publicMember(task.assigner),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Tasks in one room assigned to a session.
 * @param {{ version: number, rooms: Record<string, object> }} state - this node's state.
 * @param {string} roomId - room to inspect.
 * @param {string} key - member key.
 * @returns {object[]}
 */
export function tasksFor(state, roomId, key) {
  const room = state.rooms[roomId];
  if (room === undefined) return [];
  return room.tasks
    .filter((task) => task.deleted !== true && task.assignee.key === key)
    .map(publicTask);
}

/**
 * Resolve a member of a room from what a caller typed: a member key, a session
 * id, a node name, or a member name.
 * @param {object} room - normalized room.
 * @param {object} mesh - lookup table for node names.
 * @param {string} mesh.selfNodeId - this node's id.
 * @param {(nodeId: string) => string} mesh.nameOf - display name for one node.
 * @param {string} reference - what the caller typed.
 * @returns {object | undefined} normalized member.
 */
export function resolveMember(room, mesh, reference) {
  const wanted = clean(reference, MAX_ROOM_NAME);
  if (wanted === '') return undefined;
  const byKey = room.members.find((item) => item.key === wanted);
  if (byKey !== undefined) return byKey;
  const bySession = room.members.filter((item) => item.sessionId === wanted);
  if (bySession.length === 1) return bySession[0];
  const lowered = wanted.toLowerCase();
  const byName = room.members.filter((item) => item.name.toLowerCase() === lowered);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return undefined;
  const byNodeName = room.members.filter((item) => mesh.nameOf(item.nodeId).toLowerCase() === lowered);
  if (byNodeName.length === 1) return byNodeName[0];
  return undefined;
}

/**
 * Room ids a node should receive traffic for, used to fan a room message out.
 * @param {object} room - normalized room.
 * @returns {Map<string, object[]>} node id to the members hosted there.
 */
export function membersByNode(room) {
  const grouped = new Map();
  for (const member of room.members) {
    const list = grouped.get(member.nodeId);
    if (list === undefined) grouped.set(member.nodeId, [member]);
    else list.push(member);
  }
  return grouped;
}
