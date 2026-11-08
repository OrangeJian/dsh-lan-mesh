# Shared Documents UI and Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give humans a Room document workflow and deliver bounded, version-pinned shared context to mentioned or assigned Agents.

**Architecture:** Add a Documents Room view for reading, editing, diffs, history, and conflict resolution. Context packets contain only explicit document versions, marked decisions/questions, referenced messages, attachments, and skills; delivery records exactly which revisions the Agent received.

**Tech Stack:** React host panel, existing Markdown renderer, shared-document service, Room Agent delivery, `node:test` panel harness.

**Spec:** `docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md`

## Global Constraints

- M1 decisions and open questions come only from explicit marked blocks/fields.
- Every document context item carries revision ID and content hash.
- Context size is bounded; Agents fetch more through tools.
- Human members may propose resolutions; only Leader/maintainer controls confirmation UI.
- History is read-only; restoring an old version creates a new proposal.

## Review Focus

- A stale editor save must become a proposal and never overwrite head: Task 2.
- A non-maintainer must see resolution proposal controls but not confirmation controls: Task 3.
- A huge document must yield a bounded context packet with fetch references: Task 4.
- An Agent receiving revision N must remain auditable after head reaches N+1: Task 4.
- Deleted/archived documents referenced by old history must remain reconstructable: Task 2.

---

### Task 1: Add the Room Documents navigation and list

**Files:**
- Modify: `client.js`
- Modify: `scripts/panel-check.mjs`
- Modify: `docs/ui-contract.md`

**Interfaces:**
- Consumes: document list/create panel endpoints.
- Produces: Documents Room view with title, head revision, author, conflict count, and task link.

- [ ] Write failing panel tests for empty/list/loading/error/create/archive states and permission visibility.
- [ ] Run `node scripts/panel-check.mjs`; expect FAIL.
- [ ] Implement the list and create flow without changing native conversation ownership.
- [ ] Run the panel check; expect PASS.
- [ ] Commit with `git commit -m "feat: add room documents view"`.

### Task 2: Add Markdown edit, diff, and history surfaces

**Files:**
- Modify: `client.js`
- Modify: `scripts/panel-check.mjs`

**Interfaces:**
- Consumes: read/propose/history endpoints.
- Produces: reading/editing/diff/history tabs; save requires a commit message and sends base revision.

- [ ] Write tests for edit/save, stale save, diff rendering, history pagination, old revision read, and restore-as-new-proposal.
- [ ] Run the panel check; expect FAIL.
- [ ] Implement the four surfaces using the official Markdown renderer for reading and plain Markdown source editing for M1.
- [ ] Run the panel check; expect PASS.
- [ ] Commit with `git commit -m "feat: edit and inspect shared documents"`.

### Task 3: Add three-way conflict resolution UI

**Files:**
- Modify: `client.js`
- Modify: `scripts/panel-check.mjs`

**Interfaces:**
- Consumes: conflict detail/resolve/confirm endpoints.
- Produces: base/current/proposed display, editable resolution proposal, and role-gated confirmation.

- [ ] Write tests for human proposal access, Agent exclusion, non-maintainer hidden confirmation, maintainer confirmation, changed-head revalidation, and audit links.
- [ ] Run the panel check; expect FAIL.
- [ ] Implement resolution and confirmation as separate actions; confirmation must re-read current head before submission.
- [ ] Run the panel check; expect PASS.
- [ ] Commit with `git commit -m "feat: resolve shared document conflicts"`.

### Task 4: Build version-pinned Agent context packets

**Files:**
- Create: `lib/room-context.mjs`
- Create: `scripts/room-context.test.mjs`
- Modify: `lib/service.mjs`
- Modify: `lib/team-coordinator.mjs`

**Interfaces:**
- Produces: `buildRoomContextPacket(input, limits)` and delivery audit records; packets include explicit `selectedDocumentVersions`, `confirmedDecisions`, `openQuestions`, message/attachment/skill refs.

- [ ] Write tests for explicit-only extraction, revision/hash pinning, deterministic truncation, unavailable attachments, old-revision audit, and tool fetch references.
- [ ] Run `node --test scripts/room-context.test.mjs`; expect FAIL.
- [ ] Implement bounded packet construction and attach it to mention/task dispatch without copying complete chat history.
- [ ] Run context tests, Team tests, and `npm test`; expect PASS.
- [ ] Commit with `git commit -m "feat: deliver room context to agents"`.

### Task 5: Add manual Markdown import/export

**Files:**
- Modify: `lib/service.mjs`
- Modify: `index.js`
- Modify: `client.js`
- Create: `scripts/shared-doc-import.test.mjs`
- Modify: `scripts/panel-check.mjs`
- Modify: `docs/usage.md`

**Interfaces:**
- Produces: authorized import/export endpoints; import always creates a proposal/revision and audit event.

- [ ] Write tests for path grants, UTF-8 normalization, oversized files, export overwrite refusal, imported audit records, and UI download/upload flows.
- [ ] Run import and panel tests; expect FAIL.
- [ ] Implement explicit file selection and safe export; no automatic two-way Git binding.
- [ ] Run `npm test && node scripts/panel-check.mjs`; expect PASS.
- [ ] Commit with `git commit -m "feat: import and export shared markdown"`.

### Task 6: Run cross-node acceptance and document operations

**Files:**
- Create: `scripts/shared-docs-smoke.mjs`
- Modify: `README.md`
- Modify: `docs/usage.md`

**Interfaces:**
- Consumes: all prior plans.
- Produces: two-node acceptance script covering references, attachments, clean merge, conflict, approval, history reconstruction, and Agent context audit.

- [ ] Write the smoke script with deterministic ports/temp homes and failure injection for one lost acknowledgement.
- [ ] Run it before final wiring; expect at least one named acceptance failure.
- [ ] Complete only the missing integration wiring exposed by the smoke script.
- [ ] Run `npm test`, panel/schema/compat checks, attachment and shared-doc smoke scripts; expect all PASS and a clean `git diff --check`.
- [ ] Commit with `git commit -m "docs: finish shared room collaboration workflow"`.

