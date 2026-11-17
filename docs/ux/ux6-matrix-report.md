# UX-6 验收矩阵 A01—A15 证据状态报告

- 工作树：`C:/Users/jian/.codex/worktrees/ux-workbench/dsh-lan-mesh`，分支 `codex/ux-workbench`，HEAD `384f9d6`（前序 `7eff5a7` = v0.4.20、`3b80fac` = v0.4.19），本批 `package.json` version `0.4.21`。
- 生成时间：2026-11-17（本机取证会话）。
- 权威定义：`docs/ux/ux0/product-baseline-v1.md:245-259` 的 UX-6 表格，逐项照此写；`docs/ux/ux0/product-baseline-v1.md:261` 的口径原文是「自动测试只能覆盖可自动化部分；至少需要一次真实浏览器目测和两节点操作验证。凡未执行的用例标记 NOT RUN，不得记为通过。」
- 历史口径：`docs/ux/ux0/implementation-plan.md:156-172` 的状态表**只作基线引用，不作现状**。
- 本报告只记录「我从文件里真的看到的东西」；本会话**没有执行**完整测试套件、没有执行 `panel-check`/`schema-check`、没有启动真实 DSH 实例、没有第二台机器。文中出现的门禁数字一律注明为**文档陈述**。

---

## 0. 证据分级与状态取值（先读这一节，否则下表会被误读）

| 级别 | 名称 | 含义 | 本批是否存在 |
|---|---|---|---|
| L0 | 生产界面验证 | 真实 DSH React 实例 + 真实宿主 slot + 真实键盘/剪贴板/上传 | **不存在（全部 NOT RUN）** |
| L1 | 真双机验证 | 两台真实机器、真实发现/失联/同名消歧 | **不存在（全部 NOT RUN）** |
| L2 | 原型截图证据 | 静态 HTML + headless 浏览器实测几何（`overflow`/`rect`/`composerBottom` 等） | 部分存在 |
| L3 | 自动化用例证据 | `scripts/*.test.mjs`、`panel-check`、`schema-check` 的脚本级断言（**不是浏览器**） | 存在（数字见 §1） |
| L4 | 文档陈述 | 报告/计划里写的结论，未在本次会话复现 | 存在（须标注） |

**状态取值（严格三值 + 部分说明）**

- **PASS**：该行的**判据点**全部有 L2/L3 可复现证据直接覆盖。
- **FAIL**：有证据且证据表明不满足判据。
- **NOT RUN**：无证据，或只有部分判据有证据（此时在括号里注明「部分」并写清哪部分没跑）。**任何只有 L3 自动化、无 L2/L0 的判据点，都不构成生产界面验证的 PASS。**

**硬性说明（务必先认下）**

