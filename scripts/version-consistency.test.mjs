/**
 * One version, four carriers.
 *
 * package.json, both package-lock.json version slots and client.js all state the
 * release, and a bump that misses one is how a "0.4.21" build reaches the host
 * while the panel still reports the old number. That has been done by hand every
 * batch, so it is a check instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const clientVersion = read('client.js').match(/const PLUGIN_VERSION = '([^']+)'/)[1];

test('every carrier agrees on the release version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version, 'package-lock.json top-level version');
  assert.equal(lock.packages[''].version, pkg.version, 'package-lock.json root package version');
  assert.equal(clientVersion, pkg.version, 'client.js PLUGIN_VERSION');
});

test('the preview generators are reachable from one npm script each', () => {
  const scripts = pkg.scripts ?? {};
  for (const [name, file] of [
    ['preview:inbox', 'scripts/inbox-workbench-preview.mjs'],
    ['preview:network', 'scripts/network-workbench-preview.mjs'],
    ['preview:board', 'scripts/task-board-preview.mjs'],
  ]) {
    assert.equal(scripts[name], `node ${file}`, `npm run ${name}`);
    assert.ok(read(file).length > 0, `${file} exists`);
  }
});
