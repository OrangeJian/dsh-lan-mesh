/**
 * Tests for scripts/mesh-diagnostics.mjs.
 *
 * Every case builds its own temporary directory, so nothing here reads a real
 * DSH instance or the user's history. The CLI is exercised as a child process
 * because the exit-code contract and "sensitive text never reaches stdout" are
 * end-to-end properties rather than module-level ones.
 *
 * @module dsh-lan-mesh/scripts/mesh-diagnostics.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAVEAT,
  DIAGNOSTICS_VERSION,
  ERROR_CODES,
  EXIT_OK,
  EXIT_PROBLEM,
  EXIT_USAGE,
  FILE_CATALOGUE,
  MAX_JSONL_SAMPLE_LINES,
  MAX_READ_BYTES,
  WARNING_CODES,
  collectReport,
  formatHuman,
  parseArgs,
  sanitizeLabel,
} from './mesh-diagnostics.mjs';

const SCRIPT = fileURLToPath(new URL('./mesh-diagnostics.mjs', import.meta.url));

/** Run the CLI and capture everything a caller could see. */
function runCli(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    all: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Create a scratch directory that the test removes afterwards. */
async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'g0-diagnostics-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Snapshot every path under `dir` with a content hash, to prove nothing moved. */
async function snapshotTree(dir) {
  const rows = [];
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        rows.push({ path: relative, kind: 'dir' });
        await walk(full, relative);
        continue;
      }
      const bytes = await readFile(full);
      rows.push({
        path: relative,
        kind: 'file',
        bytes: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  await walk(dir, '');
  return rows;
}

test('parseArgs accepts the documented switches and rejects everything else', () => {
  assert.deepEqual(parseArgs([]), { kind: 'run', dataDir: null, json: false });
  assert.deepEqual(parseArgs(['--json']), { kind: 'run', dataDir: null, json: true });
  assert.deepEqual(parseArgs(['--data-dir', 'C:\\data']), { kind: 'run', dataDir: 'C:\\data', json: false });
  assert.deepEqual(parseArgs(['--data-dir=C:\\data']), { kind: 'run', dataDir: 'C:\\data', json: false });
  assert.deepEqual(parseArgs(['--help']), { kind: 'help' });
  assert.deepEqual(parseArgs(['-h']), { kind: 'help' });
  assert.equal(parseArgs(['--data-dir']).kind, 'error');
  assert.equal(parseArgs(['--data-dir', '--json']).kind, 'error');
  assert.equal(parseArgs(['--data-dir=']).kind, 'error');
  assert.equal(parseArgs(['--verbose']).kind, 'error');
  // An unrecognized token is never echoed back, so a mistyped path stays private.
  const secret = 'C:\\Users\\someone\\secret-project';
  assert.ok(!parseArgs([secret]).message.includes('secret'));
});

test('without --data-dir only the repository is reported', async () => {
  const result = runCli([]);
  assert.equal(result.status, EXIT_OK);
  assert.match(result.stdout, /dsh-lan-mesh@/);
  assert.match(result.stdout, /none requested; repository only/);
  assert.ok(result.stdout.includes(CAVEAT));

  const report = await collectReport({});
  assert.equal(report.version, DIAGNOSTICS_VERSION);
  assert.equal(report.readOnly, true);
  assert.equal(report.dataDir, null);
  assert.equal(report.repository.name, 'dsh-lan-mesh');
  assert.match(report.repository.node, /^v\d+\./);
  assert.deepEqual(report.errors, []);
  // No directory is inspected, so no file status is invented for one.
  assert.deepEqual(report.files, []);
});

test('a healthy directory parses every present file and exits clean', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'node.json'), JSON.stringify({ nodeId: 'plain', port: 45871 }));
    await writeFile(join(dir, 'rooms.json'), JSON.stringify({ version: 1, rooms: {} }));
    await writeFile(join(dir, 'team.json'), JSON.stringify({ members: [] }));
    await writeFile(join(dir, 'inbox.jsonl'), '{"a":1}\n{"b":2}\n');

    const result = runCli(['--data-dir', dir]);
    assert.equal(result.status, EXIT_OK);
    assert.match(result.stdout, /node\.json\s+present\s+.*\sok/);
    assert.match(result.stdout, /inbox\.jsonl\s+present\s+.*\sok/);

    const report = await collectReport({ dataDir: dir });
    assert.deepEqual(report.errors, []);
    const present = report.files.filter((file) => file.present);
    assert.equal(present.length, 4);
    for (const file of present) assert.equal(file.parse, 'ok');
    // Files that a fresh instance legitimately lacks are warnings, not errors.
    const missing = report.files.filter((file) => !file.present);
    assert.ok(missing.length > 0);
    for (const file of missing) {
      assert.ok(report.warnings.some((warning) => warning.code === WARNING_CODES.FILE_MISSING && warning.file === file.name));
    }
  });
});

