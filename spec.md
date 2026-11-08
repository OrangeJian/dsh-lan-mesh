# 局域网协作：全屏接管（自有侧边栏）

## 目标

点击原生侧边栏的「局域网协作」图标后，整个窗口切换为插件自己的界面：左侧是插件侧边栏（替换原生侧边栏），右侧是内容区；用户可以从侧边栏一键回到原生对话。

## 需求（逐条可验收）

1. 点击原生侧边栏图标 → 出现全屏接管层，覆盖原生侧边栏与主内容区。
2. 接管后的侧边栏自上而下为：
   - 品牌行「局域网协作」（小字提示当前节点身份）
   - `‹ 对话`：关闭接管层并回到原生对话
   - `收件箱`（带未读数）
   - `任务看板`（带任务数）
   - `项目`（标题右侧 `+` 展开新建表单）：本节点已加入的房间列表；其下「可加入」房间带「加入」按钮
   - `Agents`（标题右侧 `+` 打开 Agents 全量视图）：本机常驻 agent 会话（`imported === true`）∪ 已被拉进房间的会话（`rooms.length > 0`）；空态「还没有 Agent」
   - 底部：本机身份（可点改昵称）
3. 点击侧边栏房间 → 右栏打开该房间（既有 RoomPane）。
4. 点击侧边栏 Agent 会话 → `uiWorkspace.openSession(sessionId)` 打开原生会话，接管层关闭（即"跳转回原有对话"）。
5. 接管层默认视图为 `收件箱`。
6. 既有能力全部保留且可到达：收件箱（未读、截断/展开、点房间跳转）、任务看板、房间收发/任务/文件、Agents 全量视图（引入/联络/新建）。
7. `node scripts/panel-check.mjs` 全绿。

## 决定（已定，不再讨论）

- 方案：`shell.overlay` 全屏覆盖层接管（用户已选定）。不修改原生侧边栏，不注册 `sidebar.workspaces`。
- `main` 槽（key `dsh-lan-mesh`）只放启动器：挂载即开覆盖层，卸载即关。原生侧边栏点击会把 `main` 挂到该 key 上，因此点击图标天然触发接管。
- 覆盖层容器需 `pointer-events:auto`（`shell.overlay` 的图层本身是 `pointer-events:none`）。
- 退出方式：`对话` 按钮；不绑定 Esc（避免打断房间输入框里的 Esc）。
- 首页视图移除；`项目` 直接列出房间，`可加入` 房间并入 `项目` 区块；`Agents` 全量视图承接原首页的 AgentCatalogue。
- 侧边栏 Agent 区块只显示本地会话（远端会话留在 Agents 全量视图，避免点击无效）。

## 文件与改动

### 1. `client.js`

#### 1.1 模块级覆盖层状态（放在 `MeshPanel` 之前）

```js
const takeover = { open: false, listeners: new Set() };
function setTakeoverOpen(next) { /* 幂等；同步 listeners */ }
function useTakeoverOpen() { /* useState + effect 订阅，返回布尔 */ }
```

#### 1.2 新组件

- `MeshLauncher()`：`useEffect(() => { setTakeoverOpen(true); return () => setTakeoverOpen(false); }, [])`，返回 `null`。
- `MeshOverlay(props)`：`const open = useTakeoverOpen(); if (!open) return null;` 返回
  `h('div', { className: 'lm-takeover' }, h(MeshPanel, { openSession: props.openSession, onExit: props.onExit }))`。
  注意 `if` 必须在任何 hook 之前返回（关闭时不占 hook 位）。

#### 1.3 `Rail` 重写（替换现有 `NAV_ORDER` 导航）

- 顶部品牌行：`lm-brand` + 标题 + 本机节点 `nodeId`（小字）。
- `对话` 行：`className: 'lm-navBtn lm-conversation'`，`title: COPY.exitHint`，`onClick: props.onExit`，文案 `‹ ${COPY.conversation}`。
- 导航：仅 `收件箱`、`任务看板`（`props.view` 高亮）；计数沿用 `navCount`。
- `项目` 区块：
  - 头部 `lm-sectionHead lm-projectsToggle`：`项目 (n)` + 右侧 `+` 按钮（`props.onCreateOpen(true)`，`disabled` 当表单已开）。
  - 表单沿用现有 `createOpen/newName/newTopic` 逻辑（放在区块内，不再放 `lm-railFoot`）。
  - 房间行沿用 `lm-roomRow`，`onClick` → `props.onSelect(room.id)`，未读数 `lm-roomUnread`。
  - `可加入` 子标题 + 现有 `lm-joinRow`（`props.joinable` / `props.joinBusy` / `props.onJoin`）。
- `Agents` 区块：
  - 头部 `lm-sectionHead lm-agentsToggle`：`Agents (n)` + `+`（`onClick: props.onViewAgents`）。
  - 行：`button.lm-agentRow`（`lm-dot` 状态点、名称 `row.title || row.name`、`row.workspace` 小字，有房间时附加房间数）；`onClick: () => props.onOpenAgent(row.id)`。
  - 空态 `COPY.noAgentsRail`。
- 底部 `lm-railIdent`：原 `lm-ident` 身份块（昵称内联编辑）移到最下方；`lm-railFoot` 删除（新建入口已进 `项目` 区块）。
- 删除 `NAV_ORDER` 中的 `home`、`rooms`；保留 `navLabel` 映射到 `inbox`/`board`/`agents`，供 RoomPane 的返回文案使用。

