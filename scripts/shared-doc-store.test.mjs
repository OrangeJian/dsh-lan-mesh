/**
 * Tests for the atomic shared-document store.
 *
 * Each case corresponds to a promise the store makes to the coordinator: a
 * transaction either lands completely or not at all, a file that no longer makes
 * sense is reported instead of erased, two callers that write in the same tick
 * do not lose each other's work, and a snapshot cache may be trimmed but never at
 * the cost of a historical revision. Everything runs in `os.tmpdir()` so a failed
 * test cannot damage a real store.
 *
 * @module dsh-lan-mesh/scripts/shared-doc-store.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TransportError } from '../lib/transport.mjs';
import {
  DOC_STATE_VERSION,
  applyDocumentCommand,
  emptyDocumentState,
  hashContent,
} from '../lib/shared-doc-state.mjs';
import { patchFromContent } from '../lib/shared-doc-merge.mjs';
import {
  MAX_SNAPSHOTS_PER_DOC,
  SNAPSHOT_FILE_NAME,
  STATE_FILE_NAME,
  SharedDocStore,
} from '../lib/shared-doc-store.mjs';

const AT = '2026-10-29T00:00:00.000Z';
const LATER = '2026-10-29T01:00:00.000Z';
const ROOM = 'room-alpha';
const SELF = 'node-aaa/session-1';
const PEER = 'node-bbb/session-2';

/** Deterministic ids keep a failure pointing at a rule rather than at the clock. */
function documentIdFor(index) { return `doc-${index.toString(36).padStart(12, '0')}`; }
function revisionIdFor(index) { return `rev-${index.toString(36).padStart(12, '0')}`; }
function eventIdFor(index) { return `evt-${index.toString(36).padStart(12, '0')}`; }

/**
 * Run a test body inside a throw-away directory.
 * @param {(directory: string) => Promise<unknown>} body - test body.
 * @returns {Promise<unknown>}
 */
async function inTemporaryDirectory(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-shared-doc-'));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Path of one file inside a store directory.
 * @param {string} directory - store directory.
 * @param {string} name - file name.
 * @returns {string}
 */
function fileIn(directory, name) {
  return path.join(directory, name);
}

/**
 * `document/create` for a document whose body is `content`.
 * @param {object} [options] - overrides.
 * @returns {object}
 */
function createCommand(options = {}) {
  const index = options.index ?? 1;
  const documentId = options.documentId ?? documentIdFor(index);
  const revisionId = options.revisionId ?? revisionIdFor(index);
  const eventId = options.eventId ?? eventIdFor(index);
  const at = options.at ?? AT;
  const content = options.content ?? 'hello';
  return {
    type: 'document/create',
    document: {
      documentId,
      roomId: options.roomId ?? ROOM,
      title: options.title ?? `Doc ${index}`,
      headRevisionId: revisionId,
      contentHash: hashContent(content),
      createdBy: options.actorKey ?? SELF,
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
      authorKey: options.actorKey ?? SELF,
      authorNodeName: 'Self',
      createdAt: at,
      message: 'create',
      patch: patchFromContent('', content),
      resultHash: hashContent(content),
      source: 'import',
      relatedTaskId: null,
      relatedMessageId: null,
      generation: 0,
      seq: 1,
    },
    event: {
      eventId,
      documentId,
      generation: 0,
      seq: 1,
      type: 'document-imported',
      actorKey: options.actorKey ?? SELF,
      nodeId: 'node-aaa',
      at,
      baseRevisionId: null,
      headRevisionId: revisionId,
      proposalId: null,
      revisionId,
      detail: {},
    },
    content,
  };
}

/**
 * Last `(generation, seq)` used by a document's audit log.
 * @param {object} state - current state.
 * @param {string} documentId - document to inspect.
 * @returns {number} the next free `seq`.
 */
function nextEventSeq(state, documentId) {
  const log = state.events[documentId] ?? [];
  return log.length === 0 ? 1 : log[log.length - 1].seq + 1;
}

/**
 * `revision/append` that replaces the whole body of a document.
 * @param {object} state - state the head is read from.
 * @param {string} documentId - document to extend.
 * @param {object} options - `{ revisionId, eventId, content, baseContent }`.
 * @returns {object}
 */
function appendCommand(state, documentId, options) {
  const current = state.documents[documentId];
  const revisionId = options.revisionId;
  const eventId = options.eventId;
  const baseContent = options.baseContent;
  const content = options.content;
  const generation = current.generation;
  const seq = current.seq + 1;
  const actorKey = options.actorKey ?? PEER;
  const at = options.at ?? LATER;
  return {
    type: 'revision/append',
    document: {
      documentId,
      roomId: current.roomId,
      title: current.title,
      headRevisionId: revisionId,
      contentHash: hashContent(content),
      createdBy: current.createdBy,
      createdAt: current.createdAt,
      deletedAt: current.deletedAt,
      generation,
      seq,
    },
    revision: {
      revisionId,
      proposalId: null,
      documentId,
      parentRevisionId: current.headRevisionId,
      baseRevisionId: current.headRevisionId,
      authorKey: actorKey,
      authorNodeName: 'Peer',
      createdAt: at,
      message: 'edit',
      patch: patchFromContent(baseContent, content),
      resultHash: hashContent(content),
      source: 'human',
      relatedTaskId: null,
      relatedMessageId: null,
      generation,
      seq,
    },
    event: {
      eventId,
      documentId,
      generation,
      seq: nextEventSeq(state, documentId),
      type: 'proposal-accepted',
      actorKey,
      nodeId: 'node-bbb',
      at,
      baseRevisionId: current.headRevisionId,
      headRevisionId: revisionId,
      proposalId: null,
      revisionId,
      detail: {},
    },
    content,
  };
}

/**
 * `document/rename` whose audit event takes the next free seq.
 * @param {object} state - state the log is read from.
 * @param {string} documentId - document to rename.
 * @param {string} title - new title.
 * @param {string} eventId - id of the audit event.
 * @returns {object}
 */
function renameCommand(state, documentId, title, eventId) {
  return {
    type: 'document/rename',
    documentId,
    title,
    event: {
      eventId,
      documentId,
      generation: state.documents[documentId].generation,
      seq: nextEventSeq(state, documentId),
      type: 'document-renamed',
      actorKey: SELF,
      nodeId: 'node-aaa',
      at: LATER,
      baseRevisionId: null,
      headRevisionId: state.documents[documentId].headRevisionId,
      proposalId: null,
      revisionId: null,
      detail: { title },
    },
  };
}

/**
 * JSON with object keys sorted, exactly as the store re-hashes an event.
 * @param {unknown} value - JSON value.
 * @returns {string}
 */
function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => (
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item
  ));
}

