/**
 * Tests for the shared-document state layer.
 *
 * Every case here is a property the replicated state has to keep: a command
 * applied twice must be invisible the second time, an out-of-order head must be
 * refused rather than guessed at, and history must never be rewritten. The
 * fixtures are deterministic (ids from a counter, timestamps from constants) so
 * a failure points at a rule and not at the clock.
 *
 * @module dsh-lan-mesh/scripts/shared-doc-state.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DOC_COMMAND_TYPES,
  DOC_STATE_VERSION,
  DOCUMENT_FORMAT,
  EVENT_TYPES,
  MAX_ACTOR_KEY,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DOCUMENTS,
  MAX_CONTEXT_MESSAGES,
  MAX_DOC_PATCH_BYTES,
  MAX_DOC_CONTENT_BYTES,
  MAX_DOC_MESSAGE,
  MAX_DOC_TITLE,
  MAX_DOCUMENTS_PER_ROOM,
  MAX_EVENT_DETAIL_BYTES,
  MAX_HISTORY_PAGE,
  MAX_MAINTAINERS_PER_DOC,
  MAX_PROPOSALS_PER_DOC,
  OPEN_PROPOSAL_STATUSES,
  PROPOSAL_STATUSES,
  REVISION_SOURCES,
  applyDocumentCommand,
  documentsForRoom,
  emptyDocumentState,
  eventsForDocument,
  hashContent,
  isActorKey,
  isContentHash,
  isDocumentArchived,
  isDocumentId,
  isEventId,
  isIsoTimestamp,
  isProposalId,
  isRevisionId,
  isRoomId,
  maintainersOfDocument,
  newDocumentId,
  newEventId,
  newProposalId,
  newRevisionId,
  normalizeContent,
  openProposalCount,
  proposalsForDocument,
  revisionsForDocument,
} from '../lib/shared-doc-state.mjs';

const AT = '2026-10-29T00:00:00.000Z';
const LATER = '2026-10-29T01:00:00.000Z';
const ROOM = 'room-alpha';
const OTHER_ROOM = 'room-beta';
const SELF = 'node-aaa/session-1';
const PEER = 'node-bbb/session-2';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

/** Frozen id factories: a counter in the 12-character tail keeps ids readable. */
function documentIdFor(index) { return `doc-${index.toString(36).padStart(12, '0')}`; }
function revisionIdFor(index) { return `rev-${index.toString(36).padStart(12, '0')}`; }
function proposalIdFor(index) { return `prop-${index.toString(36).padStart(12, '0')}`; }
function eventIdFor(index) { return `evt-${index.toString(36).padStart(12, '0')}`; }

/**
 * One `document/create` command with every field filled in.
 * @param {object} [options] - overrides for the fields a test cares about.
 * @returns {object}
 */
function createCommand(options = {}) {
  const index = options.index ?? 1;
  const documentId = options.documentId ?? documentIdFor(index);
  const revisionId = options.revisionId ?? revisionIdFor(index);
  const eventId = options.eventId ?? eventIdFor(index);
  const roomId = options.roomId ?? ROOM;
  const actorKey = options.actorKey ?? SELF;
  const at = options.at ?? AT;
  const title = options.title ?? `Doc ${index}`;
  const contentHash = options.contentHash ?? HASH_A;
  return {
    type: 'document/create',
    document: {
      documentId,
      roomId,
      title,
      headRevisionId: revisionId,
      contentHash,
      createdBy: actorKey,
      createdAt: at,
      deletedAt: null,
      generation: 0,
      seq: 1,
    },
    revision: {
      revisionId,
      proposalId: null,
      documentId,
      parentRevisionId: null,
      baseRevisionId: null,
      authorKey: actorKey,
      authorNodeName: 'Self',
      createdAt: at,
      message: 'create',
      patch: options.patch ?? [{ baseStart: 0, baseCount: 0, lines: ['hello'] }],
      resultHash: contentHash,
      source: options.source ?? 'human',
      relatedTaskId: null,
      relatedMessageId: null,
      generation: 0,
      seq: 1,
    },
    event: eventRecord({
      eventId,
      documentId,
      type: options.eventType ?? 'document-imported',
      actorKey,
      at,
      generation: 0,
      seq: 1,
      headRevisionId: revisionId,
      revisionId,
    }),
    content: options.content,
  };
}

/**
 * One audit event with the fields the state layer validates.
 * @param {object} options - event fields.
 * @returns {object}
 */
function eventRecord(options) {
  const actorKey = options.actorKey ?? SELF;
  return {
    eventId: options.eventId ?? eventIdFor(99),
    documentId: options.documentId,
    generation: options.generation ?? 0,
    seq: options.seq ?? 1,
    type: options.type ?? 'proposal-accepted',
    actorKey,
    nodeId: options.nodeId ?? actorKey.split('/')[0],
    at: options.at ?? AT,
    baseRevisionId: options.baseRevisionId ?? null,
    headRevisionId: options.headRevisionId ?? null,
    proposalId: options.proposalId ?? null,
    revisionId: options.revisionId ?? null,
    detail: options.detail ?? {},
  };
}

/**
 * One `revision/append` command extending the current head of a document.
 * @param {object} state - state the document is read from.
 * @param {object} [options] - overrides.
 * @returns {object}
 */
