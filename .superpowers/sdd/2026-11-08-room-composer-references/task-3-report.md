# Task 3 report: validated Room references

Status: implemented; focused, transport, panel, schema and full suite checks pass.
Review base: ecdccce (Task 2 baseline 35dbe17 plus independent compatibility-check improvement).

## RED / GREEN evidence

- `node --test scripts/room-message.test.mjs`: first RED 0/3, expected missing normalizer function assertions. Minimal normalizer implementation then GREEN 3/3.
- Added transport/service integration tests: RED 3/6 (metadata dropped in normalized envelope and actual HTTP request; initial service fixture incorrectly assigned a getter and was corrected to constructor injection). After production integration GREEN 6/6.
- Added sender-session authentication/outsider admission assertions: RED 4/6 (session mutation still verified; outsider sender admitted), then GREEN 6/6 after binding sender session in extension and checking sender membership.
- `scripts/schema-check.mjs`: reference parameter/output assertions RED; real panel RPC RED with `args is not defined`, corrected to endpoint's `request`. Existing Task 2 nodeName projection was also absent from MEMBER_SCHEMA, causing seven existing schema failures; added the single declared field. Final GREEN 55/55.
- `node scripts/panel-check.mjs`: newly added composer identity serialization passed; mixed selected individual + all produced RED 109/111. Minimal client broadcast handling then GREEN 111/111.

## Interfaces and limits

`normalizeRoomMessageMetadata({mentions,skillRefs},room)` returns only supplied metadata fields. `mentions` entries are `{memberKey,label}`. `skillRefs` entries are `{name,sourceNodeId,sourceNodeName}`. Maximum 64 mentions and 32 skill references before deduplication. Member keys <=129 characters, mention labels <=256, skill names <=128, source node IDs <=64, source node names <=128. Fields must be nonempty strings and contain no control characters. All entries are validated before use, including duplicates. Mention membership must match the Room's exact member key. First occurrence wins, preserving insertion order; mentions deduplicate by memberKey and skills by sourceNodeId/name. Transport uses the same shape/limit normalizer without a room, then the receiver validates against its actual room before recording or waking. Labels and skill provenance never become permissions.

Absent `mentions` retains legacy text matching. Present `mentions: []` means explicitly no exact targets; it does not fall back to names or broadcast. Present nonempty mentions exclusively controls delivery, attention and room unread by exact memberKey. Legacy log `mentions` remains text tokens; projected structured entries use `structuredMentions`, avoiding incompatible meanings for the existing field.

RoomPane serializes draft selections without editor offsets. Panel `roomSay` RPC and public `lan_mesh_room_say` accept and forward references. Public inbox output/schema carries `structuredMentions` and `skillRefs`. The file field is passed through the same RPC because the existing composer already supplied it; no attachment transport redesign was attempted.

## Persistence and execution

Sender log, incoming log, room detail, inbox and read-flag rewrite all preserve metadata. Test exercises read/write disk roundtrip plus markAllRead rewrite, waiting on observable on-disk read flags using bounded polling, rather than fixed delays. Startup uses the same record projection as incoming messages; the test does not start/stop three full discovery stacks.

A reference to a missing receiver skill is accepted and stored, with no skill lookup, installation or invocation. Plain typed slash text creates no skillRefs. sourceNodeId/sourceNodeName describe provenance only.

## Protocol and compatibility

Node descriptions advertise top-level `roomReferences: 1`. Before structured delivery the sender reads peer `/lan-mesh/v1/info` capability. Capability is a feature hint, not an authentication credential.

Capable peers use `/lan-mesh/v1/send-references` with `referencesVersion: 1`. The HMAC input retains the complete original protocol-v2 input followed by a domain/version marker, JSON sender session ID, and deterministic normalized metadata JSON. All reference routing fields and skill sources participate. Ordinary v2 envelopes retain their exact existing signing input; state signatures are unchanged. Independent reference endpoint requires the version; ordinary send/hello endpoints reject reference extensions. Unsupported versions are rejected. Secured meshes retain existing HMAC and allowlist admission. Open meshes retain their established no-secret behavior.

