/**
 * Shared document coordinator: the only place that decides *who* may change a
 * shared document, and the only place that turns an edit into a state command.
 *
 * Layering (see `docs/shared-doc-interfaces.md`):
 *
 * - `lib/shared-doc-state.mjs` owns the replicated rules — what a revision is,
 *   which head may follow which, what the audit chain looks like.
 * - `lib/shared-doc-merge.mjs` owns the three-way merge.
 * - `lib/shared-doc-store.mjs` owns durability and serialization.
 * - this module owns *permission* and *sequencing*: it derives the actor from
 *   the calling surface, mints ids, picks `(generation, seq)`, and decides
 *   between "commit straight away" and "record a conflicted proposal".
 *
 * Everything below is deliberately side-effect free apart from the one store
 * transaction per operation. No network I/O, no timers: a coordinator that also
 * spoke HTTP could not be tested for the thing that matters — that a conflict
 * never silently becomes a commit.
 *
 * Authority rules (§8), and why they are shaped this way:
 *
 * A permission can only come from *how the request arrived*, never from a field
 * the request carries. `via: 'panel'` means the call came through the
 * owner-only panel route, so the actor is this node's human. `via: 'tool'`
 * means an agent tool called us, so the actor is the session that executed the
 * tool. An agent that passes `sessionId: 'human'` is still that agent — the
 * same rule the room invite fix applied, for the same reason.
 */

import { randomUUID } from 'node:crypto';
import { TransportError } from './transport.mjs';
import {
  DOC_STATE_VERSION,
  MAX_DOC_TITLE,
  MAX_HISTORY_PAGE,
  applyDocumentCommand,
  documentsForRoom,
  eventsForDocument,
  hashContent,
  isDocumentArchived,
  isIsoTimestamp,
  maintainersOfDocument,
  newDocumentId,
  newEventId,
  newProposalId,
  newRevisionId,
  normalizeContent,
  openProposalCount,
  proposalsForDocument,
  revisionsForDocument,
} from './shared-doc-state.mjs';
// `hashContent`/`normalizeContent` come from the state layer, which owns the one
// canonical definition; importing them twice would let the two drift apart again.
import { applyPatch, mergeMarkdown, patchFromContent } from './shared-doc-merge.mjs';

/** The session id that stands for the person in front of this screen. */
const HUMAN_SESSION_ID = 'human';

/** How a call reached us. Anything else is a bug in the caller, not a request. */
const VIA_PANEL = 'panel';
const VIA_TOOL = 'tool';

/** `revision.source` values the coordinator is allowed to mint (§3). */
const SOURCE_HUMAN = 'human';
const SOURCE_AGENT = 'agent';
const SOURCE_IMPORT = 'import';
const SOURCE_RESOLUTION = 'conflict-resolution';

/**
 * Refuse with a stable code. Every failure a caller can provoke is a
 * `TransportError`, because the panel and the mesh both forward `code` verbatim.
 * @param {string} code - §7 error code.
 * @param {string} message - operator-readable detail.
 * @param {number} [status] - HTTP status for the mesh path.
 * @returns {never}
 */
function fail(code, message, status = 400) {
  throw new TransportError(message, code, status);
}

/**
 * Derive the actor key from the calling surface.
 *
 * This is the whole permission story in one function: `via` decides, payload
 * strings are ignored. `panel` is the human of this node; `tool` must name the
 * executing session, which the Leader reads off `exec.agent.id` — the coordinator
 * re-derives the key so a caller cannot pass a different node's actor.
 *
 * @param {{via?: string, actorKey?: string, sessionId?: string, nodeId: string, nodeName?: string}} input
 *   `via` is the surface, `sessionId` the executing session for a tool call.
 * @returns {{actorKey: string, nodeId: string, sessionId: string, name: string, via: string, isHuman: boolean}}
 */
function resolveActor({ via, actorKey, sessionId, nodeId, nodeName }) {
  const surface = typeof via === 'string' ? via : '';
  if (surface !== VIA_PANEL && surface !== VIA_TOOL) {
    fail('DOC_COMMAND_INVALID', `via must be '${VIA_PANEL}' or '${VIA_TOOL}'`);
  }
  const host = String(nodeId ?? '').trim();
  if (host === '') fail('DOC_COMMAND_INVALID', 'the coordinator needs the host node id');
  if (surface === VIA_PANEL) {
    // The panel route is registered on the owner-only connection channel, so a
    // request that reaches it is already proven to be the local person. Nothing
    // in the payload can add to that, and nothing needs to.
    return {
      actorKey: `${host}/${HUMAN_SESSION_ID}`,
      nodeId: host,
      sessionId: HUMAN_SESSION_ID,
      name: String(nodeName ?? '').trim(),
      via: surface,
      isHuman: true,
    };
  }
  const id = String(sessionId ?? actorKey ?? '').trim();
  if (id === '') fail('DOC_COMMAND_INVALID', 'a tool call must name the session that executed it');
  // A tool cannot become the human by claiming the human session id: `via` is
  // already `tool`, so this branch can only ever produce an agent actor.
  if (id === HUMAN_SESSION_ID) {
    fail('DOC_COMMAND_INVALID', 'an agent may not act as the local human; that authority comes only from the panel route');
  }
  const slash = id.lastIndexOf('/');
  const resolvedKey = slash === -1 ? `${host}/${id}` : id;
  const resolvedSession = slash === -1 ? id : id.slice(slash + 1);
  return {
    actorKey: resolvedKey,
    nodeId: host,
    sessionId: resolvedSession,
    name: String(nodeName ?? '').trim(),
    via: surface,
    isHuman: false,
  };
}

/**
 * Validate a room membership answer from the caller's room lookup.
 * @param {unknown} info - whatever `roomInfo` returned.
 * @param {string} roomId - room being touched.
 * @returns {{id: string, leaderKey: string, memberKeys: Set<string>}}
 */
