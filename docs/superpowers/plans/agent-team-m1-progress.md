# SDD ledger — plan: docs/superpowers/plans/2026-11-08-agent-team-m1.md

Baseline: rooms + notify tests 60/60 passed.
Workspace: existing checkout, branch codex/agent-team-m1 created with approved escalation.
Ruling: use current checkout on a dedicated branch, preserving uncommitted approved design/plan; no automatic commits while Git metadata requires escalation.
Pre-flight: Task 1 state returned by reducer is consumed inside Task 2 transactions; Task 3 nonce checks use the same transactions; Task 4 coordinates all three; Task 5 binds authenticated actors. No signature mismatch found.
Task 1: in progress; tests written before implementation.

Task 1: complete — pure reducer tests observed missing-module RED then GREEN; additional sequence/terminal/key validation regressions passed.
Task 2: complete — transactional store tests RED then GREEN, concurrent write/reopen/corrupt JSON/rename failure verified.
Task 3: complete — signed request/response protocol tests RED then GREEN; persistent concurrent replay checks, clock boundaries and legacy peer rejection verified.
Task 4: implemented — dispatch/start/heartbeat/result/status-query/recovery/cancel/reconcile; fault tests passing, final review pending.
Task 5: implemented — opt-in config, five host-bound tools, independent HTTP route, local path grants; real HTTP smoke found and fixed catalogue field mismatch (agents, not local).
Task 6: in progress — full regression and fresh review pending.

Ruling: extracted tool schemas to lib/team-tools.mjs to keep index.js registration small. Tool dataJson avoids unsupported arbitrary-object output schemas; identity still comes from exec.agent.id.
Ruling: no new Team browser mutation RPC — the existing panel accepts sessionId supplied by its owner, whereas the approved Team contract requires host-bound Agent identity. Five tools and service methods are provided instead.
Ruling: added signed reconcile operation so manual stop confirmation releases Worker and Leader capacity on both nodes; cancel remains uncertain until that explicit confirmation.
Ruling: added configurable teamLeaseMs/teamHeartbeatMs/teamRequestWindowMs; defaults 90000/20000/120000.
Ruling: removed wake-probe synchronous file append in favor of existing logger; tests had appended to the tracked log, which was restored to its clean baseline.
Ruling: during live user troubleshooting, confirmed local node 192.168.0.18 had zero projects and peer 192.168.0.50 had eight. Discovery callback was a no-op and snapshots were local-only. Added new-peer and periodic Room anti-entropy, serialization and regression test. One-time project-state sync restored the user's local list without joining any project or waking Agents.
Ruling: network smoke failed discovery under sandbox; approved reruns outside sandbox passed Mesh, Rooms and Agents suites. Schema validator exists at D:/softwareNew/nodejs/node_global/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js; DSH_TOOLS_MODULE selects it.

Final review: fresh read-only reviewer identified seven important boundary issues. Each was reproduced with failing regression tests (whitelist, start-marker lease race, cancellation CAS, event ACK sequencing, expired result/progress, parseable storage corruption, pre-start expiry); all regressions are green after one fix pass. Terminal reconciliation is rejected before network effects; compact reconcile bodies avoid transmitting event history.
Ruling: explicit manual reconciliation first writes a durable Leader cancellation tombstone and a reconciliation outbox entry. remotePending reports delayed Worker acknowledgement; Worker capacity remains occupied until its own record is reconciled. This permits safely retiring an execution aimed at an offline/legacy peer without allowing a delayed old request to obtain start permission.
Ruling: queued/acknowledged executions have admissionExpiresAt using the configured lease duration, then become uncertain; dispatch retries stop at that deadline. Worker tombstones reject delayed dispatch without waking.
Ruling: Worker events now include eventId, actor, seq, timestamp, payload and canonical fingerprint; JSON property ordering does not change event identity. Local reports are size-checked before persistence so an oversized result cannot poison outbox.
Task 4: complete — 16 coordinator scenarios passing, including reviewer regressions and delayed-dispatch tombstones.
Task 5: complete — source integration and usage docs present; real two-PC project discovery/sync inspected and repaired. Team execution in a real two-PC DSH model runtime is NOT yet validated.
Task 6: complete — npm test 94/94; Team real-HTTP smoke passed; framework Schema 51/51; panel 99/99; syntax 31 files clean; git diff --check clean. Legacy Mesh/Rooms/Agents/transport smoke passed (UDP tests required approved escalation). Final fix pass checked against reviewer findings by author; no second independent approval is claimed. No merge, push, release or live Team activation performed.

User requested Git commit and testing on the second PC. Re-ran npm test (94/94), Team HTTP smoke, Schema (51/51), and panel (99/99) before preparing the commit. Submit the source preview on codex/agent-team-m1 for cross-machine validation; keep Team execution opt-in.
