/**
 * Tests for the shared document coordinator.
 *
 * The coordinator is where permission and sequencing live, so most of these
 * cases are about who may do what and about the head moving exactly once. They
 * run against the *real* store in a temporary directory rather than a stub: the
 * promise being tested is "a clean edit commits and a conflicting one does not",
 * and a stubbed store could satisfy that while the disk format was broken.
 *
 * Two invariants get the most attention because getting them wrong is silent:
 *
 * - a conflicted proposal must never move the head, and
 * - confirming a resolution must commit the text the resolver wrote, not the
 *   text that happens to be at the head by the time someone confirms.
 *
 * @module dsh-lan-mesh/scripts/shared-doc-coordinator.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TransportError } from '../lib/transport.mjs';
import { SharedDocStore, validateSharedDocReplica } from '../lib/shared-doc-store.mjs';
import {
  SharedDocCoordinator,
  VIA_PANEL,
  VIA_TOOL,
  resolveActor,
} from '../lib/shared-doc-coordinator.mjs';

const ROOM = 'room-alpha';
const LEADER = 'node-aaa/human';
const SELF_HUMAN = 'node-aaa/human';
const PEER_HUMAN = 'node-bbb/human';
const AGENT = 'node-aaa/session-agent';
const AT = '2026-10-30T00:00:00.000Z';

/**
 * A uuid source that is deterministic and never runs out.
 *
 * `idFromUuid` keeps the first twelve characters, so the counter goes at the
 * front; padding it at the back would make every id the same twelve zeros and
 * the state layer would (correctly) accuse us of reusing an id.
 */
function makeUuidSource() {
  let next = 0;
  return () => {
    next += 1;
    return next.toString(16).padStart(12, '0');
  };
}

/**
 * Run a test body with a real store in a throw-away directory.
 * @param {(tools: {store: SharedDocStore, coordinator: SharedDocCoordinator, dir: string}) => Promise<unknown>} body
 * @param {object} [options] - coordinator overrides.
 * @returns {Promise<unknown>}
 */
async function withCoordinator(body, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-doc-coord-'));
  let store;
  try {
    store = await SharedDocStore.open(directory);
    // Unknown rooms must come back undefined: the coordinator treats a room it
    // cannot resolve as a refusal, and a lookup that invents rooms would hide
    // that path entirely.
    const roomInfo = options.roomInfo ?? ((roomId) => (roomId === ROOM
      ? {
        id: ROOM,
        leaderKey: LEADER,
        memberKeys: new Set([SELF_HUMAN, PEER_HUMAN, AGENT]),
      }
      : undefined));
    const coordinator = new SharedDocCoordinator({
      store,
      nodeId: options.nodeId ?? 'node-aaa',
      nodeName: 'Workstation',
      generation: options.generation ?? (() => 0),
      now: options.now ?? (() => AT),
      uuid: options.uuid ?? makeUuidSource(),
      roomInfo,
      log: () => {},
    });
    return await body({ store, coordinator, dir: directory });
  } finally {
    if (store !== undefined) await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** @param {Function} fn - expected to throw. @returns {unknown} the error. */
function catchSync(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected the call to throw');
}

/** @param {Promise<unknown>} promise - expected to reject. @returns {Promise<unknown>} the error. */
async function settle(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the call to reject');
}

/** Create one document through the panel surface and return its id. */
async function createDoc(coordinator, content = 'one\ntwo\nthree\n') {
  const created = await coordinator.createDocument({
    roomId: ROOM,
    title: 'Notes',
    content,
    message: 'first version',
    via: VIA_PANEL,
  });
  return created.document.documentId;
}

/* -------------------------------------------------------------- actors --- */

test('the panel surface is the local human, whatever the payload claims', () => {
  const actor = resolveActor({ via: VIA_PANEL, sessionId: 'someone-else', nodeId: 'node-aaa' });
  assert.equal(actor.actorKey, LEADER);
  assert.equal(actor.isHuman, true);
  assert.equal(actor.sessionId, 'human');
});

test('the tool surface is the executing session, never the human', () => {
  const actor = resolveActor({ via: VIA_TOOL, sessionId: 'session-agent', nodeId: 'node-aaa' });
  assert.equal(actor.actorKey, AGENT);
  assert.equal(actor.isHuman, false);
});

test('an agent cannot borrow the human rule by naming the human session', () => {
  const error = catchSync(() => resolveActor({ via: VIA_TOOL, sessionId: 'human', nodeId: 'node-aaa' }));
  assert.ok(error instanceof TransportError);
  assert.equal(error.code, 'DOC_COMMAND_INVALID');
  assert.match(error.message, /may not act as the local human/);
});

test('an unknown surface is refused rather than guessed', () => {
  const error = catchSync(() => resolveActor({ via: 'rpc', nodeId: 'node-aaa', sessionId: 'x' }));
  assert.equal(error.code, 'DOC_COMMAND_INVALID');
});

test('a tool call without a session cannot be attributed', () => {
  const error = catchSync(() => resolveActor({ via: VIA_TOOL, nodeId: 'node-aaa' }));
  assert.equal(error.code, 'DOC_COMMAND_INVALID');
});

/* ------------------------------------------------------------- create --- */

test('a human member creates a document whose first revision is its own base', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const created = await coordinator.createDocument({
      roomId: ROOM,
      title: '  Notes  ',
      content: '  one\ntwo\n  ',
      message: 'first',
      via: VIA_PANEL,
    });
    assert.equal(created.status, 'clean');
    assert.equal(created.document.title, 'Notes');
    assert.equal(created.document.archived, false);
    assert.equal(created.document.conflictCount, 0);

    const documentId = created.document.documentId;
    const view = coordinator.getDocument({ documentId, via: VIA_PANEL });
    // The stored text is normalized, so a later hash always matches what a
    // reader recomputes — the trailing spaces the user typed are not kept.
    assert.equal(view.document.content, 'one\ntwo');
    assert.equal(view.document.headRevisionId, created.document.headRevisionId);
    assert.equal(view.revision.parentRevisionId, null);
    assert.equal(view.revision.source, 'human');
    assert.equal(store.verifyAudit(documentId).ok, true);
  });
});