function appendCommand(state, options = {}) {
  const documentId = options.documentId ?? documentIdFor(1);
  const current = state.documents[documentId];
  const revisionId = options.revisionId ?? revisionIdFor(2);
  const eventId = options.eventId ?? eventIdFor(2);
  const generation = options.generation ?? current.generation;
  const seq = options.seq ?? current.seq + 1;
  const contentHash = options.contentHash ?? HASH_B;
  const parentRevisionId = options.parentRevisionId ?? current.headRevisionId;
  const actorKey = options.actorKey ?? PEER;
  const at = options.at ?? LATER;
  return {
    type: 'revision/append',
    document: {
      documentId,
      roomId: options.roomId ?? current.roomId,
      title: options.title ?? current.title,
      headRevisionId: revisionId,
      contentHash,
      createdBy: options.createdBy ?? current.createdBy,
      createdAt: options.createdAt ?? current.createdAt,
      deletedAt: current.deletedAt,
      generation,
      seq,
    },
    revision: {
      revisionId,
      proposalId: options.proposalId ?? null,
      documentId,
      parentRevisionId,
      baseRevisionId: options.baseRevisionId ?? null,
      authorKey: actorKey,
      authorNodeName: 'Peer',
      createdAt: at,
      message: options.message ?? 'edit',
      patch: options.patch ?? [{ baseStart: 0, baseCount: 1, lines: ['hello', 'world'] }],
      resultHash: contentHash,
      source: options.source ?? 'human',
      relatedTaskId: null,
      relatedMessageId: null,
      generation,
      seq,
    },
    event: eventRecord({
      eventId,
      documentId,
      type: options.eventType ?? 'proposal-accepted',
      actorKey,
      at,
      generation,
      seq,
      baseRevisionId: options.baseRevisionId ?? null,
      headRevisionId: revisionId,
      revisionId,
    }),
    content: options.content,
  };
}

/**
 * One `proposals[]` record.
 * @param {object} document - document the proposal targets.
 * @param {object} [options] - overrides.
 * @returns {object}
 */
function proposalRecord(document, options = {}) {
  const index = options.index ?? 1;
  return {
    proposalId: options.proposalId ?? proposalIdFor(index),
    documentId: document.documentId,
    baseRevisionId: options.baseRevisionId ?? document.headRevisionId,
    authorKey: options.authorKey ?? PEER,
    authorNodeName: 'Peer',
    createdAt: options.createdAt ?? AT,
    message: options.message ?? 'edit',
    status: options.status ?? 'pending',
    patch: options.patch ?? [{ baseStart: 0, baseCount: 1, lines: ['hello', 'world'] }],
    resultHash: options.resultHash ?? HASH_B,
    conflict: options.conflict ?? null,
    resolvedBy: null,
    resolvedAt: null,
  };
}

/**
 * Freeze a state for later comparison — `JSON.parse(JSON.stringify(...))` is
 * enough here because every value in the state is JSON by contract.
 * @param {object} state - state to snapshot.
 * @returns {string}
 */
function snapshot(state) {
  return JSON.stringify(state);
}

/** A state holding one freshly created document. */
function stateWithDocument(options = {}) {
  return applyDocumentCommand(emptyDocumentState(), createCommand(options));
}

test('the module keeps the frozen limits and enums of §2 and §3', () => {
  assert.equal(DOC_STATE_VERSION, 1);
  assert.equal(MAX_DOCUMENTS_PER_ROOM, 100);
  assert.equal(MAX_DOC_TITLE, 200);
  assert.equal(MAX_DOC_MESSAGE, 2_000);
  assert.equal(MAX_DOC_CONTENT_BYTES, 256 * 1024);
  assert.equal(MAX_DOC_PATCH_BYTES, 128 * 1024);
  assert.equal(MAX_MAINTAINERS_PER_DOC, 16);
  assert.equal(MAX_PROPOSALS_PER_DOC, 200);
  assert.equal(MAX_HISTORY_PAGE, 50);
  assert.equal(MAX_CONTEXT_DOCUMENTS, 8);
  assert.equal(MAX_CONTEXT_MESSAGES, 20);
  assert.equal(MAX_CONTEXT_BYTES, 64 * 1024);
  assert.equal(MAX_EVENT_DETAIL_BYTES, 2_000);
  assert.equal(MAX_ACTOR_KEY, 129);
  assert.equal(DOCUMENT_FORMAT, 'markdown');
  assert.deepEqual(REVISION_SOURCES, ['human', 'agent', 'import', 'conflict-resolution']);
  assert.deepEqual(PROPOSAL_STATUSES, ['pending', 'conflicted', 'accepted', 'auto-merged', 'rejected', 'withdrawn']);
  assert.deepEqual(OPEN_PROPOSAL_STATUSES, ['pending', 'conflicted']);
  assert.equal(EVENT_TYPES.length, 12);
  assert.equal(EVENT_TYPES.includes('document-created'), false);
  assert.deepEqual(DOC_COMMAND_TYPES, [
    'document/create',
    'document/rename',
    'document/archive',
    'revision/append',
    'proposal/put',
    'proposal/status',
    'event/append',
    'maintainer/grant',
  ]);
});

test('an empty state has the six maps the contract names', () => {
  const state = emptyDocumentState();
  assert.deepEqual(Object.keys(state).sort(), ['documents', 'events', 'maintainers', 'proposals', 'revisions', 'version']);
  assert.equal(state.version, DOC_STATE_VERSION);
  for (const key of ['documents', 'revisions', 'proposals', 'events', 'maintainers']) {
    assert.deepEqual(state[key], {});
  }
  // Each call returns a fresh state, so two rooms cannot share one map.
  assert.notEqual(emptyDocumentState(), emptyDocumentState());
});

