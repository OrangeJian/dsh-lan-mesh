import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocket } from 'node:dgram';
import { Discovery } from '../lib/discovery.mjs';

test('same peer restarting on another HTTP port triggers a fresh synchronization callback',async t=>{
 const seen=[];
 const discovery=new Discovery({nodeId:'self',port:0,describe:()=>({name:'Self',httpPort:1}),onPeer:peer=>seen.push({...peer})});
 const sender=createSocket('udp4');
 t.after(async()=>{sender.close();await discovery.close();});
 await discovery.start();
 const send=port=>new Promise((resolve,reject)=>sender.send(Buffer.from(JSON.stringify({tag:'dsh-lan-mesh/1',nodeId:'peer',name:'Peer',httpPort:port})),discovery.socket.address().port,'127.0.0.1',error=>error?reject(error):resolve()));
 await send(12345);await send(12345);await send(12346);
 const deadline=Date.now()+1000;
 while(discovery.list()[0]?.httpPort!==12346&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(discovery.list()[0].httpPort,12346);
 assert.deepEqual(seen.map(peer=>peer.httpPort),[12345,12346]);
});
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