function requireRoom(info, roomId) {
  if (info === undefined || info === null) {
    fail('UNKNOWN_ROOM', `unknown room "${String(roomId ?? '')}"`);
  }
  const id = typeof info.id === 'string' ? info.id : '';
  const memberKeys = info.memberKeys instanceof Set ? info.memberKeys : new Set(info.memberKeys ?? []);
  return {
    id,
    leaderKey: typeof info.leaderKey === 'string' ? info.leaderKey : '',
    memberKeys,
  };
}

/**
 * Normalize the ordering counter pair.
 *
 * `generation` is the Leader generation (a new Leader starts a new one), `seq`
 * is the per-document sequence inside it. §4 makes the pair the only ordering
 * authority, so it is never derived from a wall clock.
 * @param {number} generation - current Leader generation.
 * @param {number} seq - sequence inside that generation.
 * @returns {{generation: number, seq: number}}
 */
function counter(generation, seq) {
  return { generation, seq };
}

/**
 * The next ordering key for a document.
 *
 * Taken as the successor of every key the document already used — head revision,
 * revisions, proposals and events. Reusing a key would let two different changes
 * claim the same slot, which is exactly the `CONFLICTING_CHECKPOINT` condition
 * §4 asks us to raise; minting past all of them keeps that condition reserved for
 * genuinely divergent peers.
 * @param {object} state - current state.
 * @param {string} documentId - document being changed.
 * @param {number} generation - current Leader generation.
 * @returns {{generation: number, seq: number}}
 */
function nextKeyFor(state, documentId, generation) {
  let highest = 0;
  const note = (record) => {
    if (record !== undefined && record !== null && Number.isSafeInteger(record.seq) && record.seq > highest) {
      highest = record.seq;
    }
  };
  note(state.documents?.[documentId]);
  for (const revision of Object.values(state.revisions ?? {})) {
    if (revision.documentId === documentId) note(revision);
  }
  for (const event of state.events?.[documentId] ?? []) note(event);
  return counter(generation, highest + 1);
}

/**
 * Reject a title the state layer would reject, before any work is done.
 * @param {unknown} title - candidate title.
 * @returns {string}
 */
function requireTitle(title) {
  const text = typeof title === 'string' ? title.trim() : '';
  if (text === '') fail('DOC_TITLE_INVALID', 'a document title is required');
  if (text.length > MAX_DOC_TITLE) {
    fail('DOC_TITLE_INVALID', `a document title may not exceed ${MAX_DOC_TITLE} characters`);
  }
  return text;
}

/**
 * Reject a submission message longer than the state layer accepts.
 * @param {unknown} message - candidate commit message.
 * @returns {string}
 */
function optionalMessage(message) {
  if (message === undefined || message === null) return '';
  if (typeof message !== 'string') fail('DOC_COMMAND_INVALID', 'message must be a string');
  return message;
}

/**
 * The coordinator.
 *
 * Construct one per node and keep it for the process lifetime: it caches nothing
 * today, but the store binding and the identity must not drift between calls.
 */
export class SharedDocCoordinator {
  /**
   * @param {object} options - dependencies.
   * @param {object} options.store - store with `transact(fn)`, `state()` and `documentAt(documentId, revisionId)`.
   * @param {string} options.nodeId - this node's id; the actor key prefix.
   * @param {string} [options.nodeName] - this node's display name, used as the author name.
   * @param {() => number} [options.generation] - Leader generation, default `0`.
   * @param {() => string} [options.now] - ISO timestamp source, default `new Date().toISOString()`.
   * @param {() => string} [options.uuid] - id source, default `randomUUID`.
   * @param {(roomId: string) => ({id: string, leaderKey: string, memberKeys: Iterable<string>} | undefined)} options.roomInfo
   *   room lookup supplied by the service; the coordinator never reads room state itself.
   * @param {(message: string, error?: unknown) => void} [options.log] - diagnostics sink.
   */
  constructor({ store, nodeId, nodeName = '', generation, now, uuid, roomInfo, log } = {}) {
    if (store === undefined || store === null) fail('DOC_STORE_UNAVAILABLE', 'the coordinator needs a document store');
    if (typeof roomInfo !== 'function') fail('DOC_COMMAND_INVALID', 'the coordinator needs a room lookup');
    this.store = store;
    this.nodeId = String(nodeId ?? '');
    this.nodeName = String(nodeName ?? '');
    this.generationOf = typeof generation === 'function' ? generation : () => 0;
    this.now = typeof now === 'function' ? now : () => new Date().toISOString();
    this.uuid = typeof uuid === 'function' ? uuid : randomUUID;
    this.roomInfo = roomInfo;
    this.log = typeof log === 'function' ? log : () => {};
  }

  /** @returns {number} the Leader generation ordering keys are minted in. */
  get generation() {
    const value = this.generationOf();
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  /**
   * Resolve an actor and prove room membership.
   * @param {{roomId: string, via: string, actorKey?: string, sessionId?: string}} request - raw call.
   * @returns {{actor: object, room: object}}
   */
  #caller(request) {
    const actor = resolveActor({
      via: request.via,
      actorKey: request.actorKey,
      sessionId: request.sessionId,
      nodeId: this.nodeId,
      nodeName: this.nodeName,
    });
    const room = requireRoom(this.roomInfo(request.roomId), request.roomId);
    if (!room.memberKeys.has(actor.actorKey)) {
      fail('NOT_ROOM_MEMBER', `${actor.actorKey} is not a member of room ${room.id}`);
    }
    return { actor, room };
  }