test('document/create stores the document, its head revision and the first event', () => {
  const state = stateWithDocument();
  const document = state.documents[documentIdFor(1)];
  assert.equal(document.documentId, documentIdFor(1));
  assert.equal(document.roomId, ROOM);
  assert.equal(document.title, 'Doc 1');
  assert.equal(document.format, 'markdown');
  assert.equal(document.headRevisionId, revisionIdFor(1));
  assert.equal(document.contentHash, HASH_A);
  assert.equal(document.createdBy, SELF);
  assert.equal(document.createdAt, AT);
  assert.equal(document.deletedAt, null);
  assert.equal(document.conflictCount, 0);
  const revision = state.revisions[revisionIdFor(1)];
  assert.equal(revision.documentId, documentIdFor(1));
  assert.equal(revision.parentRevisionId, null);
  assert.equal(revision.resultHash, HASH_A);
  assert.equal(revision.source, 'human');
  const events = eventsForDocument(state, documentIdFor(1));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'document-imported');
  assert.equal(events[0].prevHash, '');
  assert.match(events[0].hash, /^[0-9a-f]{64}$/);
});

test('document/create is idempotent for an identical retry', () => {
  const state = stateWithDocument();
  const before = snapshot(state);
  const again = applyDocumentCommand(state, createCommand());
  assert.equal(again, state);
  assert.equal(snapshot(again), before);
});

test('document/create refuses a retry that reuses the ids with different content', () => {
  const state = stateWithDocument();
  const retry = createCommand({ contentHash: HASH_B });
  assert.throws(() => applyDocumentCommand(state, retry), (error) => {
    assert.equal(error.name, 'TransportError');
    assert.equal(error.code, 'CONFLICTING_CHECKPOINT');
    return true;
  });
});

test('a command never mutates the state it was given', () => {
  const state = stateWithDocument();
  const before = snapshot(state);
  applyDocumentCommand(state, {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({
      eventId: eventIdFor(10),
      documentId: documentIdFor(1),
      type: 'document-renamed',
    }),
  });
  applyDocumentCommand(state, {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: LATER,
    event: eventRecord({ eventId: eventIdFor(11), documentId: documentIdFor(1), type: 'document-archived', at: LATER }),
  });
  applyDocumentCommand(state, { type: 'proposal/put', proposal: proposalRecord(state.documents[documentIdFor(1)]) });
  assert.equal(snapshot(state), before);
  assert.equal(state.documents[documentIdFor(1)].title, 'Doc 1');
  assert.equal(state.documents[documentIdFor(1)].deletedAt, null);
  assert.deepEqual(state.proposals, {});
});

test('document/rename retitles the document, keeps the head and appends the event', () => {
  const state = stateWithDocument();
  const next = applyDocumentCommand(state, {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: '  Renamed  ',
    event: eventRecord({
      eventId: eventIdFor(10),
      documentId: documentIdFor(1),
      type: 'document-renamed',
      detail: { title: 'Renamed' },
    }),
  });
  assert.notEqual(next, state);
  assert.equal(next.documents[documentIdFor(1)].title, 'Renamed');
  assert.equal(next.documents[documentIdFor(1)].headRevisionId, revisionIdFor(1));
  assert.equal(next.documents[documentIdFor(1)].contentHash, HASH_A);
  assert.equal(eventsForDocument(next, documentIdFor(1)).length, 2);
});

test('document/rename replays as a no-op once its event is recorded', () => {
  const rename = {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({ eventId: eventIdFor(10), documentId: documentIdFor(1), type: 'document-renamed' }),
  };
  const once = applyDocumentCommand(stateWithDocument(), rename);
  const twice = applyDocumentCommand(once, rename);
  assert.equal(twice, once);
  assert.equal(eventsForDocument(twice, documentIdFor(1)).length, 2);
});

test('document/archive writes a tombstone and keeps the history readable', () => {
  const state = stateWithDocument();
  const archived = applyDocumentCommand(state, {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: LATER,
    event: eventRecord({ eventId: eventIdFor(11), documentId: documentIdFor(1), type: 'document-archived', at: LATER }),
  });
  const document = archived.documents[documentIdFor(1)];
  assert.equal(isDocumentArchived(document), true);
  assert.equal(document.deletedAt, LATER);
  // Tombstone, not delete: the revision and both events survive.
  assert.equal(revisionsForDocument(archived, documentIdFor(1)).length, 1);
  assert.equal(eventsForDocument(archived, documentIdFor(1)).length, 2);
  assert.deepEqual(documentsForRoom(archived, ROOM), []);
  assert.deepEqual(documentsForRoom(archived, ROOM, { includeArchived: true }).map((item) => item.documentId), [documentIdFor(1)]);
});

test('document/archive keeps the first timestamp when two nodes archive at once', () => {
  const archived = applyDocumentCommand(stateWithDocument(), {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: AT,
    event: eventRecord({ eventId: eventIdFor(11), documentId: documentIdFor(1), type: 'document-archived' }),
  });
  const later = applyDocumentCommand(archived, {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: LATER,
    event: eventRecord({ eventId: eventIdFor(12), documentId: documentIdFor(1), type: 'document-archived', at: LATER }),
  });
  assert.equal(later.documents[documentIdFor(1)].deletedAt, AT);
  assert.equal(eventsForDocument(later, documentIdFor(1)).length, 3);
});

test('an archived document refuses new revisions and new proposals', () => {
  const archived = applyDocumentCommand(stateWithDocument(), {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: LATER,
    event: eventRecord({ eventId: eventIdFor(11), documentId: documentIdFor(1), type: 'document-archived', at: LATER }),
  });
  assert.throws(() => applyDocumentCommand(archived, appendCommand(archived)), (error) => {
    assert.equal(error.code, 'DOC_NOT_FOUND');
    return true;
  });
  assert.throws(
    () => applyDocumentCommand(archived, { type: 'proposal/put', proposal: proposalRecord(archived.documents[documentIdFor(1)]) }),
    (error) => {
      assert.equal(error.code, 'DOC_NOT_FOUND');
      return true;
    },
  );
});

