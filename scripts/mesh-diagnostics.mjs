#!/usr/bin/env node
/**
 * Read-only diagnostics for the local LAN mesh data footprint.
 *
 * This script answers one narrow question: which of the files this plugin owns
 * actually exist on disk, how large are they, and does their JSON parse. It
 * never repairs, never writes, never starts a node, never touches the network
 * and never prints file contents.
 *
 * Two deliberate limits keep it safe to hand to someone else:
 *
 * 1. It only looks where it is told. Without `--data-dir` it reports the
 *    repository it lives in and nothing else; it never walks `$DSH_HOME`, the
 *    user's home directory, or every discovered instance.
 * 2. It only reports whitelisted status fields. No file bodies, no environment
 *    variables, no secrets, no configuration, no chat text, no absolute paths,
 *    no room or member names. Parse failures collapse to a fixed code so a
 *    JSON library message can never smuggle file content into the output.
 *
 * Parseability is not integrity: see the caveat printed with every report.
 *
 * Run: node scripts/mesh-diagnostics.mjs [--data-dir <dir>] [--json]
 *
 * @module dsh-lan-mesh/scripts/mesh-diagnostics
 */
import { open, opendir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

/** Schema version of the emitted report. */
export const DIAGNOSTICS_VERSION = 1;

/** Hard ceiling on bytes read from any single file. */
export const MAX_READ_BYTES = 262_144;

/** How many leading lines of a JSONL log are sampled when it is large. */
export const MAX_JSONL_SAMPLE_LINES = 200;

/** Exit code: the read-only check completed with no errors. */
export const EXIT_OK = 0;
/** Exit code: the given input, or a file that exists, could not be checked. */
export const EXIT_PROBLEM = 1;
/** Exit code: the command line itself was wrong. */
export const EXIT_USAGE = 2;

/**
 * The files this plugin may own under one instance directory.
 *
 * Paths were read out of the modules that write them, not guessed. `source`
 * records where each mapping comes from so a reviewer can re-derive it; the
 * note column matters because the identity document is `node.json`, not the
 * `identity.json` an older summary assumed.
 */
export const FILE_CATALOGUE = Object.freeze([
  { name: 'node.json', relativePath: 'node.json', format: 'json', role: 'identity', source: 'lib/store.mjs:61' },
  { name: 'inbox.jsonl', relativePath: 'inbox.jsonl', format: 'jsonl', role: 'inbox', source: 'lib/store.mjs:86' },
  { name: 'rooms.json', relativePath: 'rooms.json', format: 'json', role: 'rooms', source: 'lib/store.mjs:144' },
  { name: 'nicknames.json', relativePath: 'nicknames.json', format: 'json', role: 'nicknames', source: 'lib/store.mjs:189' },
  { name: 'team.json', relativePath: 'team.json', format: 'json', role: 'team', source: 'lib/team-store.mjs:63' },
  { name: 'room-preferences.json', relativePath: 'room-preferences.json', format: 'json', role: 'room-preferences', source: 'lib/service.mjs:389' },
  { name: 'context-deliveries.json', relativePath: 'context-deliveries.json', format: 'json', role: 'context-deliveries', source: 'lib/service.mjs:2197' },
  { name: 'attachments.json', relativePath: 'attachments.json', format: 'json', role: 'attachments', source: 'lib/room-attachment-ledger.mjs:48' },
  { name: 'blobs/metadata.json', relativePath: 'blobs/metadata.json', format: 'json', role: 'blob-metadata', source: 'lib/room-blob-store.mjs:66' },
  { name: 'shared-docs/shared-docs.json', relativePath: 'shared-docs/shared-docs.json', format: 'json', role: 'shared-docs', source: 'lib/shared-doc-store.mjs:47' },
  { name: 'shared-docs/shared-snapshots.json', relativePath: 'shared-docs/shared-snapshots.json', format: 'json', role: 'shared-snapshots', source: 'lib/shared-doc-store.mjs:49' },
]);

/** Problems that fail the check (exit 1). */
export const ERROR_CODES = Object.freeze({
  DIR_MISSING: 'DIR_MISSING',
  DIR_NOT_DIRECTORY: 'DIR_NOT_DIRECTORY',
  FILE_READ_DENIED: 'FILE_READ_DENIED',
  FILE_READ_FAILED: 'FILE_READ_FAILED',
  JSON_INVALID: 'JSON_INVALID',
});

/**
 * Conditions that are reported but do not fail the check (exit 0).
 *
 * A fresh instance legitimately has none of these files, and a log over the
 * read ceiling is skipped by design rather than read without bound.
 */
export const WARNING_CODES = Object.freeze({
  FILE_MISSING: 'FILE_MISSING',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  REPO_PACKAGE_UNREADABLE: 'REPO_PACKAGE_UNREADABLE',
});

/** The caveat repeated in every report, so no reader over-reads a green check. */
export const CAVEAT =
  'JSON parseability is not ledger integrity and not service health; this check repairs nothing and writes nothing.';

/** Usage text for `--help`. */
export function usage() {
  return [
    'Read-only diagnostics for the local dsh-lan-mesh data footprint.',
    '',
    'Usage: node scripts/mesh-diagnostics.mjs [options]',
    '',
    'Options:',
    '  --data-dir <dir>  Inspect one instance directory you name explicitly.',
    '                    Without it, only this repository is reported.',
    '  --json            Emit one machine-readable JSON document instead of text.',
    '  --help, -h        Show this help.',
    '',
    'What it reports: package and Node version; for the named directory, whether',
    'each file this plugin owns exists, its byte size, and whether its JSON parses.',
    '',
    'Exit codes: 0 = no errors, 1 = input or existing file could not be checked,',
    '2 = bad arguments.',
    '',
    CAVEAT,
    '',
  ].join('\n');
}

/** Normalize an untrusted label to a bounded, non-revealing token. */
export function sanitizeLabel(value) {
  const text = typeof value === 'string' ? value : '';
  const trimmed = text.replace(/[\\/]+$/, '');
  const raw = basename(trimmed) || 'data-dir';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'data-dir';
}

/**
 * Parse the command line.
 * @param {string[]} argv - arguments after the script path.
 * @returns {{kind:'help'}|{kind:'error',message:string}|{kind:'run',dataDir:string|null,json:boolean}}
 */
export function parseArgs(argv) {
  let dataDir = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') return { kind: 'help' };
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--data-dir') {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        return { kind: 'error', message: '--data-dir requires a directory' };
      }
      dataDir = value;
      index += 1;
      continue;
    }
    if (token.startsWith('--data-dir=')) {
      const value = token.slice('--data-dir='.length);
      if (value === '') return { kind: 'error', message: '--data-dir requires a directory' };
      dataDir = value;
      continue;
    }
    // Never echo an unrecognized token: a mistyped path must not reach the output.
    return { kind: 'error', message: 'unrecognized argument' };
  }
  return { kind: 'run', dataDir, json };
}