test('a non-member cannot create a document in the room', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const error = await settle(coordinator.createDocument({
      roomId: ROOM,
      title: 'Notes',
      content: 'x',
      via: VIA_TOOL,
      sessionId: 'session-outsider',
    }));
    assert.equal(error.code, 'NOT_ROOM_MEMBER');
  });
});

test('an unknown room is refused before any write', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const error = await settle(coordinator.createDocument({
      roomId: 'room-missing',
      title: 'Notes',
      content: 'x',
      via: VIA_PANEL,
    }));
    assert.equal(error.code, 'UNKNOWN_ROOM');
  });
});

test('a blank or oversized title is refused', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const blank = await settle(coordinator.createDocument({
      roomId: ROOM, title: '   ', content: 'x', via: VIA_PANEL,
    }));
    assert.equal(blank.code, 'DOC_TITLE_INVALID');
    const long = await settle(coordinator.createDocument({
      roomId: ROOM, title: 'x'.repeat(201), content: 'x', via: VIA_PANEL,
    }));
    assert.equal(long.code, 'DOC_TITLE_INVALID');
  });
});

/* ------------------------------------------------------------- submit --- */

test('an edit against the current head commits without asking anyone', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const documentId = await createDoc(coordinator);
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;

    const submitted = await coordinator.submitDocumentProposal({
      documentId,
      baseRevisionId: base,
      content: 'one\nTWO\nthree\n',
      message: 'edit two',
      via: VIA_PANEL,
    });
    assert.equal(submitted.status, 'clean');
    assert.equal(submitted.proposal.status, 'accepted');
    assert.equal(submitted.revision.message, 'edit two');

    const head = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(head.document.content, 'one\nTWO\nthree');
    assert.equal(head.revision.parentRevisionId, base);
    assert.equal(store.verifyAudit(documentId).ok, true);
  });
});