test('titles are refused when empty, over-long or multi-line', () => {
  const state = emptyDocumentState();
  for (const title of ['', '   ', 'a'.repeat(MAX_DOC_TITLE + 1), 'two\nlines', 'tab\there']) {
    assert.throws(() => applyDocumentCommand(state, createCommand({ title })), (error) => {
      assert.equal(error.code, 'DOC_TITLE_INVALID');
      return true;
    });
  }
  // Exactly at the limit is fine.
  const ok = applyDocumentCommand(state, createCommand({ title: 'a'.repeat(MAX_DOC_TITLE) }));
  assert.equal(ok.documents[documentIdFor(1)].title.length, MAX_DOC_TITLE);
});

test('a body above MAX_DOC_CONTENT_BYTES is refused instead of truncated', () => {
  const state = emptyDocumentState();
  assert.throws(
    () => applyDocumentCommand(state, createCommand({ content: 'x'.repeat(MAX_DOC_CONTENT_BYTES + 1) })),
    (error) => {
      assert.equal(error.code, 'DOC_CONTENT_TOO_LARGE');
      return true;
    },
  );
  const ok = applyDocumentCommand(state, createCommand({ content: 'x'.repeat(MAX_DOC_CONTENT_BYTES) }));
  assert.equal(ok.documents[documentIdFor(1)].documentId, documentIdFor(1));
});

