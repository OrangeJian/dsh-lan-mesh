/**
 * Tests for the shared-document wire protocol layer.
 *
 * Every case here is a promise two machines make to each other: the signature
 * a node computes does not depend on its field order, a checkpoint disagreement
 * is reported instead of resolved, and a batch with a hole is refused whole
 * rather than applied halfway. The state fixtures are built through the real
 * `applyDocumentCommand`, so a protocol test can never quietly depend on a state
 * shape the state layer would reject.
 *
 * @module dsh-lan-mesh/scripts/shared-doc-protocol.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_BODY_BYTES } from '../lib/transport.mjs';
import { applyDocumentCommand, emptyDocumentState } from '../lib/shared-doc-state.mjs';

const api = await import('../lib/shared-doc-protocol.mjs').catch(() => ({}));

const AT = '2026-10-29T00:00:00.000Z';
const ROOM = 'room-alpha';
const SELF = 'node-aaa/session-1';
const DOC_A = 'doc-aaaaaaaaaaaa';
const DOC_B = 'doc-bbbbbbbbbbbb';
const REV_A = 'rev-aaaaaaaaaaaa';
const EVT_A = 'evt-aaaaaaaaaaaa';
const EVT_B = 'evt-bbbbbbbbbbbb';
const EVT_C = 'evt-cccccccccccc';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

/**
 * Assert a call fails with a specific §7 code.
 * @param {() => unknown} fn - call expected to throw.
 * @param {string} code - expected `TransportError.code`.
 * @returns {Error} the thrown error, for further assertions.
 */
function expectCode(fn, code) {
  let caught;
  assert.throws(fn, (error) => {
    caught = error;
    return error?.name === 'TransportError' && error.code === code;
  });
  return caught;
}

/** One audit event, in the shape the state layer validates. */
function eventRecord({ eventId, type, seq, generation = 0, headRevisionId = null, revisionId = null }) {
  return {
    eventId,
    documentId: DOC_A,
    generation,
    seq,
    type,
    actorKey: SELF,
    nodeId: 'node-aaa',
    at: AT,
    baseRevisionId: null,
    headRevisionId,
    proposalId: null,
    revisionId,
    detail: {},
  };
}

/** A complete `document/create` command, matching state §13 裁定 3. */
function createCommand() {
  return {
    type: 'document/create',
    document: {
      documentId: DOC_A,
      roomId: ROOM,
      title: 'Doc A',
      headRevisionId: REV_A,
      contentHash: HASH_A,
      createdBy: SELF,
      createdAt: AT,
      deletedAt: null,
      generation: 0,
      seq: 1,
    },
    revision: {
      revisionId: REV_A,
      proposalId: null,
      documentId: DOC_A,
      parentRevisionId: null,
      baseRevisionId: null,
      authorKey: SELF,
      authorNodeName: 'Self',
      createdAt: AT,
      message: 'create',
      patch: [{ baseStart: 0, baseCount: 0, lines: ['hello'] }],
      resultHash: HASH_A,
      source: 'human',
      relatedTaskId: null,
      relatedMessageId: null,
      generation: 0,
      seq: 1,
    },
    event: eventRecord({ eventId: EVT_A, type: 'document-imported', seq: 1, headRevisionId: REV_A, revisionId: REV_A }),
    content: 'hello',
  };
}

/** A `document/rename` command wrapped as a sync event at `(generation, seq)`. */
function renameSyncEvent({ eventId, seq, title, generation = 0 }) {
  return {
    documentId: DOC_A,
    eventId,
    generation,
    seq,
    hash: null,
    command: {
      type: 'document/rename',
      documentId: DOC_A,
      title,
      event: eventRecord({ eventId, type: 'document-renamed', seq, generation, headRevisionId: REV_A }),
    },
  };
}

/** The `document/create` command wrapped as a sync event. */
function createSyncEvent(overrides = {}) {
  return {
    documentId: DOC_A,
    eventId: EVT_A,
    generation: 0,
    seq: 1,
    hash: null,
    command: createCommand(),
    ...overrides,
  };
}