Reference targets must belong to a known Room and the authenticated sender node/session must be a member. Unknown Rooms and wrong-member references are rejected before persistence or wake. Cross-node duplicate names do not wake unintended nodes, including a third node with no selected target. Exact mode bypasses the old wake fallback completely.

Legacy peers: exact references (including explicit empty lists) return UNSUPPORTED_REFERENCES without delivering a potentially ambiguous legacy broadcast. Skills-only messages downgrade to their readable body without structured fields. Ordinary messages remain v2. This is a deliberate fail-closed compatibility boundary rather than a promise that old peers can preserve exact targeting.

Client all selection: picker displays localized labels but inserts stable `@all`, clears individual draft references, and sends legacy broadcast text. If an individual is selected alongside an existing `@all`, send also omits the exact filter. Public API callers supplying exact mentions retain exact semantics even if their readable text contains `@all`.

## Final validation

- `node --test scripts/room-message.test.mjs scripts/rooms.test.mjs`: 60/60 pass.
- `node scripts/twin-transport-check.mjs`: twin transport ok, including original protocol-v2 signature behavior.
- `node scripts/panel-check.mjs`: 111/111 assertions pass, including identity serialization and mixed all/individual choice.
- `$env:DSH_TOOLS_MODULE='D:/softwareNew/nodejs/node_global/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'; node scripts/schema-check.mjs`: 55/55 pass against installed framework validator. Default hardcoded validator location was unavailable; no dependency installed.
- `npm test`: 105/105 pass, no skipped/cancelled tests.
- `git diff --check`: passes (Git reports only existing Windows LF/CRLF conversion notices).

## Self-review / boundaries

Reviewed membership-before-write, exact wake fallback suppression, attention/unread parity, read-log rewrite preservation, extension stripping/version/target/source/session tampering, old-peer non-delivery and plain-v2 compatibility. Schema check invokes real public tool execute and the captured panel fetch handler using a real Request; actual HTTP tests run MeshServer with secured requests.

Capability probing adds one bounded HTTP info request per peer per reference message; no cache added, avoiding stale upgrade assumptions. Unknown-room rejection may require the sender to sync Rooms then retry. For mixed old/new Rooms, capable targets may receive while older targets explicitly fail. Sender UI already surfaces per-node delivery failures. Existing node-global read flags remain unchanged. File attachment normalization over remote transport is outside this reference task. No visual browser layout QA was performed for this metadata-only change.

## Review fix round 1 (base 693147c)

Reviewer reproduced a full Host rollover ID (>64 characters) missing exact attention/unread/read state even though its bounded Room key correctly woke the live Agent. Added an integration regression using an 81-character ID with an actual bounded member from joinRoom, real MeshNode receive/inbox/snapshot/markRoomRead/roomDetail and a live Agent registry. RED: `node --test scripts/room-message.test.mjs` passed 6/7, failed at exact attention (`0 !== 1`), after the exact wake assertion already passed.

Introduced a shared caller Room-key resolver for attention, unread, read marking, detail membership and room labels. A full caller ID maps to its 64-character stored Room session only when the existing unique live-prefix resolver maps that stored prefix back to this exact caller. Ambiguous prefixes resolve to no identity, including requests using the stored 64-character ID. Display names do not participate. Own-message suppression also compares canonical Room identities so full and stored caller forms agree.

GREEN: `node --test scripts/room-message.test.mjs scripts/rooms.test.mjs` 61/61; `npm test` 106/106. The regression verifies exact wake, full-ID attention, unread count, explicit read clearing, roomDetail member/read behavior; then introduces a second live Agent with the same first 64 characters. Both full IDs exist in agents.get, while the shared stored prefix is ambiguous: no new wake, no exact attention/unread, no read clearing and no viewer membership for either full ID or stored prefix.

Boundary: full IDs require a unique live mapping; no display-label fallback or unconditional truncation is used to authorize a full caller against a bounded Room identity. This intentionally fails closed when the live registry cannot disambiguate rollover sessions.