test('a missing directory and a non-directory are reported separately from a missing file', async () => {
  await withTempDir(async (dir) => {
    const absent = join(dir, 'no-such-instance');
    const missing = runCli(['--data-dir', absent, '--json']);
    assert.equal(missing.status, EXIT_PROBLEM);
    const parsedMissing = JSON.parse(missing.stdout);
    assert.deepEqual(parsedMissing.errors.map((row) => row.code), [ERROR_CODES.DIR_MISSING]);
    assert.equal(parsedMissing.dataDir.present, false);

    const filePath = join(dir, 'regular.txt');
    await writeFile(filePath, 'not a directory');
    const wrongKind = runCli(['--data-dir', filePath, '--json']);
    assert.equal(wrongKind.status, EXIT_PROBLEM);
    const parsedWrong = JSON.parse(wrongKind.stdout);
    assert.deepEqual(parsedWrong.errors.map((row) => row.code), [ERROR_CODES.DIR_NOT_DIRECTORY]);
  });
});

test('corrupt JSON fails the check with a fixed code and no library message', async () => {
  await withTempDir(async (dir) => {
    // A realistic corruption: a truncated write whose tail would leak content
    // if the parser's own message were printed.
    await writeFile(join(dir, 'rooms.json'), '{"rooms":{"room-secret-abc":{"title":"private chat text"');
    const result = runCli(['--data-dir', dir, '--json']);
    assert.equal(result.status, EXIT_PROBLEM);

    const parsed = JSON.parse(result.stdout);
    const error = parsed.errors.find((row) => row.file === 'rooms.json');
    assert.equal(error.code, ERROR_CODES.JSON_INVALID);
    const damaged = parsed.files.find((file) => file.name === 'rooms.json');
    assert.equal(damaged.parse, 'invalid');
    assert.equal(damaged.present, true);

    for (const leak of ['room-secret-abc', 'private chat text', 'Unexpected end', 'Expected']) {
      assert.ok(!result.all.includes(leak), `output must not contain ${leak}`);
    }
  });
});

test('invalid JSONL reports a fixed code rather than the failing line', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'inbox.jsonl'), '{"ok":1}\n{"bad":\n');
    const result = runCli(['--data-dir', dir, '--json']);
    assert.equal(result.status, EXIT_PROBLEM);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.errors.some((row) => row.code === ERROR_CODES.JSON_INVALID && row.file === 'inbox.jsonl'));
    assert.ok(!result.all.includes('"bad"'));
  });
});

test('a file over the read ceiling is reported unparsed instead of read whole', async () => {
  await withTempDir(async (dir) => {
    const oversized = Buffer.alloc(MAX_READ_BYTES + 1024, 'a');
    await writeFile(join(dir, 'rooms.json'), oversized);

    const result = runCli(['--data-dir', dir, '--json']);
    // Refusing to parse a large file is a deliberate limit, not a defect.
    assert.equal(result.status, EXIT_OK);
    const parsed = JSON.parse(result.stdout);
    const row = parsed.files.find((file) => file.name === 'rooms.json');
    assert.equal(row.present, true);
    assert.equal(row.parse, 'skipped-too-large');
    assert.equal(row.truncated, true);
    assert.equal(row.bytes, oversized.length);
    assert.ok(parsed.warnings.some((warning) => warning.code === WARNING_CODES.FILE_TOO_LARGE));
    assert.ok(!parsed.errors.some((error) => error.file === 'rooms.json'));
  });
});

test('a large JSONL log is sampled instead of parsed whole', async () => {
  await withTempDir(async (dir) => {
    const lines = [];
    for (let index = 0; index < MAX_JSONL_SAMPLE_LINES + 25; index += 1) lines.push(JSON.stringify({ index }));
    await writeFile(join(dir, 'inbox.jsonl'), `${lines.join('\n')}\n`);

    const report = await collectReport({ dataDir: dir });
    const row = report.files.find((file) => file.name === 'inbox.jsonl');
    assert.equal(row.parse, 'ok-sampled');
    assert.equal(row.sampled, true);
    assert.deepEqual(report.errors, []);
  });
});

test('unreadable files are classified per platform without leaking the error text', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'team.json');
    await writeFile(path, '{"ok":true}');

    const report = await collectReport({ dataDir: dir });
    assert.equal(report.files.find((file) => file.name === 'team.json').parse, 'ok');

    // Windows ACLs do not honour chmod, so deny by replacing the file with a
    // directory of the same name: opening it for read must fail as a read error.
    await rm(path);
    await mkdir(path);
    const blocked = await collectReport({ dataDir: dir });
    const row = blocked.files.find((file) => file.name === 'team.json');
    assert.equal(row.present, true);
    assert.ok(Object.values(ERROR_CODES).includes(row.read));
    assert.ok(blocked.errors.some((error) => error.file === 'team.json' && error.code === row.read));
    // No filesystem message (which may contain an absolute path) reaches output.
    const rendered = formatHuman(blocked);
    assert.ok(!rendered.includes(dir));
    assert.ok(!/EISDIR|EPERM|EACCES|errno/.test(rendered));
  });
});

