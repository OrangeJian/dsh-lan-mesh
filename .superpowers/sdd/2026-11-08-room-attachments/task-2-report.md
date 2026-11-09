# Task 2 report: authenticated streaming peer blobs

Implemented standalone `lib/room-blob-protocol.mjs`, real HTTP tests in `scripts/room-blob-protocol.test.mjs`, and an opt-in raw streaming hook in `lib/transport.mjs`. No service, schema, browser upload, UI, Mesh envelope or Team wire changes.

## Public API

- `createBlobHandler({store,nodeId,secret='',trustedPeers=[],authorize,clock=Date.now,requestWindowMs=120000,maxFileBytes=20971520,warn=console.warn})`: returns async `(IncomingMessage, ServerResponse)` for `MeshServer({onBlob: handler})`. Identity, secret and trustedPeers may also be zero-argument functions, matching transport's dynamic policy style. `handler.close()` permanently closes this handler and destroys its active requests/responses/read streams; MeshServer.close calls it automatically. Construct a fresh handler to restart.
- `authorize({operation,roomId,senderNodeId,blobId})`: operation is lowercase `put` or `get`. Must return/resolve exactly `true` after checking both Room membership and blob access. Missing callback, false, truthy non-boolean, or thrown errors deny with 403. No paths are supplied. Checks precede store access/body iteration.
- `sendBlob({peer,nodeId,secret,roomId,attachment,readable,signal,timeoutMs=15000})`: streams a Node readable to the peer, returns the attachment on HTTP 201. Requires `peer.roomBlobs === 1` before using the source. Peer has `{address,port,nodeId,roomBlobs}`.
- `readPeerBlob({peer,nodeId,secret,roomId,attachment,store,signal,timeoutMs=15000})`: expects the attachment metadata from the caller's Room reference; validates response headers, streams into `store.put`, and returns the verified committed reference with peer.nodeId as holder/ownerNodeId. It does not return a partially verified file or filesystem path.
- `encodeBlobRequest({method,nodeId,peer,secret='',roomId,attachment,now=Date.now(),nonce=randomUUID()})`: returns `{method,path,headers}` for interoperable custom clients and exact wire testing. Attachment uses the Task1 reference shape `{blobId,name,mediaType,size,ownerNodeId}`. ownerNodeId is not accepted as sender authority; server sets it from the admitted sender.

## Final wire format and canonicalization

Only `PUT` and `GET /lan-mesh/v1/room-blobs/<lowercase 64-hex SHA256>` are supported. The exact raw path must match this form: queries, suffixes, encodings, uppercase digests, trailing slashes and ranges are rejected. No redirects are followed. Request headers:

| Header | Value |
| --- | --- |
| x-room-blob-room | exact normalized existing Mesh roomId format |
| x-room-blob-sender | sender nodeId |
| x-room-blob-target | receiver nodeId |
| x-room-blob-time | canonical integer Unix milliseconds |
| x-room-blob-nonce | nonempty bounded unique token, UUID by default |
| x-room-blob-digest | lowercase SHA256, equal to path digest |
| x-room-blob-size | canonical nonnegative safe integer byte length |
| x-room-blob-metadata | unpadded base64url of UTF-8 JSON.stringify({name,mediaType}), keys in exactly that order |
| x-room-blob-signature | lowercase HMAC-SHA256 hex, or empty with empty secret |

Signature input is UTF-8 `JSON.stringify(['roomBlobs:1', method, exactRawPath, room, sender, target, time, nonce, digest, size, metadata])`. All listed header fields are strings. Repeated signed headers are rejected. Metadata is decoded, filename/mediaType validated, then re-encoded and required to equal the original bytes; extra properties, alternate ordering, padding and oversized headers are refused. Signed header values are bounded to 256 UTF-8 bytes (metadata 2048); helper nonce limit is 128. Filename follows Task1 safe basename rules and 255-byte limit. Media type is bounded and validated as an ASCII MIME type.

PUT uses Content-Length equal to signed size and Content-Type equal to signed mediaType. Raw clients may use chunked upload without Content-Length; store.put enforces the signed total incrementally regardless of framing. Helper sends Content-Length. Successful PUT is HTTP 201, empty body. GET has no request body and uses the signed metadata/size as the expected reference. HTTP 200 response contains Content-Length, Content-Type, x-room-blob-digest and Cache-Control: no-store. Receiver requires all three content headers to match the expected reference, disallows transfer-encoding, and store.put hashes/counts the actual bytes before commit. Response integrity comes from the independently expected digest; responses do not introduce a second HMAC envelope.

Errors use bounded plain-text codes (generally 400, auth/time 401, target/trust/member 403, missing 404, method 405, replay 409, too large 413, range 416, closed/ledger capacity 503). Rejected unread requests close the connection. Payload corruption may also close a socket during stream teardown; callers must treat either a non-success response or a network error as failure. Clients read at most 4096 response/error bytes and destroy sources/requests/responses on failure, timeout or cancellation.

