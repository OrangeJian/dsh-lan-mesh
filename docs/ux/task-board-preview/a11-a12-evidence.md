# A11 / A12 任务看板只读展示取证

- 基线：`415d9f229f1d3c6c4859d4392a92b720f112fee0`（worktree `ux-task-evidence`，分支 `OrangeJian/ux-task-evidence`）。
- 口径来源：`docs/ux/ux6-matrix-report.md` §0 / §2 / §3（A11、A12）与该报告引用的 `docs/ux/ux0/product-baseline-v1.md:261`。
- 本文件只记录**我从文件和实测里看到的东西**。它补齐的是 A11/A12 的**看板只读展示（L2/L3）**，**不把这两项矩阵判为 PASS**：生产界面验证（L0）与真双机（L1）仍是 NOT RUN。

## 1. 方法与约束

只用**既有字段和既有状态**构造场景，没有新增组件状态、状态机字段、审批/评审字段或派发通路：

- 唯一被注入的字段是 `ui/models/room-task-board.mjs:9` 已经读取的自由文本 `task.status`。
- 唯一被利用的状态是同一行已经存在的回退：`states=['open','doing','blocked','done','unknown']`，凡不属于前四者一律 `state='unknown'`，且 `statusLabel = '未知状态' + (task.status ? ' · ' + task.status : '')` —— **原值被保留，不会被猜测成已完成/已验收**。
- 没有改动 `ui/tasks/room-task-board.mjs`、`.css`、`ui/models/room-task-board.mjs`；没有触碰 Team 状态机、权限、Owner 面板等共享入口（`ui/shell/workspace-surfaces.mjs` 只读未改）；没有改任何生产派发代码。
- 样本值取自代码库里**已经存在**的状态名：`uncertain`/`planned`/`review`/`accepted`/`succeeded` 见 `ui/shell/workspace-surfaces.mjs:97` 的 Team 标签表（`待人工核对`/`已计划`/`待审查`/`已验收`/`已提交结果`）。它们被当作 `task.status` 的取值喂给只读投影，用来检验看板遇到这类「权限/执行态」字样时的**只读边界**。

语义说明：这些值不是「看板新增了审批状态」，而是「即使上游把这类字样塞进 Room 任务状态，看板也不推断 Team 执行或成果验收，只如实显示『未知状态 · 原值』」。看板顶部 scope 行原文即「不代表 Team 执行或成果验收」（`ui/tasks/room-task-board.mjs:5`）。

## 2. 四个场景逐项结论

| 场景 | 构造方式（既有字段） | 看板实测呈现 | 展示半 | 状态机/实机半 |
|---|---|---|---|---|
| **uncertain**（A11） | `task.status='uncertain'`，经既有 unknown 回退 | `未知状态 · uncertain`，落在唯一「未知状态」组；无成功徽标、无进度、无重试控件 | **已取证**（L2+L3） | Team 执行态 `uncertain` 的真实流转与 UI 呈现：NOT RUN |
| **Leader 不可达**（A11） | **没有可注入的字段**：只读 Room 任务投影只消费 `status/assignee/room/lifecycle/detail/updatedAt`，没有 leader / 连通性字段 | 无法构造真实 Leader 断网；仅能显示其任务级后果（uncertain → `未知状态 · uncertain`） | **字段级 NOT RUN** | 真实 Leader 断网、`wake failure remains uncertain and is not retried`（`scripts/team-coordinator.test.mjs`）只在 L3 覆盖；实机 UI NOT RUN |
| **Plan 未批准**（A12） | `task.status='planned'`（代码库既有状态名「已计划」） | `未知状态 · planned`，不显示已完成/已验收，无批准/合并控件 | **已取证**（L2+L3） | 真实 M6/Team 审批未批准的流程态与后端二次校验：NOT RUN |
| **Review 未通过**（A12） | `task.status='review'`（代码库既有状态名「待审查」） | `未知状态 · review`，不把结果呈现为已验收，无验收/合并控件 | **已取证**（L2+L3） | 真实评审拒绝响应（`succeeded` 不等于 `accepted`）：NOT RUN |

对照样本 `accepted` / `succeeded` 同样回退为 `未知状态 · 原值`：证明看板**即使拿到「看起来像成功」的值也不会显示成功**，这是 A12「不显示成功 / 不提供越权入口」的核心证据，而不是把这两个值当成真的已验收。

## 3. 证据落点

### L3 — 字段/渲染层（`scripts/room-task-board.test.mjs`，7/7 PASS）

1. `authority-like statuses fall back to unknown with the raw value, never to success`：5 个值全部 `status==='unknown'`、`statusLabel==='未知状态 · <raw>'`、`counts.done===0`、只落在唯一 `unknown` 组。
2. `read-only board exposes no dispatch approve merge accept or retry control for authority states`：全部可交互元素只有 5 行按钮 + 1 个「刷新」+ 搜索框 + 状态/负责人两个筛选（`aria-label` 仅 `搜索房间任务`/`任务状态`/`任务负责人`）；控件文本不含「派发/批准/合并/验收/接受/重试」；点击每一行都只 `onOpenRoom('room-authority')`。