/** A state that already holds `DOC_A` at `(generation 0, seq 1)`. */
function stateWithDocument() {
  return applyDocumentCommand(emptyDocumentState(), createCommand());
}

test('module exports the frozen protocol surface', () => {
  for (const name of [
    'signingFragment',
    'normalizeSharedDocEnvelope',
    'peerSupportsSharedDocs',
    'requireSharedDocsPeer',
    'sharedDocRequest',
    'sharedDocResponse',
    'planSyncEvents',
    'applySyncEvent',
    'applySyncResponse',
    'compareCheckpoint',
    'submitPayload',
    'statusPayload',
    'assertSharedDocBody',
  ]) {
    assert.equal(typeof api[name], 'function', `${name} must be exported`);
  }
  assert.equal(api.SHARED_DOCS_CAPABILITY, 1);
  assert.equal(api.SHARED_DOCS_VERSION, 1);
  assert.equal(api.SHARED_DOCS_KIND, 'shared-doc');
  assert.deepEqual(api.SHARED_DOC_OPS, ['submit', 'status', 'sync']);
  assert.equal(api.SHARED_DOCS_SIGNING_TAG, 'sharedDocs:1');
});

/* ------------------------------------------------------------- signing --- */

test('signingFragment is byte-identical however the envelope fields were ordered', () => {
  assert.equal(typeof api.signingFragment, 'function');
  const one = {
    kind: 'shared-doc',
    documentId: DOC_A,
    op: 'submit',
    from: { nodeId: 'node-aaa', sessionId: 'session-1' },
    payload: { zeta: 1, alpha: 2 },
  };
  // Same envelope, every field inserted in the opposite order, nested included.
  const other = {
    payload: { alpha: 2, zeta: 1 },
    op: 'submit',
    from: { sessionId: 'session-1', nodeId: 'node-aaa' },
    documentId: DOC_A,
    kind: 'shared-doc',
  };
  assert.equal(api.signingFragment(one), api.signingFragment(other));
  assert.equal(typeof api.signingFragment(one), 'string');
});

test('signingFragment ignores payload key order at every depth, so two nodes sign one string', () => {
  assert.equal(typeof api.signingFragment, 'function');
  // §15 裁定: this is the property that lets two machines agree. The payload is
  // the part that arrives built by different code paths, so it is the part most
  // likely to be reordered; a signature that followed insertion order would make
  // an honest peer look like a forger.
  const plain = {
    kind: 'shared-doc',
    sharedDocsVersion: 1,
    documentId: DOC_A,
    op: 'submit',
    from: { nodeId: 'node-aaa', sessionId: 'session-1' },
    payload: {
      proposalId: 'prop-aaaaaaaaaaaa',
      baseRevisionId: REV_A,
      resultHash: HASH_A,
      patch: [{ baseStart: 0, baseCount: 1, lines: ['alpha', 'beta'], meta: { y: 1, x: 2 } }],
    },
  };
  const shuffled = {
    payload: {
      patch: [{ meta: { x: 2, y: 1 }, lines: ['alpha', 'beta'], baseCount: 1, baseStart: 0 }],
      resultHash: HASH_A,
      baseRevisionId: REV_A,
      proposalId: 'prop-aaaaaaaaaaaa',
    },
    op: 'submit',
    from: { sessionId: 'session-1', nodeId: 'node-aaa' },
    documentId: DOC_A,
    sharedDocsVersion: 1,
    kind: 'shared-doc',
  };
  assert.equal(api.signingFragment(plain), api.signingFragment(shuffled));
  // Same bytes again on a repeat call: the fragment is a function of content only.
  assert.equal(api.signingFragment(plain), api.signingFragment(plain));
  // A key-order-insensitive fragment must still distinguish a real array reorder.
  const reorderedArray = {
    ...plain,
    payload: { ...plain.payload, patch: [{ baseStart: 0, baseCount: 1, lines: ['beta', 'alpha'], meta: { x: 2, y: 1 } }] },
  };
  assert.notEqual(api.signingFragment(reorderedArray), api.signingFragment(plain), 'array order is content, not noise');
});

