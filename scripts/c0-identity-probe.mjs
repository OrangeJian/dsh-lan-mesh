/** Isolated persistence probe, not a running Host or physical-network test. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'mesh-c0-identity-'));
const storeUrl = new URL('../lib/store.mjs', import.meta.url).href;
const cases = [];
async function observe(home, cwd, port = 45871, primaryPort = 45871) {
  const code = `import {loadIdentity} from ${JSON.stringify(storeUrl)};console.log(JSON.stringify(await loadIdentity({port:${port},primaryPort:${primaryPort}})));`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', code], {
    cwd, env: { ...process.env, DSH_HOME: home }, timeout: 10_000, windowsHide: true,
  });
  return JSON.parse(stdout.trim());
}
function check(name, predicate) {
  assert(predicate, name);
  cases.push({ name, status: 'PASS' });
}
try {
  const homeA = join(root, 'home-a'), homeB = join(root, 'home-b');
  const workspaceA = join(root, 'workspace-a'), workspaceB = join(root, 'workspace-b');
  await Promise.all([workspaceA, workspaceB].map(path => mkdir(path, { recursive: true })));
  const initial = await observe(homeA, workspaceA);
  const restarted = await observe(homeA, workspaceA);
  check('separate process restart preserves the complete persisted identity', JSON.stringify(initial) === JSON.stringify(restarted));
  const moved = await observe(homeA, workspaceB);
  check('workspace cwd changes do not create a new Node identity', moved.nodeId === initial.nodeId);
  const secondary = await observe(homeA, workspaceA, 45872);
  check('distinct configured ports use independent identity slots', secondary.nodeId !== initial.nodeId);
  check('secondary slot survives separate process restart', (await observe(homeA, workspaceB, 45872)).nodeId === secondary.nodeId);
  check('distinct DSH_HOME uses an independent identity', (await observe(homeB, workspaceA)).nodeId !== initial.nodeId);
  check('configured primary port retains the legacy root identity', (await observe(homeA, workspaceA, 45999, 45999)).nodeId === initial.nodeId);
  console.log(JSON.stringify({
    schemaVersion: 1, observedAt: new Date().toISOString(), runtime: process.version,
    platform: process.platform, scope: 'isolated-store-processes', cases,
    notRun: ['real-multi-host-lifecycle', 'same-slot-concurrent-writers', 'physical-two-machine', 'session-lifecycle', 'authenticated-owner-revocation', 'runner-execution'],
    conclusion: 'Node identity belongs to a DSH_HOME/mesh-port storage slot; it is not a physical-machine or workspace identity. No Host-instance-ID decision follows from this probe alone.',
  }, null, 2));
} finally {
  // Only this freshly-created, owned temporary tree is removed.
  await rm(root, { recursive: true, force: true });
}