/**
 * sha256 hex of a UTF-8 string.
 * @param {string} text - text to digest.
 * @returns {string}
 */
function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Read and parse one store file.
 * @param {string} directory - store directory.
 * @param {string} name - file name.
 * @returns {Promise<any>}
 */
async function readStoreFile(directory, name) {
  return JSON.parse(await readFile(fileIn(directory, name), 'utf8'));
}

/**
 * Read the snapshot cache of a store directory, treating "not written yet" as
 * an empty cache.
 * @param {string} directory - store directory.
 * @returns {Promise<Record<string, string>>}
 */
async function readSnapshots(directory) {
  try {
    return (await readStoreFile(directory, SNAPSHOT_FILE_NAME)).entries;
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

test('opening an empty directory yields the empty state and writes nothing', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      assert.deepEqual(store.state(), emptyDocumentState());
      assert.equal(store.state().version, DOC_STATE_VERSION);
      assert.equal(store.directory, path.resolve(directory));
      // Loading must never write: a directory that had nothing stays that way,
      // so a store that cannot read its file never overwrites it.
      await assert.rejects(() => readFile(fileIn(directory, STATE_FILE_NAME), 'utf8'), (error) => {
        assert.equal(error.code, 'ENOENT');
        return true;
      });
    } finally {
      await store.close();
    }
    const reopened = await SharedDocStore.open(directory);
    try {
      assert.deepEqual(reopened.state(), emptyDocumentState());
      // Two reads must not hand out one shared object: a caller is free to use
      // the copy it got without reaching into the store.
      assert.notEqual(reopened.state(), reopened.state());
      reopened.state().documents['doc-000000000000'] = { bogus: true };
      assert.deepEqual(reopened.state().documents, {});
    } finally {
      await reopened.close();
    }
  });
});

