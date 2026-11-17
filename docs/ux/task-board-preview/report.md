# Room 任务看板视觉取证

实际 `RoomTaskBoard()` + `roomTaskBoardView()` 渲染，`React.useState` 桩只提供初始筛选状态；fixture 由生成器按 `ui/tasks/room-task-board.css` 现算样式、由组件现渲染 DOM，不派发/变更任务，不读写真实消息或房间。截图不等于 DSH 实机操作、真实 Team 执行或成果验收。

19 例覆盖：默认看板（1440 浅色、1024 深浅）、空看板（1440 浅 / 640 深）、少量卡（2 张）、多任务（4 个 Room / 12 张卡 / 含已归档 Room 与未知状态）、长标题长名字、窄窗 640 与 390、容器查询断点两侧 699/698，以及 1440 宽窗口内主区只有 640px 的用例。全部 19 例 `overflow:false`、`rootOverflow:false`、`clippedRows:0`、`overflowingText:0`、`runtimeErrors:0`；结论 **PASS 19 / 19**，无 FAIL。

## 重新生成

```
node scripts/task-board-preview.mjs
```

脚本做两件事，都不依赖人工：

1. 读 `ui/tasks/room-task-board.css`（断言首行以 `.lm-roomTaskBoard{` 开头），把每个 fixture 的组件样式段整体重写，再用真实的 `RoomTaskBoard` 重新渲染 <main> 里的 DOM（`board.html`、`board-empty.html`、`board-few.html`、`board-many.html`、`board-long.html`、`index.html`；`index.html` 是目录入口，与 `board.html` 逐字节相同）。手写的主题变量/外壳样式保留在组件段之前，以 `/* @component:ui/tasks/room-task-board.css */` 哨兵标记边界，因此重复运行幂等：连跑两次，5 个 fixture、`index.html` 与 `preview-validation.json` 的 sha256 完全一致。
2. 用本机 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`，headless=new + CDP）逐例设置视口与 `prefers-color-scheme`，实测几何、截 PNG、抓 `Runtime.exceptionThrown`/`console.error`/`Log.entryAdded`。找不到浏览器时只刷新 fixture 并明确退出，不写测量值、不碰截图——本机 Chrome headless 输出 0 字节，所以探测列表里只留 Edge 与常见 Chromium 路径。

本目录先前的问题正是这个脚本要根治的：`preview-validation.json` 每例只有 6 个字段且 `rows` 恒为 0（看板明明渲染 6 张卡），`report.md` 里没有生成器也没有重跑命令。inbox 目录踩过同类坑——组件从 `@media` 换成 `@container` 后 fixture 的 CSS 停在旧版本，640px 那张「窄窗」其实还是双栏。现在样式和 DOM 都从组件现算，不可能再滞后。

## 每例测量

「宽/窄」列是实测的**面板驱动**判据：`@container lm-task-board (max-width:650px)` 是否生效（每个筛选控件各占一行）。「内边距」列是窗口判据（`@media(max-width:650px)` 的 24px→16px），两者按设计**不同源**，见下节。

| 用例 | 视口 | 主题 | 主区 | 面板内容宽 | 内边距 | 宽/窄 | 分组 | 行(可见) | 横向溢出 | 被裁行 | runtimeErrors | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `board-1440-light-default` | 1440×900 | light | 1440px | 1392px | 24px | 宽 | 5 | 6(5) | 无 | 0 | 0 | PASS |
| `board-1024-dark-default` | 1024×768 | dark | 1024px | 976px | 24px | 宽 | 5 | 6(3) | 无 | 0 | 0 | PASS |
| `board-1024-light-default` | 1024×768 | light | 1024px | 976px | 24px | 宽 | 5 | 6(3) | 无 | 0 | 0 | PASS |
| `board-640-light-narrow` | 640×768 | light | 640px | 608px | 16px | 窄 | 5 | 6(3) | 无 | 0 | 0 | PASS |
| `board-390-light-narrow` | 390×780 | light | 390px | 358px | 16px | 窄 | 5 | 6(3) | 无 | 0 | 0 | PASS |
| `board-1440-light-main640` | 1440×900 | light | 640px | 608px | 24px | 窄 | 5 | 6(4) | 无 | 0 | 0 | PASS |
| `board-699-light-boundary-wide` | 699×768 | light | 699px | 651px | 24px | 宽 | 5 | 6(3) | 无 | 0 | 0 | PASS |
| `board-698-light-boundary-narrow` | 698×768 | light | 698px | 650px | 24px | 窄 | 5 | 6(3) | 无 | 0 | 0 | PASS |
| `board-1440-light-focus` | 1440×900 | light | 1440px | 1392px | 24px | 宽 | 5 | 6(5) | 无 | 0 | 0 | PASS |
| `board-empty-1440-light-default` | 1440×900 | light | 1440px | 1392px | 24px | 宽 | 0 | 0(0) | 无 | 0 | 0 | PASS |
| `board-empty-640-dark-narrow` | 640×768 | dark | 640px | 608px | 16px | 窄 | 0 | 0(0) | 无 | 0 | 0 | PASS |
| `board-few-1440-light-default` | 1440×900 | light | 1440px | 1392px | 24px | 宽 | 2 | 2(2) | 无 | 0 | 0 | PASS |
| `board-few-1024-dark-default` | 1024×768 | dark | 1024px | 976px | 24px | 宽 | 2 | 2(2) | 无 | 0 | 0 | PASS |
| `board-many-1440-light-default` | 1440×900 | light | 1440px | 1392px | 24px | 宽 | 5 | 12(5) | 无 | 0 | 0 | PASS |
| `board-many-1024-dark-default` | 1024×768 | dark | 1024px | 976px | 24px | 宽 | 5 | 12(5) | 无 | 0 | 0 | PASS |
| `board-many-640-light-narrow` | 640×768 | light | 640px | 608px | 16px | 窄 | 5 | 12(4) | 无 | 0 | 0 | PASS |
| `board-long-1024-light-default` | 1024×768 | light | 1024px | 976px | 24px | 宽 | 3 | 3(3) | 无 | 0 | 0 | PASS |
| `board-long-640-dark-narrow` | 640×768 | dark | 640px | 608px | 16px | 窄 | 3 | 3(3) | 无 | 0 | 0 | PASS |
| `board-long-390-light-narrow` | 390×780 | light | 390px | 358px | 16px | 窄 | 3 | 3(2) | 无 | 0 | 0 | PASS |

空看板实测空态文案为「当前没有房间任务」（`model.counts.all === 0` 分支），`groups:0`。`board-many` 的 12 张卡分布在 5 个状态组（待开始/进行中/受阻/已完成/未知状态），已归档 Room 保留但带「已归档」标注，`future`/`merged` 状态渲染成「未知状态 · 原值」而不是被吞掉。`board-long` 例中 390px 宽下 2/3 个行头让状态徽章换行到标题下方，且有 1 处卡片详情被 `-webkit-line-clamp:2` 截到两行——都是样式表里写明的设计（`ui/tasks/room-task-board.css:8` 的限制、行头 `flex-wrap:wrap`），不是内容被压坏：`overflowingText:0` 表示没有文本在单行内被切掉。

## 断点与容器查询

组件的窄样式分成两条规则，判据不同，必须分别验证：

- `.lm-roomTaskBoard{container-type:inline-size;container-name:lm-task-board}`（`ui/tasks/room-task-board.css:10`）让看板成为**可查询容器**，但它不能查询自己——**元素永远不是自己的容器**。所以 `@container lm-task-board (max-width:650px)`（`:13`）只驱动子元素（筛选控件各占一行、行头允许换行），不能给容器自身的 `padding` 设样式。
- `@media(max-width:650px)`（`:12`）继续负责 `padding:24px→16px`，它看的是**窗口**宽度。这是有意保留的：在 1440 窗口里把主区压到 640px，内边距仍是 24px，而筛选与行头已经按窄布局排开。

因此断点基准落在**主区减内边距**上：`container-type:inline-size` 量的是内容盒。24px 内边距下，699px 主区剩 651px 保持宽、698px 剩 650px 翻转。实测：

- `board-1440-light-main640`：主区 640px、内边距 24px → 内容宽 608px，窄布局生效（筛选 592/592/592px，占用 3 行）。
- `board-699-light-boundary-wide`：主区 699px、内边距 24px → 内容宽 651px，宽布局保持（筛选 340/106/189px，占用 1 行）。
- `board-698-light-boundary-narrow`：主区 698px、内边距 24px → 内容宽 650px，窄布局生效（筛选 650/650/650px，占用 3 行）。

上一批这里有一条 FAIL：`board-1440-light-main640` 主区 640px 时筛选仍挤在一行（281/106/189px）。根因是当时只有 `@media(max-width:650px)`，判据是窗口而不是主区；宽窗口里的窄主区不会退化。补上 `container-type` + `@container` 后该例转 PASS，且 640/390 窄窗用例的内边距退化没有被破坏。

## 明确 NOT RUN

- 真实 Team/M6 审批流程下的任务派发、状态流转与成果验收：需要真实 Team 审批与多机授权，本目录只做静态取证，NOT RUN。
- 真实 DSH 宿主壳（侧栏/抽屉/分栏）里的主区宽度：需要运行中的 DSH GUI 与真实 Room，本脚本仅用 1440 宽窗口内 640px 主区近似，原样实机 NOT RUN。
- 服务端对已删除房间/未知状态的裁剪：fixture 由 roomTaskBoardView 本地生成，服务端路径 NOT RUN。
- 筛选与点击交互：由 scripts/room-task-board.test.mjs 覆盖，截图不证明交互，交互 NOT RUN。
- 键盘 focus-visible 真实 Tab 走查：程序化 focus() 不触发 :focus-visible，计算 outline 仍为 none，NOT RUN。

`board-1440-light-focus` 用程序化 `input.focus()` 只验证了焦点能落到看板内（<input>，计算样式 `outline` 仍为 none），因为 `:focus-visible`（`:9`）只匹配键盘发起的焦点。真实 Tab 走查未做。

## 数据

`preview-validation.json` 由脚本直接写出，记录每例的 `page`/`theme`/`width`/`height`/`mainWidth`、实测 `rootWidth`/`rootHeight`/`rootPadding`/`rootDisplay`/`rootOverflowY`/`rootScrollable`、`narrowApplied`/`narrowPadding`、`groups`/`groupTitles`/`rows`/`visibleRows`/`cardsWithDetail`、`rowLayout`/`rowWidth`、`filters`（数量/占用行数/各宽度）、`rowHeads`（行头标题与徽章是否同行）、`overflow`/`rootOverflow`/`clippedRows`/`clampedPreviews`/`overflowingText`、`emptyText`、`focusTargets`/`focused`、7 项 `checks` 与 `verdict`/`failedChecks`/`runtimeErrors`，以及截图路径/字节数/sha256 前 16 位。顶层另有 `component`（`ui/tasks/room-task-board.css` 的行数/字节/sha256 前 16 位，当前 13 行 / 2059 字节 / `3f972cc29078841e`）、`fixtures`（每个 html 的 sha256 与行数）、`browser`、`runtimeErrors` 与 `notRun`。

每张截图都记录了字节数（21,611–86,815 字节）与 sha256；脚本把「截图 < 4KB」判为失败检查项，避免 headless 静默产出空帧时被当成有效证据（本机 Chrome headless 正是 0 字节）。

## 改了哪些文件

- 生成器 `scripts/task-board-preview.mjs`（含本文）：读组件 CSS、现渲染 DOM、无头浏览器实测、写 JSON 与本报告。
- fixture `board.html`、`board-empty.html`、`board-few.html`、`board-many.html`、`board-long.html`、`index.html`（组件样式段 + 组件渲染的 DOM）。
- `docs/ux/task-board-preview/screenshots/*.png`（19 张）。
- `docs/ux/task-board-preview/preview-validation.json`、`docs/ux/task-board-preview/report.md`。

组件侧改动只有 `ui/tasks/room-task-board.css` 末尾的容器查询三行（`:10`–`:13`）；生成器不修改 `lib/`、`client.js`、`index.js`、`package.json`、`package-lock.json` 或任何测试，也不执行任何 git 写操作。