test('signingFragment begins with a newline so the transport can append it verbatim', () => {
  const fragment = api.signingFragment({ documentId: DOC_A, op: 'status', from: { sessionId: 's' } });
  assert.equal(fragment.startsWith('\n'), true);
  assert.equal(fragment.split('\n')[1], 'sharedDocs:1');
  assert.equal(fragment.split('\n')[2], JSON.stringify('s'));
});

test('signingFragment changes when documentId, op or payload changes', () => {
  const base = {
    documentId: DOC_A,
    op: 'submit',
    from: { nodeId: 'node-aaa', sessionId: 'session-1' },
    payload: { proposalId: 'prop-aaaaaaaaaaaa' },
  };
  const fragment = api.signingFragment(base);
  assert.notEqual(api.signingFragment({ ...base, documentId: DOC_B }), fragment);
  assert.notEqual(api.signingFragment({ ...base, op: 'status' }), fragment);
  assert.notEqual(api.signingFragment({ ...base, payload: { proposalId: 'prop-bbbbbbbbbbbb' } }), fragment);
  assert.notEqual(api.signingFragment({ ...base, payload: { proposalId: 'prop-aaaaaaaaaaaa', extra: 1 } }), fragment);
  assert.equal(api.signingFragment({ ...base }), fragment, 'a rebuild of the same envelope must sign the same');
});

test('signingFragment never throws on a malformed inbound envelope', () => {
  // The transport calls this while verifying whatever arrived on the socket; a
  // throw here would surface as a server fault instead of a clean rejection.
  for (const raw of [undefined, null, 'text', 42, [], {}, { from: 'nope' }, { payload: undefined }]) {
    assert.equal(typeof api.signingFragment(raw), 'string');
  }
});

/* ---------------------------------------------------------- capability --- */

test('peerSupportsSharedDocs demands the exact capability value', () => {
  assert.equal(typeof api.peerSupportsSharedDocs, 'function');
  assert.equal(api.peerSupportsSharedDocs({ sharedDocs: 1 }), true);
  assert.equal(api.peerSupportsSharedDocs({ sharedDocs: 0 }), false);
  assert.equal(api.peerSupportsSharedDocs({ sharedDocs: '1' }), false, 'a string must not pass');
  assert.equal(api.peerSupportsSharedDocs({ sharedDocs: 2 }), false, 'a future version is not support');
  assert.equal(api.peerSupportsSharedDocs({ sharedDocs: true }), false);
  assert.equal(api.peerSupportsSharedDocs({}), false);
  assert.equal(api.peerSupportsSharedDocs(null), false);
  assert.equal(api.peerSupportsSharedDocs('node-bbb'), false);
});

test('an unsupported peer fails precisely instead of degrading', () => {
  assert.equal(typeof api.requireSharedDocsPeer, 'function');
  assert.deepEqual(api.requireSharedDocsPeer({ sharedDocs: 1 }), { sharedDocs: 1 });
  const error = expectCode(() => api.requireSharedDocsPeer({}), 'DOC_PEER_UNSUPPORTED');
  assert.match(error.message, /sharedDocs/i);
  expectCode(() => api.requireSharedDocsPeer({ sharedDocs: '1' }), 'DOC_PEER_UNSUPPORTED');
});

/* ----------------------------------------------------------- envelopes --- */

