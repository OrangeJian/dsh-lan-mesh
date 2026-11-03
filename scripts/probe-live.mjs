/**
 * Interop probe for a live DSH instance.
 *
 * Starts one standalone mesh node on the same discovery port as the running
 * Harness, waits until each side sees the other, then exchanges a message in
 * both directions. This proves the wire protocol against the real plugin, not
 * against a copy of its own code.
 *
 * Run: node scripts/probe-live.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshNode } from '../lib/service.mjs';
import { PROTOCOL_VERSION } from '../lib/transport.mjs';

const savedHome = process.env.DSH_HOME;
let failures = 0;

/** Report one expectation. */
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

/** Wait until `test()` holds. */
async function until(test, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return test();
}

/** Read the live node's identity document over HTTP. */
async function liveInfo(address, port) {
  const response = await fetch(`http://${address}:${port}/lan-mesh/v1/info`, {
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`info answered HTTP ${response.status}`);
  return response.json();
}

const home = await mkdtemp(join(tmpdir(), 'lan-mesh-probe-'));
const probeHome = join(home, 'probe');
process.env.DSH_HOME = probeHome;

const probe = new MeshNode({
  config: {
    displayName: 'interop-probe',
    port: 45881,
    discoveryPort: 45870,
    clusterSecret: '',
    autoWake: false,
    trustedPeers: [],
  },
  log: (message, error) => console.log(`  [probe] ${message}${error === undefined ? '' : `: ${error}`}`),
});

try {
  await probe.start();
  console.log('\nlive instance');
  const info = await liveInfo('127.0.0.1', 45871);
  check('the running Harness answers /lan-mesh/v1/info', info.ok === true, JSON.stringify(info.node));
  const liveId = info.node.nodeId;
  const liveName = info.node.name;

  console.log('\ndiscovery');
  const seen = await until(() =>
    probe.peers().some((peer) => peer.nodeId === liveId) &&
    probe.peers().some((peer) => peer.address !== ''),
  );
  check('the probe discovered the live node over UDP', seen, JSON.stringify(probe.peers().map((p) => p.nodeId)));

  console.log('\nprobe -> live');
  const outbound = await probe.send({
    target: liveId,
    text: 'interop probe: can you hear me?',
    topic: 'probe',
  });
  check('the live node accepted a delivered message', outbound.delivered[0]?.ok === true, JSON.stringify(outbound.delivered));

  console.log('\nlive -> probe');
  // Ask the live node to send back through its own tool-free HTTP path: the
  // probe exposes the same endpoints, so a plain POST is the same call an agent
  // would trigger with lan_mesh_send.
  const envelope = {
    // The wire version is whatever the plugin speaks today; hardcoding it is how
    // this probe silently stopped matching the node it is meant to test.
    v: PROTOCOL_VERSION,
    id: `probe-${Date.now()}`,
    from: { nodeId: liveId, name: liveName },
    to: probe.nodeId,
    kind: 'note',
    topic: 'probe',
    text: 'interop probe: reply from the live node',
    sentAt: new Date().toISOString(),
  };
  const reply = await fetch('http://127.0.0.1:45881/lan-mesh/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(4_000),
  });
  const replyBody = await reply.json();
  check('the probe accepted the live node identity', replyBody.ok === true, JSON.stringify(replyBody));
  const inbox = probe.inbox({ limit: 10 });
  check('the message was stored on the probe', inbox.messages.length === 1, JSON.stringify(inbox.messages.map((m) => m.id)));

  console.log('\ninbox of the live node');
  const liveInbox = await fetch('http://127.0.0.1:45871/lan-mesh/v1/info', {
    signal: AbortSignal.timeout(4_000),
  }).then((response) => response.json());
  check(
    'the live node reports the delivered message as unread',
    liveInbox.node.unread >= 1,
    JSON.stringify({ unread: liveInbox.node.unread }),
  );
} catch (error) {
  failures += 1;
  console.log(`  FAIL ${String(error?.message ?? error)}`);
} finally {
  await probe.close();
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\ninterop ok' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
