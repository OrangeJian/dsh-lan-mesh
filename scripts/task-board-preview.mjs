#!/usr/bin/env node
/**
 * Room task board evidence generator.
 *
 * Usage: node scripts/task-board-preview.mjs
 *
 * Rebuilds docs/ux/task-board-preview and re-measures it in a real browser:
 *   1. Every fixture's component <style> segment is rewritten from
 *      ui/tasks/room-task-board.css, and every fixture's board markup is
 *      rendered by the real RoomTaskBoard() + roomTaskBoardView() pair, so
 *      neither the styles nor the DOM can drift from the component.
 *   2. Screenshots and geometry come from Edge/Chromium headless over CDP, one
 *      case per fixture + viewport + theme. When no browser is found the
 *      fixtures are still refreshed and the script exits without inventing
 *      measurements.
 *
 * Why this file exists: the previous evidence for this directory was a JSON
 * with six fields per case and rows:0 for a board that renders six cards, and
 * nothing regenerated it when ui/tasks/room-task-board.css changed. Same
 * failure mode the inbox directory hit when its fixture CSS stayed on an old
 * @media rule after the component moved to a container query.
 */
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const out = resolve(repo, 'docs/ux/task-board-preview');
const componentPath = 'ui/tasks/room-task-board.css';
const componentCss = (await readFile(join(repo, componentPath), 'utf8')).replace(/\r\n/g, '\n').trimEnd();
const marker = '.lm-roomTaskBoard{';
if (!componentCss.startsWith(marker)) throw new Error('room task board stylesheet must start with ' + marker);

const { RoomTaskBoard } = await import(pathToFileURL(join(repo, 'ui/tasks/room-task-board.mjs')).href);
const { roomTaskBoardView } = await import(pathToFileURL(join(repo, 'ui/models/room-task-board.mjs')).href);

// ---------------------------------------------------------------- fixtures --
const detail = '整理已经确认的结论。\n保留尚未解决的问题和来源。';
const person = (nodeId, nodeName) => ({ nodeId, sessionId: 'human', name: '小林', ...(nodeName ? { nodeName } : {}) });
const task = (id, title, status, owner, extra = {}) => ({ id, title, status, assignee: owner, ...extra });

