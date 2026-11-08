/**
 * Two-node smoke test: identity, discovery, delivery, inbox and persistence.
 *
 * Each node gets its own DSH_HOME so the two act like two machines on one LAN.
 * Run: node scripts/smoke.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';

const savedHome = process.env.DSH_HOME;
const roots = [];
let failures = 0;

/** Report one expectation. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/** Make a fresh DSH_HOME for one node. */
async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'lan-mesh-smoke-'));
  roots.push(dir);
  process.env.DSH_HOME = dir;
  return dir;
}

/** Wait until `test()` holds, polling every 100 ms. */
async function until(test, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return test();
}

const base = {
  displayName: '',
  clusterSecret: '',
  autoWake: false,
  trustedPeers: [],
};

try {
  await home();
  const alpha = new MeshNode({
    config: { ...base, displayName: 'alpha', port: 45891, discoveryPort: 45901 },
    log: (message, error) => console.log(`  [alpha] ${message}${error === undefined ? '' : `: ${error}`}`),
  });
  await alpha.start();

  await home();
  const beta = new MeshNode({
    config: { ...base, displayName: 'beta', port: 45892, discoveryPort: 45901 },
    log: (message, error) => console.log(`  [beta] ${message}${error === undefined ? '' : `: ${error}`}`),
  });
  await beta.start();

  console.log('\nidentity');
  check('alpha has a node id', /^node-[a-z0-9-]+$/.test(alpha.nodeId), alpha.nodeId);
  check('beta has a different node id', beta.nodeId !== alpha.nodeId, `${alpha.nodeId} vs ${beta.nodeId}`);
  check('alpha kept its configured name', alpha.describe().name === 'alpha', alpha.describe().name);
  check('http ports are the configured ones', alpha.port === 45891 && beta.port === 45892, `${alpha.port}/${beta.port}`);

  console.log('\ndiscovery');
  const found = await until(() => alpha.peers().length > 0 && beta.peers().length > 0);
  check('both nodes see each other', found, `alpha=${alpha.peers().length} beta=${beta.peers().length}`);

  console.log('\ndelivery');
  const report = await alpha.send({ target: 'beta', text: 'hello from alpha', topic: 'smoke' });
  check('one peer received the message', report.delivered.length === 1 && report.delivered[0].ok, JSON.stringify(report.delivered));
  const betaInbox = beta.inbox({ limit: 10 });
  check('beta stored the message', betaInbox.messages.length === 1, JSON.stringify(betaInbox.messages));
  check('text survived the wire', betaInbox.messages[0]?.text === 'hello from alpha', betaInbox.messages[0]?.text);
  check('topic survived the wire', betaInbox.messages[0]?.topic === 'smoke', betaInbox.messages[0]?.topic);
  check('unread counter moved', betaInbox.unread === 1, String(betaInbox.unread));

  const reply = await beta.send({ target: alpha.nodeId, text: 'ack from beta' });
  check('addressing by node id works', reply.delivered[0]?.ok === true, JSON.stringify(reply.delivered));
  // Alpha also keeps its own copy of the message it sent, so count alone is
  // wrong; the reply itself is what proves inbound storage.
  check(
    'alpha stored the reply',
    alpha.inbox({ limit: 10 }).messages.some((message) => message.text === 'ack from beta'),
  );

  const duplicate = await alpha.send({ target: 'no-such-node', text: 'nowhere' });
  check('an unknown target reports no delivery', duplicate.delivered.length === 0 && typeof duplicate.note === 'string', JSON.stringify(duplicate));

  console.log('\ndedup');
  const envelope = {
    id: 'fixed-envelope-id',
    from: { nodeId: 'node-manual', name: 'manual' },
    to: '*',
    kind: 'note',
    topic: '',
    text: 'sent once',
    sentAt: new Date().toISOString(),
  };
  const first = await beta.receive({ ...envelope });
  const second = await beta.receive({ ...envelope });
  check('the first copy is admitted', first.receivedAt !== '' && second.woken === false);
  const after = beta.inbox({ limit: 50, unreadOnly: true });
  check('the duplicate is dropped', after.messages.filter((item) => item.id === 'fixed-envelope-id').length === 1, String(after.messages.length));

  console.log('\npersistence');
  // A restart means the same configured port, so close beta and take its place.
  await beta.close();
  const reloaded = new MeshNode({
    config: { ...base, displayName: 'beta', port: 45892, discoveryPort: 45902 },
    log: () => {},
  });
  await reloaded.start();
  check('identity is stable across restarts', reloaded.nodeId === beta.nodeId, `${reloaded.nodeId} vs ${beta.nodeId}`);
  const restored = reloaded.inbox({ limit: 50 });
  check('the inbox is restored from disk', restored.messages.length >= 2, String(restored.messages.length));
  check('unread survived the restart', reloaded.inbox({ limit: 50 }).unread >= 1, String(reloaded.inbox({ limit: 50 }).unread));
  await reloaded.close();

  console.log('\nseparate instances');
  // A second DSH on one machine shares $DSH_HOME but must not share an identity.
  const sibling = new MeshNode({
    config: { ...base, displayName: 'sibling', port: 45897, discoveryPort: 45904 },
    log: () => {},
  });
  await sibling.start();
  check('a second instance on the same host gets its own id', sibling.nodeId !== reloaded.nodeId, `${sibling.nodeId} vs ${reloaded.nodeId}`);
  check('a second instance starts with an empty inbox', sibling.inbox({ limit: 50 }).messages.length === 0, String(sibling.inbox({ limit: 50 }).messages.length));
  await sibling.close();

  console.log('\nsecurity');
  await home();
  const guarded = new MeshNode({
    config: { ...base, displayName: 'guarded', port: 45894, discoveryPort: 45903, clusterSecret: 'shared-secret' },
    log: () => {},
  });
  await guarded.start();
  await home();
  const outsider = new MeshNode({
    config: { ...base, displayName: 'outsider', port: 45895, discoveryPort: 45903, clusterSecret: 'wrong-secret' },
    log: () => {},
  });
  await outsider.start();
  await until(() => outsider.peers().length > 0);
  const rejected = await outsider.send({ target: 'guarded', text: 'should not arrive' });
  check('a wrong secret is refused', rejected.delivered[0]?.ok === false, JSON.stringify(rejected.delivered));
  check('nothing was stored', guarded.inbox({ limit: 50 }).messages.length === 0);
  await outsider.close();

  await home();
  const friend = new MeshNode({
    config: { ...base, displayName: 'friend', port: 45896, discoveryPort: 45903, clusterSecret: 'shared-secret' },
    log: () => {},
  });
  await friend.start();
  await until(() => friend.peers().length > 0);
  const accepted = await friend.send({ target: 'guarded', text: 'signed hello' });
  check('the right secret is accepted', accepted.delivered[0]?.ok === true, JSON.stringify(accepted.delivered));
  check('the signed message arrived', guarded.inbox({ limit: 10 }).messages.length === 1);

  await friend.close();
  await guarded.close();
  await alpha.close();
  await beta.close();
} finally {
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  for (const root of roots) await rm(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
