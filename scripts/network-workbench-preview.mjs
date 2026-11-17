#!/usr/bin/env node
/**
 * Network workbench evidence generator.
 *
 * Usage: node scripts/network-workbench-preview.mjs
 *
 * Writes docs/ux/network-workbench-preview/screenshots/*.png,
 * preview-validation.json and report.md from real browser measurements.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Regenerates the static evidence in docs/ux/network-workbench-preview.
 *
 * Two jobs, both about keeping the evidence honest:
 *   1. Every fixture stylesheet is rewritten from ui/network/network-workbench.css,
 *      so a preview can never show CSS older than the component it claims to
 *      depict. This module moved its narrow-window rule from a media query to a
 *      container query, and a hand-copied stylesheet is exactly how that change
 *      silently fails to reach the evidence.
 *   2. Screenshots and geometry are re-measured in a real browser across the
 *      scales the preview promises (1/3/10/30 devices, duplicate names, a stale
 *      snapshot, and 1440/1024/640-wide windows), so "single column when the
 *      workbench is narrow" is observed rather than asserted.
 *
 * The browser is discovered, never hard-coded. When none is available the script
 * still refreshes the fixtures and says so, instead of writing numbers no
 * browser produced.
 */
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const out = resolve(repo, 'docs/ux/network-workbench-preview');
const cssPath = join(repo, 'ui/network/network-workbench.css');
const componentCss = (await readFile(cssPath, 'utf8')).replace(/\r\n/g, '\n').trimEnd();
// The first rule of the component stylesheet. Deliberately long: the fixture
// scaffolding also styles ".lm-networkWorkbench" (height/width 100%), so a short
// prefix would match the scaffold instead of the component and the whole rewrite
// would land in the wrong place.
const marker = '.lm-networkWorkbench{flex:1;min-width:0;min-height:0;overflow:auto;padding:24px;';
if (!componentCss.startsWith(marker)) throw new Error('network stylesheet must start with ' + marker);
const cssHash = createHash('sha1').update(componentCss).digest('hex');

const fixtures = ['one', 'three', 'three-stale', 'ten', 'ten-narrow', 'thirty'];
const expectedNodes = { one: 1, three: 3, 'three-stale': 3, ten: 10, 'ten-narrow': 10, thirty: 30 };

const refreshed = [];
const drifted = [];
for (const page of fixtures) {
  const file = join(out, page + '.html');
  const html = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const start = html.indexOf('<style>') + 7;
  const end = html.indexOf('</style>');
  if (start < 7 || end < 0) throw new Error(page + '.html: missing <style> block');
  const css = html.slice(start, end);
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(page + '.html: missing network component stylesheet');
  const previous = css.slice(at);
  // Whatever the fixture carried after the component rules (in practice a
  // trailing newline) is preserved, so refreshing an already-current fixture
  // stays a byte for byte no-op instead of reflowing the file on every run.
  const trailing = (previous.match(/\s*$/) || [''])[0];
  const next = html.slice(0, start) + css.slice(0, at) + componentCss + trailing + html.slice(end);
  if (previous.trimEnd() !== componentCss) drifted.push(page);
  if (next !== html) {
    await writeFile(file, next);
    refreshed.push(page);
  }
  // Re-read, so this checks what is on disk rather than what we meant to write:
  // the fixture cannot carry CSS the component does not have.
  const stored = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const storedCss = stored.slice(stored.indexOf('<style>') + 7, stored.indexOf('</style>'));
  if (!storedCss.includes(componentCss)) throw new Error(page + '.html: component stylesheet did not stick');
}
console.log('fixtures refreshed from ui/network/network-workbench.css (sha1 ' + cssHash + ', ' + componentCss.length + ' bytes)');
console.log(refreshed.length === 0
  ? 'all ' + fixtures.length + ' fixtures were already current; nothing rewritten'
  : 'rewrote ' + refreshed.length + '/' + fixtures.length + ' fixtures: ' + refreshed.join(', '));