test('a committed transaction survives a reopen and rebuilds the body', async () => {
  await inTemporaryDirectory(async (directory) => {
    const content = '# Title\n\nfirst line\nsecond line';
    const store = await SharedDocStore.open(directory);
    try {
      const written = await store.transact((state) => applyDocumentCommand(state, createCommand({ content })));
      assert.equal(written, true);
      const documentId = documentIdFor(1);
      const revisionId = revisionIdFor(1);
      const read = store.documentAt(documentId, revisionId);
      assert.equal(read.document.documentId, documentId);
      assert.equal(read.revision.revisionId, revisionId);
      assert.equal(read.content, content);
      assert.equal(hashContent(read.content), read.revision.resultHash);
    } finally {
      await store.close();
    }
    const stateFile = await readStoreFile(directory, STATE_FILE_NAME);
    assert.equal(stateFile.version, DOC_STATE_VERSION);
    assert.ok(stateFile.documents[documentIdFor(1)]);
    const reopened = await SharedDocStore.open(directory);
    try {
      const rebuilt = reopened.documentAt(documentIdFor(1), revisionIdFor(1));
      assert.equal(rebuilt.content, content);
      assert.equal(hashContent(rebuilt.content), rebuilt.revision.resultHash);
      assert.equal(reopened.verifyAudit(documentIdFor(1)).ok, true);
    } finally {
      await reopened.close();
    }
  });
});

test('transactions started in the same tick run one after another', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
      const documentId = documentIdFor(1);
      const titles = ['Alpha', 'Beta', 'Gamma'];
      const results = await Promise.all(titles.map((title, index) => store.transact((state) => (
        applyDocumentCommand(state, renameCommand(state, documentId, title, eventIdFor(20 + index)))
      ))));
      assert.deepEqual(results, [true, true, true]);

      const state = store.state();
      const log = state.events[documentId];
      // One create event plus one per rename: no transaction was lost and none
      // saw a state another one had already replaced.
      assert.equal(log.length, 4);
      assert.deepEqual(log.map((event) => event.seq), [1, 2, 3, 4]);
      assert.deepEqual(
        log.slice(1).map((event) => event.detail.title).sort(),
        [...titles].sort(),
      );
      assert.equal(titles.includes(state.documents[documentId].title), true);
      assert.equal(store.verifyAudit(documentId).ok, true);
    } finally {
      await store.close();
    }
  });
});

test('a throwing transaction leaves both the memory state and the disk untouched', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
      const before = store.state();
      const onDisk = await readFile(fileIn(directory, STATE_FILE_NAME), 'utf8');
      await assert.rejects(async () => store.transact((state) => {
        applyDocumentCommand(state, renameCommand(state, documentIdFor(1), 'Temporary', eventIdFor(30)));
        throw new TransportError('boom', 'DOC_LIMIT_REACHED');
      }), (error) => {
        assert.equal(error.code, 'DOC_LIMIT_REACHED');
        return true;
      });
      assert.deepEqual(store.state(), before);
      assert.equal(await readFile(fileIn(directory, STATE_FILE_NAME), 'utf8'), onDisk);
      // The queue must survive the failure: the next transaction still runs.
      const after = await store.transact((state) => applyDocumentCommand(
        state,
        renameCommand(state, documentIdFor(1), 'Renamed', eventIdFor(31)),
      ));
      assert.equal(after, true);
      assert.equal(store.state().documents[documentIdFor(1)].title, 'Renamed');
    } finally {
      await store.close();
    }
  });
});

test('a state file that is not JSON is reported, not replaced', async () => {
  await inTemporaryDirectory(async (directory) => {
    const garbage = 'this is not json {';
    await writeFile(fileIn(directory, STATE_FILE_NAME), garbage, 'utf8');
    await assert.rejects(() => SharedDocStore.open(directory), (error) => {
      assert.equal(error.name, 'TransportError');
      assert.equal(error.code, 'DOC_STORE_CORRUPT');
      return true;
    });
    // The evidence must still be there: recovering by starting empty would look
    // like the room lost its documents and would then overwrite the file.
    assert.equal(await readFile(fileIn(directory, STATE_FILE_NAME), 'utf8'), garbage);
  });
});

test('a state file from another schema version is refused', async () => {
  await inTemporaryDirectory(async (directory) => {
    await writeFile(
      fileIn(directory, STATE_FILE_NAME),
      JSON.stringify({ version: 999, documents: {}, revisions: {}, proposals: {}, events: {}, maintainers: {} }),
      'utf8',
    );
    await assert.rejects(() => SharedDocStore.open(directory), (error) => {
      assert.equal(error.code, 'DOC_STORE_CORRUPT');
      assert.match(error.message, /version/);
      return true;
    });
  });
});

