# Composer and agent rail UX — 2026-11-09

The composer now uses a 28px SVG skill button with a tooltip and accessible name. Both the button and `/` still open the existing catalogue; selection, source metadata, readable fallback tokens and structured skill references retain their existing behavior.

Room members can see “设为任务”. For members without the leader role, the control is disabled with “只有 leader 可以分派任务” in its tooltip and accessible name. The existing leader check on submission and backend assignment authority are unchanged.

The rail displays an animated CSS spinner only when the catalogue row has `status === 'running'`, with an accessible “运行中” status. Live idle sessions keep their static availability dots; stored and room-only fallback rows never infer running from liveness.

The rail refreshes snapshot and local catalogue every 4 seconds. One pending poll blocks subsequent poll ticks; cleanup removes the timer and guards pending responses against updating an unmounted rail. Its agents RPC sends `localOnly: true`, which the panel endpoint translates to `catalogueAgents({ peers: false })`. The full Agents catalogue keeps peer discovery.

Validation:

- RED: five new panel assertions failed before implementation.
- Panel: 147/147 after the composer/rail implementation, including running→idle→running refresh, pending-poll serialization, timer cleanup, accessible icon and disabled member task control. Inbox changes are being integrated concurrently; rerun the complete panel check before the combined commit.
- `npm test`: 117/117 passed.
- Schema: 70/70 passed using `DSH_TOOLS_MODULE` pointing at the installed Host validator, including local-only versus full peer discovery and actual running status.
- `npm run check:composer-compat`: PASS against DSH 0.2.2-rc.1 and four public client entry points.
- `git diff --check`: passed.

Limits: the DOM-free panel harness does not verify browser pixels or native sidebar composition. Other machines still need the planned manual validation. Polling reflects Host catalogue status at up to roughly a four-second interval, plus request latency; room-only fallback members have no authoritative running status.

Commit and push are owned by the coordinating agent after the concurrent inbox fix is complete; this implementation intentionally leaves shared files unstaged.