/** Read this repository's own package metadata, without printing where it lives. */
async function readRepositoryPackage() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const file = join(dirname(scriptDir), 'package.json');
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    const patch = parsed?.dsh?.bundle?.patch;
    const platform = parsed?.dsh?.client?.platform;
    return {
      name: typeof parsed?.name === 'string' ? parsed.name : null,
      version: typeof parsed?.version === 'string' ? parsed.version : null,
      bundlePatch: typeof patch === 'string' && patch.length > 0,
      clientPlatform: typeof platform === 'string' ? platform : null,
      error: null,
    };
  } catch {
    return { name: null, version: null, bundlePatch: false, clientPlatform: null, error: WARNING_CODES.REPO_PACKAGE_UNREADABLE };
  }
}

/** Classify a filesystem error into one fixed code, never a library message. */
function classifyReadError(error) {
  const code = error?.code;
  if (code === 'EACCES' || code === 'EPERM') return ERROR_CODES.FILE_READ_DENIED;
  return ERROR_CODES.FILE_READ_FAILED;
}

/** Top-level JSON shape, which is a status field rather than content. */
function jsonShape(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value === 'object' ? 'object' : 'scalar';
}

/** Validate JSONL by lines; large logs are sampled instead of read without bound. */
function inspectJsonl(text) {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const sampled = lines.length > MAX_JSONL_SAMPLE_LINES;
  const checked = sampled ? lines.slice(0, MAX_JSONL_SAMPLE_LINES) : lines;
  let shapes = 0;
  for (const line of checked) {
    if (line.trim() === '') continue;
    try {
      JSON.parse(line);
      shapes += 1;
    } catch {
      return { parse: 'invalid', shape: null, sampled };
    }
  }
  return { parse: sampled ? 'ok-sampled' : 'ok', shape: shapes > 0 ? 'lines' : 'empty', sampled };
}

