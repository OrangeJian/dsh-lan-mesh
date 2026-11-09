# Task 1 report: atomic RoomBlobStore

Status: implemented and verified on branch `codex/room-collaboration` (task base `2776bda`). No UI, protocol, transport, configuration, or index changes.

## Files

- `lib/room-blob-store.mjs`: standalone content-addressed streamed store.
- `scripts/room-blob-store.test.mjs`: 13 real-filesystem tests, each using a unique task temporary directory and cleanup hook.
- This report.

## Public interface

`await RoomBlobStore.open({dir,maxFileBytes=20971520,maxTotalBytes=209715200,orphanGraceMs=86400000})` returns the store. These defaults are implementation choices awaiting later configuration integration, not permanent product promises.

- `await put(readable,{blobId,name,mediaType,size,ownerNodeId})` validates a Node readable or async iterable and returns a frozen `{blobId,name,mediaType,size,ownerNodeId}` reference. Different display names/owners retain separate returned refs while sharing one content file.
- `await has(blobId)` returns a boolean for a committed regular file with the registered length. Invalid digests reject.
- `await openRead(blobId)` returns a Node readable stream. It leases the object until stream close; consumers must consume or destroy the stream.
- `await declareHolder(blobId,nodeId)`, `await pin(blobId,referenceId)`, and `await unpin(blobId,referenceId)` persist separate mutable metadata. Lists are idempotent; unpinning the last reference starts a new orphan grace period.
- `await collectOrphans(now=Date.now())` returns the digest IDs successfully collected. Active upload/read leases and persisted pins prevent deletion. Unknown references reject in mutation/read operations.

## Persistence and concurrency choices

Only validated lowercase SHA-256 IDs form content paths. User filenames never form filesystem paths; basename, control character, UTF-8 length, Windows reserved name, and metadata bounds are enforced. References do not embed mutable holder/pin state.

Each directory has one live store owner; its promise queue serializes metadata mutation, reservations, lease acquisition, publication, and GC. Upload bodies stream outside that queue with incremental hashing and length checks, short-write handling, file fsync, and rename. Reservations count against committed usage before consuming the stream, preventing concurrent distinct uploads from bypassing quota. A committed duplicate is hashed/length-checked without an extra temp file or physical storage reservation. Concurrent new duplicates reserve conservatively, then share the first successfully committed content file and merge holders without overwriting bytes.

Metadata uses a 16 MiB bounded JSON manifest, written to a unique exclusive temp file, fsynced, and atomically renamed. In-memory metadata changes only after that rename succeeds. Initialization validates manifest shape/values and checks regular-file type, size, and SHA-256 of committed content; corrupted metadata or committed content fails closed.

After verifying an upload, publication persists a hidden staging intent before renaming bytes, then commits the visible entry. Caught publication failure removes newly published bytes and attempts manifest rollback; if rollback also fails, a hidden intent remains for conservative quota accounting and delayed recovery. Staging entries never satisfy has/read/pin. This identifies the store's own crash leftovers without guessing that every digest-looking file is owned by the store.

GC persists deletion intent before unlink, verifies the registered file's digest/size/type before deleting it, and finally removes the manifest entry. A process exit before/after unlink remains restartable. It never scans and broadly deletes the directory. Unregistered text files, digest-looking files, and invalid digest collisions remain untouched.

## RED/GREEN evidence

1. Initial focused invocation before module creation failed with `ERR_MODULE_NOT_FOUND` (scaffold check, not counted as behavioral RED).
2. Added an explicit unimplemented `open` scaffold and reran `node --test scripts/room-blob-store.test.mjs`: **0 pass, 8 fail**, all reporting `RoomBlobStore not implemented`. These initial tests cover put/read/restart/dedup, mismatch/interruption cleanup, validation, corrupt metadata, concurrent quota, persistent pins/grace/unknown files, active read/put protection, and metadata failure atomicity.
3. Implemented the store. System temporary-directory rename consistently produced EPERM under the managed environment; moved test-only mkdtemp directories under the writable task workspace. Focused result: **8 pass, 0 fail**.
4. Added real concurrent same-content, explicit abort, digest-collision, and GC deletion-restart coverage. Focused result: **11 pass, 1 fail**. The abort test exposed an unhandled stream error while the store awaited opening the temp file, before async iteration attached its handler. Added an early error observer that remains until upload completion; errors still reject put and cleanup reservations/temp files. Focused result: **12 pass, 0 fail**.
5. Added simulated crash publication-intent recovery test before implementation. Focused result: **12 pass, 1 fail** (`Corrupt blob size or file` on a missing staged file). Added durable staging intent handling and hidden visibility. Focused result: **13 pass, 0 fail**.
6. Final focused command: `node --test scripts/room-blob-store.test.mjs`, exit **0**, **13/13**.
7. Final complete command: `npm test` outside managed network restrictions, exit **0**, **133/133** (0 failures, 0 skipped/cancelled). Full output is retained locally in `.superpowers/sdd/2026-11-08-room-attachments/task-1-npm-test-unrestricted.log` (not committed).
8. `git diff --check`: exit **0**. Staged diff checked again before commit.

