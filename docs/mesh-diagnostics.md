# LAN mesh read-only diagnostics

`scripts/mesh-diagnostics.mjs` answers one narrow question about a LAN mesh
instance: **which files this plugin owns actually exist on disk, how large are
they, and does their JSON parse?**

It is a G0 aid for triage. It is not a health check, not a repair tool, and not
a second Host Bridge. It never starts a node, never opens a socket, never reads
a message body and never writes a byte.

Run it with Node's built-in modules only; there is nothing to install.

```
node scripts/mesh-diagnostics.mjs                     # repository only
node scripts/mesh-diagnostics.mjs --data-dir <dir>    # one instance you name
node scripts/mesh-diagnostics.mjs --json              # machine-readable
node scripts/mesh-diagnostics.mjs --help
```

## What it reports

Without `--data-dir` the report covers only the repository the script lives in:
package name and version, the running Node version, whether a bundle patch is
declared, and the client platform. No directory is inspected and no file status
is invented.

With `--data-dir <dir>` it additionally inspects the catalogue below inside that
one directory. For each file it reports `present`, `bytes`, `parse`, and a
`shape` (`object` / `array` / `null` / `scalar`, or `lines` for JSONL). A file
larger than the read ceiling is reported as `skipped-too-large` with
`truncated: true` and is never read; a JSONL log with more than 200 lines is
validated against its first 200 lines and reported as `ok-sampled`.

Exit codes are the contract:

| Code | Meaning |
| ---- | ------- |
| `0` | The read-only check ran and found no errors. Absent files are normal. |
| `1` | The named directory, or a file that exists, could not be checked. |
| `2` | The command line was wrong. |

Absent files and oversized files are **warnings**, not errors: a fresh instance
legitimately has none of these files, and skipping a large file is the designed
limit rather than a defect. A missing directory, a path that is not a directory,
a read denial, an unreadable file and unparseable JSON are **errors**.

## File catalogue and why each path is trusted

The paths were read out of the modules that write them. None were guessed, and
the catalogue carries the source line for every entry so a reviewer can
re-derive it:

| File | Role | Source |
| ---- | ---- | ------ |
| `node.json` | identity | `lib/store.mjs:61` |
| `inbox.jsonl` | inbox | `lib/store.mjs:86` |
| `rooms.json` | rooms | `lib/store.mjs:144` |
| `nicknames.json` | nicknames | `lib/store.mjs:189` |
| `team.json` | team | `lib/team-store.mjs:63` |
| `room-preferences.json` | local room preferences | `lib/service.mjs:389` |
| `context-deliveries.json` | context pack deliveries | `lib/service.mjs:2197` |
| `attachments.json` | attachment ledger | `lib/room-attachment-ledger.mjs:48` |
| `blobs/metadata.json` | blob metadata | `lib/room-blob-store.mjs:66` |
| `shared-docs/shared-docs.json` | shared document state | `lib/shared-doc-store.mjs:47` |
| `shared-docs/shared-snapshots.json` | shared document snapshots | `lib/shared-doc-store.mjs:49` |

Two naming traps worth stating plainly, because earlier notes got them wrong:

- The identity document is **`node.json`**, not `identity.json`. `identity.json`
  is an older name; the script deliberately does not look for it.
- The shared-document state is not at the instance root. `lib/shared-doc-service.mjs:15`
  opens `SharedDocStore` at `<instance>/shared-docs`, so both files live one
  directory down. The blob metadata is the same shape, under `blobs/`.

The instance root itself is `${DSH_HOME:-~/.dsh}/lan-mesh`, and a non-default
port instance sits under `lan-mesh/instances/<port>`
(`lib/store.mjs:16`, `lib/store.mjs:36-40`). The script does **not** compute
those paths for you: you pass the directory you want, and it looks only there.

## Privacy boundary

The output is a whitelist of status fields. It deliberately never contains:

- file contents, message text, room or member names, model prompts;
- environment variables, tokens, keys, or any part of the configuration;
- absolute paths or user names — the directory is identified by the fixed label `explicit-data-directory`;
- JSON library or filesystem error messages, which can quote file content or an
  absolute path. Every failure collapses to a fixed code:
  `DIR_MISSING`, `DIR_NOT_DIRECTORY`, `FILE_READ_DENIED`, `FILE_READ_FAILED`,
  `JSON_INVALID`, and the warnings `FILE_MISSING`, `FILE_TOO_LARGE`,
  `REPO_PACKAGE_UNREADABLE`.

An unrecognized argument is reported as `unrecognized argument` without echoing
the token, so a mistyped private path cannot reach a log. The entry count for the
directory is reported as a number; the entries are never listed.

## What a green check does not mean

> JSON parseability is not ledger integrity and not service health.

`parse: ok` says the bytes form valid JSON. It does not say the rooms ledger is
consistent, that an event hash chain verifies, that a peer is reachable, or that
the mesh is working. This script repairs nothing, resolves nothing, and writes
nothing: no cache, no report file, no lock file.

## Verification

`scripts/mesh-diagnostics.test.mjs` drives the CLI as a child process against
temporary fixtures only; it never reads a real instance or user history. It
covers the default no-directory report, a healthy directory, a missing
directory, a path that is not a directory, missing files, corrupt JSON, invalid
JSONL, a file over the read ceiling, a large sampled JSONL log, an unreadable
file, unknown arguments, the sensitive-string sweep across both output modes,
and a before/after hash comparison proving the run leaves the directory
byte-identical.

```
node --test scripts/mesh-diagnostics.test.mjs
```

This file adds a script and documentation only. It changes no plugin code, so
the loaded plugin version is unchanged by this delivery.

Linked entries resolving outside the explicit real root are refused with PATH_OUTSIDE_SCOPE. Concurrent hostile filesystem replacement is outside this local diagnostic guarantee.