test('a stale base with disjoint edits merges and commits, still without approval', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;

    // Somebody else moves the head first.
    const first = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'A\nb\nc\n', message: 'top', via: VIA_PANEL,
    });
    assert.equal(first.status, 'clean');

    // A second editor who still holds `base` changes a different line.
    const second = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nb\nC\n', message: 'bottom', via: VIA_PANEL,
    });
    assert.equal(second.status, 'clean');
    assert.equal(second.proposal.status, 'auto-merged');
    assert.deepEqual(
      second.proposal.conflict,
      null,
      'a disjoint merge is not a conflict, so it must not look like one',
    );

    const head = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(head.document.content, 'A\nb\nC');
  });
});

test('a real conflict parks a proposal and leaves the head exactly where it was', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    const before = coordinator.getDocument({ documentId, via: VIA_PANEL });

    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nFIRST\nc\n', message: 'mine', via: VIA_PANEL,
    });
    const headAfterFirst = coordinator.getDocument({ documentId, via: VIA_PANEL });

    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nSECOND\nc\n', message: 'theirs', via: VIA_PANEL,
    });
    assert.equal(conflicted.status, 'conflict');
    assert.equal(conflicted.proposal.status, 'conflicted');
    assert.ok(conflicted.proposal.conflict.hunks.length >= 1);
    assert.match(conflicted.reason, /same lines/);

    const after = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(
      after.document.headRevisionId,
      headAfterFirst.document.headRevisionId,
      'a conflicted proposal must not move the head',
    );
    assert.equal(after.document.content, 'a\nFIRST\nc');
    assert.notEqual(after.document.headRevisionId, before.document.headRevisionId);

    // The conflict is visible on the row, and the three texts are readable.
    const listed = coordinator.listDocuments({ roomId: ROOM, via: VIA_PANEL });
    const row = listed.documents.find((entry) => entry.documentId === documentId);
    assert.equal(row.conflictCount, 1);
    assert.equal(after.proposal.conflicted, true);
    assert.equal(after.proposal.baseContent, 'a\nb\nc');
    assert.equal(after.proposal.currentContent, 'a\nFIRST\nc');
    assert.equal(store.verifyAudit(documentId).ok, true);
  });
});

test('resubmitting the same proposal id with the same content is idempotent', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const documentId = await createDoc(coordinator);
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    const request = {
      documentId,
      baseRevisionId: base,
      content: 'one\ntwo\nthree\nfour\n',
      message: 'edit',
      proposalId: 'prop-aaaaaaaaaaaa',
      via: VIA_PANEL,
    };
    const first = await coordinator.submitDocumentProposal(request);
    assert.equal(first.status, 'clean');
    const headAfterFirst = coordinator.getDocument({ documentId, via: VIA_PANEL }).document.headRevisionId;

    const again = await coordinator.submitDocumentProposal(request);
    assert.equal(again.status, 'clean');
    assert.equal(coordinator.getDocument({ documentId, via: VIA_PANEL }).document.headRevisionId, headAfterFirst);
    assert.equal(store.state().documents[documentId].headRevisionId, headAfterFirst);
  });
});

test('reusing a proposal id for different content is refused', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator);
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nb\n', message: 'one', proposalId: 'prop-bbbbbbbbbbbb', via: VIA_PANEL,
    });
    const error = await settle(coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'different\n', message: 'one', proposalId: 'prop-bbbbbbbbbbbb', via: VIA_PANEL,
    }));
    assert.equal(error.code, 'DOC_PROPOSAL_ID_REUSED');
  });
});

test('a base that never belonged to the document is refused', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const first = await createDoc(coordinator);
    const other = await createDoc(coordinator);
    const otherBase = coordinator.getDocument({ documentId: other, via: VIA_PANEL }).revision.revisionId;
    const error = await settle(coordinator.submitDocumentProposal({
      documentId: first, baseRevisionId: otherBase, content: 'x', message: 'm', via: VIA_PANEL,
    }));
    assert.equal(error.code, 'DOC_BASE_NOT_FOUND');
  });
});

test('an agent may edit but the commit records the agent, not the human', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator);
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    const submitted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'robot line\n', message: 'agent edit',
      via: VIA_TOOL, sessionId: 'session-agent',
    });
    assert.equal(submitted.status, 'clean');
    assert.equal(submitted.revision.source, 'agent');
    assert.equal(submitted.revision.authorName, 'Workstation');
  });
});

/* --------------------------------------------------- resolve/confirm --- */

