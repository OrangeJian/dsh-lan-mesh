import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
let resolver = createRequire(join(repo, 'package.json'));
try { resolver.resolve('@deepseek-ai/dsh/package.json'); } catch {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm root -g'] : ['root', '-g'];
  const root = execFileSync(command, args, { encoding: 'utf8' }).trim();
  resolver = createRequire(join(root, '__composer_probe__.cjs'));
}
const cliPath = resolver.resolve('@deepseek-ai/dsh/package.json');
const cli = JSON.parse(readFileSync(cliPath, 'utf8'));
const fromDsh = createRequire(cliPath);
const names = ['conversation', 'attachment', 'input-trigger', 'skill'];
const installed = names.map(name => {
  const id = `@deepseek-ai/dsh-client-ui-${name}`;
  const metadataPath = fromDsh.resolve(`${id}/package.json`);
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  assert(metadata.exports['./client'], `${id}: missing public client export`);
  assert(existsSync(fromDsh.resolve(`${id}/client`)), `${id}: missing client target`);
  assert(existsSync(join(dirname(metadataPath), metadata.exports['./client'].types)), `${id}: missing declarations`);
  return { id, version: metadata.version, exports: metadata.exports, inject: metadata.dsh.client.inject };
});
const document = readFileSync(join(repo, 'docs/development-room-composer-compat.md'), 'utf8');
const manifest = JSON.parse(document.match(/```json\s*([\s\S]*?)```/)?.[1] ?? 'null');
assert(manifest, 'missing machine-readable matrix');
assert.equal(manifest.dshVersion, cli.version, 'DSH version changed; re-audit scopes');
assert.deepEqual(manifest.packages, installed, 'exports/injections changed; re-audit matrix');
for (const name of names) {
  const row = manifest.capabilities.find(row => row.package === name);
  assert(row?.publicContract && row?.scope && row?.fallback, `${name}: incomplete classification`);
  assert.equal(row.fallbackOwner, 'Room-owned fallback');
}
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
assert.equal(pkg.scripts['check:composer-compat'], 'node scripts/composer-compat-check.mjs');
const client = readFileSync(join(repo, 'client.js'), 'utf8');
for (const [, id] of client.matchAll(/(?:require\s*\(|from\s*)['"](@deepseek-ai\/[^'"]+)['"]/g)) {
  assert(/^@deepseek-ai\/[^/]+(?:\/client)?$/.test(id), `private Room import: ${id}`);
  // Optional primitives are supplied by the browser module loader, not Node.
  // Only the four required client entry points above are resolution gates.
}
assert(!/\bInputBar\b/.test(client), 'Room must not depend on InputBar');
assert.equal(manifest.privateImportsRequired, false);
console.log(`PASS composer compatibility: DSH ${cli.version}, ${installed.length} public client entry points; no private-import requirement`);