`Rail` 新增 props：`agents`（已筛选）、`joinable`、`onSelect`、`onOpenAgent`、`onViewAgents`、`onExit`。

#### 1.4 `NavView`

- 删除 `home` 分支（含身份/在线节点/可加入/Agent 卡片的首页渲染）。
- 新增 `view === 'agents'`：`lm-emptyPane` + 头部（`COPY.agents` 标题 + 说明 + 刷新）+ `AgentCatalogue`（沿用现有 props）。
- `view === 'inbox'` / `'board'` / `'rooms'` 分支保持不变。
- 未识别的 view 兜底为 `InboxPane`（默认收件箱）。

#### 1.5 `MeshPanel`

- 默认 `view` 由 `'home'` 改为 `'inbox'`；`goHome` 改为 `goInbox`（`setSelectedRoom(''); setView('inbox')`），用于退房后回落。
- 新增 `onExit` prop 透传给 `Rail`。
- 计算侧边栏 agents：
  ```js
  const railAgents = (agents.local ?? []).filter(
    (row) => row.imported === true || (Array.isArray(row.rooms) && row.rooms.length > 0),
  );
  ```
- `openRoom` 仍为 `setSelectedRoom(id); setView('rooms')`（本轮不改已读逻辑）。
- `onOpenAgent(id)`：`props.openSession?.(id)`；返回 `false` 时 `flashRail(COPY.sessionUnavailable, true)`。
- 向 `Rail` 传 `agents: railAgents`、`joinable`、`onSelect: openRoom`、`onOpenAgent`、`onViewAgents: () => { setSelectedRoom(''); setView('agents'); }`、`onExit: props.onExit`。

#### 1.6 注册

```js
register('the room panel', () =>
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: 'dsh-lan-mesh' }, () => h(MeshLauncher)),
  ),
);
register('the takeover layer', () =>
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'dsh-lan-mesh-overlay' }, () =>
      h(MeshOverlay, { openSession, onExit: leaveTakeover }),
    ),
  ),
);
```

`leaveTakeover`：`setTakeoverOpen(false)` + `layout?.selectPanel?.(null)`（try/catch）。
`openSession`：打开成功后追加 `setTakeoverOpen(false)`（再 `selectPanel(null)`），保证从 Agent 行/成员 chip 跳回会话时接管层关闭。

#### 1.7 COPY（中英各补）

`conversation`、`exitHint`、`projects`、`joinableShort`（可加入）、`noAgentsRail`、`sessionUnavailable`、`inboxHint`、`boardHint`、`agentsHint`、`agentsResident`（常驻）、`agentsInRoomsUnit`（房间）。

#### 1.8 CSS

```css
.lm-takeover{position:absolute;inset:0;z-index:1;display:flex;pointer-events:auto;background:var(--dsw-alias-bg-base)}
.lm-brand{display:flex;align-items:baseline;gap:8px;padding:4px 2px 10px}
.lm-brandTitle{font-weight:700;font-size:14px}
.lm-sectionHead .lm-sectionAdd{margin-left:auto;...}
.lm-agentRow{display:flex;align-items:center;gap:8px;...}
.lm-agentName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-agentMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-railIdent{margin-top:auto}
```

`.lm-rail` 保持 300px；`.lm-root` 不变（在 `.lm-takeover` 内 100% 高）。

### 2. `scripts/panel-check.mjs`

- fixture：
  - `sessions` 增补 `session-2`（无 rooms、非 imported）。
  - `agents.agents` 本地行补 `imported` / `rooms`：`session-1` → `imported: true, rooms: ['room-1']`；新增 `session-2` → `imported: false, rooms: []`；新增 `session-3` → `imported: true, rooms: []`（验证"常驻"）。远端行保留。
- harness：
  - `const launcher = registrations.find(e => e.definition.name === 'main').component;`
  - `const overlayReg = registrations.find(e => e.definition.name === 'shell.overlay');`
  - 新增 `resetHooks()`：清空 `stateSlots/effectSlots/refSlots`、`cursor = 0`。
  - 启动：`resetHooks(); renderOnce(launcher); await settle();` → `resetHooks(); renderOnce(overlayReg.component); await settle();`
  - 后续点击只重渲染 overlay。
- 断言（新增/调整）：
  - `the launcher opens the takeover`：启动后存在 `lm-takeover`。
  - `the takeover hides the native shell`（存在覆盖层根节点即可）。
  - 侧边栏包含 `lm-conversation`、`收件箱`、`任务看板`、`lm-projectsToggle`、`lm-agentsToggle`。
  - `the projects section lists the rooms I joined`：`lm-roomRow` 数为 2。
  - `the agents section lists resident and room sessions`：`lm-agentRow` 数为 3（含 session-2 非常驻且无房间被排除）。
  - `clicking a rail agent opens that conversation`：点 `lm-agentRow`（session-3）→ `opened` 含 `session-3`；再次渲染接管层已关闭（`renderOnce` 返回 null）。
  - 既有收件箱/房间/任务断言改为在接管层内运行，逻辑不变。

## 验证

1. `node scripts/panel-check.mjs` — 全部断言通过。
2. 手动（可选）：`npm` 启动 DSH → 点侧边栏图标 → 覆盖层出现 → 点 `对话` 回到原生；点房间/Agent 行跳转。

## 不在本轮范围

- 打开房间即标已读（`roomRead`）。
- 收件箱按房间聚合未读 + 定位最早未读。
- `outgoing` 判定对远端 human 的误判修复。