/**
 * Inspect one catalogued file.
 * @param {string} dir - resolved instance directory.
 * @param {typeof FILE_CATALOGUE[number]} entry - catalogue row.
 * @returns {Promise<{record:object,error:string|null,warning:string|null}>}
 */
async function inspectFile(dir, entry) {
  const path = join(dir, entry.relativePath);
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return {
        record: { name: entry.name, role: entry.role, format: entry.format, present: false, bytes: null, parse: null, shape: null, sampled: false, truncated: false },
        error: null,
        warning: WARNING_CODES.FILE_MISSING,
      };
    }
    const code = classifyReadError(error);
    return {
      record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: null, parse: null, shape: null, sampled: false, truncated: false, read: code },
      error: code,
      warning: null,
    };
  }

  try {
    const stats = await handle.stat();
    const size = Number.isFinite(stats.size) ? stats.size : 0;
    if (!stats.isFile()) {
      return {
        record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: size, parse: null, shape: null, sampled: false, truncated: true, read: ERROR_CODES.FILE_READ_FAILED },
        error: ERROR_CODES.FILE_READ_FAILED,
        warning: null,
      };
    }
    if (size > MAX_READ_BYTES) {
      return {
        record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: size, parse: 'skipped-too-large', shape: null, sampled: false, truncated: true },
        error: null,
        warning: WARNING_CODES.FILE_TOO_LARGE,
      };
    }
    // Bound the read by the size we just measured, so a growing file cannot
    // pull the whole disk into memory.
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const chunk = await handle.read(buffer, read, size - read, read);
      if (chunk.bytesRead === 0) break;
      read += chunk.bytesRead;
    }
    const text = buffer.subarray(0, read).toString('utf8');
    if (entry.format === 'jsonl') {
      const parsed = inspectJsonl(text);
      return {
        record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: size, parse: parsed.parse, shape: parsed.shape, sampled: parsed.sampled, truncated: false },
        error: parsed.parse === 'invalid' ? ERROR_CODES.JSON_INVALID : null,
        warning: null,
      };
    }
    try {
      const value = JSON.parse(text);
      return {
        record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: size, parse: 'ok', shape: jsonShape(value), sampled: false, truncated: false },
        error: null,
        warning: null,
      };
    } catch {
      return {
        record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: size, parse: 'invalid', shape: null, sampled: false, truncated: false },
        error: ERROR_CODES.JSON_INVALID,
        warning: null,
      };
    }
  } catch (error) {
    const code = classifyReadError(error);
    return {
      record: { name: entry.name, role: entry.role, format: entry.format, present: true, bytes: null, parse: null, shape: null, sampled: false, truncated: false, read: code },
      error: code,
      warning: null,
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Build the report. Reads only; touches no file outside the named directory.
 * @param {{dataDir:string|null}} options - parsed arguments.
 * @returns {Promise<object>} report document; `errors.length > 0` means exit 1.
 */
export async function collectReport({ dataDir = null } = {}) {
  const repository = await readRepositoryPackage();
  const errors = [];
  const warnings = [];
  if (repository.error) warnings.push({ code: repository.error, file: 'package.json' });

  const report = {
    kind: 'mesh-diagnostics',
    version: DIAGNOSTICS_VERSION,
    readOnly: true,
    repository: {
      name: repository.name,
      version: repository.version,
      node: process.version,
      bundlePatch: repository.bundlePatch,
      clientPlatform: repository.clientPlatform,
    },
    dataDir: null,
    files: [],
    paths: FILE_CATALOGUE.map((entry) => ({ name: entry.name, relativePath: entry.relativePath, role: entry.role, source: entry.source })),
    limits: { maxReadBytes: MAX_READ_BYTES, maxJsonlSampleLines: MAX_JSONL_SAMPLE_LINES },
    caveat: CAVEAT,
    errors,
    warnings,
  };

  if (dataDir === null) return report;

  const resolved = resolve(dataDir);
  report.dataDir = { scope: 'explicit', label: sanitizeLabel(resolved), present: false, entryCount: null };

  let directoryHandle;
  try {
    directoryHandle = await open(resolved, 'r');
  } catch (error) {
    const code = error?.code === 'ENOENT' ? ERROR_CODES.DIR_MISSING : classifyReadError(error);
    errors.push({ code, file: null });
    return report;
  }

  let entryCount = null;
  try {
    const stats = await directoryHandle.stat();
    if (!stats.isDirectory()) {
      errors.push({ code: ERROR_CODES.DIR_NOT_DIRECTORY, file: null });
      return report;
    }
    report.dataDir.present = true;
  } catch (error) {
    errors.push({ code: classifyReadError(error), file: null });
    return report;
  } finally {
    await directoryHandle.close().catch(() => {});
  }

  // Counting entries needs a directory stream; the whitelist above means no
  // enumeration ever reaches the output, only the count.
  try {
    const stream = await opendir(resolved);
    let count = 0;
    for await (const _ of stream) count += 1;
    entryCount = count;
  } catch {
    entryCount = null;
  }
  report.dataDir.entryCount = entryCount;

  const files = [];
  for (const entry of FILE_CATALOGUE) {
    const result = await inspectFile(resolved, entry);
    files.push(result.record);
    if (result.error) errors.push({ code: result.error, file: entry.name });
    if (result.warning) warnings.push({ code: result.warning, file: entry.name });
  }
  report.files = files;
  return report;
}

/** Render the human-readable report. */
export function formatHuman(report) {
  const out = [];
  const repo = report.repository;
  out.push('dsh-lan-mesh read-only diagnostics');
  out.push('');
  out.push('repository');
  out.push(`  package          ${repo.name ?? '(unknown)'}@${repo.version ?? '(unknown)'}`);
  out.push(`  node             ${repo.node}`);
  out.push(`  bundle patch     ${repo.bundlePatch ? 'declared' : 'not declared'}`);
  out.push(`  client platform  ${repo.clientPlatform ?? '(none)'}`);
  out.push('');

  if (report.dataDir === null) {
    out.push('data directory     (none requested; repository only)');
    out.push('');
    out.push(CAVEAT);
    return `${out.join('\n')}\n`;
  }

  out.push(`data directory     ${report.dataDir.label} (explicit)`);
  out.push(`  present          ${report.dataDir.present ? 'yes' : 'no'}`);
  out.push(`  entries in dir   ${report.dataDir.entryCount === null ? '(not counted)' : report.dataDir.entryCount}`);
  out.push('');
  if (Array.isArray(report.files)) {
    for (const file of report.files) {
      const size = file.bytes === null ? '         -' : `${String(file.bytes).padStart(10)} B`;
      const state = file.present ? (file.read ?? 'present') : 'missing';
      const parse = file.parse ?? '-';
      const extra = file.sampled ? ' (sampled)' : file.truncated ? ' (not parsed)' : '';
      out.push(`  ${file.name.padEnd(34)} ${state.padEnd(14)} ${size}  ${parse}${extra}`);
    }
    out.push('');
  }

  const warnings = report.warnings ?? [];
  const errors = report.errors ?? [];
  if (warnings.length > 0) {
    out.push('warnings');
    for (const warning of warnings) out.push(`  ${warning.code}${warning.file ? `: ${warning.file}` : ''}`);
    out.push('');
  }
  if (errors.length > 0) {
    out.push('errors');
    for (const error of errors) out.push(`  ${error.code}${error.file ? `: ${error.file}` : ''}`);
    out.push('');
  }
  out.push(CAVEAT);
  return `${out.join('\n')}\n`;
}

/** True when this module is the CLI entry point rather than an import. */
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const here = realpathSync(fileURLToPath(import.meta.url));
    const there = realpathSync(resolve(entry));
    return process.platform === 'win32' ? here.toLowerCase() === there.toLowerCase() : here === there;
  } catch {
    return false;
  }
}

/** CLI body. */
async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(usage());
    return EXIT_OK;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`mesh-diagnostics: ${parsed.message}\n`);
    process.stderr.write('run with --help for usage\n');
    return EXIT_USAGE;
  }
  const report = await collectReport({ dataDir: parsed.dataDir });
  process.stdout.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatHuman(report));
  return report.errors.length > 0 ? EXIT_PROBLEM : EXIT_OK;
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