test('a resolution only becomes the head once a maintainer confirms it', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nFIRST\nc\n', message: 'mine', via: VIA_PANEL,
    });
    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nSECOND\nc\n', message: 'theirs', via: VIA_PANEL,
    });
    const proposalId = conflicted.proposal.proposalId;

    // Any member may write the resolution — the resolver need not be the author.
    const resolved = await coordinator.resolveDocumentConflict({
      documentId, proposalId, content: 'a\nBOTH\nc\n', message: 'merged by hand', via: VIA_PANEL,
      sessionId: 'session-agent',
    });
    assert.equal(resolved.status, 'pending');
    assert.equal(
      coordinator.getDocument({ documentId, via: VIA_PANEL }).document.content,
      'a\nFIRST\nc',
      'writing a resolution must not move the head',
    );

    // The Leader confirms. No content is sent: §10 gives the panel only ids.
    const confirmed = await coordinator.confirmDocumentResolution({
      documentId, proposalId, via: VIA_PANEL,
    });
    assert.equal(confirmed.status, 'clean');
    assert.equal(confirmed.document.conflictCount, 0);

    const head = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(
      head.document.content,
      'a\nBOTH\nc',
      'confirming must commit the resolution text, not the head it replaced',
    );
    assert.equal(head.revision.source, 'conflict-resolution');
    assert.equal(store.verifyAudit(documentId).ok, true);
  });
});

test('an agent may neither resolve nor confirm', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nONE\nc\n', message: 'mine', via: VIA_PANEL,
    });
    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nTWO\nc\n', message: 'theirs', via: VIA_PANEL,
    });
    assert.equal((await settle(coordinator.resolveDocumentConflict({
      documentId, proposalId: conflicted.proposal.proposalId, content: 'a\nBOTH\nc\n',
      message: 'agent resolution', via: VIA_TOOL, sessionId: 'session-agent',
    }))).code, 'AGENT_CANNOT_CONFIRM');
    const error = await settle(coordinator.confirmDocumentResolution({
      documentId, proposalId: conflicted.proposal.proposalId, via: VIA_TOOL, sessionId: 'session-agent',
    }));
    assert.equal(error.code, 'AGENT_CANNOT_CONFIRM');
  });
});

test('a human who is neither Leader nor maintainer cannot confirm', async () => {
  // The panel always speaks as the local human, so "a human without the role" is
  // expressed by putting the Leader somewhere else: this node's human is then an
  // ordinary member and must be refused on the role, not on membership.
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nONE\nc\n', message: 'mine', via: VIA_PANEL,
    });
    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nTWO\nc\n', message: 'theirs', via: VIA_PANEL,
    });
    await coordinator.resolveDocumentConflict({
      documentId, proposalId: conflicted.proposal.proposalId, content: 'a\nBOTH\nc\n', message: 'r', via: VIA_PANEL,
    });
    const error = await settle(coordinator.confirmDocumentResolution({
      documentId, proposalId: conflicted.proposal.proposalId, via: VIA_PANEL,
    }));
    assert.equal(error.code, 'NOT_DOCUMENT_MAINTAINER');
  }, {
    roomInfo: (roomId) => (roomId === ROOM
      ? { id: ROOM, leaderKey: AGENT, memberKeys: new Set([SELF_HUMAN, PEER_HUMAN, AGENT]) }
      : undefined),
  });
});

test('a granted maintainer may confirm, and only the human Leader may grant', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nONE\nc\n', message: 'mine', via: VIA_PANEL,
    });
    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nTWO\nc\n', message: 'theirs', via: VIA_PANEL,
    });
    await coordinator.resolveDocumentConflict({
      documentId, proposalId: conflicted.proposal.proposalId, content: 'a\nBOTH\nc\n', message: 'r', via: VIA_PANEL,
    });

    const granted = await coordinator.grantDocumentMaintainer({
      documentId, holderKey: PEER_HUMAN, holderName: 'Peer', via: VIA_PANEL,
    });
    assert.equal(granted.maintainers.length, 1);
    assert.equal(granted.maintainers[0].actorKey, PEER_HUMAN);

    // Maintainership must not be grantable to an agent: that would let an agent
    // appoint itself and then confirm its own conflict.
    const toAgent = await settle(coordinator.grantDocumentMaintainer({
      documentId, holderKey: AGENT, via: VIA_PANEL,
    }));
    assert.equal(toAgent.code, 'NOT_DOCUMENT_MAINTAINER');

    const toStranger = await settle(coordinator.grantDocumentMaintainer({
      documentId, holderKey: 'node-zzz/human', via: VIA_PANEL,
    }));
    assert.equal(toStranger.code, 'NOT_ROOM_MEMBER');
  });
});