test('a tampered resultHash makes the body unrecoverable instead of silently different', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'original body' })));
      await store.close();

      const stateFile = await readStoreFile(directory, STATE_FILE_NAME);
      stateFile.revisions[revisionIdFor(1)].resultHash = 'c'.repeat(64);
      await writeFile(fileIn(directory, STATE_FILE_NAME), JSON.stringify(stateFile), 'utf8');

      const reopened = await SharedDocStore.open(directory);
      try {
        assert.throws(() => reopened.documentAt(documentIdFor(1), revisionIdFor(1)), (error) => {
          assert.equal(error.code, 'DOC_STORE_CORRUPT');
          assert.match(error.message, /resultHash/);
          return true;
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await store.close();
    }
  });
});

test('a broken audit chain is reported with a reason and never repaired', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
      await store.transact((state) => applyDocumentCommand(state, {
        type: 'event/append',
        documentId: documentIdFor(1),
        event: {
          eventId: eventIdFor(40),
          documentId: documentIdFor(1),
          generation: 0,
          seq: 2,
          type: 'document-exported',
          actorKey: SELF,
          nodeId: 'node-aaa',
          at: LATER,
          baseRevisionId: null,
          headRevisionId: revisionIdFor(1),
          proposalId: null,
          revisionId: null,
          detail: {},
        },
      }));
      assert.equal(store.verifyAudit(documentIdFor(1)).ok, true);
      await store.close();

      // Break only the link, then re-seal the event so the hash itself still
      // checks out: the failure must be attributed to the chain, not to the hash.
      const stateFile = await readStoreFile(directory, STATE_FILE_NAME);
      const second = stateFile.events[documentIdFor(1)][1];
      second.prevHash = 'f'.repeat(64);
      const { hash: _ignored, ...body } = second;
      second.hash = sha256Hex(canonicalJson(body));
      await writeFile(fileIn(directory, STATE_FILE_NAME), JSON.stringify(stateFile), 'utf8');

      const reopened = await SharedDocStore.open(directory);
      try {
        const audit = reopened.verifyAudit(documentIdFor(1));
        assert.equal(audit.ok, false);
        assert.equal(typeof audit.reason, 'string');
        assert.match(audit.reason, /predecessor/);
        assert.equal(audit.events.length, 2);
      } finally {
        await reopened.close();
      }
    } finally {
      await store.close();
    }
  });
});

test('compacting snapshots keeps every historical revision byte-identical', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    const versions = ['one', 'one\ntwo', 'one\ntwo\nthree', 'one\nTWO\nthree', 'one\nTWO\nthree\nfour'];
    const documentId = documentIdFor(1);
    const revisionIds = [revisionIdFor(1), revisionIdFor(2), revisionIdFor(3), revisionIdFor(4), revisionIdFor(5)];
    const expected = new Map();
    try {
      await store.transact((state, tools) => {
        const next = applyDocumentCommand(state, createCommand({ content: versions[0] }));
        tools.snapshot(documentId, revisionIds[0], versions[0]);
        return next;
      });
      for (let index = 1; index < versions.length; index += 1) {
        await store.transact((state, tools) => {
          const next = applyDocumentCommand(state, appendCommand(state, documentId, {
            revisionId: revisionIds[index],
            eventId: eventIdFor(10 + index),
            content: versions[index],
            baseContent: versions[index - 1],
          }));
          tools.snapshot(documentId, revisionIds[index], versions[index]);
          return next;
        });
      }
      for (const [index, revisionId] of revisionIds.entries()) {
        expected.set(revisionId, store.documentAt(documentId, revisionId).content);
        assert.equal(expected.get(revisionId), versions[index]);
      }
      const before = await readStoreFile(directory, SNAPSHOT_FILE_NAME);
      assert.equal(Object.keys(before.entries).length, versions.length);

      assert.equal(await store.compactSnapshots(), true);
      const after = await readStoreFile(directory, SNAPSHOT_FILE_NAME);
      assert.equal(Object.keys(after.entries).length, 2);
      assert.ok(Object.keys(after.entries).length <= MAX_SNAPSHOTS_PER_DOC);

      for (const revisionId of revisionIds) {
        const rebuilt = store.documentAt(documentId, revisionId);
        assert.equal(rebuilt.content, expected.get(revisionId));
        assert.equal(hashContent(rebuilt.content), rebuilt.revision.resultHash);
      }
      // Nothing left to trim is reported as "nothing written" rather than as an
      // error, so a periodic compaction can run unconditionally.
      assert.equal(await store.compactSnapshots(), false);
    } finally {
      await store.close();
    }
  });
});

