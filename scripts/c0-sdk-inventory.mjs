/** Read installed public declarations without creating sessions or opening a Host. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
let resolver = createRequire(join(repo, 'package.json'));
try { resolver.resolve('@deepseek-ai/dsh/package.json'); } catch {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm root -g'] : ['root', '-g'];
  const root = execFileSync(command, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim();
  resolver = createRequire(join(root, '__c0_inventory__.cjs'));
}
const hostPath = resolver.resolve('@deepseek-ai/dsh/package.json');
const host = JSON.parse(readFileSync(hostPath, 'utf8'));
const fromHost = createRequire(hostPath);
const packages = ['dsh-agent', 'dsh-session', 'dsh-client-connection'].map(name => {
  const id = `@deepseek-ai/${name}`;
  const metadataPath = fromHost.resolve(`${id}/package.json`);
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const entry = metadata.exports?.['.'];
  const typeTarget = typeof entry === 'object' ? entry.types : undefined;
  const declaration = typeTarget ?? metadata.types;
  if (typeof declaration !== 'string') throw new Error(`${id}: no public root declaration`);
  const body = readFileSync(join(dirname(metadataPath), declaration));
  return {
    id, version: metadata.version, publicExports: Object.keys(metadata.exports ?? {}),
    declaration, sha256: createHash('sha256').update(body).digest('hex'),
    evidenceLevel: 'installed-public-declaration-only',
  };
});
console.log(JSON.stringify({
  schemaVersion: 1, observedAt: new Date().toISOString(), hostVersion: host.version,
  packages, runtimeBehaviorVerified: false,
  notVerified: ['session-create-resume', 'followup-ack-durability', 'cancel-quiescence', 'owned-handle-release', 'crash-recovery', 'workspace-isolation', 'owner-acl-revocation'],
}, null, 2));