## Admission, replay and compatibility

Target and optional allowlist are checked before body consumption, then shared-secret HMAC with timing-safe comparison, +/-120-second default window, bounded metadata/declared size, replay reservation, membership/access authorization. Replay ledger is per handler, at most 10000 entries, scoped by sender+nonce, retained through signed timestamp+window. Expired entries prune on admission; a full ledger rejects instead of evicting still-valid entries. Nonces are reserved before awaiting authorization, preventing concurrent duplicates.

Empty secret follows existing open Mesh behavior: no signature authentication, while target, allowlist, time, replay, sizes and membership checks still apply. Once per handler, the first structurally valid admitted open request emits the existing service warning when trustedPeers is empty: `WARNING: lan-mesh is open (no clusterSecret, no trustedPeers) — any machine on this LAN can read and send mesh traffic`. With a nonempty allowlist it instead accurately warns `WARNING: lan-mesh is open (no clusterSecret) — peer identities are unauthenticated`. An allowlist cannot authenticate claimed identities in an open cluster.

MeshServer intercepts only the raw blob prefix before JSON body parsing, answers 404 UNSUPPORTED when disabled, and advertises `node.roomBlobs:1` on /info only with onBlob. A stale roomBlobs value from describe() is suppressed without the hook. Other capability/identity fields and legacy Mesh/Team paths/envelopes remain unchanged. Hook-owned active streams are destroyed on server close; the store's stream close/finally releases leases and reservations.

## RED/GREEN and verification

1. Initial explicit unimplemented module scaffold plus five behavioral HTTP tests: **0 pass, 5 fail**, all `not implemented`.
2. Implemented streaming protocol/hook. Restricted execution failed real loopback connections with EACCES (not a protocol failure). Re-ran through normal approval escalation: **5/5 passed**; no HTTP mocks or skipped network tests.
3. Added adversarial GET response/header/body/redirect/oversized-error tests, active upload abort/timeout/server-close cleanup, exact-path/method/digest tampering, disabled capability, and open-cluster authorization coverage. **9/9 passed**.
4. Self-review found the open warning falsely claimed no trustedPeers when the allowlist was nonempty. Added explicit regression assertion: **0/1 fail** with that exact incorrect warning. Selected the accurate warning based on allowlist; focused **9/9 passed**.
5. Added a real 16 MiB backpressured GET. GC cannot collect during the read; server close interrupts it and GC then collects the blob, proving the read lease was released. Final focused **10/10 passed**.
6. `node scripts/twin-transport-check.mjs`: **exit 0**, all legacy state/signature/allowlist/room envelope checks passed.
7. Initial full `npm test` after nine focused tests: **144/144 passed**. After adding the backpressured GET, the next full run hit a transient existing filesystem failure in `concurrent delivery and repeated read rewrites retain all records and durable flags` (EPERM renaming inbox.jsonl.tmp to inbox.jsonl). Output retained at `task-2-npm-test-rename-retry.log`. Re-ran the full suite without code changes: **145/145 passed**, exit 0, zero failures/skips/cancellations. Final output retained locally at `task-2-npm-test.log` (logs not committed); task-local TEMP/TMP avoid managed system-temp restrictions.
8. `git diff --check`: **exit 0**.

## Self-review and limits

- Reviewed every signed-field/path boundary, repeated header ambiguity, canonical metadata, time/nonce reservation around async authorization, failclosed policy, safe metadata forwarding, stream abort races, client response/error bounds, and handler/server close cleanup. Store's atomic verification/publication is reused unchanged.
- Shared cluster HMAC authenticates secret possession, not distinct per-node private keys. HTTP provides no confidentiality. In empty-secret mode claimed sender identities are unauthenticated and the warning states this.
- Replay protection is process-local and resets on restart; persistent replay storage and credential rotation are outside this task. The ledger is bounded/failclosed; no separate transfer concurrency/rate limiter was added.
- Authorization is an integration contract: Task3 must supply current Room membership and per-blob access checks. A deliberately permissive callback permits the corresponding requests. A hung trusted callback cannot be forcibly cancelled; clients can cancel/disconnect and no subsequent store access occurs after that disconnect.
- Helper downloads require known expected attachment metadata; GET does not expose metadata discovery. Caller-provided expected size/type can produce a rejected download if inconsistent with stored bytes. The receiver's SHA256/size verification prevents partial or corrupt publication.
- There are no ranges, resume, redirect following, browser uploads, UI/service configuration, sender+Leader replication orchestration, persistent transfer jobs, or discovery advertisement integration beyond the optional /info hook. Task1 single-owner private-storage assumptions remain in force.