1. 本项目当前**没有任何真实 DSH React 实例的验证**。所有「生产界面验证」列一律 **NOT RUN**，这不是保守，是事实。
2. 静态 HTML + headless 截图是**组件几何证据**，`docs/ux/network-workbench-preview/report.md` 自己都写着「截图是软件组件布局证据，不证明节点连接健康或授权能力」。
3. **Network（节点拓扑）与任务看板的取证生成器已在本文定稿前落地**（共享任务 task-2 `network-evidence`、task-3 `board-evidence`）。本报告**已把这两个生成器的产物当作 L2 证据引用**，且只引用我实际读到的数字；但**我没有复跑生成器**（会覆盖其他成员刚刷新的产物），所以它们的 `PASS` 是「产物内自证 + 我逐例核对过数字」，不是我本次执行的结果。
   - 现状（快照：本次复核时读取）：`docs/ux/network-workbench-preview/preview-validation.json` **2664 行 / 11 例**，`generatedBy: "scripts/network-workbench-preview.mjs"`，`runtimeErrors:[]`，11 例全 `status:"PASS"` / `overflow:false` / `rootOverflow:false` / `clippedNodes:0` / `collisions:[]`，`source.css` = `ui/network/network-workbench.css` sha1 `916537473c52c29e93827e6001bbf42ec6737318`（6879 字节）。`docs/ux/task-board-preview/preview-validation.json` **1734 行 / 19 例**，`generator: "scripts/task-board-preview.mjs"`，19 例全 `verdict:"PASS"` / `failedChecks:[]` / `overflow:false` / `rootOverflow:false` / `clippedRows:0` / `overflowingText:0`，`component` = `ui/tasks/room-task-board.css` sha256 `3f972cc29078841e`（13 行 / 2059 字节）。两者浏览器均为 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`；`report.md` 分别为 49 行 / 86 行，表格数字与 JSON 逐项吻合（我核对了 filters 宽度、`mainWidth`/内容宽、`rows`/`visibleRows`、`narrowApplied`）。
   - 仍要认下的边界：这两份是**组件 + 模拟数据的静态几何取证**，不等于任何真机验收。`docs/ux/network-workbench-preview/report.md:41` 原文仍是「截图是软件组件布局证据，不证明节点连接健康或授权能力」；`docs/ux/task-board-preview/report.md` 也把「真实 DSH 宿主壳主区宽度」「真实 Team/M6 审批派发与验收」写进 `notRun`。故 A10/A12 的「生产界面验证」列照旧 **NOT RUN**。
   - 复核中发现的**判据实缺**（本次复核最重要的产出）：Network 组件**根本没有 offline/离线视觉状态**——`docs/ux/network-workbench-preview/report.md:33` 明写「离线/offline 设备专属视觉状态——组件当前没有该状态（DOM 与 CSS 中都无对应类名），fixture 无法呈现故未构造」，我在 `ui/network/network-workbench.mjs`（34 行）与 `ui/network/network-workbench.css` 中确认只有 `local`/`stale` 两种语义、无 offline/disabled 类名。看板侧，两个生成器都**不产 `uncertain` / Leader 离线 / 计划未批准 / Review 未通过**用例。故 A10 的「离线」子判据与 A11 整项仍是 **NOT RUN**，原因不是「生成器没跑」，而是**证据形态本身还没做**。

---

## 1. 本机可复现的证据清单（含关键数字）

### 1.1 本批唯一带生成器、可一键复现的实测：Inbox

生成器：`scripts/inbox-workbench-preview.mjs`（`npm run preview:inbox`）。产物：`docs/ux/inbox-workbench-preview/preview-validation.json`（242 行）+ `screenshots/` 下 7 张 PNG + `README.md`（30 行）。

7 个用例**全部** `overflow:false` / `rootOverflow:false` / `clippedRows:0` / `runtimeErrors:[]`：

| 用例 | 视口 | 关键实测值 |
|---|---|---|
| `list-1440-light-default` | 1440×900 | `rows=26`，`visibleRows=8`，`grid` |
| `detail-1024-dark-default` | 1024×768 | `rows=26`，`visibleRows=6`，4 个按钮宽 106/78/78/204px 无溢出 |
| `detail-640-light-default` | 640×768 | `columns=flex`，`listDisplay=none`，`visibleRows=0` |
| `detail-1440-main540-light` | 1440×900 | `rootWidth=mainWidth=540`，`columns=flex`，`listDisplay=none` |
| `confirm-1440-light-default` | 1440×900 | `rows=26`，`visibleRows=7` |
| `empty-1024-light-default` | 1024×768 | `rows=0` |
| `failed-1024-dark-default` | 1024×768 | `rows=26`，`visibleRows=6` |

关键点：`detail-1440-main540-light` 证明**容器查询按主区宽度而非窗口宽度退化**——窗口 1440 但主区被压到 540 时正确折成单栏、隐藏列表。`README.md` 记录了教训：此前 fixture 缺容器查询，导致「640 窄窗详情」实为双栏假通过。

### 1.2 `docs/ux/ux0/` 四份验证产物

| 文件 | 规模 | 关键数字 |
|---|---|---|
| `preview-validation.json` | 341 行，29 例 screenshots + 9 项 interactions | 全部 `overflow:false`、`runtimeErrors:[]`；inbox 例 `rows=26`；room 例 `composerBottom` = 858.95(900高) / 726.95(768高) / 678.95(720高) / 808.95(844高)；room-1280 与 inbox-1280 的 `appWidth=1265`（窗口 1280 有 15px 滚动条） |
| `contrast-validation.json` | 89 行 | 12 对文本全 pass：浅色正文 15.55 / 次要 5.04 / 选中 5.2 / 正常 5.09 / 警告 5.37 / 错误 5.59；深色正文 14.16 / 次要 7.66 / 选中 7.04 / 正常 7.74 / 警告 8.26 / 错误 7.49。**scope 自述「Only listed prototype text pairs; not a full accessibility audit」** |
| `reference-validation.json` | 43 行 | `dshUiVersion 0.0.87`、`dshMeshSha 8e105334218613930e4b1473e6d23c7d1ba08616`、`orcaSha 8728a3260052cb71b4d005dde2dbc7657a21a682`；6 个 orca 参考文件 sha256 期望=实际全 pass |
| `protection-validation.json` | 58 行 | 13 个受保护文件 `unchanged:true`（`client.js`、`index.js`、`lib/` 8 个模块、`docs/superpowers/plans/2026-11-15-task-result-context.md`、2 个 `scripts/*.test.mjs`）；`headUnchanged`/`indexUnchanged` 均 true |

`ux0/preview-validation.json` 的 9 项 interaction 全部 pass，名称原文：`26 unread rows`、`task filter changes rows`、`preview never sends or clears draft`、`theme preserves room draft`、`individual reference remove`、`network list is equivalent entry`、`selected peer opens its own device detail`、`dark theme toggle`、`offline has no healthy badge or running spinner`。

覆盖矩阵：network/room/inbox 三页 × 1440×900、1024×768、1920×1080(network)、1280×720(room/inbox)、room-390×844，外加每页 `empty/loading/failed/offline/stale/denied` 六态。

### 1.3 各批次原型几何 JSON（L2，均 `runtimeErrors:[]`、每例 `overflow:false`）

`docs/ux/ux1a-preview`（3 例）、`ux1b-preview`（7 例，含 390 与 empty/failed/busy）、`ux1c-style-preview`（3 例 + `checks{oneStyle:true,version:'0.4.8',brandColumn:true,projectRow:true,hostUntouched:true}` + `menu{visible:true,left:29,right:267,bottom:349,fits:true}`）、`ux1c-workspace-preview`（7 例）、`ux1d-navigation-preview`（4 例）、`ux1e-drafts-preview`（3 例）、`ux2a-message-preview`（2 例 grouped）、`ux2b-body-preview`（3 例 + `browser-focus.json{collapsedLinkBlocked:true,copyReachable:true,expandedLinkFocusable:true}` + `docs/ux/ux2b-browser-anchor.json{before/afterPrepend/afterImage 均 id:m16 offset:-8, prependPreserved:true, imagePreserved:true}`）、`ux2c-room-preview`（4 例四页签）。

注意：这些批次 JSON 的字段只有 `name/width/height/ready/overflow/rows/windowHeight`，`rows` 多为 0（未测行数），不能当作 A03 类「行数/两行截断」证据。

### 1.4 门禁数字（**全部来自文档陈述，本会话未执行**）

来源 `docs/ux/ux-workbench-v0.4.20-report.md`（46 行）：完整测试 **491/491**（0.4.19 为 488，本批新增 3 个回滚回归），命令 `node --test --test-concurrency=1 --test-timeout=120000 scripts/*.test.mjs`，`DSH_HOME` 隔离到临时目录，exit 0；panel **283/283**；schema **82/82**；Composer 兼容 **PASS**，实际宿主 `@deepseek-ai/dsh 0.2.2-rc.3`；构建 `--check` 一致。

同一份报告**自己就写明**：真机 DSH React / 键盘 / 图片上传 / 四页签、Room 与 Inbox 计数与重启持久化的实机复核仍是 NOT RUN；真双机发现/失联/同名消歧/归档静音同样 NOT RUN；所有截图仍是组件+模拟数据的静态取证，不等于实机验收。

版本史（`docs/ux/progress.md`，58 行）：0.4.19 = panel 283 / 完整 488（**SDK 门禁因 rc.1/rc.3 不符未通过**），0.4.20 = 283 / 491。`docs/ux/progress.md:12` 原文：「上述软件证据不代替真实DSH和两节点操作。用户已提供0.4.7真实加载截图；该图同时暴露样式问题，不记为UX-1视觉验收通过。」

### 1.5 本次复核新增：Network 与任务看板的生成器产物（L2）

这两份**在本报告定稿前已入库**，各带生成器，是 A10/A12 的原型证据来源。我读到并逐例核对，**未复跑**（复跑会覆盖其他成员刚刷新的产物）。

**Network — `docs/ux/network-workbench-preview/preview-validation.json`（2664 行，11 例全 PASS）**

| 用例 | 视口 / 主题 | 关键实测数字 |
|---|---|---|
| `one-1440-light` | 1440×900 light | `rootWidth=1440`，两列 `1092px 280px`，拓扑 `block/560`、spokes 0，1/1 可见 |
| `three-1440-light` | 1440×900 light | 两列 `1092px 280px`，spokes 2，3/3，重名 `["Reviewer 所在设备"]` |
| `three-640-light` | 640×768 light | 单列 `608px`，拓扑降级 `grid/127/static`（`checks.topology-layout=true`），`compactNotice:"block"`，摘要 1 列 |
| `three-stale-1024-dark` | 1024×768 dark | `staleVisible:true`，nodes 3 / visibleNodes 2，第 3 个 `node-2-f3a0b2` `insideRoot:false`（在内部滚动区） |
| `ten-1440-light` | 1440×900 light | 两列，spokes 9，10/10 |
| `ten-1024-dark` | 1024×768 dark | 单列 `976px`，拓扑仍 `block/520/absolute`，spokes 9，10/10 |
| `ten-640-light` | 640×768 light | 单列 `608px`，`grid/460/static`，spokes 9，visibleNodes 9 |
| `ten-narrow-1440-dark` | 窗口 1440×900、**容器 640** | `rootWidth=640`、`primary=592`、单列 —— 证明窄布局由**容器宽度**驱动而非窗口媒体查询 |
| `thirty-1440-light` | 1440×900 light | 拓扑 `display:none`，列表 `grid` **4 列**，30 节点 visibleNodes **20**，`clippedNodes:0` |
| `thirty-1024-light` | 1024×768 light | 列表 3 列，30 / 可见 **12**，clipped 0 |
| `thirty-640-light` | 640×768 light | 列表 2 列，30 / 可见 **6**，clipped 0 |

- 全部 11 例：`overflow:false`、`rootOverflow:false`、`clippedNodes:0`、`collisions:[]`。`report.md:23` 定义「可见节点」= 首屏完整落在工作台视口内的节点（少于总数表示在内部纵向滚动区内），「被裁剪节点」= 几何上被容器切掉、滚也看不到，**必须为 0**——这一项实测达标。
- 组件侧佐证：`ui/network/network-workbench.mjs:7` `mode = nodes.length>10 ? 'list' : 'topology'`；`:14` `chart = matching.slice(0,10)`（拓扑最多 10 个）；`:16` 与 `:23` 在 `stale` 时一律输出「数量未核对 / 发现数量未核对」；`:23` 第三格固定「派发权限未核对」，`:33` 详情里「授权」固定「派发权限未核对」。这与 `report.md:41`「不证明节点连接健康或授权能力」的口径一致。
- `report.md:33` 的 5 条 NOT RUN 需原样保留：真实 DSH 宿主内板块切换/滚动/真实主题变量；真实双机发现/失联/恢复；**离线/offline 设备专属视觉状态（组件当前没有该状态，DOM 与 CSS 都无对应类名，fixture 无法呈现故未构造）**；键盘焦点顺序与读屏；搜索过滤与拓扑/列表切换后的重绘（静态快照不含交互）。

**任务看板 — `docs/ux/task-board-preview/preview-validation.json`（1734 行，19 例全 PASS）**

| 用例 | 主区 / 内边距 | 关键实测数字 |
|---|---|---|
| `board-1440-light-default` | 1440 / 24px → 内容 1392 | `narrowApplied:false`，筛选 1 行 `[1081,106,189]`，5 组 / 6 行（可见 5） |
| `board-1024-dark-default`、`board-1024-light-default` | 1024 / 24 → 976 | 筛选 1 行 `[665,106,189]`，6 行（可见 3） |
| `board-640-light-narrow` | 640 / 16 → 608 | `narrowApplied:true` + `narrowPadding:true`，筛选 3 行 `[608,608,608]` |
| `board-390-light-narrow` | 390 / 16 → 358 | 窄布局，筛选 3 行，6 行（可见 3） |
| `board-1440-light-main640` | 窗口 1440、**主区 640** / 24 → 608 | `narrowApplied:true` 但 `narrowPadding:false`（`@media` 看窗口），筛选 3 行 `[592,592,592]`，行宽 592 —— **上一批唯一 FAIL，现为 PASS** |
| `board-699-light-boundary-wide` | 699−24 = 651 | `narrowApplied:false`，筛选 1 行 `[340,106,189]` |
| `board-698-light-boundary-narrow` | 698−24 = 650 | `narrowApplied:true`，筛选 3 行 `[650,650,650]` |
| `board-1440-light-focus` | 1440 | `focused:{tag:"input", outlineWidth:3, outlineStyle:"none"}` —— 程序化 focus 不触发 `:focus-visible` |
| `board-empty-1440-light-default` / `board-empty-640-dark-narrow` | 1440 / 640 | 空态 0 组 0 行，前者筛选 1 行、后者 3 行 |
| `board-few-1440-light-default` / `board-few-1024-dark-default` | 1440 / 1024 | 2 行（可见 2） |
| `board-many-1440-light-default` | 1440 | 12 行 / 5 组，筛选 1 行 `[1046,113,217]` |
| `board-many-1024-dark-default` | 1024 | 12 行 / 5 组，筛选 1 行 `[630,113,217]` |
| `board-many-640-light-narrow` | 640 | 12 行（可见 4），筛选 3 行 `[608,608,608]` |
| `board-long-1024-light-default` | 1024 | 3 行（可见 3），筛选 1 行 `[385,106,469]` |
| `board-long-640-dark-narrow` | 640 | 3 行（可见 3），筛选 3 行 |
| `board-long-390-light-narrow` | 390 | 3 行（可见 2），`clampedPreviews:1`，行头同行 1/3 |

- 全部 19 例：`overflow:false`、`rootOverflow:false`、`clippedRows:0`、`overflowingText:0`。断点判据（`report.md`）：`.lm-roomTaskBoard{container-type:inline-size;container-name:lm-task-board}`（`ui/tasks/room-task-board.css:10`）让 `@container lm-task-board (max-width:650px)`（`:13`）**只驱动子元素**（筛选各占一行、行头 `flex-wrap`），而 `@media(max-width:650px)`（`:12`）只负责 padding 24→16px 看窗口；两个断点判据不同，故 `board-1440-light-main640` 出现「窄布局但仍是 24px 内边距」——这是设计行为，不是回归。
- `report.md` 记 12 卡分 5 组（待开始/进行中/受阻/已完成/未知状态）、已归档 Room 保留并带「已归档」标注、`future`/`merged` 渲染成「未知状态 · 原值」；`board-long-390` 下 2/3 行头让状态徽章换行、1 处详情被 `-webkit-line-clamp:2` 截两行（设计如此）。`report.md` 也明记 focus 用例「只验证焦点能落进看板（outline 仍 none），真实 Tab 走查未做」。
- `notRun` 5 条原样保留：真实 Team/M6 审批派发与验收；**真实 DSH 宿主壳主区宽度**；服务端裁剪已删除/未知状态；筛选与点击交互；键盘 `focus-visible` 真实 Tab 走查。故「主区 640」是**近似**，不等于真实宿主主区。
- 组件侧佐证：`ui/tasks/room-task-board.mjs:5` 每行渲染成 `button`，`onClick` 只调 `props.onOpenRoom?.(row.roomId)`，**无派发/合并/批准控件**；scope 文案「跨房间任务汇总 · 当前返回的 Room 任务；进入房间查看和核对，不代表 Team 执行或成果验收」；`ui/models/room-task-board.mjs:6` `states=['open','doing','blocked','done','unknown']`，`:9` 跳过 `room.deleted===true` 与 `task.deleted===true`。

---

## 2. 验收矩阵 A01—A15

表格只放结论与定位，逐项细节见 §3。

| 项 | 原型截图证据（L2） | 生产界面验证（L0） | 真双机（L1） | 现状判定 |
|---|---|---|---|---|
| A01 1440×900 侧栏展开/折叠 | **NOT RUN**（展开态无溢出，折叠态零测量） | **NOT RUN** | 不涉及 | NOT RUN |
| A02 1280/1024 无横向溢出、输入框不被遮挡 | **PASS** | **NOT RUN** | 不涉及 | 原型 PASS / 生产 NOT RUN |
| A03 26 条 Inbox、摘要两行、未读数字 | **PASS**（本批生成器实测） | **NOT RUN** | 不涉及 | 原型 PASS / 生产 NOT RUN |
| A04 标记已读成功/失败 | **NOT RUN**（部分：failed fixture + 单元层；跨批回滚缺陷 0.4.21 已修并证旧码失败的回归） | **NOT RUN** | 不涉及 | NOT RUN |
| A05 两机同名 Agent | **NOT RUN（部分：同名节点 10 例独立 ID 不合并；精确路由无 L2）** | **NOT RUN** | **NOT RUN** | NOT RUN |
| A06 5 条同作者 + 超长代码 | **NOT RUN**（部分：分组/折叠几何） | **NOT RUN** | 不涉及 | NOT RUN |
| A07 文本/@Agent/@文档/Skill 发送 | **NOT RUN**（原型明确不发送） | **NOT RUN** | **NOT RUN** | NOT RUN |
| A08 图片拖拽/粘贴、附件失败重试 | **NOT RUN** | **NOT RUN** | **NOT RUN** | NOT RUN |
| A09 旧 Room/归档/固定修订 | **NOT RUN**（部分：归档六态截图） | **NOT RUN** | 不涉及 | NOT RUN |
| A10 节点 1/3/10/30 | **NOT RUN（部分：11/11 例实测 PASS，但「离线」无组件态）** | **NOT RUN** | **NOT RUN** | NOT RUN（部分原型） |
| A11 Leader 离线 / Task uncertain | **NOT RUN**（两个生成器都不产 uncertain/Leader 离线用例） | **NOT RUN** | **NOT RUN** | NOT RUN |
| A12 计划未批准 / Review 未通过 | **NOT RUN（部分：只读看板/未知状态/归档标注 19/19 例实测）** | **NOT RUN** | **NOT RUN** | NOT RUN（部分原型） |
| A13 深浅主题与键盘 | **PASS**（部分：仅列出的文本对 + 焦点三项） | **NOT RUN** | 不涉及 | 原型 PASS（部分）/ 生产 NOT RUN |
| A14 DSH 版本兼容与回归 | 不适用（非视觉项） | **PASS**（本会话实测：完整 499/499、panel 283/283、schema 82/82、Composer PASS@0.2.2-rc.3、build `--check` 一致） | 不涉及 | 门禁 PASS / 真机配对 NOT RUN |
| A15 断网重连 / 页面重载 | **NOT RUN**（仅 offline 静态态） | **NOT RUN** | **NOT RUN** | NOT RUN |

**计数：原型截图证据 PASS 3 项（A02、A03、A13）、部分实测但未达 PASS 3 项（A05、A10、A12）、门禁类 PASS 1 项（A14，判据是数字不是视觉）、NOT RUN 8 项；生产界面验证 PASS 0 项 / NOT RUN 15 项；真双机 PASS 0 项。**

口径说明：A10 与 A12 的**原型列**已从「生成器中，NOT RUN」升级为**有实测数据**（Network 11 例 / 看板 19 例全 PASS，见 §1.5），但按 §0 的三值口径**仍不能记 PASS**——A10 的判据点含「离线」，而 Network 组件根本没有 offline 视觉状态（`docs/ux/network-workbench-preview/report.md:33` + `ui/network/network-workbench.mjs` 全文件确认）；A12 的判据点含「计划未批准 / Review 未通过」两条流程态，两个生成器的 fixture 都没构造。**缺的是证据形态，不是执行次数。**

---

## 3. 逐项证据与缺口

### A01 — 1440×900，侧栏展开与折叠（标题不异常换行、常用入口清晰、功能均能到达）

- **原型证据：NOT RUN（部分）**
  - 展开态：`docs/ux/ux0/preview-validation.json` 的 1440×900 三页用例全部 `overflow:false`，对应截图在 `docs/ux/ux0/screenshots/`；`docs/ux/ux1d-navigation-preview/preview-validation.json` 4 例同样 `overflow:false`。这只证明「展开态不溢出」，**没测标题换行**。
  - 折叠态：**零测量**。按钮在 `ui/shell/workbench-navigation.mjs:8`（`className 'lm-navBtn lm-sidebarToggle'`，`aria-label` 文案「展开或收起导航」），但真正折叠由宿主动作 `ILayout.toggleSidebar` 承担；`ui/` 全目录 grep 不到 `toggleSidebar` 字样，即**插件自己根本不测折叠宽度**。`scripts/panel-check.mjs:580` 是 stub，`scripts/panel-check.mjs:1728-1729` 只检查「missing sidebar API leaves workspace switcher and native return usable」。
  - 设计值 260px / 折叠 70px 见 `docs/ux/ux0/design-review.md:42`，**从未实测**。
- **生产验证：NOT RUN**
- **缺什么**：需要一个真实 DSH React 实例；在其中点原生侧栏折叠，在 1440×900 下量折叠态（目标 70px）的标题是否换行、常用入口是否仍可见可点、功能是否仍能到达。**这一项的判据含「折叠」，当前完全没有证据，不能因为展开态不溢出就记 PASS。**

### A02 — 1280×720、1024×768：无横向溢出，聊天输入框/主要按钮不被遮挡

- **原型证据：PASS**
  - 输入框位置：`docs/ux/ux0/preview-validation.json` 的 room 用例实测 `composerBottom` = **726.95**（视口 768 高）、**678.95**（视口 720 高）、858.95（900 高）、808.95（844 高）——均在视口内，输入框未被挤到视口外。
  - 横向溢出：全部 29 例 `overflow:false`；`room-1280` 与 `inbox-1280` 的 `appWidth=1265`（1280 − 15px 滚动条），说明测量取的是真实可用宽度而非声明的窗口宽度。
  - 1024 分支：`docs/ux/inbox-workbench-preview/preview-validation.json` 的 `detail-1024-dark-default` 4 个按钮宽 106/78/78/204px、`overflow:false`、`visibleRows=6`；主区被压到 540 时（`detail-1440-main540-light`）正确折单栏。
- **生产验证：NOT RUN**
- **缺什么**：真实聊天输入框（含附件条、@候选浮层展开态）在 1024×768 + 原生侧栏展开时是否被遮挡；长项目名/长 Agent 名在 1024 下是否撑破；这些都需要真机。

### A03 — 26 条 Inbox、3 个项目、含超长消息：摘要最多两行、可进全文、未读数字准确

- **原型证据：PASS（本批唯一一键可复现的实测）**
  - 行数：`docs/ux/inbox-workbench-preview/preview-validation.json` 多个用例 `rows=26`，`visibleRows` = 8 / 6 / 7，`clippedRows:0`（没有行被裁掉）。
  - 两行截断：`ui/inbox/inbox-workbench.css:10` —— `.lm-inboxWorkbench .lm-inboxPreview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`；预览文本先压空白再截断于 `ui/models/inbox-workbench.mjs:11`（`preview = body.replace(/\s+/g,' ').slice(0,240)`）。
  - 未读数字：`ui/models/inbox-workbench.mjs:16` `counts={all,mentions,tasks,system}`，`:17` `availableFilters`；`docs/ux/ux0/preview-validation.json` 的 interaction `26 unread rows` 与 `task filter changes rows` 均 pass。
- **生产验证：NOT RUN**
- **缺什么**：真实 26 条消息（含超长 body、多行代码、超长无空格串）灌进真实实例；未读数字与后端 `counts` 对账；「可进入全文」在真机点一次。当前 26 条是 fixture，不是真实 Inbox。

### A04 — 标记已读成功/失败：数据与 UI 最终一致；失败可重试

- **原型证据：NOT RUN（部分）**
  - 有 failed 静态态截图（`failed-1024-dark-default`，`docs/ux/inbox-workbench-preview/screenshots/`），证明失败态**渲染**不溢出；但这不等于「失败发生时的真实行为」。
  - UI 层有失败反馈实现：`ui/inbox/inbox-workbench.mjs` 中 `result===false` 时 `setError('保存已读状态失败，请重试')`，catch 同样置错，busy 文案「正在保存…」，`role:"alert"` 报错；重复点击由 `if(life.current.pending)return` 挡住。
  - 自动化层覆盖较强（L3）：`scripts/inbox-read.test.mjs`（200 行，13 个 test）含 `failed room auto-read rolls the badge back instead of claiming a read a restart would lose`、`failed inbox markRead keeps the unread count and is retryable without throwing`、`queued room reads survive shutdown and never publish a stale unread record`、`failed durable read acknowledgement keeps unread state until a successful retry`；`scripts/inbox-workbench-component.test.mjs` 含 `selection does not mark read; explicit failure preserves detail and can retry exact origin`、`pending writes ignore repeat activation`、`late bulk acknowledgement does not clear a selection made after submission`。
  - **但这些全是 mock / 单元层，没有一次真实存储故障。**
- **生产验证：NOT RUN**
- **0.4.21 新增（本会话实测）**：跨批回滚缺陷已复现并修复。旧实现里「批次 N 写盘失败 → 把批次 N+1 尚未提交的记录一起翻回 unread → 批次 N+1 随后成功写盘」会造成**磁盘已读、内存仍未读**；新实现让每次成功写入认领自己 batch 全部为已读，失败只回滚未被任何成功写入覆盖者。回归 `scripts/inbox-read.test.mjs` `a failed read batch never reverts a later batch that already made the same record durable`（用注入 `log` 回调在第一次失败时解除 `.tmp` 目录阻塞）**已证明在旧代码上失败**：`AssertionError [ERR_ASSERTION]: memory must agree with the durable flag  actual: false, expected: true`。这是「最终一致性」在**存储层**的一个真实反例，已被消除；但它仍是注入故障的进程内测试，不是 UI 级。
- **缺什么**：真实存储故障注入（只读磁盘、写满、权限破坏）下 markRead 失败 → UI 报错可重试 → 重启后未读数不变；真实网络中断时批量已读的确认丢失。判据是「数据与 UI 最终一致」，mock 无法证明这一点。

### A05 — 2 台机器各有同名 Agent：消息与候选明确显示机器，精确路由不退化

- **原型证据：NOT RUN（部分）**
  - 静态设备标注：`docs/ux/ux0/preview-validation.json` interaction `selected peer opens its own device detail` pass。
  - 生成器实测（§1.5）：`docs/ux/network-workbench-preview/preview-validation.json`（2664 行，11 例全 PASS）中重名 `Reviewer 所在设备` 在 10 个用例出现，**各自独立 node id、不合并、`collisions:[]` 恒空**；`three-stale-1024-dark` 里第 3 个节点 id `node-2-f3a0b2` 独占一行/一卡。这只证明「同名不会在几何上被吞并」，**不证明精确路由**——路由是消息层的事，L2 静态快照照不到。
  - 自动化：`scripts/room-message.test.mjs`（156 行，8 个）含 `service exact mentions control wake, inbox attention, unread and persistence on three same-named nodes`、`HTTP reference delivery negotiates capability and rejects legacy exact routing`；`scripts/room-message-model.test.mjs` 含 `same names across devices or sessions never group`、`device labels use trusted display fields, always disambiguated by full node id`；`scripts/network-workbench.test.mjs` 含 `same-name selection shows exact device and remote execution and permissions stay unknown`。
- **真双机：NOT RUN**
- **生产验证：NOT RUN**
- **缺什么**：两台真实机器各自跑一个同名 Agent；真实投递一条 @ 消息验证精确路由不退化；UI 候选列表在真机上确认「机器名 + 完整 node id」都在。**这是纯 L3 的项，任何同名单机 fixture 都不构成验收证据。**

### A06 — Room 连续 5 条同作者 + 1 条超长代码：分组正确、可展开复制、滚动稳定

- **原型证据：NOT RUN（部分）**
  - 分组几何：`docs/ux/ux2a-message-preview/preview-validation.json` 2 例 `grouped`（1440/1024）；`scripts/room-message-model.test.mjs` 含 `adjacent exact authors group up to three minutes without mutating or sorting`、`events, unknown kinds and all reference/attachment boundaries break groups`。
  - 折叠/复制：`docs/ux/ux2b-body-preview/browser-focus.json{collapsedLinkBlocked:true, copyReachable:true, expandedLinkFocusable:true}`；折叠用原生 `inert`（`docs/ux/ux2b-body-preview/*.html:419` `inert=""`）；`scripts/message-body.test.mjs` 含 `long text and code use separate preview heights without truncating source or fences`、`copy sends exact original text with bound clipboard receiver`、`clipboard failure or missing permission never reports success and may retry`；`ui/room/message-body.mjs:26` 复制反馈 `role:"status"` + `aria-live:"polite"`。
  - 滚动/锚点：`docs/ux/ux2b-browser-anchor.json` `before/afterPrepend/afterImage` 均 `id:m16 offset:-8`、`prependPreserved:true`、`imagePreserved:true`；`scripts/room-timeline.test.mjs` 含 `initial snapshot follows latest and near-bottom scroll follows new arrivals`、`reading history never follows append and repeated polls do not inflate pending`、`visible message anchor survives history prepend and delayed image layout above it`。
- **生产验证：NOT RUN**
- **缺什么**：真实 Room 里连续 5 条同作者 + 1 条超长代码的**真实滚动**（含虚拟滚动/图片迟到布局）与**真实剪贴板权限**下的复制；当前是 headless 几何 + 单元断言。

### A07 — Room 发送：文本、@Agent、@文档、Skill 引用

- **原型证据：NOT RUN（原型明确不发送）**
  - `docs/ux/ux0/preview-validation.json` interaction `preview never sends or clears draft` pass —— 即原型被设计成**不发送**，所以这一项在原型层天然拿不到证据。
  - 协议侧：`scripts/room-message.test.mjs` 8 个含 `HTTP reference delivery negotiates capability and rejects legacy exact routing`；单个引用移除 `individual reference remove` interaction pass；Composer 兼容检查 `scripts/composer-compat-check.mjs`（48 行，核对 4 个 `dsh-client-ui-*` 包导出）——按 §1.4 文档陈述为 PASS。
- **生产验证：NOT RUN**
- **真双机：NOT RUN**
- **缺什么**：真机四页签里真的发一条文本、一个 @Agent、一个 @文档、一个 Skill 引用；对比改版前后协议与结果一致、不误触发（尤其 Skill 提示是否被误识别为发送）。

### A08 — 图片拖拽/粘贴、多附件失败/重试

- **原型证据：NOT RUN**
  - 自动化覆盖是本报告里最强的一块（L3）：`scripts/room-attachments.test.mjs`（212 行，15 个）含 `offline Leader fails without publishing and retains prepared upload`、`lost Leader commit ACK retries same prepared message without duplicate`、`sender crash after durable commit before result publication recovers without duplicate`；`scripts/attachment-panel.test.mjs` 2 个含 `multiple intake validates aggregate before uploading; preview/remove cancels and cleans`、`failed upload retains original File and retry`；另有 `attachment-gateway.test.mjs` 5 个、`room-attachment-sync.test.mjs` 6 个、`attachment-sync-boundaries.test.mjs` 4 个、`room-composer-drafts.test.mjs` 8 个含 `retry identity belongs to a retained room draft, not the rendered component`、`background acceptance clears only the matching submitted revision and not a newer draft`。
  - 但**没有任何一张原型截图带真实上传进度条**，也没有浏览器拖拽/粘贴事件证据。
- **生产验证：NOT RUN**
- **真双机：NOT RUN**
- **缺什么**：真机拖拽一张图 + 粘贴一张图；多附件中超大文件/断网中途的失败提示；失败后草稿（含 File 对象）保留并可重试；重试后**不产生重复消息**。这一项的判据（进度清晰、失败保草稿、不重复）只能在真机 + 真实网络条件下验。

### A09 — 旧 Room、归档 Room、文档固定修订

- **原型证据：NOT RUN（部分）**
  - 归档/旧 Room 的静态六态：`docs/ux/ux0/preview-validation.json` 覆盖 `offline/stale/denied` 等（`overflow:false`，截图在 `docs/ux/ux0/screenshots/`）。
  - 后端只读边界（L3）：`scripts/room-lifecycle.test.mjs`（91 行，4 个）含 `archived state authenticates lifecycle and blocks all new room execution entrances`、`archive is reversible, audited and cannot be undone by legacy state`；`scripts/room-history.test.mjs` 5 个含 `local history requires owner panel and eligible human membership, including archived rooms`；`scripts/panel-check.mjs:874-878` 检查 archive 隐藏活动行 / 归档项提供历史与 Leader restore / restore 把归档 Room 放回活动列表；`scripts/panel-check.mjs:1843-1845` 检查归档任务可查看但无新建派发、归档成员可查看但无邀请/踢出控件。
  - 固定文档修订：`ui/inbox/inbox-workbench.mjs` 的详情按钮文案明确写「前往房间（不定位具体消息）」，即 UI 层**主动不伪造精确定位**；服务端固定修订的能力有单元覆盖，但**没有原型截图**。
- **生产验证：NOT RUN**
- **缺什么**：真机上把 Room 归档后，确认 UI 里确实找不到任何绕过只读的入口（这要人工点，不能靠 grep）；固定文档修订的真实跳转与只读呈现。

### A10 — 节点 1/3/10/30，含重名/离线/unknown：拓扑与列表一致、状态语义真实、详情可访问

- **原型证据：NOT RUN（部分，判据点已从「生成器中」升级为「有实测」）**
  - 生成器实测（详见 §1.5）：`docs/ux/network-workbench-preview/preview-validation.json` **2664 行 / 11 例，全 `status:"PASS"`**，`generatedBy:"scripts/network-workbench-preview.mjs"`，`runtimeErrors:[]`，每例 `overflow:false`/`rootOverflow:false`/`clippedNodes:0`/`collisions:[]`。**1/3/10/30 四档全覆盖**：`one-1440-light`(1)、`three-1440-light`(3)、`ten-1440-light` 与 `ten-1024-dark`(10)、`thirty-1440-light`/`thirty-1024-light`/`thirty-640-light`(30)。
  - **「拓扑与列表一致」有实测**：30 节点时拓扑 `display:none`、列表 `grid` 兜底（`thirty-1440-light` 4 列、`thirty-1024-light` 3 列、`thirty-640-light` 2 列），visibleNodes 20/12/6 且 `clippedNodes:0`——按 `report.md:23` 定义，可见数少于总数是落在内部滚动区、可滚到，被裁剪才算失败，故达标。这一致性在组件层由 `ui/network/network-workbench.mjs:7` `nodes.length>10?'list':'topology'` 与 `:14` `slice(0,10)` 保证。
  - **「详情可访问」有实测**：每例都产出 `detail` 列（1440 两列 `1092px 280px`、1024 单列但 `primary 976`/`detail 976`），`three-640-light` 的 `checks.topology-layout=true`（拓扑 `absolute/edges-visible` → `grid/static/edges-none`）证明窄窗降级后节点仍可点、详情仍在。
  - **「状态语义真实」部分达标**：`three-stale-1024-dark` 的 `staleVisible:true`，组件在 `ui/network/network-workbench.mjs:23` 输出「节点数量未核对 / 发现数量未核对」、`:33` 输出「执行状态未核对」，且 `:23` 第三格与 `:33` 的「授权」恒为「派发权限未核对」——**不谎报健康**这一点有源码 + 截图双重佐证。
  - **不达标的那一条：离线**。`docs/ux/network-workbench-preview/report.md:33` 原文：「离线/offline 设备专属视觉状态——组件当前没有该状态（DOM 与 CSS 中都无对应类名），fixture 无法呈现故未构造」。我核对 `ui/network/network-workbench.mjs`（34 行，仅 `local`/`stale` 两种语义）与 `ui/network/network-workbench.css`（无 offline/disabled 命中），**确认属实**。A10 判据点写的是「含重名/离线/unknown」，故整项**不能记 PASS**。
  - 自动化：`scripts/network-workbench.test.mjs`（25 行，10 个）含 `30 nodes default to complete searchable list and allow topology switch`、`stale snapshot never presents live counts or verified execution status`、`10 nodes retain complete topology while 30-node topology explicitly points to full list`、`topology exposes narrow-container arrangement notice without relying on window geometry`、`local running count stays unknown unless every catalogue state is explicitly running or idle`、`missing data, long names and IDs do not invent local center or endpoint addresses`。
- **生产验证：NOT RUN｜真双机：NOT RUN**
- **缺什么**：（1）~~生成器~~ **已补齐**（task-2 `network-evidence`，产物见 §1.5，11/11 例 PASS）；（2）**「离线」这一判据点本身要先有产品决策**：要么给 `NetworkWorkbench` 增加 offline 视觉态并在 fixture 里构造，要么把 A10 判据点里的「离线」改写为「失联/过期（stale）」。当前状态是**判据要求一个组件不存在的状态**，这是需求与实现的缺口，不是取证缺口；（3）真实 30 节点与真实离线节点，验证「状态语义真实」——静态坏数据造不出真实离线（`report.md:33` 亦列入 NOT RUN）。

### A11 — Leader 离线 / Task uncertain：不显示成功、不自动重试、任务停止自动推进

- **原型证据：NOT RUN —— 且这不是「生成器没跑」，是证据形态不存在**
  - Network 的 11 例（§1.5）没有任何 `uncertain` / Leader 离线用例；看板的 19 例也没有。两份产物的 `notRun` 列表可交叉验证：`docs/ux/task-board-preview/preview-validation.json` 的 `notRun` 5 条首条即「真实 Team/M6 审批派发与验收」，`docs/ux/network-workbench-preview/report.md:33` 的 5 条 NOT RUN 里也没有 uncertain 项——**两边都没打算用静态 fixture 造 uncertain**，因为 uncertain 是状态机语义，不是几何。
  - 组件侧也无处可截：`uncertain` 是 Team 协调器状态（见下方 L3 用例名），而 Network/看板两个组件接受的都是**只读投影**（`ui/network/network-workbench.mjs:1` 注释「never conveys dispatch authority」；`ui/tasks/room-task-board.mjs:1` 注释「existing Room owns every task mutation」），根本不渲染 Team 执行状态。
- **真双机：NOT RUN｜生产验证：NOT RUN**
- **现仅有 L3**：`scripts/team-coordinator.test.mjs`（242 行，21 个）含 `wake failure remains uncertain and is not retried`、`disconnect expires lease and retains uncertain capacity`、`unstarted dispatch expires into uncertain rather than reserving forever`、`late progress and result remain auditable without freeing uncertain execution`、`reconcile tombstone prevents a delayed dispatch from ever waking`、`archive blocks new Team dispatch but preserves result and reconciliation authorization`；`scripts/team-state.test.mjs` 6 个含 `acknowledgement is not running and success requires review`。
- **缺什么**：真双机把 Leader 断网，然后在**真实 UI** 上看 uncertain 是否被渲染成「未确认」而不是成功/进度条；再确认没有可见的自动重试与自动推进。测试证明的是状态机，不是界面。
  - 补充（本次复核新增）：静态 fixture **理论上能不能** 造 uncertain？可以造一个假状态喂给组件，但**当前没有组件消费这个字段**，所以造出来也只是「渲染了一个没人用的 prop」，不构成判据覆盖。要么先在真机上确认 uncertain 到底出现在哪个视图（Owner 面板？Team 页？），要么接受这一项只能靠 L3 + 真机，**不要再指望补生成器**。

### A12 — 计划未批准 / Review 未通过：UI 不提供越权入口，权限由后端二次验证

- **原型证据：NOT RUN（部分，判据点已从「无对应原型截图」升级为「有实测但缺两条流程态」）**
  - **「UI 不提供越权入口」这一半有实测 + 源码双重佐证**：`docs/ux/task-board-preview/preview-validation.json`（1734 行 / 19 例全 `verdict:"PASS"`、`failedChecks:[]`，详见 §1.5）覆盖 6 个 fixture（`board` 6 行 5 组、`board-empty` 0 行、`board-few` 2 行、`board-many` 12 行 5 组、`board-long` 3 行）；`ui/tasks/room-task-board.mjs:5` 每行只渲染成 `button`，`onClick` 只调 `props.onOpenRoom?.(row.roomId)`——**没有派发、批准、合并任何一个控件**，源码层面就不存在越权入口。
  - **只读语义有实测文案**：scope 行「跨房间任务汇总 · 当前返回的 Room 任务；进入房间查看和核对，**不代表 Team 执行或成果验收**」；已归档 Room 带「 · 已归档」标注（`board-many` 用例实证）；`future`/`merged` 渲染成「未知状态 · 原值」而非猜测为已完成——这正对应 A12 要防的「越权把未通过的东西显示成通过」。
  - **达标不了的那一半**：判据点里的「**计划未批准**」与「**Review 未通过**」两条**流程态**，两个生成器的 fixture 都没构造（`board` 系列只有 open/doing/blocked/done/unknown 五态；`notRun` 首条明写「真实 Team/M6 审批派发与验收」未做）。`ui/models/room-task-board.mjs:6` 的 `states` 里根本没有 `pending-approval` / `review-rejected` 这类状态，**组件不建模这两条流程**，所以截图无从谈起。
- **真双机：NOT RUN｜生产验证：NOT RUN**
- **现仅有 L3 + 审计记录**：`scripts/m3-review-regression.test.mjs`（923 行，21 个）；`scripts/room-task-board.test.mjs` 含 `task controls require leader or exact complete owner identity`、`stable Room/task identity preserves namesakes and unknown states while excluding deleted`；`scripts/team-service.test.mjs` 含 `Team service defaults closed and never accepts a self-reported actor`。
  - 已知 UI 缺陷线索（`docs/ux/ux5a-capability-audit.md`）：`:21` `TaskItem` 的 `mine` **只比较 `assignee.sessionId` 未比较 `nodeId`**，跨机器同名 human/session 可能错误显示状态按钮（**后端仍按精确 key 拒绝，无授权绕过**）；`:27` 现有 Owner 面板 `switch` 无 `teamStatus` 只读路由；`:29` `succeeded` 使 task 进入 `review` 不等于 `accepted`。
- **缺什么**：（1）~~生成器~~ **已补齐**（task-3 `board-evidence`，19/19 例 PASS）；（2）**「计划未批准 / Review 未通过」两条流程态在组件里不存在**——先确认真机上这两条流程到底由哪个视图承载（大概率不在 `RoomTaskBoard` 这个跨房间只读看板上），再决定是补 fixture 还是改判据点表述；（3）真机走一遍这两条路径，确认界面上没有任何派发/合并按钮；同时验证后端二次校验真的拒绝（要看到拒绝响应，不是看到按钮消失）——**按钮消失 ≠ 权限生效**，这条始终需要真机 + 真实后端响应。

### A13 — 深/浅主题与键盘操作：对比度、焦点可见、菜单可用、颜色不是唯一状态依据

- **原型证据：PASS（部分，范围明确受限）**
  - 对比度：`docs/ux/ux0/contrast-validation.json` 12 对全 pass（数值见 §1.2）；但 scope 原文自述「Only listed prototype text pairs; **not a full accessibility audit**」。
  - 主题切换：`docs/ux/ux0/preview-validation.json` interaction `dark theme toggle` 与 `theme preserves room draft` 均 pass。
  - 焦点：`docs/ux/ux2b-body-preview/browser-focus.json{collapsedLinkBlocked:true, copyReachable:true, expandedLinkFocusable:true}`（折叠态用原生 `inert` 挡住隐藏链接的键盘焦点）；`scripts/inbox-workbench-component.test.mjs` 含 `Escape closes selection and returns focus to its own row`、`detail provides a focus target when the selected list becomes hidden`；`scripts/room-tabs.test.mjs` 含 `keyboard arrows and Home/End select and focus exact peer tab without global DOM access`；`ui/shell/discover-projects.mjs:9` 与 `ui/room/message-body.mjs:26` 分别有 `aria-live:"polite"`。
  - 颜色非唯一依据：状态语义由文本承担（如「前往房间（不定位具体消息）」明确不伪造），但**没有专门的「颜色不是唯一状态依据」取证**。
- **生产验证：NOT RUN**
- **缺什么**：真机焦点可见性（focus ring 在深浅两主题下的实际可见度）、菜单键盘可达、完整无障碍审计（当前只测了列出的 12 对文本，且 `aria-disabled` 在 `ui/` 里 0 命中，意味着禁用态可能缺少语义）；另需补「颜色不是唯一状态依据」的专项取证。

### A14 — DSH 版本兼容与 UI 回归：panel-check / Schema / Composer 无退化，记录真实数量

- **类别**：这一项不是视觉项，「原型截图证据」列不适用。
- **门禁数据（本会话 v0.4.21 实测，逐条执行、各自 exit 0）**：完整 **499/499**（0 fail / 0 skipped / 0 todo，duration_ms 102562.45，`DSH_HOME` 隔离到临时目录）、**panel 283/283**（`panel check ok`）、**schema 82/82**（`schema check ok`）、**Composer PASS**（`DSH 0.2.2-rc.3, 4 public client entry points; no private-import requirement`）、构建 `node scripts/build-client.mjs --check` → `client UI blocks match source`、`shared documents smoke passed`（自述 not physical-device/model acceptance）。上一批 491 已随新增 8 个用例升到 499（3 个已读回滚回归 + 2 个版本一致性 + 5 个历史索引，其中历史索引 1 例为改造后重跑、其余 4 例新增）。版本快照：`docs/ux/ux0/reference-validation.json` `dshUiVersion 0.0.87`、`dshMeshSha 8e105334...`、6 个参考文件 sha256 全 match；`docs/ux/ux0/protection-validation.json` 13 个受保护文件 `unchanged:true`、`headUnchanged`/`indexUnchanged` 均 true。
- **生产验证：NOT RUN**
- **已知风险**：`docs/ux/progress.md` 记 0.4.19 时「SDK 门禁因 rc.1/rc.3 不符未通过」；`docs/ux/progress.md:12` 记 0.4.7 的真实加载截图**当场暴露样式问题**，故真实宿主上的兼容从未被视觉确认。
- **缺什么**：(1) ~~门禁未复现~~ **已复现（见上，494/283/82/Composer 均为本会话实际执行）**；(2) 真实宿主版本上加载并目测，记录宿主版本与插件版本的精确配对（当前只是 `composer-compat-check` 解析到的宿主版本，不是人眼确认的界面加载）；(3) 说明 rc.1/rc.3 差异是否已彻底消解——本机解析到 rc.3 且门禁 PASS，但换机若解析到 rc.1 必须重新核对安装位置与实际版本，不能改矩阵绕过断言。

### A15 — 断网后重新连接 / 页面重载：状态解释正确、已保存消息/文档/设置不丢

- **原型证据：NOT RUN**
  - 只有静态 offline 态：`docs/ux/ux0/preview-validation.json` 每页 `offline` 态截图 `overflow:false` + interaction `offline has no healthy badge or running spinner` pass。这只证明「离线时**不显示**虚假健康徽标」，不证明重连行为。
  - 断线/重连自动化：`grep '断线'|'重连'|'离线'` 在 `scripts/` 下 **0 命中**。间接覆盖只有：`scripts/room-discovery.test.mjs` `same peer restarting on another HTTP port triggers a fresh synchronization callback`、`discovering a peer fetches projects created before this node came online`；`scripts/static-peers.test.mjs` `a failed static target retains dirty state and receives local history after recovery`；`scripts/mesh-diagnostics.test.mjs` 16 个（只读诊断，不测断网 UI）；持久性侧 `scripts/inbox-read.test.mjs` `queued room reads survive shutdown and never publish a stale unread record`、`scripts/room-composer-drafts.test.mjs` `room composer fields are isolated by node, actor and room`。
- **真双机：NOT RUN｜生产验证：NOT RUN**
- **缺什么**：真机 + 真断网：断开→页面状态解释正确→恢复连接→状态自动纠正；再做一次页面重载，确认已保存消息/文档/设置与草稿不丢。这一项的判据 100% 无法用现有 fixture 覆盖。

---

## 4. 结论与建议优先级

**总体结论**：15 项里，原型截图层只有 A02、A03、A13 三项算 PASS（且 A13 的对比度范围自述不是全面审计）；A05、A10、A12 三项在本次复核后**有了实测数据但仍不能记 PASS**（各有半个判据点没有对应证据形态）；其余 9 项只有自动化（L3）或仅有历史资产。**生产界面验证 0/15、真双机 0/5**。用一句话概括：这个仓库现在有很强的**脚本级正确性证据**和一套**覆盖面已相当完整的组件几何取证**（Network 11 例 + 看板 19 例 + Inbox 7 例 + ux0 29 例），但**没有一次真实界面验收**；而 UX-6 的判据本身（「不被遮挡」「状态语义真实」「数据与 UI 最终一致」「已保存内容没有丢失」）恰恰都是只能在真实环境里成立的。

**最该先补的三件事（按性价比排序）**

1. ~~**补齐 Network 与任务看板的取证生成器（task-2 / task-3）。**~~
   **本次复核已完成，结果如下**：`scripts/network-workbench-preview.mjs` 与 `scripts/task-board-preview.mjs` 均已入库；产物 `docs/ux/network-workbench-preview/preview-validation.json` **2664 行 / 11 例全 PASS**、`docs/ux/task-board-preview/preview-validation.json` **1734 行 / 19 例全 PASS**，`runtimeErrors:[]`、每例 `overflow:false`/`rootOverflow:false`、`clippedNodes:0`/`clippedRows:0`。**A10 的 1/3/10/30 四档、拓扑↔列表一致、详情可访问、stale 不谎报健康，以及 A12 的「看板只读、无任何派发/合并/批准控件」现在都有可复现证据**（§1.5）。上一批看板唯一的 FAIL（`board-1440-light-main640` 主区 640 时窄布局不生效）也已转为 PASS。
   **但补完生成器后暴露出一个更根本的缺口，它取代了这一条成为新的第 1 优先**：A10 判据点里的「**离线**」和 A12 判据点里的「**计划未批准 / Review 未通过**」，在组件里**根本不存在对应状态**——`docs/ux/network-workbench-preview/report.md:33` 明写「组件当前没有该状态（DOM 与 CSS 中都无对应类名），fixture 无法呈现故未构造」，我核对 `ui/network/network-workbench.mjs`（34 行，仅 `local`/`stale`）确认属实；`ui/models/room-task-board.mjs:6` 的 `states` 也完全没有审批/评审相关状态。**这不再是取证问题，而是「验收判据要求了一个产品没有实现的状态」——继续加生成器也补不出来，必须先做需求侧定性。**
（生成器这条清掉之后，原第 2、3 条顺位前移，且上面那段「判据要求了不存在的状态」成为新的第 1 优先——它决定了 A10/A12 到底要不要改判据。）

2. **安排一次真实 DSH React 实例的目测（1440 / 1280 / 1024 三档 + 深浅主题 + 键盘）。**
   一次会话同时解锁 A01（折叠态 70px，当前零测量）、A02、A07、A13 的「生产界面验证」列。这是把 3 项原型 PASS 往生产推进的最短路径，成本是一个实例 + 一次人工走查；而 A01 的折叠判据目前**完全无证据**，是矩阵里最令人不安的一块。
3. **安排一次真双机联调（同名 Agent + Leader 断线 + 断网重连）。**
   一次联调覆盖 A05（同名精确路由）、A08（真实上传失败保草稿不重复）、A11（Leader 离线显 uncertain）、A15（重连与重载持久性），并顺带验证 A09/A10 的真实离线/归档语义。这四项目前全是 L3 自动化，按 `docs/ux/ux0/product-baseline-v1.md:261` 的口径不得记为通过。

**附带建议**：A14 的门禁数字已在 v0.4.21 本会话逐条复现（499/499、283/283、82/82、Composer PASS@rc.3、build `--check` 一致），因此它从「文档陈述」升级为实测；仍缺的是真机上「宿主版本 ↔ 插件版本」的**视觉**配对不对任何自动化能替代——`docs/ux/progress.md:12` 记过真实加载当场暴露样式问题，`docs/ux/progress.md:54` 记过 rc.1/rc.3 不符。门禁 PASS 不等于界面在宿主里长得对。

---

## 5. 复现命令与本报告的证据边界

可一键复现的（本会话已由生成器刷新，非本次会话执行）：
- `npm run preview:inbox` → 刷新 `docs/ux/inbox-workbench-preview/preview-validation.json` 与 7 张截图（A03 的主力证据）。
- `docs/ux/ux0/preview-validation.json`、`contrast-validation.json`、`reference-validation.json`、`protection-validation.json` 为其各自生成器的产物（A02/A13/A14 的证据）。
- `scripts/network-workbench-preview.mjs` → `docs/ux/network-workbench-preview/preview-validation.json`（2664 行 / 11 例，A10 的主力证据，见 §1.5）。
- `scripts/task-board-preview.mjs` → `docs/ux/task-board-preview/preview-validation.json`（1734 行 / 19 例，A12 的主力证据，见 §1.5）。

**注意：这两个生成器我没有复跑。** 复跑会覆盖 task-2/task-3 刚刷新的产物，按分工不该由本报告去动它们。本报告引用的是「产物里自证 PASS + 我逐例核对了数字与 `report.md` 表格」这种双重核对结果，属于 L2 引用，不是本会话的实测执行。

**复核后补记（主 Agent 2026-11-17）**：`npm run preview:board` 已由主 Agent 复跑，exit 0、`19 cases, 0 FAIL, 0 runtime errors`，`preview-validation.json` sha256 前 16 位 `E71291A5692FBDCF`（连跑两次一致）；`scripts/network-workbench-preview.mjs` 由其作者复跑 11/11 PASS。因此 §1.5 的两份产物现在都有「复跑可复现」记录，但**复跑仍只是组件 + 模拟数据的几何取证，生产界面验证与真双机列的地位不变**。

**不要**为了本任务执行 `scripts/panel-check.mjs`：该脚本 `:694-697` 会把 fixture HTML 写进 `docs/ux/ux2a-message-preview`、`ux2b-body-preview`、`ux2c-room-preview`，会改动其它文档；且其自述「It is not a browser: styles, layout and real slot behaviour are out of scope」，本来也证明不了视觉判据。

本报告的边界：只读文件 + 引用既有产物，未执行完整测试套件，未启动真实 DSH 实例，未使用第二台机器，未复跑任何 preview 生成器。任何标 PASS 的行都给出了可复查的文件路径与数字；任何没有证据的判据点都标了 NOT RUN。

**边界更新（本次复核）**：Network 与任务看板的生成器入库后，本报告对这两块的处理从「一律不引用」改为「引用但标注未复跑」。这条改动只影响 `§0.3`、`§1.5`、`A05`、`A10`、`A12` 与 `§4`；**其余各节的判定与第 1 节其余数字一字未动**。