The first restricted full-suite attempt was interrupted after system temporary-directory errors; a second restricted run with TEMP/TMP redirected to a task workspace directory completed **129/132**, with exactly these existing network failures: `discovering a peer fetches projects created before this node came online`, `HTTP reference delivery negotiates capability and rejects legacy exact routing`, and `old peers report unsupported without fallback execution`. Their loopback connections were denied with EACCES (discovery observed zero peers). The subsequent unrestricted full run passed all tests, including these three. Restricted and final outputs are retained locally under the task report directory.

## Self-review and limitations

- Reviewed publication and metadata failure rollback, active leases around await boundaries, quota reservation/release, concurrent holder/pin updates, manifest validation, and deletion intent recovery. Tests use real streams and files, without filesystem mocks.
- Per-directory single live ownership is a caller contract. Multiple simultaneous RoomBlobStore objects or processes writing the same directory are unsupported; integration should retain one instance. Reopen tests model restart (old instance is no longer used). There is no cross-process lock.
- File contents and manifest temp files are fsynced before rename. This does not claim a portable directory-fsync or power-loss transaction guarantee across Windows/filesystems. Crash recovery tests model manifest states directly, not OS process termination or power failure.
- Abrupt process death may leave unregistered `.blob-*.tmp` / `.metadata-*.tmp` files. GC deliberately preserves these as unknown files; only registered final digest objects have automatic recovery. Caught upload failures clean up their own temp files.
- Open validates committed bytes fully; has checks registered file type/size, and read opens those local bytes without hashing them again. The storage directory must remain private to its owning service; malicious external mutation/path replacement is outside this in-process store's concurrency boundary.
- Conservative in-flight reservations can reject simultaneous same-digest new uploads even though the eventual committed bytes deduplicate. Successful committed duplicates require no additional quota.
- Metadata corruption is rejected rather than repaired. Failed interrupted GC remains hidden and quota-conservative until a subsequent collection succeeds.
- No sender plus Leader replication, network endpoint/authentication, browser/UI integration, or host configuration is claimed by this task.

## Fix round 1 (2026-11-10, base `8d8d79b`)

Both reviewer P2 findings were reproduced before modifying production code:

1. A valid, unregistered digest-named file was previously verified and adopted by put, making an unknown user file eligible for later GC. Publication now requires an existing committed manifest entry before accepting an existing destination. An unregistered destination is rejected with a conflict error regardless of its bytes; neither the file nor manifest changes. The existing invalid-content collision test now expects this earlier conflict rejection.
2. Two same-digest uploads could both obtain leases, after which A's final metadata commit and rollback unlink failed, leaving hidden staging metadata and bytes. B previously reused that state and returned a reference that has/read/pin rejected. Publication now rechecks staging/deleting and size inside the serialization queue, before inspecting or publishing the destination. A pending hidden state rejects B; normal GC can recover the staging entry and a subsequent fresh put succeeds and supports read/pin.

Added two regression tests. The concurrent failure test uses real files/streams with narrowly scoped injected failures for the second metadata rename and first digest unlink, then restores both filesystem methods before B continues. It asserts the actual persistent staging state, B's rejection, absence of a readable/pinnable commit, and successful GC/retry/read/pin recovery. It does not merely assert mock invocation. Builtin ESM exports are synchronized and both fault overrides restored in finally; no production test hooks were added.

RED: `node --test scripts/room-blob-store.test.mjs` exited 1 with **13 pass, 2 fail**. Both new tests reported `Missing expected rejection`, proving the original implementation accepted the unknown file and falsely succeeded after the concurrent staging failure.

GREEN: the same focused command exited 0 with **15/15**. The full `npm test` command outside managed network restrictions exited 0 with **135/135**, zero failures/skips/cancellations. Output retained locally at `.superpowers/sdd/2026-11-08-room-attachments/task-1-fix-round-1-npm-test.log`. `git diff --check` and staged diff checks passed.

Self-review: ownership is now established by committed metadata, not matching bytes; hidden states are checked at reservation and publication boundaries. Existing ordinary dedup, concurrent successful same-content uploads, quota reservations, active leases, pin persistence, and recovery tests remain green. Public interfaces and prior single-owner/directory limitations are unchanged. Only the store, its focused tests, and this report changed; no UI/protocol changes.