const cases = [
  { name: 'one-1440-light', page: 'one', width: 1440, height: 900, theme: 'light' },
  { name: 'three-1440-light', page: 'three', width: 1440, height: 900, theme: 'light' },
  { name: 'three-640-light', page: 'three', width: 640, height: 768, theme: 'light' },
  { name: 'three-stale-1024-dark', page: 'three-stale', width: 1024, height: 768, theme: 'dark' },
  { name: 'ten-1440-light', page: 'ten', width: 1440, height: 900, theme: 'light' },
  { name: 'ten-1024-dark', page: 'ten', width: 1024, height: 768, theme: 'dark' },
  { name: 'ten-640-light', page: 'ten', width: 640, height: 768, theme: 'light' },
  { name: 'ten-narrow-1440-dark', page: 'ten-narrow', width: 1440, height: 900, theme: 'dark' },
  { name: 'thirty-1440-light', page: 'thirty', width: 1440, height: 900, theme: 'light' },
  { name: 'thirty-1024-light', page: 'thirty', width: 1024, height: 768, theme: 'light' },
  { name: 'thirty-640-light', page: 'thirty', width: 640, height: 768, theme: 'light' },
];

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = browsers.find((entry) => existsSync(entry));
const scriptName = relative(repo, fileURLToPath(import.meta.url)).split(sep).join('/');
if (!browser) {
  console.log('no Chromium browser found; screenshots left untouched');
  // No browser means no measurement. The fixtures are still refreshed above, but
  // nothing below may run, so rather than invent numbers the report reprints the
  // last set a real browser produced and says plainly that this run measured
  // nothing.
  const previous = JSON.parse(await readFile(join(out, 'preview-validation.json'), 'utf8'));
  await writeReport({
    measurements: previous.screenshots,
    errors: previous.runtimeErrors || [],
    caveat: '本机未找到 Chromium 浏览器：fixture 样式已按组件源刷新，但本次**没有做任何新测量**，截图与 preview-validation.json 均未刷新。下表是上一次真实浏览器（'
      + previous.browser + '，组件 CSS sha1 ' + previous.source.sha1 + '）留下的记录，仅作参考；装好浏览器后重跑即可获得本次证据。',
  });
  process.exit(0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = await mkdtemp(join(tmpdir(), 'lm-network-preview-'));
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
  let caseErrors = [];
  const waiters = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id) {
      const resolveWaiter = waiters.get(payload.id);
      if (resolveWaiter) {
        waiters.delete(payload.id);
        resolveWaiter(payload);
      }
      return;
    }
    // Page-side failures are evidence too: an exception here would make every
    // geometry number below describe a page that never finished loading.
    if (payload.method === 'Runtime.exceptionThrown') {
      const detail = payload.params && payload.params.exceptionDetails;
      const description = (detail && (detail.exception && detail.exception.description)) || (detail && detail.text) || 'unknown';
      caseErrors.push('exception: ' + String(description).split('\n')[0].slice(0, 200));
    } else if (payload.method === 'Runtime.consoleAPICalled' && payload.params && payload.params.type === 'error') {
      const args = payload.params.args || [];
      caseErrors.push('console.error: ' + args.map((arg) => arg.value !== undefined ? arg.value : (arg.description || '')).join(' ').slice(0, 200));
    } else if (payload.method === 'Log.entryAdded' && payload.params && payload.params.entry && payload.params.entry.level === 'error') {
      caseErrors.push('log: ' + String(payload.params.entry.text).slice(0, 200));
    }
  });
  const send = (method, params = {}) => new Promise((done) => {
    id += 1;
    waiters.set(id, done);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  const measure = [
    '(() => {',
    '  const pick = (selector) => document.querySelector(selector);',
    '  const style = (element) => element ? getComputedStyle(element) : null;',
    '  const box = (element) => element ? element.getBoundingClientRect() : null;',
    '  const tracks = (element) => {',
    '    const value = style(element) ? style(element).gridTemplateColumns : "";',
    '    if (!value || value === "none") return 0;',
    '    return value.split(" ").filter((entry) => entry.trim() !== "").length;',
    '  };',
    '  const root = pick(".lm-networkWorkbench");',
    '  const layout = pick(".lm-networkLayout");',
    '  const primary = pick(".lm-networkPrimary");',
    '  const detail = pick(".lm-networkDetail");',
    '  const topology = pick(".lm-networkTopology");',
    '  const list = pick(".lm-networkList");',
    '  const notice = pick(".lm-networkCompactNotice");',
    '  const nodes = [...document.querySelectorAll(".lm-networkNode")];',
    '  const rootBox = root ? box(root) : null;',
    '  const rects = nodes.map((node, index) => {',
    '    const rect = box(node);',
    '    const name = node.querySelector("strong");',
    '    const idText = node.querySelector(".lm-networkNodeId");',
    '    return {',
    '      index: index,',
    '      name: (name ? name.textContent : "").trim(),',
    '      id: (idText ? idText.textContent : "").trim(),',
    '      x: Math.round(rect.x),',
    '      y: Math.round(rect.y),',
    '      w: Math.round(rect.width),',
    '      h: Math.round(rect.height),',
    '      nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : false,',
    '      insideRoot: rootBox ? (rect.top >= rootBox.top - 1 && rect.bottom <= rootBox.bottom + 1) : false,',
    '    };',
    '  });',
    '  const collisions = [];',
    '  for (let i = 0; i < rects.length; i += 1) {',
    '    for (let j = i + 1; j < rects.length; j += 1) {',
    '      const a = rects[i];',
    '      const b = rects[j];',
    '      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);',
    '      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);',
    '      if (overlapX > 1 && overlapY > 1) collisions.push(a.id + " x " + b.id + " = " + overlapX + "x" + overlapY);',
    '    }',
    '  }',
    '  const names = rects.map((rect) => rect.name);',
    '  const duplicateNames = [...new Set(names.filter((name) => names.filter((other) => other === name).length > 1))];',
    '  const scrolling = document.scrollingElement;',
    '  return {',
    '    ready: document.readyState,',
    '    windowWidth: innerWidth,',
    '    windowHeight: innerHeight,',
    '    rootWidth: root ? Math.round(box(root).width) : 0,',
    '    rootHeight: root ? Math.round(box(root).height) : 0,',
    '    rootScrollWidth: root ? root.scrollWidth : 0,',
    '    rootClientWidth: root ? root.clientWidth : 0,',
    '    layoutDisplay: style(layout) ? style(layout).display : "",',
    '    layoutColumns: tracks(layout),',
    '    layoutTemplate: style(layout) ? style(layout).gridTemplateColumns : "",',
    '    primaryWidth: primary ? Math.round(box(primary).width) : 0,',
    '    detailWidth: detail ? Math.round(box(detail).width) : 0,',
    '    detailDisplay: style(detail) ? style(detail).display : "",',
    '    topologyDisplay: topology ? style(topology).display : "none",',
    '    topologyHeight: topology ? Math.round(box(topology).height) : 0,',
    '    topologyNodePosition: topology && nodes[0] ? style(nodes[0]).position : "",',
    '    edgesDisplay: style(pick(".lm-networkEdges")) ? style(pick(".lm-networkEdges")).display : "none",',
    '    spokes: document.querySelectorAll(".lm-networkSpoke").length,',
    '    listDisplay: list ? style(list).display : "none",',
    '    listColumns: tracks(list),',
    '    compactNotice: notice ? style(notice).display : "none",',
    '    summaryColumns: tracks(pick(".lm-networkSummary")),',
    '    staleVisible: Boolean(pick(".lm-networkStale")),',
    '    overflow: scrolling.scrollWidth > scrolling.clientWidth,',
    '    rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : false,',
    '    nodes: rects.length,',
    '    visibleNodes: rects.filter((rect) => rect.insideRoot).length,',
    '    clippedNodes: nodes.filter((node) => node.scrollHeight > node.clientHeight + 1).length,',
    '    clippedNames: rects.filter((rect) => rect.nameClipped).length,',
    '    duplicateNames: duplicateNames,',
    '    collisions: collisions,',
    '    rects: rects,',
    '    buttons: [...document.querySelectorAll(".lm-btn")].map((button) => ({',
    '      label: button.textContent.trim().slice(0, 24),',
    '      width: Math.round(box(button).width),',
    '      overflow: button.scrollWidth > button.clientWidth + 1,',
    '    })),',
    '  };',
    '})()',
  ].join('\n');

  const results = [];
  const errors = [];
  for (const item of cases) {
    caseErrors = [];
    await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: item.theme }] });
    const url = pathToFileURL(join(out, item.page + '.html')).href;
    await send('Page.navigate', { url });
    // The fixture is static; one shared sleep plus the readyState reported below
    // is enough, and every case gets the same treatment.
    await sleep(700);
    const measured = await send('Runtime.evaluate', { expression: measure, returnByValue: true });
    const value = measured.result && measured.result.result ? measured.result.result.value : null;
    if (!value) {
      errors.push(item.name + ': measurement failed');
      caseErrors.forEach((entry) => errors.push(item.name + ': ' + entry));
      console.log('FAILED to measure ' + item.name);
      continue;
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot.result || !shot.result.data) errors.push(item.name + ': screenshot failed');
    else {
      await mkdir(join(out, 'screenshots'), { recursive: true });
      await writeFile(join(out, 'screenshots', item.name + '.png'), Buffer.from(shot.result.data, 'base64'));
    }
    for (const entry of caseErrors) errors.push(item.name + ': ' + entry);

    // Expectations are derived from what was measured, not from a per-case wish
    // list: the breakpoint under test is the workbench width for the container
    // query and the viewport width for the media query.
    const narrow = value.rootWidth <= 650;
    const medium = !narrow && item.width <= 1100;
    const expectedColumns = narrow || medium ? 1 : 2;
    const hasTopology = value.topologyDisplay !== 'none';
    const expectedNotice = narrow && hasTopology ? 'block' : 'none';
    const checks = [
      { name: 'page-horizontal-overflow', ok: value.overflow === false, expected: 'false', actual: String(value.overflow) },
      { name: 'workbench-horizontal-overflow', ok: value.rootOverflow === false, expected: 'false', actual: String(value.rootOverflow) },
      { name: 'nodes-rendered', ok: value.nodes === expectedNodes[item.page], expected: String(expectedNodes[item.page]), actual: String(value.nodes) },
      { name: 'node-collisions', ok: value.collisions.length === 0, expected: '0', actual: String(value.collisions.length) },
      { name: 'layout-columns', ok: value.layoutColumns === expectedColumns, expected: String(expectedColumns), actual: String(value.layoutColumns) },
      { name: 'compact-notice', ok: value.compactNotice === expectedNotice, expected: expectedNotice, actual: value.compactNotice },
      { name: 'runtime-errors', ok: caseErrors.length === 0, expected: '0', actual: String(caseErrors.length) },
    ];
    if (hasTopology) {
      checks.push({
        name: 'topology-layout',
        ok: narrow
          ? (value.topologyDisplay === 'grid' && value.topologyNodePosition === 'static' && value.edgesDisplay === 'none')
          : (value.topologyNodePosition === 'absolute' && value.edgesDisplay !== 'none'),
        expected: narrow ? 'grid/static/edges-hidden' : 'absolute/edges-visible',
        actual: value.topologyDisplay + '/' + value.topologyNodePosition + '/edges-' + value.edgesDisplay,
      });
    }
    const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
    results.push({
      name: item.name,
      page: item.page + '.html',
      width: item.width,
      height: item.height,
      theme: item.theme,
      ...value,
      checks: checks,
      status: status,
    });
    console.log('captured ' + item.name + ' [' + status + '] w=' + value.windowWidth + ' root=' + value.rootWidth
      + ' columns=' + value.layoutColumns + ' overflow=' + value.overflow + '/' + value.rootOverflow
      + ' visible=' + value.visibleNodes + '/' + value.nodes + ' errors=' + caseErrors.length);
  }

  await writeFile(join(out, 'preview-validation.json'), JSON.stringify({
    screenshots: results,
    runtimeErrors: errors,
    source: { css: 'ui/network/network-workbench.css', sha1: cssHash, bytes: componentCss.length },
    fixtures: fixtures.map((page) => ({ page: page + '.html', rewritten: refreshed.includes(page), drifted: drifted.includes(page) })),
    browser: browser,
    generatedBy: scriptName,
  }, null, 2) + '\n');
  console.log('wrote preview-validation.json (' + results.length + ' cases, ' + errors.length + ' errors)');
  await writeReport({ measurements: results, errors: errors });
  console.log('wrote report.md');
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

