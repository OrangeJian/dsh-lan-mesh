/**
 * Peer discovery over UDP broadcast.
 *
 * Every node announces itself on the discovery port at a fixed interval and
 * answers anyone else's announcement with its own. Peers that go quiet for a
 * few intervals are dropped, so a machine that is switched off disappears
 * without any explicit goodbye.
 *
 * @module dsh-lan-mesh/lib/discovery
 */
import { createSocket } from 'node:dgram';

/** Wire tag so an unrelated broadcast on the same port is ignored. */
const TAG = 'dsh-lan-mesh/1';
/** How often this node announces itself. */
const ANNOUNCE_MS = 5_000;
/** How long a peer stays listed after its last announcement. */
const PEER_TTL_MS = 20_000;
/** Largest announcement accepted; anything bigger is not ours. */
const MAX_DATAGRAM = 2_048;

/**
 * Render one announcement.
 * @param {string} nodeId - sending node.
 * @param {object} details - name and http port.
 * @returns {Buffer}
 */
function announce(nodeId, details) {
  return Buffer.from(
    JSON.stringify({
      tag: TAG,
      nodeId,
      name: details.name,
      httpPort: details.httpPort,
      sentAt: Date.now(),
    }),
    'utf8',
  );
}

/**
 * Validate one datagram as an announcement from another node.
 * @param {Buffer} raw - received bytes.
 * @param {string} selfId - this node's id, to ignore echoes.
 * @returns {{ nodeId: string, name: string, httpPort: number } | undefined}
 */
function parse(raw, selfId) {
  if (raw.length === 0 || raw.length > MAX_DATAGRAM) return undefined;
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  if (value.tag !== TAG) return undefined;
  if (typeof value.nodeId !== 'string' || value.nodeId.length === 0 || value.nodeId === selfId) return undefined;
  const httpPort = Number(value.httpPort);
  if (!Number.isInteger(httpPort) || httpPort <= 0 || httpPort > 65535) return undefined;
  const name = typeof value.name === 'string' && value.name !== '' ? value.name.slice(0, 64) : value.nodeId;
  return { nodeId: value.nodeId, name, httpPort };
}

/**
 * A UDP discovery participant for one node.
 */
export class Discovery {
  /**
   * @param {object} options - identity and callbacks.
   * @param {string} options.nodeId - this node's id.
   * @param {number} options.port - UDP port to share.
   * @param {() => { name: string, httpPort: number }} options.describe - current announcement body.
   * @param {(peer: object) => void} [options.onPeer] - first sighting or refresh of a peer.
   * @param {(peer: object) => void} [options.onPeerLost] - peer expiry.
   * @param {(message: string, error?: unknown) => void} [options.onError] - diagnostics.
   */
  constructor(options) {
    this.nodeId = options.nodeId;
    this.port = options.port;
    this.describe = options.describe;
    this.onPeer = options.onPeer ?? (() => {});
    this.onPeerLost = options.onPeerLost ?? (() => {});
    this.onError = options.onError ?? (() => {});
    /** @type {import('node:dgram').Socket | undefined} */
    this.socket = undefined;
    /** @type {Map<string, object>} */
    this.peers = new Map();
    this.timer = undefined;
    this.sweeper = undefined;
  }

  /** Number of live peers. */
  get size() {
    return this.peers.size;
  }

  /**
   * Bind the discovery socket and start announcing.
   * @returns {Promise<void>} resolves once the socket is listening.
   */
  async start() {
    if (this.socket !== undefined) return;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.port, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
    socket.on('error', (error) => this.onError('discovery socket', error));
    socket.on('message', (raw, remote) => this.#receive(raw, remote));
    try {
      socket.setBroadcast(true);
    } catch (error) {
      this.onError('cannot enable broadcast; only direct peers will appear', error);
    }
    this.socket = socket;
    this.#announce();
    this.timer = setInterval(() => this.#announce(), ANNOUNCE_MS);
    this.timer.unref?.();
    this.sweeper = setInterval(() => this.#sweep(), ANNOUNCE_MS);
    this.sweeper.unref?.();
  }

  /** Close the socket and drop every peer. */
  async close() {
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.sweeper !== undefined) clearInterval(this.sweeper);
    this.timer = undefined;
    this.sweeper = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.peers.clear();
    if (socket === undefined) return;
    await new Promise((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  /**
   * Live peers, most recently seen first.
   * @returns {object[]}
   */
  list() {
    return [...this.peers.values()].sort((left, right) => right.lastSeen - left.lastSeen);
  }

  /**
   * Admit one datagram.
   * @param {Buffer} raw - received bytes.
   * @param {{ address: string }} remote - sender address.
   */
  #receive(raw, remote) {
    try {
      const parsed = parse(raw, this.nodeId);
      if (parsed === undefined) return;
      const address = String(remote.address ?? '').replace(/^::ffff:/, '');
      const previous = this.peers.get(parsed.nodeId);
      this.peers.set(parsed.nodeId, {
        nodeId: parsed.nodeId,
        name: parsed.name,
        httpPort: parsed.httpPort,
        address,
        lastSeen: Date.now(),
        firstSeen: previous?.firstSeen ?? Date.now(),
      });
      if (previous === undefined) this.onPeer(this.peers.get(parsed.nodeId));
      // Answer a stranger once so both sides converge without waiting for the
      // next scheduled announcement.
      if (previous === undefined) this.#announce(remote.address);
    } catch (error) {
      this.onError('discovery datagram', error);
    }
  }

  /**
   * Announce to the subnet, or answer one address directly.
   * @param {string} [target] - unicast reply address.
   */
  #announce(target) {
    const socket = this.socket;
    if (socket === undefined) return;
    let payload;
    try {
      payload = announce(this.nodeId, this.describe());
    } catch (error) {
      this.onError('cannot describe this node', error);
      return;
    }
    const address = target ?? '255.255.255.255';
    try {
      socket.send(payload, this.port, address, (error) => {
        if (error !== undefined && error !== null) {
          // A broadcast failure is normal on networks that block it; a direct
          // reply failing is worth knowing but never fatal.
          this.onError(`cannot announce to ${address}`, error);
        }
      });
    } catch (error) {
      this.onError(`cannot announce to ${address}`, error);
    }
  }

  /** Drop peers that have gone quiet. */
  #sweep() {
    const floor = Date.now() - PEER_TTL_MS;
    for (const [nodeId, peer] of [...this.peers]) {
      if (peer.lastSeen >= floor) continue;
      this.peers.delete(nodeId);
      this.onPeerLost(peer);
    }
  }
}