### L2 — 浏览器实测（`scripts/task-board-preview.mjs`）

- 新增 fixture `docs/ux/task-board-preview/board-authority.html`，由真实的 `RoomTaskBoard()` + `roomTaskBoardView()` 渲染；样式段由 `ui/tasks/room-task-board.css` 现算，生成器没有写死 DOM/CSS。
- 新增 2 例：`board-authority-1440-light-default`、`board-authority-1024-dark-default`，截图在 `docs/ux/task-board-preview/screenshots/` 同名 `.png`。
- 新增实测字段 `statusBadges` / `nonRowButtons`，新增检查 `authorityStatusBadges` / `noAuthorityControls`。两例实测值：
  - `statusBadges` = `["未知状态 · uncertain","未知状态 · planned","未知状态 · review","未知状态 · accepted","未知状态 · succeeded"]`
  - `nonRowButtons` = `["刷新"]`
  - `groupTitles` = `["未知状态 5"]`，`rows=5`
  - `authorityStatusBadges:true`、`noAuthorityControls:true`、`verdict:PASS`、`failedChecks:[]`、`runtimeErrors:[]`
  - `overflow:false`、`rootOverflow:false`、`clippedRows:0`、`overflowingText:0`
- 目录级 `preview-validation.json` / `report.md` 已由生成器刷新；连跑两次上述 JSON、报告与 fixture 的 sha256 一致（幂等）。
- 注意与矩阵口径一致：这是**组件 + 模拟数据的静态几何取证**，不是 DSH 宿主里的真机验收。

## 4. 明确 NOT RUN（不得据此把 A11/A12 记为通过）

1. **A11 Leader 不可达（连通性语义）**：无 leader/连通性字段，fixture 造不出真实 Leader 断网；只覆盖其任务级后果的展示。
2. **A11 不自动重试 / 任务停止自动推进**：属 Team 状态机行为，看板不渲染也不控制；静止截图无法观察，只有 `scripts/team-coordinator.test.mjs` 的 L3 断言（`wake failure remains uncertain and is not retried`、`disconnect expires lease and retains uncertain capacity` 等）。
3. **A12 后端二次验证拒绝**：「按钮消失 ≠ 权限生效」；需要真实后端返回拒绝响应，**静态截图不能证明权限生效**。
4. **A12 计划未批准 / Review 未通过的真实流程态**：看板不建模审批/评审状态；`succeeded` 进入 `review` 不等于 `accepted`（`team-state.test.mjs: acknowledgement is not running and success requires review`）。真实 Team/M6 审批与评审流程 NOT RUN。
5. **生产界面验证（L0）/ 真双机（L1）全部 NOT RUN**：需要真实 DSH React 实例、真实宿主主区宽度、真实键盘走查与第二台机器。
6. 原目录既有的 5 条 NOT RUN 原样保留（真实 Team/M6 派发与验收、真实宿主主区宽度、服务端裁剪、筛选点击交互、键盘 `focus-visible` 真 Tab 走查），完整列表在 `preview-validation.json` 的 `notRun` 与 `report.md` 的「明确 NOT RUN」。

**解除 NOT RUN 需要什么**：一次真实 DSH 实例 + 真双机联调，断网 Leader 后在**真实 UI** 看 uncertain 是否显示成「未确认」而非成功/进度条、有无可见自动重试；并真实走一遍审批未批准与评审拒绝，确认界面无越权入口**且后端确实返回拒绝**。本目录不能替代这一步。

## 5. 复现命令与退出码（本机实测）

```sh
node --check scripts/task-board-preview.mjs                                  # exit 0
node --test --test-concurrency=1 scripts/room-task-board.test.mjs           # exit 0, tests 7 / pass 7 / fail 0
node scripts/task-board-preview.mjs                                         # exit 0, 21 cases, 0 FAIL, 0 runtime errors
```

浏览器：`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`（headless=new + CDP）。

## 6. 改动范围（供 Codex 评审）

- `scripts/room-task-board.test.mjs`（+2 测试）
- `scripts/task-board-preview.mjs`（fixture + cases + 测量字段 + 检查 + NOT RUN + 报告措辞）
- `docs/ux/task-board-preview/board-authority.html`（新）
- `docs/ux/task-board-preview/screenshots/board-authority-1440-light-default.png`、`board-authority-1024-dark-default.png`（新）
- `docs/ux/task-board-preview/preview-validation.json`、`report.md`（生成器刷新）
- 本文件 `docs/ux/task-board-preview/a11-a12-evidence.md`（新）

未改：`ui/` 下任何组件/CSS/模型、`lib/`、`client.js`、`index.js`、`package.json`、`scripts/panel-check.mjs`、Team 状态机、权限与共享入口、任何生产派发；未执行 git push。