test('a confirmation that raced another commit fails instead of overwriting it', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    // The head has to move before the conflicting proposal is written: a proposal
    // whose base is still the head is a clean edit by definition, so a real
    // conflict needs a stale base.
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nB\nc\n', message: 'moves the head', via: VIA_PANEL,
    });
    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nX\nc\n', message: 'x', via: VIA_PANEL,
    });
    assert.equal(conflicted.status, 'conflict');
    // A clean edit onto the head lands while the conflict waits.
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nb\nZ\n', message: 'later', via: VIA_PANEL,
    });
    const error = await settle(coordinator.confirmDocumentResolution({
      documentId, proposalId: conflicted.proposal.proposalId, via: VIA_PANEL,
    }));
    assert.ok(
      ['DOC_CONFLICT_PENDING', 'DOC_PATCH_MISMATCH'].includes(error.code),
      `expected the stale confirmation to be refused, got ${error.code}`,
    );
  });
});

test('confirming a proposal that is not conflicted is refused', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator);
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    const clean = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\n', message: 'm', via: VIA_PANEL,
    });
    const error = await settle(coordinator.confirmDocumentResolution({
      documentId, proposalId: clean.proposal.proposalId, via: VIA_PANEL,
    }));
    assert.equal(error.code, 'DOC_CONFLICT_PENDING');
  });
});

/* -------------------------------------------------------------- reads --- */

test('a confirmed reader sees canConfirm, an agent never does', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator);
    const asLeader = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(asLeader.document.canConfirm, true);
    assert.equal(asLeader.document.isMaintainer, false);

    const asAgent = coordinator.getDocument({
      documentId, via: VIA_TOOL, sessionId: 'session-agent',
    });
    assert.equal(asAgent.document.canConfirm, false);
  });
});

test('reading an old revision reports that revision hash, not the head hash', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'first\n');
    const first = coordinator.getDocument({ documentId, via: VIA_PANEL });
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: first.revision.revisionId, content: 'second\n', message: 'm', via: VIA_PANEL,
    });
    const old = coordinator.getDocument({
      documentId, revisionId: first.revision.revisionId, via: VIA_PANEL,
    });
    assert.equal(old.document.content, 'first');
    assert.notEqual(old.document.contentHash, first.document.headRevisionId);
    assert.equal(old.revision.revisionId, first.revision.revisionId);

    const head = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.notEqual(old.document.contentHash, head.document.contentHash);
  });
});

test('history pages by cursor and never repeats or skips a revision', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator, 'v0\n');
    let head = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    for (let index = 1; index <= 4; index += 1) {
      const submitted = await coordinator.submitDocumentProposal({
        documentId, baseRevisionId: head, content: `v${index}\n`, message: `edit ${index}`, via: VIA_PANEL,
      });
      head = submitted.revision.revisionId;
    }
    // Five revisions (the create plus four edits) over pages of two means three
    // pages, so the walk has to follow every cursor rather than assume a second
    // page is the last one.
    const pages = [];
    let cursor = '';
    for (let guard = 0; guard < 10; guard += 1) {
      const page = coordinator.listDocumentHistory({ documentId, via: VIA_PANEL, cursor, limit: 2 });
      pages.push(page);
      assert.ok(page.revisions.length <= 2);
      cursor = page.nextCursor;
      if (cursor === '') break;
    }
    assert.equal(pages.length, 3);
    const seen = new Set(pages.flatMap((page) => page.revisions.map((row) => row.revisionId)));
    assert.equal(seen.size, 5);
    assert.equal(pages[0].events.length >= 5, true);
  });
});