test('the exported hash helper follows §1 normalization, not the raw bytes', () => {
  // The coordinator hashes bodies too, so the algorithm must be importable from
  // one place: CRLF is folded and the ends are trimmed before hashing, and the
  // same text written two ways hashes identically.
  assert.equal(hashContent('hello\r\nworld\r\n'), hashContent('  hello\nworld  '));
  assert.equal(hashContent('hello\nworld'), hashContent('hello\nworld\n'));
  assert.notEqual(hashContent('hello'), hashContent('Hello'));
  // Interior whitespace is part of the content and is never rewritten.
  assert.notEqual(hashContent('a\n\nb'), hashContent('a\nb'));
  assert.equal(normalizeContent(' \r\n a \r\n b \r\n '), 'a \n b');
  assert.equal(hashContent('hello\nworld').length, 64);
  assert.match(hashContent('hello\nworld'), /^[0-9a-f]{64}$/);
  // A value that is not text is a command error, not a silent coercion.
  assert.throws(() => hashContent(7), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
});

test('a patch above MAX_DOC_PATCH_BYTES is refused', () => {
  const state = emptyDocumentState();
  const patch = [{ baseStart: 0, baseCount: 0, lines: ['x'.repeat(MAX_DOC_PATCH_BYTES)] }];
  assert.throws(() => applyDocumentCommand(state, createCommand({ patch })), (error) => {
    assert.equal(error.code, 'DOC_PATCH_TOO_LARGE');
    return true;
  });
});

test('a malformed patch shape is refused as a patch mismatch', () => {
  const state = emptyDocumentState();
  for (const patch of ['not-a-patch', [{ baseStart: -1, baseCount: 0, lines: [] }], [{ baseStart: 0, baseCount: 0, lines: [1] }]]) {
    assert.throws(() => applyDocumentCommand(state, createCommand({ patch })), (error) => {
      assert.equal(error.code, 'DOC_PATCH_MISMATCH');
      return true;
    });
  }
});

test('malformed ids are refused with the code that names the problem', () => {
  const state = emptyDocumentState();
  // A document id that cannot name a document is reported as a missing document.
  assert.throws(() => applyDocumentCommand(state, createCommand({ documentId: 'doc-1' })), (error) => {
    assert.equal(error.code, 'DOC_NOT_FOUND');
    return true;
  });
  assert.throws(() => applyDocumentCommand(state, createCommand({ roomId: 'alpha' })), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
  assert.equal(isDocumentId('doc-abcdef123456'), true);
  assert.equal(isDocumentId('doc-ABCDEF123456'), false);
  assert.equal(isRevisionId('rev-abcdef123456'), true);
  assert.equal(isProposalId('prop-abcdef123456'), true);
  assert.equal(isEventId('evt-abcdef123456'), true);
  assert.equal(isContentHash(HASH_A), true);
  assert.equal(isContentHash('a'.repeat(63)), false);
  assert.equal(isActorKey(SELF), true);
  assert.equal(isActorKey('no-slash'), false);
  assert.equal(isRoomId(ROOM), true);
  assert.equal(isRoomId('room-a'), false);
  assert.equal(isIsoTimestamp(AT), true);
  assert.equal(isIsoTimestamp('yesterday'), false);
});

test('a state that is not a state document is reported as corrupt', () => {
  assert.throws(() => applyDocumentCommand(null, createCommand()), (error) => {
    assert.equal(error.code, 'DOC_STORE_CORRUPT');
    return true;
  });
  assert.throws(() => applyDocumentCommand({ documents: [] }, createCommand()), (error) => {
    assert.equal(error.code, 'DOC_STORE_CORRUPT');
    return true;
  });
});

test('the room document limit is enforced before a document is stored', () => {
  let state = emptyDocumentState();
  for (let index = 1; index <= MAX_DOCUMENTS_PER_ROOM; index += 1) {
    state = applyDocumentCommand(state, createCommand({ index, title: `Doc ${index}` }));
  }
  assert.equal(documentsForRoom(state, ROOM).length, MAX_DOCUMENTS_PER_ROOM);
  assert.throws(
    () => applyDocumentCommand(state, createCommand({ index: MAX_DOCUMENTS_PER_ROOM + 1 })),
    (error) => {
      assert.equal(error.code, 'DOC_LIMIT_REACHED');
      return true;
    },
  );
  // Another room is unaffected by the first room's limit.
  const elsewhere = applyDocumentCommand(state, createCommand({ index: 900, roomId: OTHER_ROOM }));
  assert.equal(documentsForRoom(elsewhere, OTHER_ROOM).length, 1);
});

test('revision/append moves the head and keeps history in (generation, seq) order', () => {
  const state = stateWithDocument();
  const next = applyDocumentCommand(state, appendCommand(state));
  const document = next.documents[documentIdFor(1)];
  assert.equal(document.headRevisionId, revisionIdFor(2));
  assert.equal(document.contentHash, HASH_B);
  assert.equal(document.seq, 2);
  const history = revisionsForDocument(next, documentIdFor(1));
  assert.deepEqual(history.map((item) => item.revisionId), [revisionIdFor(1), revisionIdFor(2)]);
  assert.equal(history[1].parentRevisionId, revisionIdFor(1));
  assert.equal(history[1].baseRevisionId, null);
  assert.equal(eventsForDocument(next, documentIdFor(1)).length, 2);
});

test('revision/append replays as a no-op once the revision is stored', () => {
  const state = stateWithDocument();
  const command = appendCommand(state);
  const once = applyDocumentCommand(state, command);
  const twice = applyDocumentCommand(once, command);
  assert.equal(twice, once);
  assert.equal(revisionsForDocument(twice, documentIdFor(1)).length, 2);
});

test('revision/append refuses a parent that is not the current head', () => {
  const state = stateWithDocument();
  const command = appendCommand(state, { parentRevisionId: revisionIdFor(999) });
  assert.throws(() => applyDocumentCommand(state, command), (error) => {
    assert.equal(error.code, 'CONFLICTING_CHECKPOINT');
    return true;
  });
});

test('revision/append refuses a head that does not sort after the current one', () => {
  const state = stateWithDocument();
  // Same (generation, seq) as the current head: §4 forbids picking a winner.
  const command = appendCommand(state, { generation: 0, seq: 1 });
  assert.throws(() => applyDocumentCommand(state, command), (error) => {
    assert.equal(error.code, 'CONFLICTING_CHECKPOINT');
    return true;
  });
});

test('revision/append refuses a base that is not in the history', () => {
  const state = stateWithDocument();
  const command = appendCommand(state, { baseRevisionId: revisionIdFor(999) });
  assert.throws(() => applyDocumentCommand(state, command), (error) => {
    assert.equal(error.code, 'DOC_BASE_NOT_FOUND');
    return true;
  });
});

test('revision/append refuses a document view that disagrees with the revision', () => {
  const state = stateWithDocument();
  const command = appendCommand(state);
  command.document.contentHash = HASH_A;
  assert.throws(() => applyDocumentCommand(state, command), (error) => {
    assert.equal(error.code, 'DOC_PATCH_MISMATCH');
    return true;
  });
});

test('revision/append refuses to change the room or the creator of a document', () => {
  const state = stateWithDocument();
  const command = appendCommand(state, { roomId: OTHER_ROOM });
  assert.throws(() => applyDocumentCommand(state, command), (error) => {
    assert.equal(error.code, 'DOC_PATCH_MISMATCH');
    return true;
  });
});

test('a revision that cannot advance an archived document is refused', () => {
  const archived = applyDocumentCommand(stateWithDocument(), {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: AT,
    event: eventRecord({ eventId: eventIdFor(11), documentId: documentIdFor(1), type: 'document-archived' }),
  });
  assert.throws(() => applyDocumentCommand(archived, appendCommand(archived)), (error) => {
    assert.equal(error.code, 'DOC_NOT_FOUND');
    return true;
  });
});

test('proposal/put records a proposal and is idempotent for the same content', () => {
  const state = stateWithDocument();
  const proposal = proposalRecord(state.documents[documentIdFor(1)]);
  const once = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  assert.deepEqual(Object.keys(once.proposals), [proposal.proposalId]);
  assert.equal(once.proposals[proposal.proposalId].status, 'pending');
  assert.equal(openProposalCount(once, documentIdFor(1)), 1);
  const twice = applyDocumentCommand(once, { type: 'proposal/put', proposal });
  assert.equal(twice, once);
});

test('proposal/put refuses a reused proposal id with different content', () => {
  const state = stateWithDocument();
  const proposal = proposalRecord(state.documents[documentIdFor(1)]);
  const once = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  const reused = { ...proposal, resultHash: HASH_A };
  assert.throws(() => applyDocumentCommand(once, { type: 'proposal/put', proposal: reused }), (error) => {
    assert.equal(error.code, 'DOC_PROPOSAL_ID_REUSED');
    return true;
  });
});

test('a resolution may re-answer a conflicted proposal under the same id', () => {
  // Resolving a conflict rewrites the answer to one question, so the id stays.
  // Everything that identifies the question must stay identical; only the text,
  // its patch/hash, the message and the resolver may move.
  const state = stateWithDocument();
  const proposal = { ...proposalRecord(state.documents[documentIdFor(1)]), status: 'conflicted' };
  const once = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  const answered = {
    ...proposal,
    resultHash: HASH_A,
    patch: [{ baseStart: 0, baseCount: 1, lines: ['resolved'] }],
    message: 'merged by hand',
    resolvedBy: 'node-aaa/human',
    resolvedAt: '2026-10-30T00:00:00.000Z',
  };
  const twice = applyDocumentCommand(once, { type: 'proposal/put', proposal: answered });
  assert.equal(twice.proposals[proposal.proposalId].resultHash, HASH_A);
  assert.equal(twice.proposals[proposal.proposalId].message, 'merged by hand');
  assert.equal(twice.proposals[proposal.proposalId].status, 'conflicted');
  assert.notEqual(twice, once);
});

test('a resolution may not change what the proposal is about', () => {
  // The refinement path is narrow on purpose: moving the author, the base or the
  // document would make the id stand for a different question, which is exactly
  // what the reuse guard exists to stop.
  const state = stateWithDocument();
  const proposal = { ...proposalRecord(state.documents[documentIdFor(1)]), status: 'conflicted' };
  const once = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  const answer = { resultHash: HASH_A, message: 'merged by hand' };

  assert.throws(
    () => applyDocumentCommand(once, { type: 'proposal/put', proposal: { ...proposal, ...answer, authorKey: 'node-bbb/human' } }),
    (error) => {
      assert.equal(error.code, 'DOC_PROPOSAL_ID_REUSED');
      return true;
    },
    'moving the author must not be treated as a resolution',
  );

  // A different document is refused even earlier: the document must exist before
  // the id can be looked up in it.
  assert.throws(
    () => applyDocumentCommand(once, { type: 'proposal/put', proposal: { ...proposal, ...answer, documentId: documentIdFor(2) } }),
    (error) => {
      assert.equal(error.code, 'DOC_NOT_FOUND');
      return true;
    },
    'moving the document must not be treated as a resolution',
  );

  // Re-answering a proposal that is already settled is history rewriting, not a
  // resolution: only a conflicted proposal can still be answered.
  const settled = { ...proposal, status: 'accepted' };
  const accepted = applyDocumentCommand(state, { type: 'proposal/put', proposal: settled });
  assert.throws(
    () => applyDocumentCommand(accepted, { type: 'proposal/put', proposal: { ...settled, ...answer } }),
    (error) => {
      assert.equal(error.code, 'DOC_PROPOSAL_ID_REUSED');
      return true;
    },
    'a settled proposal may not be re-answered',
  );
});

test('proposal/put refuses a base revision outside the history', () => {
  const state = stateWithDocument();
  const proposal = proposalRecord(state.documents[documentIdFor(1)], { baseRevisionId: revisionIdFor(999) });
  assert.throws(() => applyDocumentCommand(state, { type: 'proposal/put', proposal }), (error) => {
    assert.equal(error.code, 'DOC_BASE_NOT_FOUND');
    return true;
  });
});

test('proposal/put stops at MAX_PROPOSALS_PER_DOC unresolved proposals', () => {
  const state = stateWithDocument();
  const document = state.documents[documentIdFor(1)];
  let withProposals = state;
  for (let index = 1; index <= MAX_PROPOSALS_PER_DOC; index += 1) {
    withProposals = applyDocumentCommand(withProposals, {
      type: 'proposal/put',
      proposal: proposalRecord(document, { index, proposalId: proposalIdFor(index) }),
    });
  }
  assert.equal(openProposalCount(withProposals, documentIdFor(1)), MAX_PROPOSALS_PER_DOC);
  assert.throws(
    () => applyDocumentCommand(withProposals, {
      type: 'proposal/put',
      proposal: proposalRecord(document, { index: MAX_PROPOSALS_PER_DOC + 1, proposalId: proposalIdFor(MAX_PROPOSALS_PER_DOC + 1) }),
    }),
    (error) => {
      assert.equal(error.code, 'DOC_LIMIT_REACHED');
      return true;
    },
  );
  // Resolving one frees a slot: the limit counts unresolved proposals only.
  const resolved = applyDocumentCommand(withProposals, {
    type: 'proposal/status',
    proposalId: proposalIdFor(1),
    status: 'accepted',
    event: eventRecord({ eventId: eventIdFor(500), documentId: document.documentId, type: 'proposal-accepted' }),
  });
  assert.equal(openProposalCount(resolved, documentIdFor(1)), MAX_PROPOSALS_PER_DOC - 1);
  const accepted = applyDocumentCommand(resolved, {
    type: 'proposal/put',
    proposal: proposalRecord(document, { index: MAX_PROPOSALS_PER_DOC + 1, proposalId: proposalIdFor(MAX_PROPOSALS_PER_DOC + 1) }),
  });
  assert.equal(Object.keys(accepted.proposals).length, MAX_PROPOSALS_PER_DOC + 1);
});

test('proposal/status moves the proposal and keeps conflictCount a projection', () => {
  const state = stateWithDocument();
  const document = state.documents[documentIdFor(1)];
  const proposal = proposalRecord(document);
  const withProposal = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  const conflicted = applyDocumentCommand(withProposal, {
    type: 'proposal/status',
    proposalId: proposal.proposalId,
    status: 'conflicted',
    event: eventRecord({ eventId: eventIdFor(20), documentId: document.documentId, type: 'conflict-detected' }),
  });
  assert.equal(conflicted.proposals[proposal.proposalId].status, 'conflicted');
  assert.equal(conflicted.documents[document.documentId].conflictCount, 1);
  const resolved = applyDocumentCommand(conflicted, {
    type: 'proposal/status',
    proposalId: proposal.proposalId,
    status: 'accepted',
    resolvedBy: SELF,
    resolvedAt: LATER,
    event: eventRecord({
      eventId: eventIdFor(21),
      documentId: document.documentId,
      type: 'conflict-resolved',
      at: LATER,
      actorKey: SELF,
    }),
  });
  assert.equal(resolved.proposals[proposal.proposalId].status, 'accepted');
  assert.equal(resolved.proposals[proposal.proposalId].resolvedBy, SELF);
  assert.equal(resolved.proposals[proposal.proposalId].resolvedAt, LATER);
  assert.equal(resolved.documents[document.documentId].conflictCount, 0);
  assert.equal(proposalsForDocument(resolved, document.documentId).length, 1);
});

test('proposal/status refuses an unknown proposal and a status outside the enum', () => {
  const state = stateWithDocument();
  const document = state.documents[documentIdFor(1)];
  const proposal = proposalRecord(document);
  const withProposal = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  assert.throws(
    () => applyDocumentCommand(withProposal, {
      type: 'proposal/status',
      proposalId: proposalIdFor(999),
      status: 'accepted',
      event: eventRecord({ eventId: eventIdFor(30), documentId: document.documentId, type: 'proposal-accepted' }),
    }),
    (error) => {
      assert.equal(error.code, 'DOC_NOT_FOUND');
      return true;
    },
  );
  assert.throws(
    () => applyDocumentCommand(withProposal, {
      type: 'proposal/status',
      proposalId: proposal.proposalId,
      status: 'approved',
      event: eventRecord({ eventId: eventIdFor(31), documentId: document.documentId, type: 'proposal-accepted' }),
    }),
    (error) => {
      assert.equal(error.code, 'DOC_COMMAND_INVALID');
      return true;
    },
  );
});

test('proposal/status replays as a no-op once its event is recorded', () => {
  const state = stateWithDocument();
  const document = state.documents[documentIdFor(1)];
  const proposal = proposalRecord(document);
  const withProposal = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  const command = {
    type: 'proposal/status',
    proposalId: proposal.proposalId,
    status: 'rejected',
    event: eventRecord({ eventId: eventIdFor(40), documentId: document.documentId, type: 'proposal-rejected' }),
  };
  const once = applyDocumentCommand(withProposal, command);
  const twice = applyDocumentCommand(once, command);
  assert.equal(twice, once);
});

test('maintainer/grant is additive and the first grant wins', () => {
  const state = stateWithDocument();
  const holder = {
    actorKey: PEER,
    nodeId: 'node-bbb',
    sessionId: 'session-2',
    name: 'Peer',
    grantedBy: SELF,
    grantedAt: AT,
  };
  const granted = applyDocumentCommand(state, {
    type: 'maintainer/grant',
    documentId: documentIdFor(1),
    holder,
    event: eventRecord({ eventId: eventIdFor(50), documentId: documentIdFor(1), type: 'maintainer-granted' }),
  });
  assert.deepEqual(maintainersOfDocument(granted, documentIdFor(1)), { [PEER]: holder });
  const regranted = applyDocumentCommand(granted, {
    type: 'maintainer/grant',
    documentId: documentIdFor(1),
    holder: { ...holder, name: 'Somebody Else' },
    event: eventRecord({ eventId: eventIdFor(51), documentId: documentIdFor(1), type: 'maintainer-granted' }),
  });
  // The name keeps what the first grant said; the extra delivery is still logged.
  assert.equal(maintainersOfDocument(regranted, documentIdFor(1))[PEER].name, 'Peer');
  assert.equal(eventsForDocument(regranted, documentIdFor(1)).length, 3);
});

test('maintainer/grant stops at MAX_MAINTAINERS_PER_DOC', () => {
  let state = stateWithDocument();
  for (let index = 1; index <= MAX_MAINTAINERS_PER_DOC; index += 1) {
    state = applyDocumentCommand(state, {
      type: 'maintainer/grant',
      documentId: documentIdFor(1),
      holder: {
        actorKey: `node-h${index}/session-${index}`,
        nodeId: `node-h${index}`,
        sessionId: `session-${index}`,
        name: `Holder ${index}`,
        grantedBy: SELF,
        grantedAt: AT,
      },
      event: eventRecord({ eventId: eventIdFor(600 + index), documentId: documentIdFor(1), type: 'maintainer-granted' }),
    });
  }
  assert.equal(Object.keys(maintainersOfDocument(state, documentIdFor(1))).length, MAX_MAINTAINERS_PER_DOC);
  assert.throws(
    () => applyDocumentCommand(state, {
      type: 'maintainer/grant',
      documentId: documentIdFor(1),
      holder: {
        actorKey: 'node-h99/session-99',
        nodeId: 'node-h99',
        sessionId: 'session-99',
        name: 'Holder 99',
        grantedBy: SELF,
        grantedAt: AT,
      },
      event: eventRecord({ eventId: eventIdFor(699), documentId: documentIdFor(1), type: 'maintainer-granted' }),
    }),
    (error) => {
      assert.equal(error.code, 'DOC_LIMIT_REACHED');
      return true;
    },
  );
});

test('a holder whose actor key disagrees with its parts is refused', () => {
  const state = stateWithDocument();
  assert.throws(
    () => applyDocumentCommand(state, {
      type: 'maintainer/grant',
      documentId: documentIdFor(1),
      holder: {
        actorKey: PEER,
        nodeId: 'node-bbb',
        sessionId: 'session-3',
        name: 'Peer',
        grantedBy: SELF,
        grantedAt: AT,
      },
      event: eventRecord({ eventId: eventIdFor(52), documentId: documentIdFor(1), type: 'maintainer-granted' }),
    }),
    (error) => {
      assert.equal(error.code, 'DOC_COMMAND_INVALID');
      return true;
    },
  );
});

test('events chain by prevHash and are sealed with a hash of their content', () => {
  const state = stateWithDocument();
  const renamed = applyDocumentCommand(state, {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({ eventId: eventIdFor(10), documentId: documentIdFor(1), type: 'document-renamed' }),
  });
  const events = eventsForDocument(renamed, documentIdFor(1));
  assert.equal(events.length, 2);
  assert.equal(events[0].prevHash, '');
  assert.equal(events[1].prevHash, events[0].hash);
  assert.notEqual(events[0].hash, events[1].hash);
  for (const event of events) {
    assert.match(event.hash, /^[0-9a-f]{64}$/);
    assert.equal(event.documentId, documentIdFor(1));
  }
  // A different detail must produce a different hash, or the chain proves nothing.
  const other = applyDocumentCommand(stateWithDocument(), {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({
      eventId: eventIdFor(10),
      documentId: documentIdFor(1),
      type: 'document-renamed',
      detail: { title: 'different' },
    }),
  });
  assert.notEqual(eventsForDocument(other, documentIdFor(1))[1].hash, events[1].hash);
});

test('event/append dedupes and still works for an archived document', () => {
  const archived = applyDocumentCommand(stateWithDocument(), {
    type: 'document/archive',
    documentId: documentIdFor(1),
    at: LATER,
    event: eventRecord({ eventId: eventIdFor(11), documentId: documentIdFor(1), type: 'document-archived', at: LATER }),
  });
  const command = {
    type: 'event/append',
    documentId: documentIdFor(1),
    event: eventRecord({
      eventId: eventIdFor(60),
      documentId: documentIdFor(1),
      type: 'document-exported',
      at: LATER,
      detail: { path: 'out.md' },
    }),
  };
  const once = applyDocumentCommand(archived, command);
  assert.equal(eventsForDocument(once, documentIdFor(1)).length, 3);
  assert.equal(eventsForDocument(once, documentIdFor(1))[2].type, 'document-exported');
  assert.equal(applyDocumentCommand(once, command), once);
});

test('an event that contradicts the status it reports is refused', () => {
  const state = stateWithDocument();
  const document = state.documents[documentIdFor(1)];
  const proposal = proposalRecord(document);
  const withProposal = applyDocumentCommand(state, { type: 'proposal/put', proposal });
  const accepted = applyDocumentCommand(withProposal, {
    type: 'proposal/status',
    proposalId: proposal.proposalId,
    status: 'accepted',
    event: eventRecord({ eventId: eventIdFor(70), documentId: document.documentId, type: 'proposal-accepted' }),
  });
  // Replaying the same event id with a different requested status must not
  // silently rewrite the proposal.
  assert.throws(
    () => applyDocumentCommand(accepted, {
      type: 'proposal/status',
      proposalId: proposal.proposalId,
      status: 'withdrawn',
      event: eventRecord({ eventId: eventIdFor(70), documentId: document.documentId, type: 'proposal-accepted' }),
    }),
    (error) => {
      assert.equal(error.code, 'CONFLICTING_CHECKPOINT');
      return true;
    },
  );
});

test('an event of an unknown type or for the wrong document is refused', () => {
  const state = stateWithDocument();
  const wrongType = {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({ eventId: eventIdFor(80), documentId: documentIdFor(1), type: 'document-created' }),
  };
  assert.throws(() => applyDocumentCommand(state, wrongType), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
  const wrongDocument = {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({ eventId: eventIdFor(81), documentId: documentIdFor(2), type: 'document-renamed' }),
  };
  assert.throws(() => applyDocumentCommand(state, wrongDocument), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
  // The audit event must belong to the node it claims.
  const wrongNode = {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({
      eventId: eventIdFor(82),
      documentId: documentIdFor(1),
      type: 'document-renamed',
      actorKey: PEER,
      nodeId: 'node-aaa',
    }),
  };
  assert.throws(() => applyDocumentCommand(state, wrongNode), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
});

test('an over-long event detail is refused instead of dropped', () => {
  const state = stateWithDocument();
  const oversized = {
    type: 'document/rename',
    documentId: documentIdFor(1),
    title: 'Renamed',
    event: eventRecord({
      eventId: eventIdFor(83),
      documentId: documentIdFor(1),
      type: 'document-renamed',
      detail: { note: 'x'.repeat(MAX_EVENT_DETAIL_BYTES + 1) },
    }),
  };
  assert.throws(() => applyDocumentCommand(state, oversized), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
});

test('unknown commands are refused', () => {
  const state = emptyDocumentState();
  assert.throws(() => applyDocumentCommand(state, { type: 'document/delete' }), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
  assert.throws(() => applyDocumentCommand(state, 'not-a-command'), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
});

test('a command for a document that does not exist is reported as DOC_NOT_FOUND', () => {
  const state = emptyDocumentState();
  assert.throws(
    () => applyDocumentCommand(state, {
      type: 'document/rename',
      documentId: documentIdFor(7),
      title: 'Nope',
      event: eventRecord({ eventId: eventIdFor(90), documentId: documentIdFor(7), type: 'document-renamed' }),
    }),
    (error) => {
      assert.equal(error.code, 'DOC_NOT_FOUND');
      return true;
    },
  );
});

test('ids minted from a uuid source match the frozen patterns', () => {
  const uuid = () => 'ABCDEF12-3456-7890-abcd-ef1234567890';
  assert.equal(newDocumentId(uuid), 'doc-abcdef123456');
  assert.equal(newRevisionId(uuid), 'rev-abcdef123456');
  assert.equal(newProposalId(uuid), 'prop-abcdef123456');
  assert.equal(newEventId(uuid), 'evt-abcdef123456');
  assert.equal(isDocumentId(newDocumentId(uuid)), true);
  assert.equal(isEventId(newEventId(uuid)), true);
  assert.throws(() => newDocumentId(() => 'short'), (error) => {
    assert.equal(error.code, 'DOC_COMMAND_INVALID');
    return true;
  });
});

test('read helpers return copies and stable orders', () => {
  let state = stateWithDocument({ index: 1, title: 'Zulu' });
  state = applyDocumentCommand(state, createCommand({ index: 2, title: 'Alpha' }));
  state = applyDocumentCommand(state, createCommand({ index: 3, title: 'Mike' }));
  assert.deepEqual(
    documentsForRoom(state, ROOM).map((document) => document.title),
    ['Alpha', 'Mike', 'Zulu'],
  );
  const events = eventsForDocument(state, documentIdFor(1));
  events.push({ eventId: eventIdFor(999) });
  assert.equal(eventsForDocument(state, documentIdFor(1)).length, 1);
  assert.deepEqual(revisionsForDocument(state, documentIdFor(2)).map((revision) => revision.revisionId), [revisionIdFor(2)]);
  assert.deepEqual(proposalsForDocument(state, documentIdFor(1)), []);
  assert.deepEqual(maintainersOfDocument(state, documentIdFor(1)), {});
});
