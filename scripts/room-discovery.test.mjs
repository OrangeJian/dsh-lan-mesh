import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocket } from 'node:dgram';
import { MeshNode } from '../lib/service.mjs';
import { MeshServer } from '../lib/transport.mjs';
import { emptyState, createRoom } from '../lib/rooms.mjs';

test('discovering a peer fetches projects created before this node came online', async t => {
  const home = await mkdtemp(join(tmpdir(), 'room-discovery-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const remoteState = emptyState();
  const room = createRoom(remoteState, { name: 'Existing project', leader: { nodeId: 'node-remote01', sessionId: 'leader' } }, () => '111111111111-aaaa-bbbb-cccc-dddddddddddd');
  const remote = new MeshServer({ describe: () => ({ nodeId: 'node-remote01' }), secret: () => '', trustedPeers: () => [], onState: async () => ({ state: remoteState }) });
  const node = new MeshNode({ config: { port: 0, discoveryPort: 0, clusterSecret: '', trustedPeers: [], autoWake: false } });
  const socket = createSocket('udp4');
  t.after(async () => {
    socket.close();
    await node.close();
    await remote.close();
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  });
  await remote.listen(0);
  await node.start();
  const announcement = Buffer.from(JSON.stringify({ tag: 'dsh-lan-mesh/1', nodeId: 'node-remote01', name: 'Remote', httpPort: remote.port }));
  await new Promise((resolve, reject) => socket.send(announcement, node.discovery.socket.address().port, '127.0.0.1', error => error ? reject(error) : resolve()));
  const deadline = Date.now() + 2000;
  while (!node.roomsDoc.rooms[room.id] && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(node.discovery.list().length, 1);
  assert.equal(node.roomsDoc.rooms[room.id]?.name, 'Existing project');
});
