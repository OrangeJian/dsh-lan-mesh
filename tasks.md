# Tasks：局域网协作全屏接管

> **状态：v0.2 规划记录，已被后续实现取代，仅作历史留档。**
> 实际落地的是 `MeshNavigation` 状态机（`NAV_KEY = 'dsh.lanmesh.navigation'`）+ `registerModeShadow('sidebar.workspaces')` 条件槽注册，不是本文件写的 `MeshLauncher` / `MeshOverlay` / `shell.overlay` 两阶段覆盖层。当前验证数字见 `README.md`「验证」一节。

- [x] 1. **COPY**：在 `COPY_ZH` / `COPY_EN` 补充 `conversation`、`exitHint`、`projects`、`joinableShort`、`noAgentsRail`、`sessionUnavailable`、`inboxHint`、`boardHint`、`agentsHint`、`agentsResident`、`agentsInRoomsUnit`。
- [x] 2. **CSS**：新增 `.lm-takeover`、`.lm-brand`、`.lm-brandTitle`、`.lm-sectionAdd`、`.lm-agentRow`、`.lm-agentName`、`.lm-agentMeta`、`.lm-railIdent`；确认 `.lm-root` 在覆盖层内占满。
- [x] 3. **覆盖层状态**：模块级 `takeover` store + `setTakeoverOpen` + `useTakeoverOpen`；`MeshLauncher`；`MeshOverlay`。
- [x] 4. **Rail 重写**：
  - [x] 品牌行 + `对话`（`onExit`）
  - [x] 导航：收件箱 / 任务看板（保留计数）
  - [x] `项目` 区块：`+` 展开新建表单、`lm-roomRow` 列表、`可加入` + `lm-joinRow`
  - [x] `Agents` 区块：`+` → `onViewAgents`、本地筛选行 `lm-agentRow`（点击 `onOpenAgent`）、空态
  - [x] 身份块移到底部；移除 `lm-railFoot` 与旧 `NAV_ORDER`（home/rooms）
- [x] 5. **NavView**：删除 home 首页渲染；新增 `agents` 视图（`AgentCatalogue`）；未识别 view 兜底为收件箱。
- [x] 6. **MeshPanel**：默认 view 改 `inbox`；`goHome` → `goInbox`；新增 `onExit`、`railAgents` 筛选、`onOpenAgent`、`onViewAgents`，并传给 `Rail`。
- [x] 7. **注册**（v0.2 规划，已不适用）：`main` → `MeshLauncher`；新增 `shell.overlay` → `MeshOverlay`；`leaveTakeover`；离开面板时由 launcher 卸载关闭覆盖层。实际为 `MeshNavigation` 状态机 + `registerModeShadow('sidebar.workspaces')` + `MeshRailHost`。
- [x] 8. **panel-check.mjs**（v0.2 规划，已不适用）：fixture 增补会话/agent 字段；harness 改为 launcher → overlay 两阶段渲染 + `resetHooks`；新增接管层 / 侧边栏 / 项目 / Agents / 跳转断言，调整受影响的旧断言。实际 harness 为单阶段渲染 + `resetHooks`，并新增待确认通知交互断言。
- [x] 9. **验证**：v0.2 当时 `panel-check.mjs` 89/89、`rooms.test.mjs` 49/49；当前 `panel-check.mjs` 99/99、`rooms.test.mjs` 49/49。
