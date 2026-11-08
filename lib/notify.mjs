/**
 * Out-of-band notifications, discovered at send time.
 *
 * The mesh never hardcodes a channel. When a notification is due we look for
 * whatever this machine actually has — the `@xmanrui/dsh-im` service (WeChat,
 * Feishu, ...) and, if configured, a generic webhook — then:
 *   - 0 channels  -> log and give up (a missing channel must never fail the caller)
 *   - 1 channel   -> send immediately
 *   - >1 channels -> hold the message as `pending` so a person can pick one in
 *                    the panel (`notifySend`) or an agent can confirm.
 *
 * Discovery is deliberately lazy and best-effort: a missing IM plugin, a bot
 * with no saved targets, or a dead webhook must not take the mesh down.
 */
import { randomUUID } from 'node:crypto';

/** @returns {string} short id for one held notification. */
function pendingId() {
  return `notify-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Accept both `listBots()` shapes: string ids, or `{botId, channel}` rows. */
function botIdOf(row) {
  return typeof row === 'string' ? row : typeof row?.botId === 'string' ? row.botId : '';
}

/** Accept both `listTargets()` shapes: strings, `{targetId,...}` rows, or a `{targets}` wrapper. */
function targetsOf(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.targets) ? raw.targets : [];
  return list
    .map((row) => ({
      targetId: typeof row === 'string' ? row : typeof row?.targetId === 'string' ? row.targetId : '',
      name: typeof row === 'object' && row !== null && typeof row.name === 'string' ? row.name : '',
    }))
    .filter((row) => row.targetId !== '');
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'webhook';
  }
}

/** Result of a single delivery attempt. */
function delivered(channel, okSummary) {
  return { status: 'sent', ok: true, channel: channel.label, summary: okSummary };
}

function failed(error) {
  const detail = String(error?.message ?? error);
  return { status: 'failed', ok: false, error: detail, summary: `通知发送失败：${detail}` };
}

export class Notifier {
  /**
   * @param {object} options
   * @param {object} options.config - resolved plugin config; reads `notifyWebhook`.
   * @param {() => object | undefined} options.getIm - late-bound `ctx.get('dshIm')`.
   * @param {(message: string, detail?: unknown) => void} options.log - diagnostics.
   */
  constructor({ config, getIm, log }) {
    this.config = config;
    this.getIm = getIm;
    this.log = log;
    /** @type {Array<{id:string,message:string,scope:string,createdAt:string,options:Array<{id:string,label:string,send:(text:string)=>Promise<unknown>}>}>} */
    this.pending = [];
  }

  /** Discover every usable channel on this machine. Never throws. */
  async channels() {
    const out = [];
    let im;
    try {
      im = typeof this.getIm === 'function' ? this.getIm() : undefined;
    } catch (error) {
      this.log('notify: cannot read the IM service', error);
    }
    if (im !== undefined && im !== null && typeof im.listBots === 'function' && typeof im.send === 'function') {
      let bots = [];
      try {
        const raw = await im.listBots();
        if (Array.isArray(raw)) bots = raw;
      } catch (error) {
        this.log('notify: listBots failed', error);
      }
      for (const row of bots) {
        const botId = botIdOf(row);
        if (botId === '' || typeof im.listTargets !== 'function') continue;
        const kind = typeof row === 'object' && row !== null && typeof row.channel === 'string' ? row.channel : 'IM';
        let targets = [];
        try {
          targets = targetsOf(await im.listTargets(botId));
        } catch (error) {
          this.log(`notify: listTargets failed for ${botId}`, error);
        }
        for (const target of targets) {
          out.push({
            id: `im:${botId}:${target.targetId}`,
            label: `${kind} · ${target.name || target.targetId}`,
            kind: 'im',
            send: (text) => im.send(botId, target.targetId, text, { format: 'plain' }),
          });
        }
      }
    }
    const hook = typeof this.config?.notifyWebhook === 'string' ? this.config.notifyWebhook.trim() : '';
    if (hook !== '' && /^https?:\/\//i.test(hook)) {
      out.push({
        id: 'webhook:default',
        label: `Webhook · ${safeHost(hook)}`,
        kind: 'webhook',
        send: async (text) => {
          const response = await fetch(hook, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
        },
      });
    }
    return out;
  }

  /** Public, serializable channel list. */
  async listChannels() {
    const list = await this.channels();
    return list.map(({ id, label, kind }) => ({ id, label, kind }));
  }

  /**
   * Run the reserved notification operation.
   * @returns {Promise<{status:string, summary:string, id?:string, channels?:object[]}>}
   */
  async notify(message, scope = '') {
    const flat = String(message ?? '').trim();
    if (flat === '') return { status: 'empty', summary: '通知内容为空。' };
    const list = await this.channels();
    if (list.length === 0) {
      this.log('notify: no local notification channel is available');
      return { status: 'none', summary: '本机没有可用的通知渠道，未发送。' };
    }
    if (list.length === 1) return this.#deliver(list[0], flat);
    const id = pendingId();
    this.pending.push({
      id,
      message: flat,
      scope,
      createdAt: new Date().toISOString(),
      options: list.map(({ id: channelId, label, send }) => ({ id: channelId, label, send })),
    });
    return {
      status: 'pending',
      id,
      channels: list.map(({ id: channelId, label }) => ({ id: channelId, label })),
      summary: `发现 ${list.length} 个可用通知渠道，需要用户选择后再发。待确认编号 ${id}。`,
    };
  }

  /** Send `text` straight to one channel id (no pending record). */
  async sendDirect(channelId, text) {
    const flat = String(text ?? '').trim();
    if (flat === '') return { ok: false, error: 'empty message' };
    const channel = (await this.channels()).find((row) => row.id === channelId);
    if (channel === undefined) return { ok: false, error: `unknown channel ${channelId}` };
    return this.#deliver(channel, flat);
  }

  /** Confirm one held notification with the channel a person picked. */
  async confirm(id, channelId) {
    const item = this.pending.find((row) => row.id === id);
    if (item === undefined) return { ok: false, error: 'no pending notification with that id' };
    const choice = item.options.find((row) => row.id === channelId);
    if (choice === undefined) return { ok: false, error: `unknown channel ${channelId}` };
    const result = await this.#deliver(choice, item.message);
    if (result.status === 'sent') this.pending = this.pending.filter((row) => row.id !== id);
    return result;
  }

  /** Drop one held notification without sending. */
  dismiss(id) {
    const before = this.pending.length;
    this.pending = this.pending.filter((row) => row.id !== id);
    return { ok: this.pending.length < before };
  }

  /** Serializable state for the panel's `snapshot`. */
  describe() {
    return {
      pending: this.pending.map(({ id, message, createdAt, options }) => ({
        id,
        message,
        createdAt,
        channels: options.map(({ id: channelId, label }) => ({ id: channelId, label })),
      })),
    };
  }

  async #deliver(channel, text) {
    try {
      const result = await channel.send(text);
      // Some IM adapters resolve `false` / `{sent:false}` instead of throwing.
      if (result === false || result?.sent === false) throw new Error('channel refused the message');
      return delivered(channel, `已通过 ${channel.label} 通知：${text}`);
    } catch (error) {
      this.log('notify: send failed', error);
      return failed(error);
    }
  }
}
