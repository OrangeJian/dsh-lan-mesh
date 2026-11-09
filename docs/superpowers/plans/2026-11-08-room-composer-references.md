# Room Composer References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Room composer with machine-disambiguated mentions and non-executing structured skill references while keeping Room submission independent from Agent Sessions.

**Architecture:** Keep `roomSay` as the only submission sink. Add validated structured message metadata and a Room-owned draft; reuse only public DSH client contracts discovered by a compatibility check, never private `InputBar` internals.

**Tech Stack:** Node.js ESM, React 18 host runtime, DSH client slot contracts, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md`

## Global Constraints

- Skill selection creates a reference only; it must never install or execute a skill.
- Mention authority is the member key, never a display name.
- Candidate labels use `Agent title · machine name`; add a short Session ID only when both repeat.
- Do not fabricate a Session or import unexported symbols from DSH bundles.
- Old messages without structured metadata remain readable.

## Review Focus

- Two same-title Agents on different nodes must select different member keys: pinned in Task 2.
- Two same-title Agents on the same node must gain a short Session suffix: pinned in Task 2.
- Typed slash-like text must not become a skill reference without menu confirmation: pinned in Task 3.
- A referenced skill missing on the receiver must remain visible and non-executing: pinned in Task 3.
- An older peer must still receive readable text when it ignores metadata: pinned in Task 4.

---

### Task 1: Verify the public DSH reuse boundary

**Files:**
- Create: `scripts/composer-compat-check.mjs`
- Create: `docs/development-room-composer-compat.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: installed DSH package exports and package metadata.
- Produces: `npm run check:composer-compat`, a documented matrix of reusable public contracts versus Room-owned fallbacks.

- [ ] **Step 1: Write a failing compatibility check**

Assert that the installed DSH exposes its public conversation, attachment, input-trigger, and skill client entry points; assert that the plan does not require importing `InputBar` or bundle-private paths.

- [ ] **Step 2: Run it and verify the missing script/document fails**

Run: `node scripts/composer-compat-check.mjs`
Expected: FAIL until the check resolves and classifies all required entry points.

- [ ] **Step 3: Implement the check and compatibility matrix**

Record exact package versions, public exports, scope requirements, and the Room-owned fallback for every Session-only capability. Add `check:composer-compat` to `package.json`.

- [ ] **Step 4: Verify**

Run: `npm run check:composer-compat`
Expected: PASS with no private-import requirement.

- [ ] **Step 5: Commit**

```bash
git add scripts/composer-compat-check.mjs docs/development-room-composer-compat.md package.json
git commit -m "test: document room composer compatibility"
```

### Task 2: Persist node identity and disambiguate mentions

**Files:**
- Modify: `lib/rooms.mjs`
- Modify: `lib/service.mjs`
- Modify: `client.js`
- Modify: `scripts/rooms.test.mjs`
- Modify: `scripts/panel-check.mjs`

**Interfaces:**
- Consumes: `memberKey(nodeId, sessionId)` and discovery node names.
- Produces: member projection field `nodeName`; `mentionLabels(members)` returning display and stable key labels.

- [ ] **Step 1: Write failing room and panel tests**

Add tests proving node names round-trip and update by timestamp; panel candidates distinguish cross-node duplicates as `title · nodeName`, and same-node duplicates append a short Session ID while selection sends the correct key.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/rooms.test.mjs && node scripts/panel-check.mjs`
Expected: FAIL on absent `nodeName` and incorrect candidate labels.

- [ ] **Step 3: Implement the minimum projection and UI changes**

Add LWW `nodeName/nodeNameUpdatedAt` membership fields, update local memberships when node identity changes, and make mention insertion retain member key separately from display text.

- [ ] **Step 4: Verify GREEN**

Run: `node --test scripts/rooms.test.mjs && node scripts/panel-check.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rooms.mjs lib/service.mjs client.js scripts/rooms.test.mjs scripts/panel-check.mjs
git commit -m "feat: disambiguate room mentions by machine"
```

### Task 3: Add validated mention and skill-reference metadata

**Files:**
- Create: `lib/room-message.mjs`
- Create: `scripts/room-message.test.mjs`
- Modify: `lib/service.mjs`
- Modify: `lib/transport.mjs`

**Interfaces:**
- Produces: `normalizeRoomMessageMetadata({mentions, skillRefs}, room): {mentions, skillRefs}` and wire fields `mentions[]`, `skillRefs[]`.
- Mention entry: `{memberKey, label}`.
- Skill entry: `{name, sourceNodeId, sourceNodeName}`.

- [ ] **Step 1: Write failing metadata tests**

Cover stable-key validation, deduplication, length/count limits, rejection of non-members, unconfirmed slash text producing no reference, and a missing receiver skill remaining ordinary metadata.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/room-message.test.mjs`
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the pure normalizer and service wiring**

Keep metadata out of signatures that would break legacy peers unless protocol capability says it is supported; always preserve readable text.

- [ ] **Step 4: Verify GREEN and transport compatibility**

Run: `node --test scripts/room-message.test.mjs scripts/rooms.test.mjs && node scripts/twin-transport-check.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/room-message.mjs scripts/room-message.test.mjs lib/service.mjs lib/transport.mjs
git commit -m "feat: add structured room references"
```

### Task 4: Build the Room-owned rich draft and skill picker

**Files:**
- Modify: `client.js`
- Modify: `index.js`
- Modify: `scripts/panel-check.mjs`
- Modify: `scripts/schema-check.mjs`
- Modify: `docs/ui-contract.md`

**Interfaces:**
- Consumes: `roomSay({room, sessionId, text, mentions, skillRefs})`.
- Produces: panel endpoint `roomSkills`; Room draft state `{text, mentions, skillRefs, phase}`.

- [ ] **Step 1: Write failing panel and endpoint tests**

Assert `/` opens the catalog, clicking inserts one confirmed chip/reference, arbitrary typed `/foo` stays plain text, removal clears metadata, send serializes references, and legacy text remains readable.

- [ ] **Step 2: Verify RED**

Run: `node scripts/panel-check.mjs && node scripts/schema-check.mjs`
Expected: FAIL on missing catalog and structured submission.

- [ ] **Step 3: Implement endpoint and Room draft UI**

Resolve only the local public skill catalog. Render unavailable received skills as labeled references without action. Preserve Enter/Shift+Enter and existing `@` keyboard behavior.

- [ ] **Step 4: Verify the phase**

Run: `npm test && node scripts/panel-check.mjs && npm run check:composer-compat`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add client.js index.js scripts/panel-check.mjs scripts/schema-check.mjs docs/ui-contract.md
git commit -m "feat: add room skill references"
```