test('bad arguments exit 2 and never echo what the user typed', () => {
  const result = runCli(['--nope', 'C:\\Users\\someone\\private.txt']);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /unrecognized argument/);
  assert.ok(!result.all.includes('private.txt'));
  assert.ok(!result.all.includes('someone'));

  const missingValue = runCli(['--data-dir']);
  assert.equal(missingValue.status, EXIT_USAGE);
  assert.match(missingValue.stderr, /requires a directory/);

  const help = runCli(['--help']);
  assert.equal(help.status, EXIT_OK);
  assert.match(help.stdout, /--data-dir <dir>/);
  assert.ok(help.stdout.includes(CAVEAT));
});

test('sensitive content never reaches either output mode', async () => {
  await withTempDir(async (dir) => {
    const markers = [
      'sk-live-token-000111222',
      'Bearer abcdef123456',
      'room-secret-marker',
      'member-alice-name',
      'model-prompt-marker',
      'C:\\Users\\real-person',
    ];
    await writeFile(
      join(dir, 'node.json'),
      JSON.stringify({ token: markers[0], authorization: markers[1], displayName: markers[3] }),
    );
    await writeFile(
      join(dir, 'rooms.json'),
      JSON.stringify({ rooms: { 'room-secret-marker': { title: markers[4], owner: markers[5] } } }),
    );
    await writeFile(join(dir, 'inbox.jsonl'), `${JSON.stringify({ text: 'private chat text', secret: markers[0] })}\n`);

    for (const args of [['--data-dir', dir], ['--data-dir', dir, '--json']]) {
      const result = runCli(args);
      for (const marker of markers) {
        assert.ok(!result.all.includes(marker), `${args.join(' ')} must not contain ${marker}`);
      }
      assert.ok(!result.all.includes('private chat text'));
      // The directory is identified by its base name only, never the full path.
      assert.ok(!result.all.includes(dir));
      assert.ok(!result.all.includes(tmpdir()));
    }
  });
});

test('the check writes nothing and leaves the directory byte-identical', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'node.json'), JSON.stringify({ nodeId: 'stable' }));
    await writeFile(join(dir, 'rooms.json'), JSON.stringify({ rooms: {} }));
    await writeFile(join(dir, 'inbox.jsonl'), '{"a":1}\n');
    await mkdir(join(dir, 'shared-docs'));
    await writeFile(join(dir, 'shared-docs', 'shared-docs.json'), JSON.stringify({ documents: {} }));
    // A corrupt file is the case most likely to tempt a "repair".
    await writeFile(join(dir, 'team.json'), '{oops');

    const before = await snapshotTree(dir);
    const result = runCli(['--data-dir', dir, '--json']);
    assert.equal(result.status, EXIT_PROBLEM);
    const after = await snapshotTree(dir);
    assert.deepEqual(after, before);

    // No cache, report or lock file appears beside the fixture.
    const names = (await readdir(dir)).sort();
    assert.deepEqual(names, ['inbox.jsonl', 'node.json', 'rooms.json', 'shared-docs', 'team.json']);
    const docs = await readdir(join(dir, 'shared-docs'));
    assert.deepEqual(docs, ['shared-docs.json']);
  });
});

test('the catalogue records where each path came from and never guesses', () => {
  assert.ok(FILE_CATALOGUE.length >= 10);
  for (const entry of FILE_CATALOGUE) {
    assert.match(entry.source, /^lib\/[\w.-]+\.m?js:\d+$/, `${entry.name} must cite a source line`);
    assert.ok(['json', 'jsonl'].includes(entry.format));
    assert.ok(!entry.relativePath.startsWith('/'));
    assert.ok(!entry.relativePath.includes('..'));
  }
  // The identity document is node.json; identity.json is an old name this
  // catalogue deliberately does not look for.
  assert.ok(FILE_CATALOGUE.some((entry) => entry.relativePath === 'node.json' && entry.role === 'identity'));
  assert.ok(!FILE_CATALOGUE.some((entry) => entry.relativePath === 'identity.json'));
});

test('sanitizeLabel reduces any path to a bounded base name', () => {
  assert.equal(sanitizeLabel('C:\\Users\\someone\\lan-mesh'), 'lan-mesh');
  assert.equal(sanitizeLabel('/home/someone/.dsh/lan-mesh/instances/45872'), '45872');
  assert.equal(sanitizeLabel('lan-mesh/'), 'lan-mesh');
  assert.equal(sanitizeLabel(''), 'data-dir');
  assert.equal(sanitizeLabel('a'.repeat(200)).length, 64);
  assert.equal(sanitizeLabel('bad\u0000name'), 'badname');
});

test('the human and JSON reports describe the same verdict', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'node.json'), '{"ok":true}');
    await writeFile(join(dir, 'rooms.json'), '{bad');

    const human = runCli(['--data-dir', dir]);
    const asJson = runCli(['--data-dir', dir, '--json']);
    assert.equal(human.status, asJson.status);
    assert.equal(human.status, EXIT_PROBLEM);

    const parsed = JSON.parse(asJson.stdout);
    for (const error of parsed.errors) assert.ok(human.stdout.includes(error.code));
    for (const warning of parsed.warnings) assert.ok(human.stdout.includes(warning.code));
    // Both modes agree on the measured size of a present file.
    const size = (await stat(join(dir, 'node.json'))).size;
    assert.ok(human.stdout.includes(`${size} B`));
  });
});