test('normalizeSharedDocEnvelope accepts a well formed envelope and canonicalizes the payload', () => {
  assert.equal(typeof api.normalizeSharedDocEnvelope, 'function');
  const normalized = api.normalizeSharedDocEnvelope({
    kind: 'shared-doc',
    sharedDocsVersion: 1,
    documentId: DOC_A,
    op: 'sync',
    payload: { zeta: 1, alpha: { beta: 2 } },
  });
  assert.equal(normalized.kind, 'shared-doc');
  assert.equal(normalized.sharedDocsVersion, 1);
  assert.equal(normalized.documentId, DOC_A);
  assert.equal(normalized.op, 'sync');
  assert.deepEqual(normalized.payload, { alpha: { beta: 2 }, zeta: 1 });
  // Missing payload is an empty object, not `undefined`, so a caller can read it.
  assert.deepEqual(api.normalizeSharedDocEnvelope({
    sharedDocsVersion: 1, documentId: DOC_A, op: 'status',
  }).payload, {});
});

test('normalizeSharedDocEnvelope refuses a missing documentId as DOC_NOT_FOUND', () => {
  // §13 裁定 6: an id that can never name a document is a lookup failure, not a
  // shape failure, so the code must be DOC_NOT_FOUND.
  expectCode(() => api.normalizeSharedDocEnvelope({ sharedDocsVersion: 1, op: 'submit' }), 'DOC_NOT_FOUND');
  expectCode(() => api.normalizeSharedDocEnvelope({ sharedDocsVersion: 1, documentId: 'doc-nope', op: 'submit' }), 'DOC_NOT_FOUND');
  expectCode(() => api.normalizeSharedDocEnvelope({ sharedDocsVersion: 1, documentId: DOC_A.toUpperCase(), op: 'submit' }), 'DOC_NOT_FOUND');
});

