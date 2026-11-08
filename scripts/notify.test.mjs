import test from 'node:test';
import assert from 'node:assert/strict';
import { Notifier } from '../lib/notify.mjs';

/** Build a fake IM service with a configurable bot/target matrix. */
function fakeIm({ bots, targetsByBot = () => [], sent = [] } = {}) {
  return {
    listBots: async () => bots,
    listTargets: async (botId) => targetsByBot(botId),
    send: async (botId, targetId, text) => {
      sent.push({ botId, targetId, text });
      return { sent: true };
    },
  };
}

function notifierFor(im, config = {}) {
  const logs = [];
  const n = new Notifier({
    config,
    getIm: () => im,
    log: (message) => logs.push(message),
  });
  return { n, logs };
}

test('no local channel: notify gives up without throwing', async () => {
  const { n } = notifierFor(undefined);
  const result = await n.notify('任务完成');
  assert.equal(result.status, 'none');
  assert.equal((await n.listChannels()).length, 0);
});

test('one IM bot with one target: sends automatically', async () => {
  const sent = [];
  const im = fakeIm({
    bots: [{ botId: 'wx_1', channel: 'wechat' }],
    targetsByBot: () => [{ targetId: 'tgt_1', name: '我' }],
    sent,
  });
  const { n } = notifierFor(im);
  const result = await n.notify('任务完成：房间 A 的「核对」已完成');
  assert.equal(result.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].botId, 'wx_1');
  assert.equal(sent[0].targetId, 'tgt_1');
  assert.equal(sent[0].text, '任务完成：房间 A 的「核对」已完成');
  assert.match(result.summary, /wechat/);
});

test('listBots returning plain string ids still works', async () => {
  const sent = [];
  const im = fakeIm({
    bots: ['wx_string'],
    targetsByBot: () => ['tgt_string'],
    sent,
  });
  const { n } = notifierFor(im);
  assert.equal((await n.listChannels()).length, 1);
  assert.equal((await n.notify('hi')).status, 'sent');
  assert.equal(sent[0].botId, 'wx_string');
});

test('two channels: holds the message for a human to pick one', async () => {
  const sent = [];
  const im = fakeIm({
    bots: [{ botId: 'wx_1', channel: 'wechat' }, { botId: 'fs_1', channel: 'feishu' }],
    targetsByBot: () => [{ targetId: 'tgt_1', name: '我' }],
    sent,
  });
  const { n } = notifierFor(im);
  const result = await n.notify('请确认');
  assert.equal(result.status, 'pending');
  assert.equal(result.channels.length, 2);
  assert.equal(sent.length, 0, 'nothing is sent before confirmation');
  assert.equal(n.describe().pending.length, 1);
  assert.equal(n.describe().pending[0].message, '请确认');
});

test('confirm sends through the chosen channel then clears the pending item', async () => {
  const sent = [];
  const im = fakeIm({
    bots: [{ botId: 'wx_1', channel: 'wechat' }, { botId: 'fs_1', channel: 'feishu' }],
    targetsByBot: () => [{ targetId: 'tgt_1', name: '我' }],
    sent,
  });
  const { n } = notifierFor(im);
  const held = await n.notify('请确认');
  const picked = held.channels[1].id;
  const result = await n.confirm(held.id, picked);
  assert.equal(result.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].botId, 'fs_1');
  assert.equal(n.describe().pending.length, 0);
});

test('a failed delivery keeps the pending item so the user can retry', async () => {
  const im = {
    listBots: async () => ['wx_1', 'wx_2'],
    listTargets: async () => ['tgt_1'],
    send: async () => ({ sent: false }),
  };
  const { n } = notifierFor(im);
  const held = await n.notify('请确认');
  const result = await n.confirm(held.id, held.channels[0].id);
  assert.equal(result.status, 'failed');
  assert.equal(n.describe().pending.length, 1);
});

test('dismiss drops a pending notification', async () => {
  const im = fakeIm({
    bots: ['wx_1', 'wx_2'],
    targetsByBot: () => ['tgt_1'],
  });
  const { n } = notifierFor(im);
  const held = await n.notify('忽略我');
  assert.equal(n.dismiss(held.id).ok, true);
  assert.equal(n.describe().pending.length, 0);
  assert.equal(n.dismiss('notify-nope').ok, false);
});

test('a missing IM service is swallowed, discovery still finds a webhook', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  try {
    const logs = [];
    const n = new Notifier({
      config: { notifyWebhook: 'https://example.test/hook' },
      getIm: () => { throw new Error('service not mounted'); },
      log: (m) => logs.push(m),
    });
    assert.equal((await n.listChannels()).length, 1);
    const result = await n.notify('webhook 通知');
    assert.equal(result.status, 'sent');
    assert.equal(calls[0].url, 'https://example.test/hook');
    assert.equal(calls[0].body.text, 'webhook 通知');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an invalid webhook URL is not treated as a channel', async () => {
  const { n } = notifierFor(undefined, { notifyWebhook: 'file:///etc/passwd' });
  assert.equal((await n.listChannels()).length, 0);
  assert.equal((await n.notify('x')).status, 'none');
});

test('sendDirect requires a known channel id', async () => {
  const sent = [];
  const { n } = notifierFor(fakeIm({ bots: ['wx_1'], targetsByBot: () => ['tgt_1'], sent }));
  assert.equal((await n.sendDirect('im:wx_1:tgt_1', '直接发')).status, 'sent');
  assert.equal((await n.sendDirect('nope', '直接发')).ok, false);
  assert.equal(sent.length, 1);
});

test('empty text never calls a channel', async () => {
  const sent = [];
  const { n } = notifierFor(fakeIm({ bots: ['wx_1'], targetsByBot: () => ['tgt_1'], sent }));
  assert.equal((await n.notify('   ')).status, 'empty');
  assert.equal(sent.length, 0);
});