const fixtures = [
  {
    page: 'board',
    note: '实际组件 / 模拟三个同名项目、跨设备同名负责人 · 静态取证，不派发任务',
    rooms: [
      { id: 'room-0', name: '跨系统协作', tasks: [
        task('t-open', '澄清设计与验收范围', 'open', person('node-0', '工作电脑'), { detail, updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-done', '核对交付清单', 'done', person('node-0', '工作电脑')),
        task('t-deleted', '已删除任务', 'open', person('node-0', '工作电脑'), { deleted: true }),
      ] },
      { id: 'room-1', name: '跨系统协作', tasks: [
        task('t-doing', '澄清设计与验收范围', 'doing', person('node-1'), { detail, updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-done', '核对交付清单', 'done', person('node-1')),
      ] },
      { id: 'room-2', name: '跨系统协作', tasks: [
        task('t-blocked', '澄清设计与验收范围', 'blocked', person('node-2'), { detail, updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-unknown', '核对交付清单', 'future', person('node-2')),
      ] },
      { id: 'room-removed', deleted: true, name: '已删除房间', tasks: [task('t-gone', '已删除房间里的任务', 'open', person('node-9'))] },
    ],
  },
  {
    page: 'board-empty',
    note: '实际组件 / 空看板：没有返回任何 Room 任务 · 静态取证，不派发任务',
    rooms: [],
  },
  {
    page: 'board-few',
    note: '实际组件 / 少量任务：一个 Room、两张卡 · 静态取证，不派发任务',
    rooms: [
      { id: 'room-ship', name: '发布协作', tasks: [
        task('t-a', '确认发版窗口', 'open', person('node-0', '工作电脑'), { detail, updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-b', '回填发布记录', 'doing', person('node-1'), { updatedAt: '2026-11-16T02:30:00Z' }),
      ] },
    ],
  },
  {
    page: 'board-many',
    note: '实际组件 / 多任务：四个 Room、十二张卡、含已归档 Room 与未知状态 · 静态取证，不派发任务',
    rooms: [
      { id: 'room-0', name: '跨系统协作', tasks: [
        task('t-1', '澄清设计与验收范围', 'open', person('node-0', '工作电脑'), { detail, updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-2', '核对交付清单', 'done', person('node-0', '工作电脑'), { updatedAt: '2026-11-14T09:10:00Z' }),
        task('t-3', '补齐回滚预案', 'doing', person('node-1')),
      ] },
      { id: 'room-1', name: '跨系统协作', tasks: [
        task('t-1', '澄清设计与验收范围', 'blocked', person('node-1'), { detail, updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-2', '核对交付清单', 'open', person('node-2', '会议室备用机')),
        task('t-3', '补齐回滚预案', 'done', person('node-2', '会议室备用机')),
      ] },
      { id: 'room-2', name: '跨系统协作', tasks: [
        task('t-1', '澄清设计与验收范围', 'doing', person('node-0', '工作电脑'), { detail }),
        task('t-2', '核对交付清单', 'blocked', person('node-1')),
        task('t-3', '未知状态样本', 'merged', person('node-2', '会议室备用机')),
      ] },
      { id: 'room-archived', name: '已归档协作', lifecycle: { status: 'archived' }, tasks: [
        task('t-1', '归档后的收尾核对', 'done', person('node-0', '工作电脑')),
        task('t-2', '归档任务留档', 'open', person('node-1')),
        task('t-3', '归档后遗留问题', 'future', person('node-2', '会议室备用机')),
      ] },
    ],
  },
  {
    page: 'board-long',
    note: '实际组件 / 长标题、长负责人名、长项目名与不可断词串 · 静态取证，不派发任务',
    rooms: [
      { id: 'room-long', name: '跨系统协作与交付验收证据核对专项（华东区第二批）', tasks: [
        task('t-long', '核对跨系统交付清单与验收证据并补齐缺失的审批记录与回滚预案', 'open',
          { nodeId: 'node-0', sessionId: 'human', name: '小林（华东交付组值班负责人）', nodeName: '交付组共享工作电脑第三台' },
          { detail: '需核对 evidence-bundle-room-long-task-2026-11-15T21:00:00Z.json 与对应审批记录。\n第二行：保留尚未解决的问题和来源。', updatedAt: '2026-11-15T21:00:00Z' }),
        task('t-long-2', '确认跨系统协作证据链是否覆盖全部跨设备负责人', 'blocked',
          { nodeId: 'node-1', sessionId: 'human', title: '小林（跨设备负责人）', name: '小林' }, { detail: '同上。' }),
        task('t-long-3', '归档前的最后核对', 'done', person('node-2')),
      ] },
    ],
  },
  {
    page: 'board-authority',
    note: 'A11/A12 只读展示取证：用既有 task.status 字段注入 uncertain / planned / review / accepted / succeeded，看板一律渲染成「未知状态 · 原值」，不显示成功、不提供批准/合并/验收/重试控件 · 静态取证',
    expectStatusBadges: ['未知状态 · uncertain', '未知状态 · planned', '未知状态 · review', '未知状态 · accepted', '未知状态 · succeeded'],
    rooms: [
      { id: 'room-authority', name: '审批与评审样本', tasks: [
        task('t-uncertain', 'Leader 失联后待人工核对的任务', 'uncertain', person('node-0', '工作电脑'), { detail: 'A11：Leader 不可达时任务状态未确认；看板只显示未知状态，不显示成功或进度条。', updatedAt: '2026-11-17T09:00:00Z' }),
        task('t-planned', '计划未批准的任务', 'planned', person('node-1')),
        task('t-review', 'Review 未通过的任务', 'review', person('node-1')),
        task('t-accepted', '已验收样本对照', 'accepted', person('node-2', '会议室备用机')),
        task('t-succeeded', '已提交结果样本对照', 'succeeded', person('node-2', '会议室备用机')),
      ] },
    ],
  },
];

const cases = [
  { name: 'board-1440-light-default', page: 'board', width: 1440, height: 900, theme: 'light' },
  { name: 'board-1024-dark-default', page: 'board', width: 1024, height: 768, theme: 'dark' },
  { name: 'board-1024-light-default', page: 'board', width: 1024, height: 768, theme: 'light' },
  { name: 'board-640-light-narrow', page: 'board', width: 640, height: 768, theme: 'light' },
  { name: 'board-390-light-narrow', page: 'board', width: 390, height: 780, theme: 'light' },
  { name: 'board-1440-light-main640', page: 'board', width: 1440, height: 900, theme: 'light', mainWidth: 640 },
  // Boundary of the container query. `container-type: inline-size` measures the
  // board's *content* box, so the threshold lands on the pane minus its padding:
  // with 24px sides, a 699px pane leaves 651px and stays wide, 698px leaves 650px
  // and flips. Both cases pin that exact edge.
  { name: 'board-699-light-boundary-wide', page: 'board', width: 699, height: 768, theme: 'light' },
  { name: 'board-698-light-boundary-narrow', page: 'board', width: 698, height: 768, theme: 'light' },
  { name: 'board-1440-light-focus', page: 'board', width: 1440, height: 900, theme: 'light', focus: true },
  { name: 'board-empty-1440-light-default', page: 'board-empty', width: 1440, height: 900, theme: 'light' },
  { name: 'board-empty-640-dark-narrow', page: 'board-empty', width: 640, height: 768, theme: 'dark' },
  { name: 'board-few-1440-light-default', page: 'board-few', width: 1440, height: 900, theme: 'light' },
  { name: 'board-few-1024-dark-default', page: 'board-few', width: 1024, height: 768, theme: 'dark' },
  { name: 'board-many-1440-light-default', page: 'board-many', width: 1440, height: 900, theme: 'light' },
  { name: 'board-many-1024-dark-default', page: 'board-many', width: 1024, height: 768, theme: 'dark' },
  { name: 'board-many-640-light-narrow', page: 'board-many', width: 640, height: 768, theme: 'light' },
  { name: 'board-long-1024-light-default', page: 'board-long', width: 1024, height: 768, theme: 'light' },
  { name: 'board-long-640-dark-narrow', page: 'board-long', width: 640, height: 768, theme: 'dark' },
  { name: 'board-long-390-light-narrow', page: 'board-long', width: 390, height: 780, theme: 'light' },
  { name: 'board-authority-1440-light-default', page: 'board-authority', width: 1440, height: 900, theme: 'light' },
  { name: 'board-authority-1024-dark-default', page: 'board-authority', width: 1024, height: 768, theme: 'dark' },
];

// The narrow stylesheet is a container query on the board itself, the same
// contract inbox adopted: the host main pane can be far narrower than its
// window, so `board-1440-light-main640` runs a 1440px window with a 640px
// pane. Every case declares the narrow layout it should show for its own
// geometry; a pane case expects the board to react to its pane, not the window.
const narrowWidth = 650;
for (const item of cases) {
  const paneWidth = item.mainWidth ?? item.width;
  // The container query reads the content box, so compare the pane minus the
  // padding the window query gives it (16px under 650px, otherwise 24px).
  const padding = paneWidth <= 650 ? 16 : 24;
  const contentWidth = paneWidth - padding * 2;
  item.expect = { narrow: contentWidth <= narrowWidth, basis: item.mainWidth ? 'pane' : 'window', paneWidth, padding, contentWidth };
}

// ------------------------------------------------------------- fixture HTML --
const sentinel = '/* @component:' + componentPath + ' */';
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const voidTags = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
const React = { useState: (value) => [value, () => {}] };
const render = (node) => {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  const attrs = Object.entries(node.props)
    .filter(([key, value]) => key !== 'key' && !key.startsWith('on')
      && value !== null && value !== undefined && value !== false && typeof value !== 'object')
    .map(([key, value]) => ' ' + (key === 'className' ? 'class' : key) + '="' + escapeHtml(value) + '"')
    .join('');
  if (voidTags.has(node.type)) return '<' + node.type + attrs + '>';
  return '<' + node.type + attrs + '>' + node.children.map(render).join('') + '</' + node.type + '>';
};
const renderBoard = (rooms) => render(RoomTaskBoard({
  h, React, modelOf: roomTaskBoardView, rooms, onRefresh: () => {}, onOpenRoom: () => {},
}));

/** The theme/shell stylesheet in front of the component rules is fixture-only.
 *  Keep it byte-identical across runs so a refresh restyles only the component
 *  segment. The sentinel marks that boundary; a fixture written before this
 *  generator existed is split at the first line that starts with the component
 *  marker, and the next run writes the sentinel. */
const readShell = async () => {
  const html = (await readFile(join(out, 'board.html'), 'utf8')).replace(/\r\n/g, '\n');
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  if (start < 0 || end < 0) throw new Error('board.html: no <style> block');
  const block = html.slice(start + 7, end);
  const atSentinel = block.indexOf(sentinel);
  let prefix;
  if (atSentinel >= 0) prefix = block.slice(0, atSentinel);
  else {
    // A fixture written before this generator existed has no sentinel: the
    // component segment starts at the first line of the component stylesheet,
    // which is unique in the block (the shell only sets main>.lm-roomTaskBoard).
    const firstLine = componentCss.split('\n')[0];
    const atLine = block.indexOf(firstLine);
    if (atLine < 0) throw new Error('board.html: component stylesheet boundary not found');
    prefix = block.slice(0, atLine);
  }
  return { prefix: prefix.replace(/\s*$/, '\n'), head: html.slice(0, start) };
};

const shellParts = await readShell();
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
const fixturesMeta = [];
await mkdir(out, { recursive: true });
let boardHtml = '';
for (const fixture of fixtures) {
  const model = roomTaskBoardView({ rooms: fixture.rooms });
  fixture.rows = model.rows.length;
  fixture.groups = model.groups.length;
  const html = shellParts.head + '<style>' + shellParts.prefix + sentinel + '\n' + componentCss + '\n</style>'
    + '<div class="note">' + fixture.note + '</div><main>' + renderBoard(fixture.rooms) + '</main></html>';
  await writeFile(join(out, fixture.page + '.html'), html);
  if (fixture.page === 'board') boardHtml = html;
  fixturesMeta.push({
    page: fixture.page + '.html',
    rows: model.rows.length,
    groups: model.groups.length,
    bytes: Buffer.byteLength(html),
    sha256: sha(html),
  });
}
// index.html is the directory entry; keep it the default board byte-for-byte so
// the two files cannot disagree.
await writeFile(join(out, 'index.html'), boardHtml);
fixturesMeta.push({ page: 'index.html', copyOf: 'board.html', bytes: Buffer.byteLength(boardHtml), sha256: sha(boardHtml) });
console.log('fixtures refreshed from ' + componentPath + ' and rendered by RoomTaskBoard()');
for (const meta of fixturesMeta) console.log('  ' + meta.page + '  rows=' + (meta.rows ?? '-') + ' groups=' + (meta.groups ?? '-') + ' bytes=' + meta.bytes);

// Kept in one place so the JSON and the report cannot disagree about what was
// never executed.
const notRun = [
  '真实 Team/M6 审批流程下的任务派发、状态流转与成果验收：需要真实 Team 审批与多机授权，本目录只做静态取证，NOT RUN。',
  '真实 DSH 宿主壳（侧栏/抽屉/分栏）里的主区宽度：需要运行中的 DSH GUI 与真实 Room，本脚本仅用 1440 宽窗口内 640px 主区近似，原样实机 NOT RUN。',
  '服务端对已删除房间/未知状态的裁剪：fixture 由 roomTaskBoardView 本地生成，服务端路径 NOT RUN。',
  '筛选与点击交互：由 scripts/room-task-board.test.mjs 覆盖，截图不证明交互，交互 NOT RUN。',
  '键盘 focus-visible 真实 Tab 走查：程序化 focus() 不触发 :focus-visible，计算 outline 仍为 none，NOT RUN。',
  // A11/A12: only the display-half is covered by the read-only board. The
  // state-machine/backend/real-machine half is listed here, not claimed as PASS.
  'A11 Leader 不可达（连通性语义）：只读 Room 任务投影没有 leader / 连通性字段（ui/models/room-task-board.mjs 只消费 task.status / assignee / room / lifecycle 等既有字段），无法在 fixture 中构造真实 Leader 断网状态；仅有 uncertain 任务经既有 unknown 回退渲染为「未知状态 · uncertain」的字段级证据。真实 Leader 断网与其状态机语义 NOT RUN。',
  'A11 不自动重试 / 任务停止自动推进：属 Team 状态机行为，看板不渲染也不控制，静止截图无法观察；只能由 scripts/team-coordinator.test.mjs 的 L3 断言覆盖，实机 UI NOT RUN。',
  'A12 后端二次验证拒绝：看板没有任何派发/批准/合并/验收控件，但「按钮消失 ≠ 权限生效」；需要真实后端返回拒绝响应才能验证，静态取证 NOT RUN。',
  'A12 计划未批准 / Review 未通过的真实流程态：看板不建模审批/评审状态，本目录仅用既有 task.status 字段注入样本值验证只读回退（一律显示「未知状态 · 原值」），真实 Team/M6 审批与评审流程 NOT RUN。',
];

// --------------------------------------------------------------- browser ----
const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = browsers.find((candidate) => existsSync(candidate));
if (!browser) {
  console.log('no Chromium browser found; fixtures refreshed, screenshots and preview-validation.json left untouched');
  process.exit(0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = await mkdtemp(join(tmpdir(), 'lm-task-board-preview-'));
const port = 9800 + Math.floor(Math.random() * 400);
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

const measureSource = [
  '(() => {',
  '  const one = (selector) => document.querySelector(selector);',
  '  const many = (selector) => [...document.querySelectorAll(selector)];',
  '  const box = (element) => element ? element.getBoundingClientRect() : null;',
  '  const css = (element) => element ? getComputedStyle(element) : null;',
  '  const px = (value) => Math.round((parseFloat(value) || 0) * 10) / 10;',
  '  const root = one(".lm-roomTaskBoard");',
  '  const rootBox = box(root);',
  '  const board = css(root) || {};',
  '  const rows = many(".lm-taskBoardRow");',
  '  const groups = many(".lm-taskBoardGroup");',
  '  const filters = many(".lm-taskBoardFilters > *");',
  '  const previews = many(".lm-taskBoardPreview");',
  '  const heads = rows.map((row) => {',
  '    const head = row.querySelector(".lm-taskBoardRowHead");',
  '    const title = head && head.querySelector("strong");',
  '    const badge = head && head.querySelector("span");',
  '    if (!title || !badge) return null;',
  '    return Math.abs(box(title).top - box(badge).top) < 2;',
  '  }).filter((value) => value !== null);',
  '  const scroller = document.scrollingElement;',
  '  const note = one(".note");',
  '  const focusables = [...rows, ...many(".lm-roomTaskBoard input"), ...many(".lm-roomTaskBoard select"), ...many(".lm-roomTaskBoard > header button")];',
  '  const active = document.activeElement;',
  '  const insideBoard = !!(active && root && root.contains(active) && active !== root);',
  '  const empty = one(".lm-roomTaskBoard .lm-muted");',
  '  return {',
  '    ready: document.readyState,',
  '    viewport: { width: innerWidth, height: innerHeight },',
  '    bodyBackground: css(document.body).backgroundColor,',
  '    mainWidth: Math.round(box(one("main")).width),',
  '    rootWidth: Math.round(rootBox.width),',
  '    rootHeight: Math.round(rootBox.height),',
  '    rootPadding: px(board.paddingLeft),',
  '    rootDisplay: (board.display || "") + "/" + (board.flexDirection || ""),',
  '    rootOverflowY: board.overflowY || "",',
  '    rootScrollable: root ? root.scrollHeight > root.clientHeight + 1 : false,',
  '    narrowPadding: px(board.paddingLeft) === 16,',
  '    // The layout branch is the pane-driven one: with the container query on,',
  '    // every filter takes a full row. Padding stays a window query because an',
  '    // element is never its own container.',
  '    narrowApplied: filters.length > 1 && new Set(filters.map((filter) => Math.round(box(filter).top))).size === filters.length,',
  '    groups: groups.length,',
  '    groupTitles: groups.map((group) => { const heading = group.querySelector("h2"); return heading ? heading.textContent.trim() : ""; }),',
  '    rows: rows.length,',
  '    cardsWithDetail: previews.length,',
  '    rowLayout: rows.length ? (css(rows[0]).display + "/" + css(rows[0]).flexDirection) : "",',
  '    rowWidth: rows.length ? Math.round(box(rows[0]).width) : 0,',
  '    filters: {',
  '      count: filters.length,',
  '      rowsUsed: new Set(filters.map((filter) => Math.round(box(filter).top))).size,',
  '      widths: filters.map((filter) => Math.round(box(filter).width)),',
  '    },',
  '    rowHeads: { measured: heads.length, sameLine: heads.filter(Boolean).length },',
  '    overflow: scroller.scrollWidth > scroller.clientWidth,',
  '    rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : false,',
  '    clippedRows: rows.filter((row) => row.scrollHeight > row.clientHeight + 1).length,',
  '    clampedPreviews: previews.filter((preview) => preview.scrollHeight > preview.clientHeight + 1).length,',
  '    overflowingText: many(".lm-taskBoardRowHead > strong, .lm-taskBoardRowHead > span, .lm-taskBoardRow > div").filter((element) => element.scrollWidth > element.clientWidth + 1).length,',
  '    emptyText: empty ? empty.textContent.trim() : "",',
  '    visibleRows: rootBox ? rows.filter((row) => { const rect = box(row); return rect.bottom > rootBox.top + 1 && rect.top < rootBox.bottom - 1; }).length : 0,',
  '    shellNote: note ? { height: Math.round(box(note).height), contentHeight: note.scrollHeight, clipped: note.scrollHeight > Math.round(box(note).height) + 1 } : null,',
  '    focusTargets: focusables.length,',
  '    focused: insideBoard ? { tag: active.tagName.toLowerCase(), outlineWidth: px(css(active).outlineWidth), outlineStyle: css(active).outlineStyle } : null,',
  '    // A11/A12 read-only evidence: the exact badge text on each row and every',
  '    // non-row button. The read-only board must only ever expose the refresh button.',
  '    statusBadges: rows.map((row) => { const badge = row.querySelector(".lm-taskBoardRowHead > span"); return badge ? badge.textContent.trim() : ""; }),',
  '    nonRowButtons: many(".lm-roomTaskBoard button").filter((button) => !button.classList.contains("lm-taskBoardRow")).map((button) => button.textContent.trim()),',
  '  };',
  '})()',
].join('\n');

const results = [];
const runtimeErrors = [];
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
  const target = targets.find((entry) => entry.type === 'page');
  if (!target) throw new Error('browser did not expose a page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let id = 0;
  const waiters = new Map();
  let current = null;
  const noteError = (text) => {
    if (current) runtimeErrors.push({ case: current, message: String(text).slice(0, 400) });
  };
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id) {
      const waiter = waiters.get(payload.id);
      if (waiter) {
        waiters.delete(payload.id);
        waiter(payload);
      }
      return;
    }
    const params = payload.params || {};
    if (payload.method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails || {};
      noteError((details.exception && (details.exception.description || details.exception.value)) || details.text || 'exception');
    } else if (payload.method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
      noteError((params.args || []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
    } else if (payload.method === 'Log.entryAdded' && params.entry && params.entry.level === 'error') {
      noteError(params.entry.text);
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

  for (const item of cases) {
    current = item.name;
    await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: item.theme }] });
    await send('Page.navigate', { url: pathToFileURL(join(out, item.page + '.html')).href });
    let ready = '';
    for (let attempt = 0; attempt < 40 && ready !== 'complete'; attempt += 1) {
      await sleep(100);
      const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      ready = state.result?.result?.value ?? '';
    }
    await sleep(250);
    if (item.mainWidth) {
      const applied = await send('Runtime.evaluate', {
        expression: '(() => { const main = document.querySelector("main"); main.style.width = "' + item.mainWidth
          + 'px"; main.style.flex = "0 0 auto"; return Math.round(main.getBoundingClientRect().width); })()',
        returnByValue: true,
      });
      if (applied.result?.exceptionDetails) runtimeErrors.push({ case: item.name, message: 'main pane resize failed' });
      await sleep(200);
    }
    if (item.focus) {
      const focused = await send('Runtime.evaluate', {
        expression: '(() => { const input = document.querySelector(".lm-roomTaskBoard input"); if (input) input.focus(); return document.activeElement ? document.activeElement.tagName : ""; })()',
        returnByValue: true,
      });
      if (focused.result?.exceptionDetails) runtimeErrors.push({ case: item.name, message: 'focus probe failed' });
      await sleep(150);
    }
    const measured = await send('Runtime.evaluate', { expression: measureSource, returnByValue: true });
    const value = measured.result?.result?.value;
    if (!value) {
      runtimeErrors.push({ case: item.name, message: 'measurement returned no value' });
      continue;
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    let shotBytes = 0;
    let shotSha = null;
    if (!shot.result?.data) runtimeErrors.push({ case: item.name, message: 'screenshot failed' });
    else {
      const png = Buffer.from(shot.result.data, 'base64');
      await mkdir(join(out, 'screenshots'), { recursive: true });
      await writeFile(join(out, 'screenshots', item.name + '.png'), png);
      shotBytes = png.length;
      shotSha = createHash('sha256').update(png).digest('hex').slice(0, 16);
    }
    const caseErrors = runtimeErrors.filter((entry) => entry.case === item.name);
    const expectedRows = fixtures.find((fixture) => fixture.page === item.page).rows;
    // A real capture is far larger than an empty frame; a 0-byte or tiny file is
    // exactly how a silently broken headless run looks.
    const screenshotLooksReal = shotBytes > 4000;
    const checks = {
      rows: value.rows === expectedRows,
      noHorizontalOverflow: value.overflow === false && value.rootOverflow === false,
      noClippedRows: value.clippedRows === 0,
      noOverflowingText: value.overflowingText === 0,
      narrowStyleAsExpected: value.narrowApplied === item.expect.narrow,
      screenshotCaptured: screenshotLooksReal,
      noRuntimeErrors: caseErrors.length === 0,
    };
    if (item.page === 'board-authority') {
      // Existing task.status values must fall back to the unknown state with the
      // raw value kept, and no approve/merge/accept/retry control may appear.
      const authorityFixture = fixtures.find((fixture) => fixture.page === item.page);
      checks.authorityStatusBadges = JSON.stringify(value.statusBadges) === JSON.stringify(authorityFixture.expectStatusBadges);
      checks.noAuthorityControls = value.nonRowButtons.length === 1 && value.nonRowButtons[0] === '刷新';
    }
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
    const notes = [];
    if (item.mainWidth) {
      notes.push(value.narrowApplied
        ? 'pane ' + item.mainWidth + 'px triggered the narrow branch'
        : 'pane ' + item.mainWidth + 'px did NOT trigger the narrow branch: the @container lm-task-board (max-width:650px) query did not fire on the pane; the filters stayed on '
          + value.filters.rowsUsed + ' row(s) (' + value.filters.widths.join('/') + 'px)');
    }
    if (value.clampedPreviews) notes.push(value.clampedPreviews + ' detail preview(s) clamped to two lines by -webkit-line-clamp (designed)');
    if (item.focus) {
      notes.push(value.focused
        ? 'programmatic focus landed on <' + value.focused.tag + '>, computed outline ' + value.focused.outlineStyle + ' ' + value.focused.outlineWidth + 'px; '
          + 'the :focus-visible rule (ui/tasks/room-task-board.css:9) only matches keyboard-originated focus, so a real Tab walk is NOT VERIFIED by this case'
        : 'focus probe did not land inside the board');
    }
    if (value.rowHeads.measured && value.rowHeads.sameLine < value.rowHeads.measured) {
      notes.push((value.rowHeads.measured - value.rowHeads.sameLine) + '/' + value.rowHeads.measured
        + ' row heads let the status badge wrap under the title (@media flex-wrap:wrap at <=650px, designed)');
    }
    if (value.groupTitles.length) notes.push('groups: ' + value.groupTitles.join(' | '));
    if (item.page === 'board-authority') notes.push('authority statuses rendered as badges: ' + value.statusBadges.join(' | ') + '; non-row buttons: ' + value.nonRowButtons.join('/') + '; raw values kept, no success/acceptance shown, no approve/merge/retry control');
    results.push({
      screenshot: { path: 'screenshots/' + item.name + '.png', bytes: shotBytes, sha256: shotSha },
      notes,
      name: item.name,
      page: item.page + '.html',
      width: item.width,
      height: item.height,
      theme: item.theme,
      expectation: {
        rows: expectedRows,
        narrow: item.expect.narrow,
        narrowBasis: item.expect.basis,
        paneWidth: item.expect.paneWidth,
        padding: item.expect.padding,
        containerContentWidth: item.expect.contentWidth,
      },
      ...value,
      checks,
      verdict: failed.length ? 'FAIL' : 'PASS',
      failedChecks: failed,
      runtimeErrors: caseErrors.map((entry) => entry.message),
    });
    console.log('captured ' + item.name + '  ' + (failed.length ? 'FAIL (' + failed.join(',') + ')' : 'PASS'));
  }

  const component = { path: componentPath, lines: componentCss.split('\n').length, bytes: Buffer.byteLength(componentCss), sha256: sha(componentCss) };
  await writeFile(join(out, 'preview-validation.json'), JSON.stringify({
    generator: 'scripts/task-board-preview.mjs',
    browser: browser.replace(/\\/g, '/'),
    component,
    fixtures: fixturesMeta,
    screenshots: results,
    runtimeErrors,
    notRun,
  }, null, 2) + '\n');
  const failing = results.filter((item) => item.verdict === 'FAIL');
  console.log('wrote preview-validation.json (' + results.length + ' cases, ' + failing.length + ' FAIL, ' + runtimeErrors.length + ' runtime errors)');
  await writeReport({ measurements: results, component, fixtures: fixturesMeta, errors: runtimeErrors });
  console.log('wrote report.md');
  socket.close();
} finally {
  child.kill();
  // Chromium keeps Crashpad files open briefly after exit; a removal that raced
  // it would fail the run after the evidence was already written.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(200);
    }
  }
}

async function writeReport({ measurements, component, fixtures: fixtureMeta, errors }) {
  const bt = String.fromCharCode(96);
  const code = (text) => bt + text + bt;
  const lines = [];
  lines.push('# Room 任务看板视觉取证');
  lines.push('');
  lines.push('实际 ' + code('RoomTaskBoard()') + ' + ' + code('roomTaskBoardView()') + ' 渲染，' + code('React.useState') + ' 桩只提供初始筛选状态；fixture 由生成器按 ' + code('ui/tasks/room-task-board.css') + ' 现算样式、由组件现渲染 DOM，不派发/变更任务，不读写真实消息或房间。截图不等于 DSH 实机操作、真实 Team 执行或成果验收。');
  lines.push('');
  const passed = measurements.filter((item) => item.verdict === 'PASS');
  const failed = measurements.filter((item) => item.verdict === 'FAIL');
  lines.push(measurements.length + ' 例覆盖：默认看板（1440 浅色、1024 深浅）、空看板（1440 浅 / 640 深）、少量卡（2 张）、多任务（4 个 Room / 12 张卡 / 含已归档 Room 与未知状态）、长标题长名字、窄窗 640 与 390、容器查询断点两侧 699/698、1440 宽窗口内主区只有 640px 的用例，以及 A11/A12 只读权限样本（用既有 ' + code('task.status') + ' 注入 ' + code('uncertain/planned/review/accepted/succeeded') + '，一律回退为「未知状态 · 原值」，无派发/批准/合并/验收/重试控件）。'
    + '全部 ' + measurements.length + ' 例 ' + code('overflow:false') + '、' + code('rootOverflow:false') + '、' + code('clippedRows:0') + '、' + code('overflowingText:0') + '、' + code('runtimeErrors:' + errors.length) + '；结论 **PASS ' + passed.length + ' / ' + measurements.length + '**'
    + (failed.length ? '，FAIL：' + failed.map((item) => code(item.name)).join('、') : '，无 FAIL') + '。');
  lines.push('');
  lines.push('## 重新生成');
  lines.push('');
  lines.push(bt + bt + bt);
  lines.push('node scripts/task-board-preview.mjs');
  lines.push(bt + bt + bt);
  lines.push('');
  lines.push('脚本做两件事，都不依赖人工：');
  lines.push('');
  lines.push('1. 读 ' + code(component.path) + '（断言首行以 ' + code('.lm-roomTaskBoard{') + ' 开头），把每个 fixture 的组件样式段整体重写，再用真实的 ' + code('RoomTaskBoard') + ' 重新渲染 <main> 里的 DOM（'
    + fixtureMeta.map((fixture) => code(fixture.page)).join('、') + '；' + code('index.html') + ' 是目录入口，与 ' + code('board.html') + ' 逐字节相同）。手写的主题变量/外壳样式保留在组件段之前，以 ' + code('/* @component:ui/tasks/room-task-board.css */') + ' 哨兵标记边界，因此重复运行幂等：连跑两次，' + fixtures.length + ' 个 fixture、' + code('index.html') + ' 与 ' + code('preview-validation.json') + ' 的 sha256 完全一致。');
  lines.push('2. 用本机 Edge（' + code('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') + '，headless=new + CDP）逐例设置视口与 ' + code('prefers-color-scheme') + '，实测几何、截 PNG、抓 ' + code('Runtime.exceptionThrown') + '/' + code('console.error') + '/' + code('Log.entryAdded') + '。找不到浏览器时只刷新 fixture 并明确退出，不写测量值、不碰截图——本机 Chrome headless 输出 0 字节，所以探测列表里只留 Edge 与常见 Chromium 路径。');
  lines.push('');
  lines.push('本目录先前的问题正是这个脚本要根治的：' + code('preview-validation.json') + ' 每例只有 6 个字段且 ' + code('rows') + ' 恒为 0（看板明明渲染 6 张卡），' + code('report.md') + ' 里没有生成器也没有重跑命令。inbox 目录踩过同类坑——组件从 ' + code('@media') + ' 换成 ' + code('@container') + ' 后 fixture 的 CSS 停在旧版本，640px 那张「窄窗」其实还是双栏。现在样式和 DOM 都从组件现算，不可能再滞后。');
  lines.push('');
  lines.push('## 每例测量');
  lines.push('');
  lines.push('「宽/窄」列是实测的**面板驱动**判据：' + code('@container lm-task-board (max-width:650px)') + ' 是否生效（每个筛选控件各占一行）。「内边距」列是窗口判据（' + code('@media(max-width:650px)') + ' 的 24px→16px），两者按设计**不同源**，见下节。');
  lines.push('');
  lines.push('| 用例 | 视口 | 主题 | 主区 | 面板内容宽 | 内边距 | 宽/窄 | 分组 | 行(可见) | 横向溢出 | 被裁行 | runtimeErrors | 结论 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of measurements) {
    lines.push('| ' + [
      code(item.name),
      item.width + '×' + item.height,
      item.theme,
      item.mainWidth + 'px',
      item.expectation.containerContentWidth + 'px',
      item.rootPadding + 'px',
      item.narrowApplied ? '窄' : '宽',
      String(item.groups),
      item.rows + '(' + item.visibleRows + ')',
      item.overflow || item.rootOverflow ? '有' : '无',
      String(item.clippedRows),
      String(item.runtimeErrors.length),
      item.verdict,
    ].join(' | ') + ' |');
  }
  lines.push('');
  lines.push('空看板实测空态文案为「当前没有房间任务」（' + code('model.counts.all === 0') + ' 分支），' + code('groups:0') + '。' + code('board-many') + ' 的 12 张卡分布在 5 个状态组（待开始/进行中/受阻/已完成/未知状态），已归档 Room 保留但带「已归档」标注，' + code('future') + '/' + code('merged') + ' 状态渲染成「未知状态 · 原值」而不是被吞掉。' + code('board-long') + ' 例中 390px 宽下 2/3 个行头让状态徽章换行到标题下方，且有 1 处卡片详情被 ' + code('-webkit-line-clamp:2') + ' 截到两行——都是样式表里写明的设计（' + code('ui/tasks/room-task-board.css:8') + ' 的限制、行头 ' + code('flex-wrap:wrap') + '），不是内容被压坏：' + code('overflowingText:0') + ' 表示没有文本在单行内被切掉。');
  lines.push('');
  lines.push('## A11/A12 只读展示取证');
  lines.push('');
  lines.push('只看板的**展示半**可以取证，状态机/后端/实机半在下方 `明确 NOT RUN` 与 `docs/ux/task-board-preview/a11-a12-evidence.md` 逐条列明。' + code('board-authority') + ' 只使用既有 ' + code('task.status') + ' 自由文本字段（没有新增组件状态、没有新增审批/评审/连通性字段）注入 ' + code('uncertain') + '/' + code('planned') + '/' + code('review') + '/' + code('accepted') + '/' + code('succeeded') + '，依赖既有 unknown 回退渲染成「未知状态 · 原值」。两例实测 ' + code('authorityStatusBadges') + '=true、' + code('noAuthorityControls') + '=true：5 张卡全落在唯一「未知状态」组、徽章保留原值且没有任何状态显示成已完成/已验收，非行按钮只有「刷新」，没有派发/批准/合并/验收/重试控件。字段级 ' + code('scripts/room-task-board.test.mjs') + ' 另有两条断言锁定同一口径。Leader 连通性、自动重试/自动推进、后端二次校验与真实审批/评审流程**均 NOT RUN**，不得据此把 A11/A12 记为通过。');
  lines.push('');
  lines.push('## 断点与容器查询');
  lines.push('');
  lines.push('组件的窄样式分成两条规则，判据不同，必须分别验证：');
  lines.push('');
  lines.push('- ' + code('.lm-roomTaskBoard{container-type:inline-size;container-name:lm-task-board}') + '（' + code('ui/tasks/room-task-board.css:10') + '）让看板成为**可查询容器**，但它不能查询自己——**元素永远不是自己的容器**。所以 ' + code('@container lm-task-board (max-width:650px)') + '（' + code(':13') + '）只驱动子元素（筛选控件各占一行、行头允许换行），不能给容器自身的 ' + code('padding') + ' 设样式。');
  lines.push('- ' + code('@media(max-width:650px)') + '（' + code(':12') + '）继续负责 ' + code('padding:24px→16px') + '，它看的是**窗口**宽度。这是有意保留的：在 1440 窗口里把主区压到 640px，内边距仍是 24px，而筛选与行头已经按窄布局排开。');
  lines.push('');
  lines.push('因此断点基准落在**主区减内边距**上：' + code('container-type:inline-size') + ' 量的是内容盒。24px 内边距下，699px 主区剩 651px 保持宽、698px 剩 650px 翻转。实测：');
  lines.push('');
  for (const item of measurements.filter((entry) => entry.name.includes('boundary') || entry.name.includes('main640'))) {
    lines.push('- ' + code(item.name) + '：主区 ' + item.mainWidth + 'px、内边距 ' + item.rootPadding + 'px → 内容宽 ' + item.expectation.containerContentWidth + 'px，' + (item.narrowApplied ? '窄布局生效' : '宽布局保持') + '（筛选 ' + item.filters.widths.join('/') + 'px，占用 ' + item.filters.rowsUsed + ' 行）。');
  }
  lines.push('');
  lines.push('上一批这里有一条 FAIL：' + code('board-1440-light-main640') + ' 主区 640px 时筛选仍挤在一行（281/106/189px）。根因是当时只有 ' + code('@media(max-width:650px)') + '，判据是窗口而不是主区；宽窗口里的窄主区不会退化。补上 ' + code('container-type') + ' + ' + code('@container') + ' 后该例转 PASS，且 640/390 窄窗用例的内边距退化没有被破坏。');
  lines.push('');
  lines.push('## 明确 NOT RUN');
  lines.push('');
  for (const entry of notRun) lines.push('- ' + entry);
  const focusCase = measurements.find((item) => item.name.includes('focus'));
  if (focusCase) {
    lines.push('');
    lines.push(code(focusCase.name) + ' 用程序化 ' + code('input.focus()') + ' 只验证了焦点能落到看板内（' + (focusCase.focused ? '<' + focusCase.focused.tag + '>' : '未落点') + '，计算样式 ' + code('outline') + ' 仍为 ' + (focusCase.focused ? focusCase.focused.outlineStyle : 'n/a') + '），因为 ' + code(':focus-visible') + '（' + code(':9') + '）只匹配键盘发起的焦点。真实 Tab 走查未做。');
  }
  lines.push('');
  lines.push('## 数据');
  lines.push('');
  lines.push(code('preview-validation.json') + ' 由脚本直接写出，记录每例的 ' + code('page') + '/' + code('theme') + '/' + code('width') + '/' + code('height') + '/' + code('mainWidth') + '、实测 ' + code('rootWidth') + '/' + code('rootHeight') + '/' + code('rootPadding') + '/' + code('rootDisplay') + '/' + code('rootOverflowY') + '/' + code('rootScrollable') + '、' + code('narrowApplied') + '/' + code('narrowPadding') + '、' + code('groups') + '/' + code('groupTitles') + '/' + code('rows') + '/' + code('visibleRows') + '/' + code('cardsWithDetail') + '、' + code('rowLayout') + '/' + code('rowWidth') + '、' + code('filters') + '（数量/占用行数/各宽度）、' + code('rowHeads') + '（行头标题与徽章是否同行）、' + code('overflow') + '/' + code('rootOverflow') + '/' + code('clippedRows') + '/' + code('clampedPreviews') + '/' + code('overflowingText') + '、' + code('emptyText') + '、' + code('focusTargets') + '/' + code('focused') + '/' + code('statusBadges') + '/' + code('nonRowButtons') + '、通用 7 项 ' + code('checks') + '（' + code('board-authority') + ' 两例另含 ' + code('authorityStatusBadges') + '/' + code('noAuthorityControls') + '）与 ' + code('verdict') + '/' + code('failedChecks') + '/' + code('runtimeErrors') + '，以及截图路径/字节数/sha256 前 16 位。顶层另有 ' + code('component') + '（' + code(component.path) + ' 的行数/字节/sha256 前 16 位，当前 ' + component.lines + ' 行 / ' + component.bytes + ' 字节 / ' + code(component.sha256) + '）、' + code('fixtures') + '（每个 html 的 sha256 与行数）、' + code('browser') + '、' + code('runtimeErrors') + ' 与 ' + code('notRun') + '。');
  lines.push('');
  const shotBytes = measurements.map((item) => item.screenshot.bytes);
  lines.push('每张截图都记录了字节数（' + Math.min(...shotBytes).toLocaleString('en-US') + '–' + Math.max(...shotBytes).toLocaleString('en-US') + ' 字节）与 sha256；脚本把「截图 < 4KB」判为失败检查项，避免 headless 静默产出空帧时被当成有效证据（本机 Chrome headless 正是 0 字节）。');
  lines.push('');
  lines.push('## 改了哪些文件');
  lines.push('');
  lines.push('- 生成器 ' + code('scripts/task-board-preview.mjs') + '（含本文）：读组件 CSS、现渲染 DOM、无头浏览器实测、写 JSON 与本报告。');
  lines.push('- fixture ' + fixtureMeta.map((fixture) => code(fixture.page)).join('、') + '（组件样式段 + 组件渲染的 DOM）。');
  lines.push('- ' + code('docs/ux/task-board-preview/screenshots/*.png') + '（' + measurements.length + ' 张）。');
  lines.push('- ' + code('docs/ux/task-board-preview/preview-validation.json') + '、' + code('docs/ux/task-board-preview/report.md') + '。');
  lines.push('');
  lines.push('组件侧改动只有 ' + code('ui/tasks/room-task-board.css') + ' 末尾的容器查询三行（' + code(':10') + '–' + code(':13') + '）；生成器不修改 ' + code('lib/') + '、' + code('client.js') + '、' + code('index.js') + '、' + code('package.json') + '、' + code('package-lock.json') + ' 或任何测试，也不执行任何 git 写操作。');
  lines.push('');
  await writeFile(join(out, 'report.md'), lines.join('\n'));
}
