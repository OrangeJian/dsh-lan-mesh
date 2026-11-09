# Room Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace new inline base64 Room files with multi-file, image-capable, content-addressed attachments that survive cross-node transfer.

**Architecture:** Store bytes in a local atomic `RoomBlobStore`; messages contain immutable refs while mutable holder declarations travel separately. A message is accepted only after sender and Room Leader both durably hold every blob.

**Tech Stack:** Node.js streams, SHA-256, atomic filesystem writes, authenticated Mesh HTTP, React attachment rail, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md`

## Global Constraints

- Never embed new attachment bytes in Room JSON.
- Verify declared size and SHA-256 on every intake path.
- Persist on sender and Leader before acknowledging the message.
- Keep legacy inline attachment reads; do not create new legacy payloads.
- Enforce configurable count, per-file, and total-size limits at browser, Host, and peer boundaries.

## Review Focus

- Hash mismatch or truncated upload must leave no committed blob: Task 1.
- Crash after blob rename but before message commit must create only a collectible orphan: Task 3.
- Duplicate content must not duplicate bytes or holder declarations: Task 1.
- Leader offline must keep a draft and never claim the message was sent: Task 3.
- No reachable holder must render metadata plus a clear unavailable state: Task 4.

---

### Task 1: Implement the atomic content-addressed blob store

**Files:**
- Create: `lib/room-blob-store.mjs`
- Create: `scripts/room-blob-store.test.mjs`
- Modify: `index.js`

**Interfaces:**
- Produces: `RoomBlobStore.open(options)`, `put(readable, descriptor)`, `has(blobId)`, `openRead(blobId)`, `declareHolder(blobId,nodeId)`, `collectOrphans(now)`.

- [ ] Write tests for atomic commit, deduplication, size/hash mismatch, corrupt metadata, restart, and orphan grace-period collection.
- [ ] Run `node --test scripts/room-blob-store.test.mjs`; expect FAIL because the module is absent.
- [ ] Implement immutable refs and separate holder declarations using temp-file `fsync + rename` and serialized metadata transactions.
- [ ] Run the test again; expect PASS.
- [ ] Commit with `git commit -m "feat: add room blob storage"`.

### Task 2: Add authenticated streaming blob transfer

**Files:**
- Create: `lib/room-blob-protocol.mjs`
- Create: `scripts/room-blob-protocol.test.mjs`
- Modify: `lib/transport.mjs`

**Interfaces:**
- Produces: capability `roomBlobs: 1`; authenticated `PUT/GET /lan-mesh/v1/room-blobs/:sha256`; bounded stream helpers.

- [ ] Write tests for auth, target binding, replay, range refusal, length limit, hash mismatch, cancellation, and capability refusal.
- [ ] Run the protocol test; expect FAIL.
- [ ] Implement streaming routes without buffering a complete file in JSON or memory.
- [ ] Run protocol tests plus `node scripts/twin-transport-check.mjs`; expect PASS.
- [ ] Commit with `git commit -m "feat: transfer room blobs between peers"`.

### Task 3: Make attachment-backed message submission transactional

**Files:**
- Modify: `lib/service.mjs`
- Modify: `lib/room-message.mjs`
- Create: `scripts/room-attachments.test.mjs`
- Modify: `scripts/rooms-smoke.mjs`

**Interfaces:**
- Consumes: `RoomBlobStore` and blob protocol.
- Produces: `roomSay({attachments: RoomAttachmentRef[]})`; holder outbox and idempotent message submission id.

- [ ] Write failing tests for sender+Leader durability, duplicate retries, Leader offline, crash windows, late holder replication, and old-peer readable-text fallback.
- [ ] Run `node --test scripts/room-attachments.test.mjs`; expect FAIL.
- [ ] Implement prepare/upload/commit ordering and durable retry outbox.
- [ ] Run unit test and escalated `node scripts/rooms-smoke.mjs`; expect PASS.
- [ ] Commit with `git commit -m "feat: send durable room attachments"`.

### Task 4: Add official-shaped multi-attachment UI

**Files:**
- Modify: `client.js`
- Modify: `index.js`
- Modify: `scripts/panel-check.mjs`
- Modify: `docs/ui-contract.md`

**Interfaces:**
- Produces: panel upload/read endpoints; Room draft `attachmentIds[]`; image previews, file cards, progress, retry, removal, drag/drop and paste.

- [ ] Write failing panel tests for multi-select, pasted images, drag/drop, progress, failed retry, removal, unavailable holders, and blocking send while uploads are pending.
- [ ] Run `node scripts/panel-check.mjs`; expect FAIL.
- [ ] Implement UI using only compatibility-matrix-approved public DSH pieces and Room-owned fallbacks.
- [ ] Run `npm test && node scripts/panel-check.mjs && npm run check:composer-compat`; expect PASS.
- [ ] Commit with `git commit -m "feat: add rich room attachments"`.

