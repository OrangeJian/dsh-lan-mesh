#!/usr/bin/env node
/**
 * Inbox workbench evidence generator.
 *
 * Usage: node scripts/inbox-workbench-preview.mjs
 *
 * Writes docs/ux/inbox-workbench-preview/screenshots/*.png plus
 * preview-validation.json from real browser measurements.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Regenerates the static evidence in docs/ux/inbox-workbench-preview.
 *
 * Two jobs, both about keeping the evidence honest:
 *   1. The fixture stylesheets are rewritten from ui/inbox/inbox-workbench.css,
 *      so a preview can never show CSS older than the component (the reason
 *      this file exists: the 850px media-query version survived the switch to a
 *      container query and the "narrow" preview kept two columns).
 *   2. Screenshots and geometry are re-measured in a real browser, including the
 *      narrow Host main pane the handoff asks about (540px inside a wide
 *      window), so "single column at 540px" is observed rather than asserted.
 *
 * The browser is discovered, never hard-coded. When none is available the script
 * still refreshes the fixtures and says so, instead of writing numbers no
 * browser produced.
 */
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const out = resolve(repo, 'docs/ux/inbox-workbench-preview');
const componentCss = (await readFile(join(repo, 'ui/inbox/inbox-workbench.css'), 'utf8')).replace(/\r\n/g, '\n').trimEnd();
const marker = '.lm-inboxWorkbench{';
if (!componentCss.startsWith(marker)) throw new Error('inbox stylesheet must start with ' + marker);

const cases = [
  { name: 'list-1440-light-default', page: 'list', width: 1440, height: 900, theme: 'light' },
  { name: 'detail-1024-dark-default', page: 'detail', width: 1024, height: 768, theme: 'dark' },
  { name: 'detail-640-light-default', page: 'detail', width: 640, height: 768, theme: 'light' },
  { name: 'confirm-1440-light-default', page: 'confirm', width: 1440, height: 900, theme: 'light' },
  { name: 'empty-1024-light-default', page: 'empty', width: 1024, height: 768, theme: 'light' },
  { name: 'failed-1024-dark-default', page: 'failed', width: 1024, height: 768, theme: 'dark' },
  { name: 'detail-1440-main540-light', page: 'detail', width: 1440, height: 900, theme: 'light', mainWidth: 540 },
];

for (const page of [...new Set(cases.map((item) => item.page))]) {
  const file = join(out, page + '.html');
  const html = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const start = html.indexOf('<style>') + 7;
  const end = html.indexOf('</style>');
  const css = html.slice(start, end);
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(page + '.html: missing inbox stylesheet');
  await writeFile(file, html.slice(0, start) + css.slice(0, at) + componentCss + html.slice(end));
}
console.log('fixtures refreshed from ui/inbox/inbox-workbench.css');

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = browsers.find((entry) => existsSync(entry));
if (!browser) {
  console.log('no Chromium browser found; screenshots left untouched');
  process.exit(0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = await mkdtemp(join(tmpdir(), 'lm-inbox-preview-'));
const port = 9400 + Math.floor(Math.random() * 400);
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
try {
  let targets = [];
  for (let attempt = 0; attempt < 80 && targets.length === 0; attempt += 1) {
    await sleep(250);
    try {
      targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    } catch {
      // The debugging endpoint is not up yet.
    }
  }
  const page = targets.find((entry) => entry.type === 'page');
  if (!page) throw new Error('browser did not expose a page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let id = 0;
  const waiters = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    const resolveWaiter = waiters.get(payload.id);
    if (resolveWaiter) {
      waiters.delete(payload.id);
      resolveWaiter(payload);
    }
  });
  const send = (method, params = {}) => new Promise((done) => {
    id += 1;
    waiters.set(id, done);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');

  const measure = `(() => {
    const pick = (selector) => document.querySelector(selector);
    const style = (element) => element ? getComputedStyle(element) : null;
    const box = (element) => element ? element.getBoundingClientRect() : null;
    const root = pick('.lm-inboxWorkbench');
    const list = pick('.lm-inboxList');
    const detail = pick('.lm-inboxDetail');
    const rows = [...document.querySelectorAll('.lm-inboxRow')];
    const listBox = list ? box(list) : null;
    const visible = listBox ? rows.filter((row) => {
      const rect = box(row);
      return rect.top < listBox.bottom - 1 && rect.bottom > listBox.top + 1;
    }).length : 0;
    return {
      ready: document.readyState,
      rootWidth: root ? Math.round(box(root).width) : 0,
      mainWidth: Math.round(box(pick('main')).width),
      columnsDisplay: style(pick('.lm-inboxColumns'))?.display ?? '',
      listDisplay: style(list)?.display ?? '',
      detailDisplay: style(detail)?.display ?? '',
      overflow: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth,
      rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : false,
      clippedRows: list ? rows.filter((row) => row.scrollHeight > row.clientHeight + 1).length : 0,
      buttons: [...document.querySelectorAll('.lm-btn')].map((button) => ({
        label: button.textContent.trim().slice(0, 24),
        width: Math.round(box(button).width),
        overflow: button.scrollWidth > button.clientWidth + 1,
      })),
      rows: rows.length,
      visibleRows: visible,
      windowHeight: innerHeight,
    };
  })()`;

  const results = [];
  const errors = [];
  for (const item of cases) {
    await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: item.theme }] });
    const url = pathToFileURL(join(out, item.page + '.html')).href;
    await send('Page.navigate', { url });
    await sleep(700);
    if (item.mainWidth) {
      const applied = await send('Runtime.evaluate', {
        expression: `(() => {
          const main = document.querySelector('main');
          main.style.width = '${item.mainWidth}px';
          main.style.flex = '0 0 auto';
          return main.getBoundingClientRect().width;
        })()`,
        returnByValue: true,
      });
      if (applied.result?.exceptionDetails) errors.push(item.name + ': main pane resize failed');
      await sleep(300);
    }
    const measured = await send('Runtime.evaluate', { expression: measure, returnByValue: true });
    const value = measured.result?.result?.value;
    if (!value) {
      errors.push(item.name + ': measurement failed');
      continue;
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot.result?.data) errors.push(item.name + ': screenshot failed');
    else {
      await mkdir(join(out, 'screenshots'), { recursive: true });
      await writeFile(join(out, 'screenshots', item.name + '.png'), Buffer.from(shot.result.data, 'base64'));
    }
    results.push({
      name: item.name,
      page: item.page + '.html',
      width: item.width,
      height: item.height,
      theme: item.theme,
      ...value,
    });
    console.log('captured ' + item.name);
  }
  await writeFile(join(out, 'preview-validation.json'), JSON.stringify({ screenshots: results, runtimeErrors: errors }, null, 2) + '\n');
  console.log('wrote preview-validation.json (' + results.length + ' cases, ' + errors.length + ' errors)');
  socket.close();
} finally {
  child.kill();
  // Chromium keeps Crashpad files open for a moment after the process exits, so
  // a profile removal that raced it would fail the whole run after the evidence
  // was already written. Retry briefly, then leave the profile behind.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(200);
    }
  }
}