test('a failed rename leaves the previous state file loadable', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    const statePath = fileIn(directory, STATE_FILE_NAME);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
      const before = store.state();
      await chmod(statePath, 0o444);
      try {
        // Renaming over a read-only file fails on Windows and on POSIX; either
        // way the store must surface the failure and keep the old state.
        await assert.rejects(
          () => store.transact((state) => applyDocumentCommand(
            state,
            renameCommand(state, documentIdFor(1), 'Should Not Land', eventIdFor(50)),
          )),
          (error) => {
            assert.equal(error.name, 'TransportError');
            assert.equal(error.code, 'DOC_STORE_UNAVAILABLE');
            assert.equal(error.status, 503);
            return true;
          },
        );
        assert.deepEqual(store.state(), before);
        assert.equal(store.state().documents[documentIdFor(1)].title, 'Doc 1');
      } finally {
        await chmod(statePath, 0o666);
      }
      const reopened = await SharedDocStore.open(directory);
      try {
        assert.equal(reopened.state().documents[documentIdFor(1)].title, 'Doc 1');
        assert.equal(reopened.verifyAudit(documentIdFor(1)).ok, true);
      } finally {
        await reopened.close();
      }
    } finally {
      await store.close();
    }
  });
});

test('a snapshot that does not match its revision is refused before anything is written', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
      await assert.rejects(() => store.transact((state, tools) => {
        tools.snapshot(documentIdFor(1), revisionIdFor(1), 'a different body');
        return state;
      }), (error) => {
        assert.equal(error.code, 'DOC_PATCH_MISMATCH');
        return true;
      });
      await assert.rejects(() => store.transact((state, tools) => {
        tools.snapshot(documentIdFor(1), revisionIdFor(9), 'body');
        return state;
      }), (error) => {
        assert.equal(error.code, 'DOC_NOT_FOUND');
        return true;
      });
      assert.deepEqual(await readSnapshots(directory), {});

      const recorded = await store.transact((state, tools) => {
        tools.snapshot(documentIdFor(1), revisionIdFor(1), 'body');
        return undefined;
      });
      assert.equal(recorded, true);
      const entries = await readSnapshots(directory);
      assert.deepEqual(Object.keys(entries), [`${documentIdFor(1)}/${revisionIdFor(1)}`]);
      assert.equal(store.documentAt(documentIdFor(1), revisionIdFor(1)).content, 'body');
    } finally {
      await store.close();
    }
  });
});

test('a closed store refuses further work and a no-op transaction writes nothing', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
    assert.equal(await store.transact(() => undefined), false);
    // Returning the state it was handed is also a no-op, so a replayed command
    // does not rewrite the same bytes.
    assert.equal(await store.transact((state) => state), false);
    await assert.rejects(() => store.transact(7), (error) => {
      assert.equal(error.code, 'DOC_COMMAND_INVALID');
      return true;
    });

    await store.close();
    assert.equal(store.closed, true);
    await assert.rejects(() => store.transact((state) => state), (error) => {
      assert.equal(error.code, 'DOC_STORE_UNAVAILABLE');
      return true;
    });
    assert.throws(() => store.state(), (error) => {
      assert.equal(error.code, 'DOC_STORE_UNAVAILABLE');
      return true;
    });
    assert.throws(() => store.documentAt(documentIdFor(1), revisionIdFor(1)), (error) => {
      assert.equal(error.code, 'DOC_STORE_UNAVAILABLE');
      return true;
    });
    // Closing twice is harmless, which matters when two shutdown paths race.
    await store.close();
  });
});

test('unknown ids are reported as missing rather than as corruption', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = await SharedDocStore.open(directory);
    try {
      await store.transact((state) => applyDocumentCommand(state, createCommand({ content: 'body' })));
      assert.throws(() => store.documentAt(documentIdFor(2), revisionIdFor(2)), (error) => {
        assert.equal(error.code, 'DOC_NOT_FOUND');
        return true;
      });
      assert.throws(() => store.documentAt('not-a-document', revisionIdFor(1)), (error) => {
        assert.equal(error.code, 'DOC_NOT_FOUND');
        return true;
      });
      assert.throws(() => store.documentAt(documentIdFor(1), revisionIdFor(2)), (error) => {
        assert.equal(error.code, 'DOC_NOT_FOUND');
        return true;
      });
      assert.throws(() => store.verifyAudit(documentIdFor(2)), (error) => {
        assert.equal(error.code, 'DOC_NOT_FOUND');
        return true;
      });
    } finally {
      await store.close();
    }
  });
});