test('listDocuments hides archived documents but keeps them readable by id', async () => {
  await withCoordinator(async ({ coordinator }) => {
    const documentId = await createDoc(coordinator);
    const archived = await coordinator.archiveDocument({ documentId, via: VIA_PANEL });
    assert.equal(archived.document.archived, true);
    assert.deepEqual(coordinator.listDocuments({ roomId: ROOM, via: VIA_PANEL }).documents, []);
    // A tombstone, not a delete: the history is still there.
    const view = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(view.document.title, 'Notes');
    // And it can no longer be edited.
    const error = await settle(coordinator.submitDocumentProposal({
      documentId, baseRevisionId: view.revision.revisionId, content: 'x', message: 'm', via: VIA_PANEL,
    }));
    assert.equal(error.code, 'DOC_NOT_FOUND');
  });
});

test('renaming records an audit event without minting a revision', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const documentId = await createDoc(coordinator);
    const before = coordinator.getDocument({ documentId, via: VIA_PANEL });
    const renamed = await coordinator.renameDocument({ documentId, title: 'Renamed', via: VIA_PANEL });
    assert.equal(renamed.document.title, 'Renamed');
    const after = coordinator.getDocument({ documentId, via: VIA_PANEL });
    assert.equal(after.document.headRevisionId, before.document.headRevisionId);
    const types = coordinator.listDocumentHistory({ documentId, via: VIA_PANEL }).events.map((event) => event.type);
    assert.ok(types.includes('document-renamed'));
    assert.equal(store.verifyAudit(documentId).ok, true);
  });
});

test('the audit log verifies after a full create/edit/conflict/confirm cycle', async () => {
  await withCoordinator(async ({ store, coordinator }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc\n');
    const base = coordinator.getDocument({ documentId, via: VIA_PANEL }).revision.revisionId;
    await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nONE\nc\n', message: 'mine', via: VIA_PANEL,
    });
    const conflicted = await coordinator.submitDocumentProposal({
      documentId, baseRevisionId: base, content: 'a\nTWO\nc\n', message: 'theirs', via: VIA_PANEL,
    });
    await coordinator.resolveDocumentConflict({
      documentId, proposalId: conflicted.proposal.proposalId, content: 'a\nBOTH\nc\n', message: 'r', via: VIA_PANEL,
    });
    await coordinator.confirmDocumentResolution({
      documentId, proposalId: conflicted.proposal.proposalId, via: VIA_PANEL,
    });
    const audit = store.verifyAudit(documentId);
    assert.equal(audit.ok, true, audit.ok ? '' : String(audit.reason));
    const types = audit.events.map((event) => event.type);
    for (const expected of ['proposal-accepted', 'conflict-detected', 'conflict-resolved']) {
      assert.ok(types.includes(expected), `audit is missing ${expected}`);
    }
  });
});

