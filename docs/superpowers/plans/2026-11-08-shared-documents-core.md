# Shared Documents Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Room-native Markdown documents with optimistic commits, deterministic conflict detection, Leader ordering, and fully reconstructable append-only history.

**Architecture:** A pure reducer validates documents, proposals, revisions, and audit events. The Room Leader commits revision, audit, head, idempotency, and sync outbox atomically; stale proposals use deterministic line-level diff3 and become conflicts only when overlapping edits cannot merge.

**Tech Stack:** Node.js ESM, `diff` v9 line changes, atomic JSON store pattern, SHA-256 hash chains, signed Team-style protocol, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md`

## Global Constraints

- Only Leader orders canonical revisions in M1; offline nodes create pending proposals only.
- Audit order uses `leaderGeneration + seq`, never wall-clock order.
- The same proposal ID is idempotent; retries re-evaluate against current head.
- Revision, event, head, idempotency record, and outbox commit in one durable transaction.
- Any human member may propose a conflict resolution; only Leader or a designated document maintainer may confirm it.

## Review Focus

- Same-line concurrent edits must not auto-merge silently: Task 2.
- Non-overlapping edits with shifted line numbers must merge deterministically: Task 2.
- Same generation+seq with different hashes must stop sync and alarm: Task 4.
- Crash at every transaction boundary must expose either old or complete new state: Task 3.
- Agent confirmation attempts must fail even with a valid Room membership: Task 5.

---

### Task 1: Define the pure document state model

**Files:**
- Create: `lib/shared-doc-state.mjs`
- Create: `scripts/shared-doc-state.test.mjs`

**Interfaces:**
- Produces: `emptyDocumentState()`, `applyDocumentCommand(state, command)`, canonical validators and exported views.
- Entities: `SharedDocument`, `DocumentProposal`, `DocumentRevision`, `DocumentAuditEvent`, maintainer grants.

- [ ] Write tests for create/rename/archive, size limits, canonical IDs, immutable input, proposal idempotency, maintainer grants, and tombstones.
- [ ] Run the test; expect FAIL.
- [ ] Implement the smallest pure state transitions; no filesystem or network access.
- [ ] Run the test; expect PASS.
- [ ] Commit with `git commit -m "feat: define shared document state"`.

### Task 2: Implement deterministic line-level merge

**Files:**
- Create: `lib/shared-doc-merge.mjs`
- Create: `scripts/shared-doc-merge.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `mergeMarkdown({base,current,proposed}): {status:'clean',content,hunks}|{status:'conflict',hunks}` and canonical patch helpers.

- [ ] Write tests for disjoint edits, insert/delete shifts, same-line conflicts, newline normalization, empty documents, Unicode, deterministic repeated output, and configured size limits.
- [ ] Run the test; expect FAIL.
- [ ] Add direct dependency `diff@^9.0.0` and implement interval reconciliation over its line change sets; never accept conflict markers as a successful merge.
- [ ] Run the test; expect PASS.
- [ ] Commit with `git commit -m "feat: add deterministic document merging"`.

### Task 3: Add the atomic document store and reconstruction

**Files:**
- Create: `lib/shared-doc-store.mjs`
- Create: `scripts/shared-doc-store.test.mjs`

**Interfaces:**
- Produces: `SharedDocStore.open(dir)`, `transact(fn)`, `documentAt(documentId, revisionId)`, `verifyAudit(documentId)`.

- [ ] Write tests for serialized transactions, restart, corrupt state, revision reconstruction, snapshot compaction without history loss, failed rename, and injected crash points.
- [ ] Run the test; expect FAIL.
- [ ] Implement temp-file/fsync/rename transactions and permanent revision objects; snapshots may optimize reads but never replace audit material.
- [ ] Run the test; expect PASS.
- [ ] Commit with `git commit -m "feat: persist shared document history"`.

### Task 4: Add signed document replication and split-brain detection

**Files:**
- Create: `lib/shared-doc-protocol.mjs`
- Create: `scripts/shared-doc-protocol.test.mjs`
- Modify: `lib/transport.mjs`

**Interfaces:**
- Produces: capability `sharedDocs: 1`; submit/status/sync operations; generation+seq+hash verification.

- [ ] Write tests for auth, replay, actor binding, unsupported peers, duplicate events, gaps, conflicting hashes, oversized bodies, and recovery from a lost acknowledgement.
- [ ] Run the protocol test; expect FAIL.
- [ ] Implement signed requests and fail-closed replication; a conflicting checkpoint pauses that document and emits an operator-visible error.
- [ ] Run protocol and legacy transport tests; expect PASS.
- [ ] Commit with `git commit -m "feat: replicate shared document history"`.

### Task 5: Coordinate proposals, auto-merges, conflicts, and approvals

**Files:**
- Create: `lib/shared-doc-coordinator.mjs`
- Create: `scripts/shared-doc-coordinator.test.mjs`
- Modify: `lib/service.mjs`

**Interfaces:**
- Produces: service methods `createDocument`, `submitDocumentProposal`, `resolveDocumentConflict`, `confirmDocumentResolution`, `getDocument`, `listDocumentHistory`.

- [ ] Write tests for current-base commits, clean stale merges, conflicts preserving head, pending offline proposals, retry idempotency, human proposal rights, Agent confirmation refusal, Leader/maintainer confirmation, and atomic outbox creation.
- [ ] Run coordinator tests; expect FAIL.
- [ ] Implement Leader-only canonical coordination and explicit human/Agent actor kinds.
- [ ] Run coordinator tests plus `npm test`; expect PASS.
- [ ] Commit with `git commit -m "feat: coordinate shared document revisions"`.

### Task 6: Expose tools and panel endpoints

**Files:**
- Create: `lib/shared-doc-tools.mjs`
- Create: `scripts/shared-doc-tools.test.mjs`
- Modify: `index.js`
- Modify: `scripts/schema-check.mjs`
- Modify: `docs/usage.md`

**Interfaces:**
- Produces: model tools for list/read/propose/history; human panel endpoints for create/read/propose/resolve/confirm/history.

- [ ] Write schema and identity-binding tests; confirm tools cannot self-report a human actor or confirm conflict resolution.
- [ ] Run tool and schema tests; expect FAIL.
- [ ] Register tools/endpoints with bounded string outputs and host-bound actor identity.
- [ ] Run `npm test && node scripts/schema-check.mjs`; expect PASS.
- [ ] Commit with `git commit -m "feat: expose shared document operations"`.