async function writeReport({ measurements, errors, caveat }) {
  const bt = String.fromCharCode(96);
  const fence = bt + bt + bt;
  const code = (text) => bt + text + bt;
  const lines = [];
  lines.push('# 网络总览独立视觉取证');
  lines.push('');
  lines.push('直接渲染实际 NetworkWorkbench 组件（fakeReact/h 静态导出），所有节点与状态为明确模拟数据，不连接真实节点。组件 CSS 由 ' + code(scriptName) + ' 从 ' + code('ui/network/network-workbench.css') + ' **整体重写注入**（sha1 ' + code(cssHash) + '，' + componentCss.length + ' 字节），预览不可能停留在比组件更旧的样式上。宿主颜色变量为样例。');
  lines.push('');
  if (caveat) {
    lines.push('> ' + caveat);
    lines.push('');
  }
  if (measurements) {
    lines.push('## 测量结果');
    lines.push('');
    lines.push('| 用例 | 视口 | 主题 | 工作台宽 | 布局列 | 显示方式 | 横向溢出 | 可见节点 | 被裁剪节点 | runtimeErrors | 结论 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of measurements) {
      const mode = item.listDisplay !== 'none'
        ? '列表 ' + item.listColumns + ' 列'
        : '拓扑 ' + item.topologyDisplay + (item.topologyDisplay === 'grid' ? '（静态排布）' : '（' + item.topologyHeight + 'px 放射）');
      const runtime = item.checks.find((check) => check.name === 'runtime-errors');
      const failedChecks = item.checks.filter((check) => !check.ok).map((check) => check.name + '=' + check.actual);
      lines.push('| ' + [
        item.name,
        item.width + 'x' + item.height,
        item.theme,
        String(item.rootWidth),
        String(item.layoutColumns),
        mode,
        item.overflow || item.rootOverflow ? '有' : '无',
        String(item.visibleNodes) + '/' + String(item.nodes),
        String(item.clippedNodes) + (item.clippedNames ? '（名称截断 ' + item.clippedNames + '）' : ''),
        runtime ? runtime.actual : '?',
        item.status + (failedChecks.length ? '（' + failedChecks.join(', ') + '）' : ''),
      ].join(' | ') + ' |');
    }
    lines.push('');
    const passed = measurements.filter((item) => item.status === 'PASS');
    const failed = measurements.filter((item) => item.status === 'FAIL');
    lines.push('PASS ' + passed.length + ' / ' + measurements.length + (failed.length
      ? '；FAIL：' + failed.map((item) => item.name).join('、')
      : '；无 FAIL'));
    lines.push('');
    lines.push('“可见节点”是首屏内完整落在工作台视口里的节点数，小于总数表示节点在 ' + code('lm-networkWorkbench') + ' 的内部纵向滚动区内，滚一下即可见；“被裁剪节点”统计的是几何上被容器切掉、无法通过滚动看到的节点，这一类必须为 0。');
    lines.push('');
    lines.push('每个用例的断言：页面与工作台无横向溢出、节点数与 fixture 声明一致、节点卡片无两两矩形碰撞、布局列数符合预期（工作台宽 ≤650px 或视口 ≤1100px 为单列，否则两列）、' + code('compactNotice') + ' 仅在工作台容器查询生效时显示、拓扑模式下节点定位方式（宽屏 ' + code('absolute') + ' 放射 vs 窄容器 ' + code('grid') + ' 静态排布并隐藏连线）、浏览器侧 runtimeErrors 为 0。');
    lines.push('');
    const narrow = measurements.filter((item) => item.rootWidth <= 650);
    if (narrow.length) {
      lines.push('关键不变式：' + narrow.map((item) => code(item.name) + '（工作台 ' + item.rootWidth + 'px）').join('、') + ' 都落在 ' + code('@container lm-network (max-width:650px)') + ' 内：拓扑转静态网格、连线隐藏、' + code('compactNotice') + ' 显示。其中 ' + code('ten-narrow-1440-dark') + ' 的窗口是 1440px 而工作台外框 640px——窄窗证据来自容器宽度而不是媒体查询宽度，这正是上一批 inbox 取证踩过的坑（fixture 停在旧 @media，窄窗截图其实是双栏）。');
      lines.push('');
    }
    const duplicate = measurements.filter((item) => item.duplicateNames.length > 0);
    if (duplicate.length) {
      const names = [...new Set(duplicate.flatMap((item) => item.duplicateNames))];
      lines.push('重名用例：' + duplicate.map((item) => code(item.name)).join('、') + ' 都含重名节点 '
        + names.map((name) => '“' + name + '”').join('、')
        + '（' + String(duplicate.length) + ' 个用例覆盖同名节点）。重名节点各自保留独立 ID，节点卡片不合并、不碰撞，详情区按选中 ID 显示。');
      lines.push('');
    }
    const stale = measurements.filter((item) => item.staleVisible);
    if (stale.length) {
      lines.push('过期快照用例：' + stale.map((item) => code(item.name)).join('、') + ' 显示 ' + code('lm-networkStale') + ' 提示条，摘要三格改为“未核对”文案而不是实时计数。');
      lines.push('');
    }
    if (errors.length) {
      lines.push('浏览器侧错误：');
      lines.push('');
      for (const entry of errors) lines.push('- ' + entry);
      lines.push('');
    }
  }
  lines.push('## 未运行（NOT RUN）');
  lines.push('');
  lines.push('- 真实 DSH 宿主内的板块切换、滚动与真实主题变量：证据只渲染组件，不含 App 外壳。');
  lines.push('- 真实双机节点发现、失联与恢复：单机无法复现。' + code('stale') + ' 用例只证明过期快照的文案与排版，不证明失联检测本身。');
  lines.push('- 离线/offline 设备的专属视觉状态：组件当前没有该状态（DOM 与 CSS 中都没有对应类名），fixture 无法呈现，因此未构造。若组件后续补上，需要同步新增 fixture 并让本脚本纳入。');
  lines.push('- 键盘焦点顺序与读屏（NVDA/VoiceOver）验收：未运行。');
  lines.push('- 搜索输入后的过滤、拓扑/列表切换后的重绘：静态快照不含交互，未运行。');
  lines.push('');
  lines.push('截图是软件组件布局证据，不证明节点连接健康或授权能力。');
  lines.push('');
  lines.push('## 重新生成');
  lines.push('');
  lines.push(fence);
  lines.push('node scripts/network-workbench-preview.mjs');
  lines.push(fence);
  lines.push('');
  lines.push('脚本幂等：先把 6 个 fixture 的组件样式段按 ' + code('ui/network/network-workbench.css') + ' 重写（已是最新则不改文件），再用隔离的无头 Chromium（本机为 Edge，headless + CDP）在 1440/1024/640 三档窗口、深/浅色下实测 11 个用例，写出 ' + code('screenshots/*.png') + '、' + code('preview-validation.json') + ' 与本文。若本机找不到浏览器，脚本只刷新 fixture 并明确报告“未测量”，不会写入任何测量数字。');
  lines.push('');
  await writeFile(join(out, 'report.md'), lines.join('\n'));
}