test('a document survives a store restart with the same head and text', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-doc-restart-'));
  try {
    let documentId;
    let headRevisionId;
    const first = await SharedDocStore.open(directory);
    try {
      const coordinator = new SharedDocCoordinator({
        store: first,
        nodeId: 'node-aaa',
        nodeName: 'Workstation',
        now: () => AT,
        uuid: makeUuidSource(),
        roomInfo: () => ({ id: ROOM, leaderKey: LEADER, memberKeys: new Set([SELF_HUMAN]) }),
      });
      documentId = await createDoc(coordinator, 'persisted\n');
      headRevisionId = coordinator.getDocument({ documentId, via: VIA_PANEL }).document.headRevisionId;
    } finally {
      await first.close();
    }

    const second = await SharedDocStore.open(directory);
    try {
      const coordinator = new SharedDocCoordinator({
        store: second,
        nodeId: 'node-aaa',
        nodeName: 'Workstation',
        now: () => AT,
        uuid: makeUuidSource(),
        roomInfo: () => ({ id: ROOM, leaderKey: LEADER, memberKeys: new Set([SELF_HUMAN]) }),
      });
      const view = coordinator.getDocument({ documentId, via: VIA_PANEL });
      assert.equal(view.document.content, 'persisted');
      assert.equal(view.document.headRevisionId, headRevisionId);
      assert.equal(second.verifyAudit(documentId).ok, true);
    } finally {
      await second.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('trusted relay retains remote identity and read membership', async () => {
  await withCoordinator(async ({ coordinator, store }) => {
    const relay = coordinator.forTrustedActor({ nodeId: 'node-bbb', sessionId: 'human', isHuman: true });
    const created = await relay.createDocument({ roomId: ROOM, title: 'remote', content: 'body', via: VIA_TOOL });
    const id = created.document.documentId;
    assert.equal(store.state().documents[id].createdBy, PEER_HUMAN);
    assert.equal(relay.listDocuments({ roomId: ROOM }).documents.length, 1);
    assert.equal(relay.listDocumentHistory({ documentId: id }).revisions.length, 1);
    assert.ok(Object.keys(store.state().outbox).length > 0);
    const stranger = coordinator.forTrustedActor({ nodeId: 'stranger', sessionId: 'human', isHuman: true });
    assert.equal(catchSync(() => stranger.listDocuments({ roomId: ROOM })).code, 'NOT_ROOM_MEMBER');
  });
});

test('tool cannot pass a remote or human actor key as session', () => {
  for (const sessionId of ['node-bbb/human', 'node-bbb/agent', 'human']) {
    assert.equal(catchSync(() => resolveActor({ via: VIA_TOOL, nodeId: 'node-aaa', sessionId })).code, 'DOC_COMMAND_INVALID');
  }
});

test('outbox and proposal fingerprints survive reopening', async () => {
  await withCoordinator(async ({ coordinator, store, dir }) => {
    const id = await createDoc(coordinator, 'a\nb\nc');
    const base = store.state().documents[id].headRevisionId;
    await coordinator.submitDocumentProposal({ documentId: id, baseRevisionId: base, content: 'A\nb\nc', via: VIA_PANEL });
    const request = { documentId: id, proposalId: 'prop-123456abcdef', baseRevisionId: base, content: 'a\nb\nC', via: VIA_PANEL };
    await coordinator.submitDocumentProposal(request);
    assert.equal((await coordinator.submitDocumentProposal(request)).status, 'clean');
    const reopened = await SharedDocStore.open(dir);
    try {
      assert.deepEqual(reopened.state().idempotency, store.state().idempotency);
      assert.deepEqual(reopened.state().outbox, store.state().outbox);
      for (const revision of Object.values(reopened.state().revisions)) reopened.documentAt(id, revision.revisionId);
    } finally { await reopened.close(); }
  });
});

test('concurrent proposals cannot overwrite a committed head', async () => {
  await withCoordinator(async ({ coordinator, store }) => {
    const id = await createDoc(coordinator, 'base');
    const base = store.state().documents[id].headRevisionId;
    const request = { documentId: id, proposalId: 'prop-abcdef123456', baseRevisionId: base, content: 'new', via: VIA_PANEL };
    const results = await Promise.allSettled([coordinator.submitDocumentProposal(request), coordinator.submitDocumentProposal(request)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DOC_CONFLICT_PENDING');
    assert.equal((await coordinator.submitDocumentProposal(request)).status, 'clean');
    assert.equal(Object.keys(store.state().revisions).length, 2);
  });
});

test('create requestId commits one document concurrently and survives reopening', async () => {
  await withCoordinator(async ({ coordinator, store, dir }) => {
    const request = { roomId: ROOM, title: 'import', content: 'original', message: 'receipt', source: 'import', requestId: 'create-retry-1', via: VIA_PANEL };
    const [first, second] = await Promise.all([coordinator.createDocument(request), coordinator.createDocument(request)]);
    assert.equal(first.document.documentId, second.document.documentId);
    assert.equal(Object.keys(store.state().documents).length, 1);
    assert.equal(Object.values(store.state().events).flat()[0].type, 'document-imported');
    for (const changed of [{ content: 'different' }, { title: 'different' }, { message: 'different' }, { source: 'human' }]) {
      assert.equal((await settle(coordinator.createDocument({ ...request, ...changed }))).code, 'DOC_COMMAND_INVALID');
    }
    const reopened = await SharedDocStore.open(dir);
    try {
      const retry = new SharedDocCoordinator({ store: reopened, nodeId: 'node-aaa', roomInfo: () => ({ id: ROOM, leaderKey: LEADER, memberKeys: new Set([SELF_HUMAN, PEER_HUMAN]) }) });
      assert.equal((await retry.createDocument(request)).document.documentId, first.document.documentId);
      const remote = retry.forTrustedActor({ nodeId: 'node-bbb', sessionId: 'human', isHuman: true });
      assert.equal((await settle(remote.createDocument(request))).code, 'DOC_COMMAND_INVALID');
      assert.equal(Object.keys(reopened.state().documents).length, 1);
    } finally { await reopened.close(); }
  });
});

test('pure replica validation rejects damaged history, heads and audit', async () => {
  await withCoordinator(async ({ coordinator, store }) => {
    const id = await createDoc(coordinator, 'original');
    const base = store.state().documents[id].headRevisionId;
    await coordinator.submitDocumentProposal({ documentId: id, baseRevisionId: base, content: 'next', via: VIA_PANEL });
    const valid = store.state();
    assert.equal(validateSharedDocReplica(valid), true);
    for (const corrupt of [
      state => { state.revisions[base].resultHash = '0'.repeat(64); },
      state => { delete state.revisions[base]; },
      state => { state.events[id][0].detail = { tampered: true }; },
      state => { state.documents[id].contentHash = '0'.repeat(64); },
    ]) {
      const damaged = structuredClone(valid);
      corrupt(damaged);
      assert.equal(catchSync(() => validateSharedDocReplica(damaged)).code, 'DOC_STORE_CORRUPT');
    }
    assert.deepEqual(store.state(), valid);
  });
});

test('conflict originals and versioned resolutions survive restart and reject moved heads', async () => {
  await withCoordinator(async ({ coordinator, store, dir }) => {
    const documentId = await createDoc(coordinator, 'a\nb\nc');
    const baseRevisionId = store.state().documents[documentId].headRevisionId;
    await coordinator.submitDocumentProposal({ documentId, baseRevisionId, content: 'a\nONE\nc', via: VIA_PANEL });
    const conflict = await coordinator.submitDocumentProposal({ documentId, baseRevisionId, content: 'a\nTWO\nc', via: VIA_PANEL });
    const proposalId = conflict.proposal.proposalId;
    const remote = coordinator.forTrustedActor({ nodeId: 'node-bbb', sessionId: 'human', isHuman: true });
    assert.equal(remote.getDocument({ documentId }).proposal.proposedContent, 'a\nTWO\nc');
    await remote.resolveDocumentConflict({ documentId, proposalId, content: 'a\nBOTH\nc' });
    const reopened = await SharedDocStore.open(dir);
    try {
      const reader = new SharedDocCoordinator({ store: reopened, nodeId: 'node-aaa', roomInfo: () => ({ id: ROOM, leaderKey: LEADER, memberKeys: new Set([SELF_HUMAN, PEER_HUMAN]) }) }).forTrustedActor({ nodeId: 'node-bbb', sessionId: 'human', isHuman: true });
      const view = reader.getDocument({ documentId }).proposal;
      assert.equal(view.proposedContent, 'a\nTWO\nc');
      assert.equal(view.resolutionContent, 'a\nBOTH\nc');
    } finally { await reopened.close(); }
    const head = store.state().documents[documentId].headRevisionId;
    await coordinator.submitDocumentProposal({ documentId, baseRevisionId: head, content: 'a\nONE\nNEW', via: VIA_PANEL });
    assert.equal((await settle(coordinator.confirmDocumentResolution({ documentId, proposalId, via: VIA_PANEL }))).code, 'DOC_CONFLICT_PENDING');
    await remote.resolveDocumentConflict({ documentId, proposalId, content: 'a\nBOTH\nNEW' });
    assert.equal(store.state().idempotency[proposalId].resolutions.length, 2);
    assert.equal(store.state().idempotency[proposalId].content, 'a\nTWO\nc');
    await coordinator.confirmDocumentResolution({ documentId, proposalId, content: 'payload must not override resolution', via: VIA_PANEL });
    assert.equal(remote.getDocument({ documentId }).document.content, 'a\nBOTH\nNEW');
  });
});