test('normalizeSharedDocEnvelope refuses an unknown op and a foreign kind', () => {
  expectCode(() => api.normalizeSharedDocEnvelope({
    sharedDocsVersion: 1, documentId: DOC_A, op: 'merge',
  }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.normalizeSharedDocEnvelope({
    sharedDocsVersion: 1, documentId: DOC_A, op: 7,
  }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.normalizeSharedDocEnvelope({
    kind: 'room-message', sharedDocsVersion: 1, documentId: DOC_A, op: 'submit',
  }), 'DOC_COMMAND_INVALID');
});

test('normalizeSharedDocEnvelope reports an unknown version as an unsupported peer', () => {
  // A different version is a peer this node cannot talk to, not a malformed
  // message: the coordinator must stop pairing rather than retry forever.
  expectCode(() => api.normalizeSharedDocEnvelope({
    sharedDocsVersion: 2, documentId: DOC_A, op: 'submit',
  }), 'DOC_PEER_UNSUPPORTED');
  expectCode(() => api.normalizeSharedDocEnvelope({
    documentId: DOC_A, op: 'submit',
  }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.normalizeSharedDocEnvelope(null), 'DOC_COMMAND_INVALID');
});

test('the §15 rulings stay pinned: bad id, missing version, foreign version', () => {
  // One test that states all three rulings together, because each is a decision
  // that looks arbitrary at the call site and would silently flip during a
  // cleanup. §15: an id that cannot name a document is a lookup failure; a
  // missing version is a malformed message; a different version is a peer we
  // cannot talk to.
  const wellFormed = { sharedDocsVersion: 1, documentId: DOC_A, op: 'submit' };

  // 'doc-SHORT' has the right prefix and the wrong body: too short, and upper
  // case where the id alphabet is lower-case only. It can never name a document.
  expectCode(
    () => api.normalizeSharedDocEnvelope({ ...wellFormed, documentId: 'doc-SHORT' }),
    'DOC_NOT_FOUND',
  );

  // A message whose sender forgot the version field is a sender bug: reject it
  // as malformed rather than guessing which protocol it was written against.
  expectCode(
    () => api.normalizeSharedDocEnvelope({ documentId: DOC_A, op: 'submit' }),
    'DOC_COMMAND_INVALID',
  );

  // A sender that states a version we do not implement is a peer we cannot
  // interoperate with, so the caller must stop pairing with it instead of
  // retrying the same doomed exchange.
  expectCode(
    () => api.normalizeSharedDocEnvelope({ ...wellFormed, sharedDocsVersion: 2 }),
    'DOC_PEER_UNSUPPORTED',
  );

  // The well-formed control that makes the three above meaningful.
  const normalized = api.normalizeSharedDocEnvelope(wellFormed);
  assert.equal(normalized.sharedDocsVersion, 1);
  assert.equal(normalized.documentId, DOC_A);
  assert.equal(normalized.op, 'submit');
});

/* ---------------------------------------------------------------- body --- */

test('an oversized body fails as DOC_BODY_TOO_LARGE instead of being truncated', () => {
  assert.equal(typeof api.assertSharedDocBody, 'function');
  assert.equal(typeof api.assertSharedDocBody({ ok: true }), 'string');
  const error = expectCode(
    () => api.assertSharedDocBody({ blob: 'x'.repeat(MAX_BODY_BYTES + 1) }),
    'DOC_BODY_TOO_LARGE',
  );
  assert.equal(error.status, 413, 'a body that cannot fit the frame is a 413');
  assert.match(error.message, new RegExp(String(MAX_BODY_BYTES)));
});

test('sync request and response bodies round-trip through the wire shape', () => {
  const request = api.sharedDocRequest({ since: { [DOC_A]: { generation: 0, seq: 3, hash: HASH_A } } });
  assert.equal(request.sharedDocsVersion, 1);
  assert.deepEqual(request.since, { [DOC_A]: { generation: 0, seq: 3 } }, 'a request carries keys only');

  const response = api.sharedDocResponse({ events: [createSyncEvent()], gaps: [] });
  assert.equal(response.sharedDocsVersion, 1);
  assert.equal(response.events.length, 1);
  assert.deepEqual(response.gaps, []);
  assert.equal(response.events[0].eventId, EVT_A);

  expectCode(() => api.sharedDocRequest({ since: { [DOC_A]: { seq: 3 } } }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.sharedDocResponse({ events: [{ documentId: DOC_A }] }), 'DOC_COMMAND_INVALID');
});

/* --------------------------------------------------------------- apply --- */

test('applySyncEvent advances the state when the event is new', () => {
  assert.equal(typeof api.applySyncEvent, 'function');
  const empty = emptyDocumentState();
  const next = api.applySyncEvent(empty, createSyncEvent());
  assert.notEqual(next, empty);
  assert.equal(next.documents[DOC_A].title, 'Doc A');
  assert.equal(next.revisions[REV_A].revisionId, REV_A);
  assert.equal(empty.documents[DOC_A], undefined, 'the input state must not be modified');
});

test('applySyncEvent is idempotent for a repeated eventId', () => {
  const state = stateWithDocument();
  // A retry whose hash the peer did not state, and one stating the stored hash.
  assert.equal(api.applySyncEvent(state, createSyncEvent({ hash: null })), state);
  const storedHash = state.events[DOC_A][0].hash;
  assert.equal(api.applySyncEvent(state, createSyncEvent({ hash: storedHash })), state);
  // Same object identity is the signal a store uses to skip the write.
  assert.equal(api.applySyncEvent(state, createSyncEvent({ hash: storedHash })), state);
});

test('applySyncEvent raises CONFLICTING_CHECKPOINT for one eventId with two hashes', () => {
  const state = stateWithDocument();
  const storedHash = state.events[DOC_A][0].hash;
  const error = expectCode(
    () => api.applySyncEvent(state, createSyncEvent({ hash: HASH_B === storedHash ? HASH_A : HASH_B })),
    'CONFLICTING_CHECKPOINT',
  );
  assert.match(error.message, /CONFLICTING_CHECKPOINT/);
});

test('applySyncEvent refuses an event whose command the state layer rejects', () => {
  const state = stateWithDocument();
  expectCode(() => api.applySyncEvent(state, {
    ...createSyncEvent(),
    eventId: EVT_B,
    command: { type: 'document/teleport' },
  }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.applySyncEvent(state, { documentId: DOC_A, eventId: 'nope', generation: 0, seq: 2 }), 'DOC_COMMAND_INVALID');
});

/* --------------------------------------------------------- checkpoints --- */

test('compareCheckpoint reports equality, behind and ahead from the ordering key', () => {
  assert.equal(typeof api.compareCheckpoint, 'function');
  assert.equal(api.compareCheckpoint(
    { generation: 1, seq: 4, hash: HASH_A },
    { generation: 1, seq: 4, hash: HASH_A },
  ).status, 'equal');
  assert.equal(api.compareCheckpoint(
    { generation: 1, seq: 4, hash: HASH_A },
    { generation: 1, seq: 5, hash: HASH_B },
  ).status, 'behind');
  assert.equal(api.compareCheckpoint(
    { generation: 1, seq: 5, hash: HASH_B },
    { generation: 1, seq: 4, hash: HASH_A },
  ).status, 'ahead');
  // A new generation outranks any seq inside the old one, whatever the seq.
  assert.equal(api.compareCheckpoint(
    { generation: 1, seq: 99, hash: HASH_A },
    { generation: 2, seq: 0, hash: HASH_B },
  ).status, 'behind');
  assert.equal(api.compareCheckpoint(
    { generation: 2, seq: 0, hash: HASH_B },
    { generation: 1, seq: 99, hash: HASH_A },
  ).status, 'ahead');
});

test('compareCheckpoint reports a hash disagreement as diverged, and offers no side', () => {
  const result = api.compareCheckpoint(
    { generation: 1, seq: 4, hash: HASH_A },
    { generation: 1, seq: 4, hash: HASH_B },
  );
  assert.equal(result.status, 'diverged');
  assert.equal(typeof result.reason, 'string');
  assert.match(result.reason, /CONFLICTING_CHECKPOINT/);
  // Nothing a caller could use to pick a winner: no content, no hashes, no winner.
  assert.deepEqual(Object.keys(result).sort(), ['reason', 'status']);
  assert.equal(result.content, undefined);
  assert.equal(result.local, undefined);
  assert.equal(result.remote, undefined);
  expectCode(() => api.compareCheckpoint({ generation: 1, seq: 4 }, { generation: 1, seq: 4, hash: HASH_A }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.compareCheckpoint(null, null), 'DOC_COMMAND_INVALID');
});

/* ---------------------------------------------------------------- sync --- */

test('a batch with a hole is refused whole and reports the gap', () => {
  assert.equal(typeof api.applySyncResponse, 'function');
  const state = stateWithDocument();
  const result = api.applySyncResponse(state, {
    documentId: DOC_A,
    since: { generation: 0, seq: 1 },
    events: [renameSyncEvent({ eventId: EVT_C, seq: 3, title: 'Three' })],
  });
  assert.equal(result.state, state, 'nothing may be applied before the hole');
  assert.deepEqual(result.applied, []);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].documentId, DOC_A);
  assert.equal(result.gaps[0].reason, 'missing-range');
  assert.equal(result.gaps[0].fromSeq, 2);
  assert.equal(result.gaps[0].toSeq, 2);
});

test('a contiguous batch is applied in (generation, seq) order whatever order it arrived in', () => {
  const state = stateWithDocument();
  const result = api.applySyncResponse(state, {
    documentId: DOC_A,
    since: { generation: 0, seq: 1 },
    events: [
      renameSyncEvent({ eventId: EVT_C, seq: 3, title: 'Three' }),
      renameSyncEvent({ eventId: EVT_B, seq: 2, title: 'Two' }),
    ],
  });
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.applied, [EVT_B, EVT_C], 'the batch must be replayed in ordering-key order');
  assert.equal(result.state.documents[DOC_A].title, 'Three');
  assert.equal(state.documents[DOC_A].title, 'Doc A', 'the input state must not be modified');
});

test('a generation change in the batch requires a full sync instead of guessing', () => {
  const state = stateWithDocument();
  const result = api.applySyncResponse(state, {
    documentId: DOC_A,
    since: { generation: 0, seq: 1 },
    events: [renameSyncEvent({ eventId: EVT_B, seq: 2, title: 'Two', generation: 1 })],
  });
  assert.equal(result.state, state);
  assert.deepEqual(result.applied, []);
  assert.equal(result.gaps[0].reason, 'generation-changed');
  assert.equal(result.gaps[0].needsFullSync, true);
});

test('a full sync from nothing applies the whole batch in order', () => {
  const plan = api.planSyncEvents({
    documentId: DOC_A,
    since: null,
    events: [createSyncEvent()],
  });
  assert.deepEqual(plan.gaps, []);
  assert.equal(plan.applicable.length, 1);
  assert.equal(plan.applicable[0].eventId, EVT_A);
  expectCode(() => api.planSyncEvents({ documentId: DOC_A, since: null, events: [createSyncEvent({ documentId: DOC_B })] }), 'DOC_COMMAND_INVALID');
});

/* ------------------------------------------------------------ payloads --- */

test('submitPayload keeps the fields a proposal needs and refuses a malformed one', () => {
  assert.equal(typeof api.submitPayload, 'function');
  const payload = api.submitPayload({
    proposalId: 'prop-aaaaaaaaaaaa',
    baseRevisionId: REV_A,
    resultHash: HASH_A,
    message: '  tighten wording  ',
  });
  assert.deepEqual(payload, {
    proposalId: 'prop-aaaaaaaaaaaa',
    baseRevisionId: REV_A,
    resultHash: HASH_A,
    message: 'tighten wording',
  });
  assert.equal(api.submitPayload({ proposalId: 'prop-aaaaaaaaaaaa', resultHash: HASH_A }).baseRevisionId, null);
  expectCode(() => api.submitPayload({ resultHash: HASH_A }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.submitPayload({ proposalId: 'prop-aaaaaaaaaaaa', resultHash: 'nope' }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.submitPayload({ proposalId: 'prop-aaaaaaaaaaaa', resultHash: HASH_A, baseRevisionId: 'rev-x' }), 'DOC_COMMAND_INVALID');
});

test('statusPayload is exactly the anti-entropy checkpoint', () => {
  assert.equal(typeof api.statusPayload, 'function');
  assert.deepEqual(api.statusPayload({
    headRevisionId: REV_A, generation: 2, seq: 7, hash: HASH_A,
  }), { headRevisionId: REV_A, generation: 2, seq: 7, hash: HASH_A });
  expectCode(() => api.statusPayload({ headRevisionId: 'nope', generation: 0, seq: 0, hash: HASH_A }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.statusPayload({ headRevisionId: REV_A, generation: -1, seq: 0, hash: HASH_A }), 'DOC_COMMAND_INVALID');
  expectCode(() => api.statusPayload({ headRevisionId: REV_A, generation: 0, seq: 0, hash: 'HASH' }), 'DOC_COMMAND_INVALID');
});

test('the protocol layer never needs a clock or a random source', () => {
  // Determinism is the property under test: the same wire value must normalize to
  // the same object twice, with no timestamp or nonce of its own invention.
  const raw = { sharedDocsVersion: 1, documentId: DOC_A, op: 'status', payload: { generation: 0, seq: 1, hash: HASH_A } };
  assert.deepEqual(api.normalizeSharedDocEnvelope(raw), api.normalizeSharedDocEnvelope(raw));
  assert.deepEqual(api.sharedDocResponse({ events: [createSyncEvent()] }), api.sharedDocResponse({ events: [createSyncEvent()] }));
  const checkpoint = { generation: 0, seq: 1, hash: HASH_A };
  assert.deepEqual(api.compareCheckpoint(checkpoint, checkpoint), api.compareCheckpoint(checkpoint, checkpoint));
});