  /**
   * Resolve a document and the room it belongs to, proving membership.
   * @param {{documentId: string, via: string, actorKey?: string, sessionId?: string}} request - raw call.
   * @returns {{actor: object, room: object, document: object}}
   */
  #documentCaller(request) {
    const state = this.store.state();
    const documentId = String(request.documentId ?? '');
    const document = state.documents?.[documentId];
    if (document === undefined) fail('DOC_NOT_FOUND', `unknown document ${documentId}`);
    const actor = resolveActor({
      via: request.via,
      actorKey: request.actorKey,
      sessionId: request.sessionId,
      nodeId: this.nodeId,
      nodeName: this.nodeName,
    });
    const room = requireRoom(this.roomInfo(document.roomId), document.roomId);
    if (!room.memberKeys.has(actor.actorKey)) {
      fail('NOT_ROOM_MEMBER', `${actor.actorKey} is not a member of room ${room.id}`);
    }
    return { actor, room, document };
  }

  /**
   * Whether an actor may confirm a resolution: the Leader, or a document
   * maintainer. Agents never may — §8, and the tool surface has no way to prove
   * a human is behind it.
   * @param {object} state - current state.
   * @param {string} documentId - document being confirmed.
   * @param {object} actor - resolved actor.
   * @param {object} room - resolved room.
   * @returns {boolean}
   */
  #canConfirm(state, documentId, actor, room) {
    if (!actor.isHuman) return false;
    if (room.leaderKey !== '' && room.leaderKey === actor.actorKey) return true;
    const holders = state.maintainers?.[documentId] ?? {};
    return Object.prototype.hasOwnProperty.call(holders, actor.actorKey);
  }

  /**
   * Build the author fields both revisions and proposals carry.
   * @param {object} actor - resolved actor.
   * @param {string} at - timestamp.
   * @param {string} source - `revision.source`.
   * @returns {{authorKey: string, authorNodeName: string, createdAt: string, source: string}}
   */
  #authorship(actor, at, source) {
    return {
      authorKey: actor.actorKey,
      authorNodeName: actor.name === '' ? this.nodeName : actor.name,
      createdAt: at,
      source,
    };
  }

  /**
   * The document view a state command must carry alongside a revision.
   *
   * `applyRevisionAppend` refuses a view whose head, hash and ordering key do not
   * agree with the revision, so this is derived from the revision rather than
   * assembled separately — two sources for the same triple is how a document ends
   * up pointing at text it does not hold.
   * @param {object} document - current document record.
   * @param {object} revision - revision being appended.
   * @returns {object}
   */
  #headView(document, revision) {
    return {
      documentId: document.documentId,
      roomId: document.roomId,
      title: document.title,
      format: document.format,
      headRevisionId: revision.revisionId,
      contentHash: revision.resultHash,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      deletedAt: document.deletedAt ?? null,
      generation: revision.generation,
      seq: revision.seq,
    };
  }

  /* ------------------------------------------------------------ reads --- */

  /**
   * Rebuild the text of one document at one revision.
   *
   * Patches are always expressed against a specific revision, so anything that
   * writes a patch has to reconstruct that revision first. `null` means "the
   * empty document", which is what a first revision is written against.
   * @param {string} documentId - document to read.
   * @param {string|null} revisionId - revision to reconstruct, or null for empty.
   * @returns {string} normalized text.
   */
  #contentAt(documentId, revisionId) {
    if (revisionId === null || revisionId === undefined) return '';
    return this.store.documentAt(documentId, revisionId).content;
  }

  /**
   * Documents of one room, as panel rows.
   * @param {{roomId: string}} request - room to list.
   * @returns {{status: string, documents: object[]}}
   */
  listDocuments({ roomId } = {}) {
    const state = this.store.state();
    const rows = documentsForRoom(state, roomId).map((document) => this.#documentRow(state, document));
    return { status: 'ready', documents: rows };
  }

  /**
   * One document, optionally at an older revision.
   *
   * `canConfirm` is the only authority the panel has for showing a confirm
   * button, so this read resolves the caller too: a view built without an actor
   * would silently tell every user they may not confirm, and a view built from
   * the payload's claimed identity would tell them the opposite.
   * @param {{documentId: string, revisionId?: string, via?: string, actorKey?: string,
   *   sessionId?: string}} request - what to read, and who is reading.
   * @returns {{status: string, document: object, revision: object}}
   */
  getDocument({ documentId, revisionId, via, actorKey, sessionId } = {}) {
    const state = this.store.state();
    const id = String(documentId ?? '');
    const document = state.documents?.[id];
    if (document === undefined) fail('DOC_NOT_FOUND', `unknown document ${id}`);
    const target = typeof revisionId === 'string' && revisionId !== ''
      ? revisionId
      : document.headRevisionId;
    const at = this.store.documentAt(id, target);
    const revision = state.revisions?.[target];
    if (revision === undefined) fail('DOC_NOT_FOUND', `unknown revision ${target} of document ${id}`);
    const reader = resolveActor({ via, actorKey, sessionId, nodeId: this.nodeId, nodeName: this.nodeName });
    const room = requireRoom(this.roomInfo(document.roomId), document.roomId);
    if (!room.memberKeys.has(reader.actorKey)) {
      fail('NOT_ROOM_MEMBER', `${reader.actorKey} is not a member of room ${room.id}`);
    }
    return {
      status: 'ready',
      // The hash describes the text this view returns, which on a historical
      // read is that revision's hash — not the head's. Showing the head hash
      // beside an old body would let a reader "verify" the wrong bytes.
      document: this.#documentView(state, document, at.content, reader, room, revision.resultHash),
      revision: this.#historyRow(state, revision, document),
      proposal: this.#openProposalRow(state, id),
    };
  }

  /**
   * Revision and event history of one document, newest first, cursor paged.
   * @param {{documentId: string, cursor?: string, limit?: number}} request - paging.
   * @returns {{status: string, revisions: object[], events: object[], nextCursor: string}}
   */
  listDocumentHistory({ documentId, cursor, limit } = {}) {
    const state = this.store.state();
    const id = String(documentId ?? '');
    const document = state.documents?.[id];
    if (document === undefined) fail('DOC_NOT_FOUND', `unknown document ${id}`);
    const size = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_HISTORY_PAGE) : MAX_HISTORY_PAGE;
    // Oldest first in the state layer, so the cursor is an offset into that
    // order and a reader walking pages sees a stable sequence even while new
    // revisions land at the front of the reversed list.
    const all = revisionsForDocument(state, id);
    const start = typeof cursor === 'string' && cursor !== '' ? Number.parseInt(cursor, 10) : 0;
    const from = Number.isSafeInteger(start) && start >= 0 ? start : 0;
    const page = all.slice(from, from + size);
    const nextCursor = from + size < all.length ? String(from + size) : '';
    return {
      status: 'ready',
      revisions: page.map((revision) => this.#historyRow(state, revision, document)),
      events: eventsForDocument(state, id),
      nextCursor,
    };
  }

  /* ----------------------------------------------------------- writers --- */

  /**
   * Create a document and its first revision.
   *
   * The first revision has no parent and no base: it *is* the base every later
   * proposal will name.
   * @param {{roomId: string, title: string, content: string, message?: string, via: string,
   *   actorKey?: string, sessionId?: string, relatedTaskId?: string, relatedMessageId?: string}} request
   * @returns {Promise<{status: string, document: object}>}
   */
  async createDocument(request = {}) {
    const { actor, room } = this.#caller(request);
    const title = requireTitle(request.title);
    const body = normalizeContent(String(request.content ?? ''));
    const message = optionalMessage(request.message);
    const at = this.now();
    const generation = this.generation;
    const source = actor.isHuman ? SOURCE_HUMAN : SOURCE_AGENT;
    const resultHash = hashContent(body);
    const activity = {
      documentId: newDocumentId(this.uuid),
      revisionId: newRevisionId(this.uuid),
      eventId: newEventId(this.uuid),
    };
    let row;
    await this.store.transact((state) => {
      const key = nextKeyFor(state, activity.documentId, generation);
      const document = {
        documentId: activity.documentId,
        roomId: room.id,
        title,
        format: 'markdown',
        headRevisionId: activity.revisionId,
        contentHash: resultHash,
        createdBy: actor.actorKey,
        createdAt: at,
        deletedAt: null,
        generation: key.generation,
        seq: key.seq,
        conflictCount: 0,
      };
      const revision = {
        revisionId: activity.revisionId,
        proposalId: null,
        documentId: activity.documentId,
        parentRevisionId: null,
        baseRevisionId: null,
        authorKey: actor.actorKey,
        authorNodeName: actor.name === '' ? this.nodeName : actor.name,
        createdAt: at,
        message,
        patch: patchFromContent('', body),
        resultHash,
        source,
        relatedTaskId: request.relatedTaskId ?? null,
        relatedMessageId: request.relatedMessageId ?? null,
        generation: key.generation,
        seq: key.seq,
      };
      const event = {
        eventId: activity.eventId,
        documentId: activity.documentId,
        generation: key.generation,
        seq: key.seq,
        type: 'proposal-accepted',
        actorKey: actor.actorKey,
        nodeId: this.nodeId,
        at,
        baseRevisionId: null,
        headRevisionId: activity.revisionId,
        proposalId: null,
        revisionId: activity.revisionId,
        detail: { title },
      };
      const next = applyDocumentCommand(state, {
        type: 'document/create', document, revision, event, content: body,
      });
      row = document;
      return next;
    });
    return { status: 'clean', document: this.#documentRow(this.store.state(), row) };
  }

  /**
   * Submit an edit. Commits cleanly, or parks a conflicted proposal.
   *
   * The three outcomes are deliberate and are what makes "no extra approval for
   * the happy path" safe:
   *
   * - base is still the head → commit immediately, no human in the loop;
   * - base is stale but the two edits do not overlap → merge and commit, still no
   *   human in the loop, because git's own rule applies: disjoint edits have one
   *   answer;
   * - the edits disagree → the head does **not** move, a proposal in `conflicted`
   *   state is recorded, and somebody has to resolve it.
   * @param {{documentId: string, baseRevisionId?: string, content: string, message?: string,
   *   proposalId?: string, via: string, actorKey?: string, sessionId?: string}} request
   * @returns {Promise<{status: string, revision?: object, proposal?: object, reason?: string}>}
   */
  async submitDocumentProposal(request = {}) {
    const { actor, document } = this.#documentCaller(request);
    if (isDocumentArchived(document)) fail('DOC_NOT_FOUND', `document ${document.documentId} is archived`);
    const state = this.store.state();
    const proposalId = typeof request.proposalId === 'string' && request.proposalId !== ''
      ? request.proposalId
      : newProposalId(this.uuid);
    const baseRevisionId = typeof request.baseRevisionId === 'string' && request.baseRevisionId !== ''
      ? request.baseRevisionId
      : document.headRevisionId;
    const base = state.revisions?.[baseRevisionId];
    if (base === undefined || base.documentId !== document.documentId) {
      fail('DOC_BASE_NOT_FOUND', `revision ${baseRevisionId} is not part of document ${document.documentId}`);
    }
    const proposed = normalizeContent(String(request.content ?? ''));
    const message = optionalMessage(request.message);
    const at = this.now();
    const source = actor.isHuman ? SOURCE_HUMAN : SOURCE_AGENT;
    const address = this.#authorship(actor, at, source);
    const proposedHash = hashContent(proposed);
    const head = state.revisions[document.headRevisionId];
    const headContent = this.store.documentAt(document.documentId, document.headRevisionId).content;
    const baseContent = baseRevisionId === document.headRevisionId
      ? headContent
      : this.store.documentAt(document.documentId, baseRevisionId).content;

    // Same proposal id must mean the same proposal (§1). Checking before the
    // merge keeps a retry from being turned into a second, different change.
    const known = state.proposals?.[proposalId];
    if (known !== undefined) {
      if (known.resultHash !== proposedHash || (known.baseRevisionId ?? null) !== baseRevisionId) {
        fail(
          'DOC_PROPOSAL_ID_REUSED',
          `proposal ${proposalId} already exists with different content; a retry must reuse the id only for the same proposal`,
        );
      }
      // The outer `status` is the endpoint's three-way answer (§10: clean,
      // conflict, pending); the proposal's own lifecycle state lives on
      // `proposal.status`. A retry therefore reports the same value as the
      // first call instead of leaking "accepted"/"auto-merged" upward.
      const settled = known.status === 'accepted' || known.status === 'auto-merged';
      return {
        status: settled ? 'clean' : known.status === 'conflicted' ? 'conflict' : 'pending',
        proposal: this.#proposalRow(known),
        ...(known.status === 'conflicted'
          ? { reason: 'this proposal is waiting for a resolution' }
          : {}),
      };
    }

    const direct = baseRevisionId === document.headRevisionId;
    const merged = direct
      ? { status: 'clean', content: proposed, hunks: patchFromContent(headContent, proposed) }
      : mergeMarkdown({ base: baseContent, current: headContent, proposed });

    const generation = this.generation;
    const proposalBase = {
      proposalId,
      documentId: document.documentId,
      baseRevisionId,
      authorKey: address.authorKey,
      authorNodeName: address.authorNodeName,
      createdAt: at,
      message,
      patch: merged.status === 'clean' ? merged.hunks : [],
      resultHash: merged.status === 'clean' ? hashContent(merged.content) : proposedHash,
      conflict: merged.status === 'conflict'
        ? {
          hunks: merged.hunks,
          baseContentHash: hashContent(baseContent),
          currentContentHash: hashContent(headContent),
        }
        : null,
      resolvedBy: null,
      resolvedAt: null,
    };

    if (merged.status === 'conflict') {
      let row;
      await this.store.transact((current) => {
        const live = current.documents?.[document.documentId];
        if (live === undefined) fail('DOC_NOT_FOUND', `document ${document.documentId} disappeared`);
        if (live.headRevisionId !== document.headRevisionId) {
          fail('DOC_CONFLICT_PENDING', 'the document moved while this proposal was merging; re-read and submit again');
        }
        const key = nextKeyFor(current, document.documentId, generation);
        const proposal = { ...proposalBase, status: 'conflicted' };
        let next = applyDocumentCommand(current, { type: 'proposal/put', proposal });
        next = applyDocumentCommand(next, {
          type: 'event/append',
            documentId: document.documentId,
          event: {
            eventId: newEventId(this.uuid),
            documentId: document.documentId,
            generation: key.generation,
            seq: key.seq,
            type: 'conflict-detected',
            actorKey: proposal.authorKey,
            nodeId: this.nodeId,
            at,
            baseRevisionId,
            headRevisionId: live.headRevisionId,
            proposalId,
            revisionId: null,
            detail: { hunks: merged.hunks.length },
          },
        });
        row = proposal;
        return next;
      });
      return {
        status: 'conflict',
        proposal: this.#proposalRow(row),
        reason: 'both sides changed the same lines; a maintainer has to pick the final text',
      };
    }

    // Clean: commit the merged text as the new head.
    let revisionOut;
    let proposalOut;
    const cleanContent = merged.content;
    const cleanHash = hashContent(cleanContent);
    // §14 ruling 2: a stored patch is base -> result, and the store replays it
    // from `revision.baseRevisionId`. Recording a head-based patch next to a
    // stale base is what makes a cache miss (snapshot dropped) replay wrong and
    // surface as DOC_STORE_CORRUPT, so the patch is taken against the base the
    // revision claims.
    const cleanPatch = patchFromContent(baseContent, cleanContent);
    const status = direct ? 'accepted' : 'auto-merged';
    await this.store.transact((current) => {
      const live = current.documents?.[document.documentId];
      if (live === undefined) fail('DOC_NOT_FOUND', `document ${document.documentId} disappeared`);
      // A commit is only allowed onto the head this merge was computed against.
      // If it moved, the merge we just did is stale and committing it would
      // silently overwrite the other edit.
      if (live.headRevisionId !== document.headRevisionId) {
        fail('DOC_CONFLICT_PENDING', 'the document moved while this proposal was merging; re-read and submit again');
      }
      const key = nextKeyFor(current, document.documentId, generation);
      const revisionId = newRevisionId(this.uuid);
      const revision = {
        revisionId,
        proposalId,
        documentId: document.documentId,
        parentRevisionId: live.headRevisionId,
        baseRevisionId,
        authorKey: proposalBase.authorKey,
        authorNodeName: proposalBase.authorNodeName,
        createdAt: at,
        message,
        patch: cleanPatch,
        resultHash: cleanHash,
        source,
        relatedTaskId: request.relatedTaskId ?? null,
        relatedMessageId: request.relatedMessageId ?? null,
        generation: key.generation,
        seq: key.seq,
      };
      const proposal = { ...proposalBase, status, patch: cleanPatch, resultHash: cleanHash, resolvedBy: actor.actorKey, resolvedAt: at };
      const event = {
        eventId: newEventId(this.uuid),
        documentId: document.documentId,
        generation: key.generation,
        seq: key.seq,
        type: status === 'accepted' ? 'proposal-accepted' : 'proposal-auto-merged',
        actorKey: proposal.authorKey,
        nodeId: this.nodeId,
        at,
        baseRevisionId,
        headRevisionId: revisionId,
        proposalId,
        revisionId,
        detail: { message },
      };
      let next = applyDocumentCommand(current, { type: 'proposal/put', proposal });
      next = applyDocumentCommand(next, {
        type: 'revision/append',
        revision,
        document: this.#headView(live, revision),
        event,
        content: cleanContent,
      });
      revisionOut = revision;
      proposalOut = proposal;
      return next;
    });
    const after = this.store.state();
    return {
      status: 'clean',
      revision: this.#historyRow(after, revisionOut, after.documents[document.documentId]),
      proposal: this.#proposalRow(proposalOut),
    };
  }

  /**
   * Replace a conflicted proposal with a hand-written resolution.
   *
   * Any room member may write one — the person who resolves a conflict is not
   * necessarily the person who caused it — but writing a resolution is still only
   * a proposal. `confirmDocumentResolution` is what moves the head, and that is
   * restricted.
   * @param {{documentId: string, proposalId: string, content: string, message?: string,
   *   via: string, actorKey?: string, sessionId?: string}} request
   * @returns {Promise<{status: string, proposal: object}>}
   */
  async resolveDocumentConflict(request = {}) {
    const { actor, document } = this.#documentCaller(request);
    const state = this.store.state();
    const proposal = state.proposals?.[String(request.proposalId ?? '')];
    if (proposal === undefined) fail('DOC_NOT_FOUND', `unknown proposal ${String(request.proposalId ?? '')}`);
    if (proposal.documentId !== document.documentId) {
      fail('DOC_COMMAND_INVALID', `proposal ${proposal.proposalId} does not belong to document ${document.documentId}`);
    }
    if (proposal.status !== 'conflicted') {
      fail('DOC_CONFLICT_PENDING', `proposal ${proposal.proposalId} is '${proposal.status}', not conflicted`);
    }
    const resolved = normalizeContent(String(request.content ?? ''));
    const message = optionalMessage(request.message);
    const at = this.now();
    let row;
    await this.store.transact((current) => {
      const live = current.proposals?.[proposal.proposalId];
      if (live === undefined) fail('DOC_NOT_FOUND', `unknown proposal ${proposal.proposalId}`);
      if (live.status !== 'conflicted') {
        fail('DOC_CONFLICT_PENDING', `proposal ${proposal.proposalId} is no longer conflicted`);
      }
      const key = nextKeyFor(current, document.documentId, this.generation);
      // The resolution is a new version of the same proposal: same id, same base,
      // but now carrying the human's text instead of the machine's conflict.
      //
      // The patch is expressed against the proposal's own base revision, not
      // against the head and certainly not against an empty document. §14 ruling 2
      // freezes that meaning ("a clean patch runs base → result"), and only that
      // base stays stable: the head can move again before anyone confirms, while
      // the base revision the conflicted proposal was written against cannot.
      const baseContent = this.#contentAt(document.documentId, live.baseRevisionId);
      const next = applyDocumentCommand(current, {
        type: 'proposal/put',
        proposal: {
          ...live,
          status: 'conflicted',
          message: message === '' ? live.message : message,
          patch: patchFromContent(baseContent, resolved),
          resultHash: hashContent(resolved),
          conflict: live.conflict,
          resolvedBy: actor.actorKey,
          resolvedAt: at,
        },
      });
      const logged = applyDocumentCommand(next, {
        type: 'event/append',
          documentId: document.documentId,
        event: {
          eventId: newEventId(this.uuid),
          documentId: document.documentId,
          generation: key.generation,
          seq: key.seq,
          type: 'conflict-resolved',
          actorKey: actor.actorKey,
          nodeId: this.nodeId,
          at,
          baseRevisionId: live.baseRevisionId ?? null,
          headRevisionId: current.documents?.[document.documentId]?.headRevisionId ?? null,
          proposalId: live.proposalId,
          revisionId: null,
          detail: { resolved: true },
        },
      });
      row = logged.proposals?.[proposal.proposalId];
      return logged;
    });
    return {
      status: 'pending',
      proposal: this.#proposalRow(row),
      reason: 'a resolution still needs a maintainer or the Leader to confirm it',
    };
  }

  /**
   * Accept a conflicted proposal's resolution and move the head.
   *
   * Only the Leader or a registered document maintainer may do this, and only a
   * human can be either — §8. The head is re-read inside the transaction, so a
   * confirmation that raced another commit fails instead of overwriting it.
   * @param {{documentId: string, proposalId: string, via: string, actorKey?: string,
   *   sessionId?: string}} request
   * @returns {Promise<{status: string, document: object, revision: object}>}
   */
  async confirmDocumentResolution(request = {}) {
    const { actor, room, document } = this.#documentCaller(request);
    const state = this.store.state();
    if (!this.#canConfirm(state, document.documentId, actor, room)) {
      fail(
        actor.isHuman ? 'NOT_DOCUMENT_MAINTAINER' : 'AGENT_CANNOT_CONFIRM',
        actor.isHuman
          ? 'only the room Leader or a document maintainer may confirm a resolution'
          : 'an agent may propose and resolve, but never confirm',
      );
    }
    const proposal = state.proposals?.[String(request.proposalId ?? '')];
    if (proposal === undefined) fail('DOC_NOT_FOUND', `unknown proposal ${String(request.proposalId ?? '')}`);
    if (proposal.documentId !== document.documentId) {
      fail('DOC_COMMAND_INVALID', `proposal ${proposal.proposalId} does not belong to document ${document.documentId}`);
    }
    if (proposal.status !== 'conflicted') {
      fail('DOC_CONFLICT_PENDING', `proposal ${proposal.proposalId} is '${proposal.status}', not conflicted`);
    }
    const at = this.now();
    let revisionOut;
    let liveDocument;
    await this.store.transact((current) => {
      const live = current.documents?.[document.documentId];
      if (live === undefined) fail('DOC_NOT_FOUND', `document ${document.documentId} disappeared`);
      if (live.headRevisionId !== document.headRevisionId) {
        fail('DOC_CONFLICT_PENDING', 'the document moved while this resolution was waiting; re-read before confirming');
      }
      const stored = current.proposals?.[proposal.proposalId];
      if (stored === undefined || stored.status !== 'conflicted') {
        fail('DOC_CONFLICT_PENDING', `proposal ${proposal.proposalId} is no longer conflicted`);
      }
      const headContent = this.store.documentAt(document.documentId, live.headRevisionId).content;
      // A confirmation without text is the normal path (§10: the panel only sends
      // ids). The text it commits is the resolution the human already wrote, which
      // is only recoverable from the proposal's patch against its own base — the
      // head has usually moved on since, so replaying the head would "confirm" a
      // change nobody made.
      const text = normalizeContent(
        typeof request.content === 'string' && request.content !== ''
          ? request.content
          : this.#restatedResolution(stored),
      );
      const key = nextKeyFor(current, document.documentId, this.generation);
      const revisionId = newRevisionId(this.uuid);
      const revision = {
        revisionId,
        proposalId: stored.proposalId,
        documentId: document.documentId,
        parentRevisionId: live.headRevisionId,
        baseRevisionId: stored.baseRevisionId ?? null,
        authorKey: stored.resolvedBy ?? stored.authorKey,
        authorNodeName: stored.authorNodeName,
        createdAt: at,
        message: stored.message,
        // Same rule as a normal commit: the stored patch is replayed from this
        // revision's own base, so it has to be relative to that base and not to
        // the head the human happened to be looking at.
        patch: patchFromContent(this.#contentAt(document.documentId, stored.baseRevisionId ?? null), text),
        resultHash: hashContent(text),
        source: SOURCE_RESOLUTION,
        relatedTaskId: null,
        relatedMessageId: null,
        generation: key.generation,
        seq: key.seq,
      };
      const event = {
        eventId: newEventId(this.uuid),
        documentId: document.documentId,
        generation: key.generation,
        seq: key.seq,
        type: 'proposal-accepted',
        actorKey: actor.actorKey,
        nodeId: this.nodeId,
        at,
        baseRevisionId: stored.baseRevisionId ?? null,
        headRevisionId: revisionId,
        proposalId: stored.proposalId,
        revisionId,
        detail: { confirmedBy: actor.actorKey },
      };
      let next = applyDocumentCommand(current, {
        type: 'proposal/status',
        proposalId: stored.proposalId,
        status: 'accepted',
        resolvedBy: actor.actorKey,
        resolvedAt: at,
        event,
      });
      next = applyDocumentCommand(next, {
        type: 'revision/append',
        revision,
        document: this.#headView(live, revision),
        // The confirmation writes two audit entries: the proposal is accepted, and
        // the conflict that made a human decide is resolved. One `(generation, seq)`
        // identifies one entry, so the second has to take the next counter — reusing
        // the first one made the log fail its own ordering check.
        event: {
          ...event,
          eventId: newEventId(this.uuid),
          generation: counter(key.generation, key.seq + 1).generation,
          seq: key.seq + 1,
          type: 'conflict-resolved',
          detail: { resolvedBy: actor.actorKey },
        },
        content: text,
      });
      revisionOut = revision;
      liveDocument = next.documents[document.documentId];
      return next;
    });
    const after = this.store.state();
    return {
      status: 'clean',
      document: this.#documentRow(after, liveDocument),
      revision: this.#historyRow(after, revisionOut, liveDocument),
    };
  }

  /**
   * Rename a document. Title is metadata, so no revision is created — the audit
   * event is what makes the change replayable.
   * @param {{documentId: string, title: string, via: string, actorKey?: string, sessionId?: string}} request
   * @returns {Promise<{status: string, document: object}>}
   */
  async renameDocument(request = {}) {
    const { actor, document } = this.#documentCaller(request);
    const title = requireTitle(request.title);
    const at = this.now();
    let row;
    await this.store.transact((current) => {
      const live = current.documents?.[document.documentId];
      if (live === undefined) fail('DOC_NOT_FOUND', `document ${document.documentId} disappeared`);
      const key = nextKeyFor(current, document.documentId, this.generation);
      const next = applyDocumentCommand(current, {
        type: 'document/rename',
        documentId: document.documentId,
        title,
        event: {
          eventId: newEventId(this.uuid),
          documentId: document.documentId,
          generation: key.generation,
          seq: key.seq,
          type: 'document-renamed',
          actorKey: actor.actorKey,
          nodeId: this.nodeId,
          at,
          baseRevisionId: null,
          headRevisionId: live.headRevisionId,
          proposalId: null,
          revisionId: null,
          detail: { title },
        },
      });
      row = next.documents[document.documentId];
      return next;
    });
    return { status: 'clean', document: this.#documentRow(this.store.state(), row) };
  }

  /**
   * Archive a document. A tombstone, never a delete: history stays readable.
   * @param {{documentId: string, via: string, actorKey?: string, sessionId?: string}} request
   * @returns {Promise<{status: string, document: object}>}
   */
  async archiveDocument(request = {}) {
    const { actor, document } = this.#documentCaller(request);
    const at = this.now();
    let row;
    await this.store.transact((current) => {
      const live = current.documents?.[document.documentId];
      if (live === undefined) fail('DOC_NOT_FOUND', `document ${document.documentId} disappeared`);
      if (isDocumentArchived(live)) {
        row = live;
        return current;
      }
      const key = nextKeyFor(current, document.documentId, this.generation);
      const next = applyDocumentCommand(current, {
        type: 'document/archive',
        documentId: document.documentId,
        at,
        event: {
          eventId: newEventId(this.uuid),
          documentId: document.documentId,
          generation: key.generation,
          seq: key.seq,
          type: 'document-archived',
          actorKey: actor.actorKey,
          nodeId: this.nodeId,
          at,
          baseRevisionId: null,
          headRevisionId: live.headRevisionId,
          proposalId: null,
          revisionId: null,
          detail: {},
        },
      });
      row = next.documents[document.documentId];
      return next;
    });
    return { status: 'clean', document: this.#documentRow(this.store.state(), row) };
  }

  /**
   * Grant a document maintainer. Only the Leader may, and only to a human — an
   * agent that could appoint maintainers could appoint itself.
   * @param {{documentId: string, holderKey: string, via: string, actorKey?: string,
   *   sessionId?: string}} request
   * @returns {Promise<{status: string, maintainers: object[]}>}
   */
  async grantDocumentMaintainer(request = {}) {
    const { actor, room, document } = this.#documentCaller(request);
    const state = this.store.state();
    if (!actor.isHuman || room.leaderKey === '' || room.leaderKey !== actor.actorKey) {
      fail('NOT_DOCUMENT_MAINTAINER', 'only the room Leader may grant document maintainership');
    }
    const holderKey = String(request.holderKey ?? '');
    const slash = holderKey.lastIndexOf('/');
    if (slash <= 0 || slash === holderKey.length - 1) {
      fail('DOC_COMMAND_INVALID', 'holderKey must look like `${nodeId}/${sessionId}`');
    }
    const sessionId = holderKey.slice(slash + 1);
    if (sessionId !== HUMAN_SESSION_ID) {
      fail('NOT_DOCUMENT_MAINTAINER', 'maintainership may only be granted to a human member');
    }
    if (!room.memberKeys.has(holderKey)) {
      fail('NOT_ROOM_MEMBER', `${holderKey} is not a member of room ${room.id}`);
    }
    const at = this.now();
    await this.store.transact((current) => {
      const live = current.documents?.[document.documentId];
      if (live === undefined) fail('DOC_NOT_FOUND', `document ${document.documentId} disappeared`);
      const key = nextKeyFor(current, document.documentId, this.generation);
      return applyDocumentCommand(current, {
        type: 'maintainer/grant',
        documentId: document.documentId,
        holder: {
          actorKey: holderKey,
          nodeId: holderKey.slice(0, slash),
          sessionId,
          name: String(request.holderName ?? '').trim(),
          grantedBy: actor.actorKey,
          grantedAt: at,
        },
        event: {
          eventId: newEventId(this.uuid),
          documentId: document.documentId,
          generation: key.generation,
          seq: key.seq,
          type: 'maintainer-granted',
          actorKey: actor.actorKey,
          nodeId: this.nodeId,
          at,
          baseRevisionId: null,
          headRevisionId: live.headRevisionId,
          proposalId: null,
          revisionId: null,
          detail: { holderKey },
        },
      });
    });
    const after = this.store.state();
    return { status: 'clean', maintainers: Object.values(maintainersOfDocument(after, document.documentId)) };
  }

  /* ----------------------------------------------------- projections --- */

  /**
   * Panel row for one document (§11).
   * @param {object} state - current state.
   * @param {object} document - document record.
   * @returns {object}
   */
  #documentRow(state, document) {
    const head = state.revisions?.[document.headRevisionId];
    return {
      documentId: document.documentId,
      roomId: document.roomId,
      title: document.title,
      headRevisionId: document.headRevisionId,
      authorName: head?.authorNodeName || head?.authorKey || '',
      updatedAt: head?.createdAt ?? document.createdAt,
      conflictCount: openProposalCount(state, document.documentId),
      relatedTaskId: head?.relatedTaskId ?? null,
      archived: isDocumentArchived(document),
    };
  }

  /**
   * Panel view for one document at one revision (§11).
   *
   * @param {object} state - current state.
   * @param {object} document - document record.
   * @param {string} content - reconstructed text.
   * @param {object} [actor] - resolved actor, when `canConfirm` matters.
   * @param {object} [room] - resolved room, when `canConfirm` matters.
   * @param {string} [hash] - hash of `content`; defaults to the head hash, which
   *   is only right when `content` is the head's text.
   * @returns {object}
   */
  #documentView(state, document, content, actor, room, hash) {
    return {
      documentId: document.documentId,
      roomId: document.roomId,
      title: document.title,
      headRevisionId: document.headRevisionId,
      contentHash: typeof hash === 'string' && hash !== '' ? hash : document.contentHash,
      content,
      canConfirm: actor === undefined ? false : this.#canConfirm(state, document.documentId, actor, room),
      isMaintainer: actor === undefined
        ? false
        : Object.prototype.hasOwnProperty.call(state.maintainers?.[document.documentId] ?? {}, actor.actorKey),
    };
  }

  /**
   * The newest proposal still waiting on people, if any.
   *
   * The panel needs the conflicted proposal's three texts to render a merge view,
   * and it must not have to read state to find them. Only one is surfaced: a
   * document with several open conflicts is a document whose readers need a
   * decision, not a queue of them.
   * @param {object} state - current state.
   * @param {string} documentId - document to inspect.
   * @returns {object|null}
   */
  #openProposalRow(state, documentId) {
    const open = proposalsForDocument(state, documentId).filter(
      (proposal) => proposal.status === 'conflicted' || proposal.status === 'pending',
    );
    if (open.length === 0) return null;
    const newest = open[open.length - 1];
    return {
      ...this.#proposalRow(newest),
      // base/current/proposed, because §"冲突" asks for all three side by side.
      baseRevisionId: newest.baseRevisionId,
      baseContent: this.#contentAt(documentId, newest.baseRevisionId),
      currentContent: this.#contentAt(documentId, state.documents?.[documentId]?.headRevisionId ?? null),
      conflicted: newest.status === 'conflicted',
    };
  }

  /**
   * Panel row for one revision (§11).
   * @param {object} state - current state.
   * @param {object} revision - revision record.
   * @param {object} document - document the revision belongs to.
   * @returns {object}
   */
  #historyRow(state, revision, document) {
    const types = eventsForDocument(state, document.documentId)
      .filter((event) => event.revisionId === revision.revisionId)
      .map((event) => event.type);
    return {
      revisionId: revision.revisionId,
      parentRevisionId: revision.parentRevisionId,
      authorName: revision.authorNodeName || revision.authorKey,
      createdAt: revision.createdAt,
      message: revision.message,
      source: revision.source,
      relatedTaskId: revision.relatedTaskId ?? null,
      eventTypes: types,
    };
  }

  /**
   * Panel row for one proposal (§11).
   * @param {object} proposal - proposal record.
   * @returns {object}
   */
  #proposalRow(proposal) {
    return {
      proposalId: proposal.proposalId,
      documentId: proposal.documentId,
      status: proposal.status,
      authorName: proposal.authorNodeName || proposal.authorKey,
      createdAt: proposal.createdAt,
      message: proposal.message,
      resultHash: proposal.resultHash,
      conflict: proposal.conflict === null || proposal.conflict === undefined
        ? null
        : { hunks: proposal.conflict.hunks },
    };
  }
  /**
   * The text a confirmation should commit when the caller only sends a proposal id.
   *
   * §10 gives the panel only `{documentId, proposalId}`, so the resolution text has
   * to come from the proposal itself. It is not stored verbatim: a proposal keeps
   * its patch plus `resultHash`. Replaying the patch against the proposal's own
   * base revision reproduces that text exactly — `applyPatch` is the same function
   * that produced the hash, so a mismatch means the stored record is inconsistent
   * and must fail loudly rather than commit something else.
   * @param {object} proposal - conflicted proposal carrying a resolution.
   * @returns {string} rebuilt resolution text.
   */
  #restatedResolution(proposal) {
    const base = this.#contentAt(proposal.documentId, proposal.baseRevisionId);
    const rebuilt = normalizeContent(applyPatch(base, proposal.patch));
    if (hashContent(rebuilt) !== proposal.resultHash) {
      fail('DOC_PATCH_MISMATCH', 'the stored resolution does not rebuild to the hash it was recorded with; resolve it again');
    }
    return rebuilt;
  }
}


export { HUMAN_SESSION_ID, VIA_PANEL, VIA_TOOL, resolveActor, DOC_STATE_VERSION };
