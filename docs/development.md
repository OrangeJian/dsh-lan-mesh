# 开发过程

这份文档记录**为什么长成现在这样**：每个决定背后的约束、每次真机验证暴露的真 bug、以及踩过的操作事故。想看怎么用去看 [usage.md](usage.md)。

时间跨度：约三天，从「一个能互发消息的插件」长成「节点 + 房间 + agent 联邦」三层。

---

## 1. 需求是怎么长出来的

原始需求只有一句：**「同个局域网里面的多个 agent 进行互相通讯，用于协同办公或开发」**。

做到一半，用户补了关键一句：

> 一个人可以有多个 agent 会话，并加入到不同的房间。其实一个房间就相当于一个项目，大家各自负责不同的内容，共同完成同一个项目。只是不同的人会由房间的主 leader 来分配不同的任务。

这一句把「发消息」变成了**协作模型**，逼出三个设计决定：

1. 成员身份必须是「**节点 + 会话**」的组合，不能是「人」。一个人本来就有多个会话，还会跨机器。
2. 房间必须有 **leader** 角色和**任务**实体，否则「分配任务」无从表达。
3. 消息必须能**只发给同房间成员**，否则房间就只是个标签。

再后来是第三个需求：

> 参照 `@contexera/dsh-agent-team` 的做法，或者考虑在它基础上把想要的功能加上，譬如从其他 workspace 引入 agent，也可以从局域网其他人机器上引入。

这条把系统推到第三层：**agent 联邦**。

---

## 2. 三个岔路口

### 2.1 扩展 `@contexera/dsh-agent-team`，还是在别处做联邦层？

先读了它的源码和文档再决定。结论是**不在它上面加**，理由三条：

- 它的协作域是**一个 DSH home**。`ctx.agentTeam` 用 append-only ledger 重建全部状态，README 明确写「单 Host writer，M1 不支持多进程并发写同一 dshHome」。
- 它的「多 Workspace」是**同机纯关系**。`ledger.js` 里 joinWorkspace 的注释原文：*Participation is a pure relation — no Session is created or moved*，而且 `assertHumanActor(request.actor)` 限定只有人授权。它连「跨机器」这个概念都没有。
- 它是**闭源打包产物**（client.js 906KB、ledger.js 266KB），升级会覆盖改动。

同时确认了 `dsh-lan-mesh` 已经具备跨机所需的全部零件：UDP 发现、双向 HTTP 投递、节点身份、房间、工具、面板、远端唤醒。所以在自己这里加一层更省。

保留的借鉴只有一个：`TeamAgentImport.tsx` 的交互——「列出未加入的成员 → 点一下加入」。这直接成了面板里的「可加入的项目」。

### 2.2 传输用什么？

选 **UDP 广播发现 + HTTP JSON 直连**，且**零 npm 依赖**。

零依赖不是洁癖，是实测出来的硬约束：profile 的 `node_modules` 是 pnpm hoisted 布局，安装 bundle 时插件目录是 **symlink** 指回工作区，所以 `import '@deepseek-ai/schemastery'` 直接 `ERR_MODULE_NOT_FOUND`。于是：

- 配置不走 schemastery 的 `Config` 导出，改成手写 `resolveConfig()` + `DEFAULTS`（cordis 对没有 `Config` 导出的插件接受任意 config）。
- 只能 import `node:` 内置模块。

副作用是好的：插件没有任何线上依赖，装到哪都能跑。

### 2.3 面板怎么接 Host？

这一条走了最多弯路，见 §4.2。

---

## 3. 分层与它们各自的边界

```
index.js      Host 入口：10 个工具、/api/lan-mesh 路由（17 个端点）、系统提示、启动
client.js     面板：侧栏图标 + 两栏独立界面（左栏房间、右栏成员/聊天/任务）
lib/discovery.mjs  UDP 广播；只管「谁在线」，不碰业务
lib/transport.mjs  HTTP、信封规范化、HMAC 签名、状态/agent 清单交换；只管线
lib/service.mjs    MeshNode：把节点、房间、agent 三件事捏在一起
lib/rooms.mjs      纯函数：房间状态的唯一真相（无 socket、无 timer、无磁盘）
lib/agents.mjs     纯函数：agent 行投影、远端清单规范化、按 id/名字解析
lib/store.mjs      持久化：三个文件的原子写
```

边界是刻意的：`rooms.mjs` 和 `agents.mjs` **不碰 IO**。这带来两个好处——房间逻辑可以用 `node:test` 直接测（47 个用例，跑 250ms），合并语义可以被证明是幂等且可交换的。

`service.mjs` 是唯一知道「网络 + 磁盘 + agent 运行时」三者如何交汇的地方。它也因此最胖（65KB）。

界面重写成两栏时，这条边界又救了一次：所有「房间里有哪些人、谁在线、我能不能改名」的判断都在 Host 的 `#roomView`／`#roomRows` 里做完了，`client.js` 只负责画。所以两栏改造**没有动一行后端逻辑**（只补了 `rooms`／`roomRename` 两个端点和 `live`／`unread` 两个字段），前端由另一个 teammate 独立完成、靠 `docs/ui-contract.md` 对齐。

---

## 4. 真机验证抓到的 bug（这一节是本文档的核心）

所有 bug 都是**两个真实 DSH 实例对发**才暴露的，不是单进程冒烟能测出来的。每条的修法都比症状更深一层。

### 4.1 身份共享：两个实例互相看不见

**症状**：起了第二个实例（`DSH_LAN_MESH_PORT=45872`），两边 `/info` 都显示同一个 `nodeId: node-371946a3`，`peers: 0`。

**根因**：两个进程共用 `$DSH_HOME/lan-mesh/node.json`。而发现逻辑里有一条「忽略自己 nodeId 的回声」过滤——两边都是同一个 id，于是互相把对方当成自己的回声，永远看不见。

**修法**：存储按端口分槽。`meshRootDir(port)` 在 `port === DEFAULT_PORT` 时返回 `$DSH_HOME/lan-mesh/`，否则 `$DSH_HOME/lan-mesh/instances/<port>/`。默认端口保持原路径，是为了不丢已有节点的历史。

**教训**：「一个家庭一份身份」这种假设，在多实例场景下是第一类 bug 来源。

### 4.2 面板 RPC 从来没通过：`cannot get property "webServer" without inject`

**症状**：`POST /lan-mesh/snapshot` 永远 405。更糟的是，我一开始把它误判成「405 说明路由已挂上，只是认证拦了」——后来对照实验（`GET /definitely-not-a-route` 得 404、`POST` 得 405）才证明 405 来自 SPA fallback 的「未知路径 + 非 GET」，路由根本没注册。

**定位手法**：在插件里加文件探针，在注册前后各写一行日志。结果 `before-handle` 有、`after-handle` 永远没有 —— 说明 `connection.rpc.handle(...)` 抛了。再用 try/catch 抓出原文：

```
Error: cannot get property "webServer" without inject
  at dsh-client-connection/lib/index.js:871:35
```

**根因**：`ctx.inject(['connection','webServer'], scope => { const connection = scope.get('connection'); ... })` —— `scope.get()` 返回的是包在**外层 ctx** 上的 traceable 代理（cordis 的 `ReflectService.get` 用 `getTraceable(this.ctx, ...)`），而 `connection.rpc.handle` 内部 `owner.effect(() => owner.webServer.register(...))` 里的 `owner` 那个 ctx 看不到 `webServer`，于是属性访问抛错。

**修法**：改用 `connection.fetch.register({ path: '/api/<name>', methods: ['POST'], requestBody: 'buffered', fetch })`。这条路在 `registerFetchRoute` 内部**完全不碰 `owner.webServer`**，绕开了整个陷阱；而且 `/api` 前缀是平台保留的、已经存在的。同时 `scope.connection` 用属性访问而不是 `scope.get()`——属性访问走 cordis 的 Proxy，能拿到正确绑定的 service。

这个写法是照着 `@xmanrui/dsh-im` 的 `dA(...)` 抄的骨架（它是本 profile 里唯一用 `fetch.register` 的插件）。

**验证**：裸 POST 得 401（证明路由在、认证拦住了），带浏览器 cookie 的 POST 得 200 + 正确包络。

**教训**：`scope.get(name)` 和 `scope.name` 不等价。前者拿到的是按 scope 父级包装的代理，后者走 Proxy 绑定到当前 fiber。

### 4.3 output schema 与真实投影打架

**症状**：真机调 `lan_mesh_room_member action=create` 报

```
returned invalid output: missing required property "value.room.role";
"value.room.members[0].key" is not a declared property;
"value.room.leader" is not a declared property; ...
```

**根因**：房间在代码里有**两套投影**——

- `rooms.mjs` 的 `roomRow()` 产出 `{role, isMember, isLeader, ...}`，面向「调用者视角」（我是不是 leader）。
- `service.mjs` 的 `#roomView()` 产出 `{leader, memberCount, createdAt, ...}`，面向「房间本身」。

而 `index.js` 用**一个** `ROOM_SCHEMA` 覆盖两者，必然有一边对不上。

**修法**：拆成 `ROOM_ROW_SCHEMA`（给 `lan_mesh_rooms`）和 `ROOM_VIEW_SCHEMA`（给 member/task/say）；`MEMBER_SCHEMA` 补 `key`；`delivered` 数组的实际形状有四种（`{nodeId,name,ok,local,woken}`、`{...,deliveredAt}`、`{...,error}`）也补成 `DELIVERED_SCHEMA`。

**为防复发**：写了 `scripts/schema-check.mjs`。它用 stub context 挂载 `apply()` 捕获真实工具定义，走每个工具的 `execute()` 拿「框架将要校验的值」，再用**框架自己的校验器**（`@deepseek-ai/dsh-tools` 导出的 `validateJsonSchemaValue` + `assertSupportedJsonSchema`）比对。

这个脚本有三个坑值得记：

- 不能拿 service 原始输出比 —— 工具 `execute` 会自己加 `summary`。
- 不能用同一个 `exec.agent.id` —— 成员加入得是两个不同身份。
- 预期内的拒绝要用 `expectError` 表达，否则会被当成失败。

### 4.4 同名任务静默改错

**症状**：报进度时明明指定了标题，改的却是另一条任务。

**根因**：`setTaskStatus` 用 `tasks.find(...)` 按标题匹配，**只取第一个命中**。房间里有两条同名任务时，改的是谁全看插入顺序，而且不报错。这和之前修过的「同名房间只匹配第一个」是同一类错误，当时漏了任务层。

**修法**：抽出 `resolveTask(room, reference)`：id 精确命中优先；按标题收集**全部**匹配，恰好 1 个才返回，多于 1 个抛 `AMBIGUOUS_TASK` 并列出「候选 id（状态）」。房间名同理（`AMBIGUOUS_ROOM`）。

**测试**：加了 6 个用例，其中一条专门断言「被拒绝时不改动任何一个任务」——歧义拒绝必须是原子的。

### 4.5 成员退出了，对端还以为他在

**症状**：双节点测试 18 项过 17 项，唯一失败是 `A learned the leave — ["Alpha","Beta"]`。

**根因**：`mergeStates` 对成员只做**并集**。退出事件在任何节点都不是一条「数据」，只是「这个人不在我的列表里」，而并集会把它加回来。所以离开永远传不出去。

**修法**：给房间加内部字段 `left: { [memberKey]: ISO离开时间 }`。退出写墓碑（时间取「现在」和「该成员加入时间」的较晚者，防止时钟不一致导致墓碑早于它要取消的加入）；合并时先并集再合并墓碑（较晚者胜），最后按「墓碑时间 ≥ 加入时间」过滤掉成员；重新加入时清掉墓碑。

**修法之外的一个副产品**：加了 `allRooms()`。原来只列「我加入的房间」，结果对端永远没有入口加入别人建的项目——面板上「可加入的项目」就是这么来的。

### 4.6 跨机新建 agent 一轮就崩：目录不存在

**症状**：`lan_mesh_agent_import cwd=...` 成功返回，agent 也 live，但一被唤醒 turn 立刻结束：

```
working-directory: directory does not exist: "C:\Users\jian\.dsh\lan-mesh-probe-ws2"
```

**根因**：`ctx.agents.create({ meta: { cwd } })` **不校验目录存在性**，要到 turn 启动时由 working-directory 服务才发现。

**修法**：`createAgentIn` 里先 `statSync(cwd).isDirectory()`，不存在则 `mkdirSync(cwd, { recursive: true })`，再失败才 `BAD_REQUEST`。

### 4.7 目录存在了，还是崩：没有模型

**症状**：同一个 agent，目录建好后第二轮：

```
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")
```

**根因**：`agents.create` 没传 `agentOptions: {provider, model, reasoningEffort}`。系统提示里的 `{{model}}` 变量没有值。

**修法**：读 `ctx.agentDefaultModel.currentSelection()`，把三元组塞进 `agents.create({agentOptions})` 和 `agents.resume({agentOptions})`。**注意**：`ctx.get('agentDefaultModel')` 在 `apply` 时可能还没挂上，所以这类 Host service 全改成惰性取（`getAgentPresets: () => ctx.get('agentPresets')`、`agentDefaultModel` 同理）。

### 4.8 有了模型，还是没有工具：preset 只写标签不挂插件

**症状**：新建 agent 的会话日志里 `request/header.tools` 只有 28 个 host 工具，一个 `lan_mesh_*` 都没有，连 edit/read 都没有。它的推理原文：`But I don't see lan_mesh_send in my available tools list.`

**根因**：`agents.create({ meta: { agentPreset: 'standard' } })` **只把 preset id 写进会话头，不做 mount**。真正生效的写法在 `dsh-api-session-controller` 的 `composeAgent()` 里：

```js
return {
  agentPreset: resolvedId,
  setup: async (agentCtx, agent) => {
    this.installSelection(agent);
    await presets.mount(agentCtx, resolvedId);   // ← 这一句才是挂插件
  },
};
```

**修法**：`#presetSetup()` 返回 `{ presetId, setup }`，`createAgentIn`/`importAgent` 都把它传给 `agents.create({setup})` / `agents.resume({setup})`。

**验证**：tools 从 28 → 55。

### 4.9 有 55 个工具了，还是没有 `lan_mesh_*`

**根因**：preset 只挂它自己那一组插件。`lan_mesh_*` 是挂在**宿主 ctx** 上的，preset 组里看不到。

**修法**：在 `setup` 里额外把 10 个工具定义注册到 agent 自己的 ctx：

```js
setup: async (agentCtx) => {
  await presets.mount(agentCtx, presetId);
  this.#mountMeshTools(agentCtx);   // 把宿主的 10 个工具再登记一遍到 agent 的 tools 服务
}
```

**验证**：tools 28 → 65（含全部 10 个 `lan_mesh_*`），会话里实际发起了 `lan_mesh_send`，本节点 inbox 收到对端 agent 的回信 → **端到端闭环成立**。

在这之前，那个远端 agent 是靠 `terminal_open` 读 `lib/transport.mjs` 源码、手工 `POST /lan-mesh/v1/send` 回的信——能用，但完全不是我们想要的形状。

### 4.10 一个隐蔽的时序坑：`ctx.get('tools')` 在 `apply` 时是 undefined

**症状**：宿主上那 10 个工具在某些实例上**根本没注册**，`getToolDefinitions` 返回 0 个。

**根因**：`const tools = ctx.get('tools')` 在 `apply` 执行时，Host 还没挂 tools 服务，而 `ctx.get` **不等待**。于是 `if (tools !== undefined …)` 整块被跳过 —— 静默失败。

**修法**：

```js
ctx.inject(['tools'], (scope) => {
  const tools = scope.tools;   // 属性访问，等依赖挂载后才有值
  ...
  return scope.effect(() => { ...注册 10 个工具...; return disposeAll; });
});
```

这与 §4.2 是同一个教训的两个面：**依赖注入要用 `inject` + 属性访问，不要用 `ctx.get` + `if` 兜底**。兜底会把「还没准备好」变成「永远没有」。

### 4.11 加了 `live` 字段，忘了改 schema

**症状**：`schema-check.mjs` 有 9 项突然红掉，全是 `value.room.members[0].live is not a declared property`。

**原因**：改界面时给成员加了在线状态 `live`（本机看 `agents.get(id)` 是否存在，跨节点看那个 nodeId 是否还在发现列表里），但 `index.js` 的 `MEMBER_SCHEMA` 是 `additionalProperties: false` 的白名单，新字段一律拒收。

**教训**：`additionalProperties: false` 是**故意的**——它把「Host 多返回了字段」变成一次显式失败，而不是让界面静默读到 `undefined`。代价是加字段必须同步改 schema，而这个成本正好由 `schema-check.mjs` 兜住。所以每次改投影形状，先跑它。

顺带一个边界：成员在线是**节点级**判断，跨节点不对每个会话逐个查（那要多一次往返）；同节点的人（`human` 位）恒为在线。

### 4.12 改名被 stale peer 改回去了

**症状**：A 改完房间名，下一轮同步又变回旧名。

**原因**：`mergeStates` 原来用一句 `current.topic = current.topic === '' ? other.topic : current.topic;` 处理说明字段——「谁先写谁赢」。名字一旦也走这条路，任何持有旧名字的节点都会把它推回来。

**修法**：把 `name`／`topic` 都挂到 `updatedAt` 上——只有对端 `updatedAt` 更新时才接受它的名字和说明，并且在真变化时 bump `updatedAt`。改名本身就是一次写入，bump 之后新名字在时间序上占优，stale peer 的旧名自然输掉。

**这里也踩了一次测试的坑**：`rooms-smoke.mjs` 里最初写「本地 agent 在线时 `live` 应为 true」，但那个脚本里根本没有 agent runtime，所以代码**正确地**报了 false。改成两条各自成立的断言（无 runtime 的本地成员为离线、`human` 位恒在线）才对。**断言失败先怀疑断言，但必须先证明是断言错。**

### 4.13 客户端声明了服务当依赖，整个 Web UI 起不来

**症状**：刷新页面直接白屏，标题是 `HARNESS / Failed to load plugins / web boot: 1 entry did not activate / dsh-lan-mesh: failed`。主机端一切正常，只有浏览器端挂了。

**原因**：两栏界面需要在「打开会话」时调 `ctx.uiWorkspace.openSession()` 和 `ctx.layout.selectPanel()`，于是客户端半把这两个名字写进了 `inject: ['slots', 'layout', 'uiWorkspace']`。`inject` 是**启动时的硬依赖**：cordis 的客户端 fiber 等不到就会停在 pending，boot 把 pending 一律算作 `did not activate`，整个应用就不起来了。这对一个可选功能来说惩罚过重——面板只是少个跳转按钮，不该让整个界面打不开。

**修法**（`dsh-lan-mesh/client.js:1822` 起）：
1. `inject` 只留 `['slots']`——这是唯一真正必需的。
2. 两个导航服务改成**点击时**用 `ctx.get(name)` 现取，取不到就返回 `false`，按钮点了没反应但不会崩。
3. `apply()` 整体套 `try/catch`，注册 slot 也各自包一层 `try/catch`——`apply` 抛出和 pending 是同一个后果，所以任何一步都不能把异常放出去。
4. `scripts/panel-check.mjs` 增加两条断言：喂一个**故意抛错**的 ctx（模拟 cordis 的 `cannot get property "x" without inject`），断言 `apply` 不抛、两个 slot 仍然注册成功。这条断言就是这次事故的回归保护。

**教训**：客户端插件的 `inject` 是「没有它我就不该启动」，不是「我可能会用到它」。可选依赖要在使用点取，并给降级路径；同时 `panel-check.mjs` 这类纯逻辑测试**测不到**真实 fiber 语义，只能靠模拟严格 ctx 来兜住。

### 4.14 修好白屏之后，侧栏图标不见了

**症状**：刷新后 Web UI 正常了，但侧栏里没有「局域网协作」入口，`Slots.listSubTree` 却仍然报 `sidebar.panellist` 的 occupants 里有 `{"registrant":"dsh-lan-mesh","id":"dsh-lan-mesh","order":40,"active":true}`——插槽层看得见，界面上看不见。

**原因**：这是 §4.13 修法的副作用。去掉 `layout` / `uiWorkspace` 之后，本插件的客户端 `apply()` 不再等待任何服务，于是**可能早于 sidebar 声明 `sidebar.panellist` 就执行**。而 sidebar 的 `syncPanels()`（`@deepseek-ai/dsh-client-ui-sidebar` 里）用 `ctx.slots.entriesOfSlot("sidebar.panellist").map(...)` 建立侧栏按钮列表——注册进「还没声明」的插槽的条目在那个投影里看不见。以前的版本因为要等两个服务，启动被推迟，碰巧排在声明之后；依赖一删，时序就翻了。

**修法**：两个注册都改走 `ctx.slots.inject(key, () => ctx.slots.register(...))`——这是 shipped 插件（`dsh-client-ui-schedule`、`dshmarket`）的统一写法，语义是「等 owner 声明了这个插槽再注册」，天然免疫声明顺序。

```js
register('the sidebar icon', () =>
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-lan-mesh', order: 40, label: () => COPY.title }, MeshIcon),
  ),
);
```

**教训**：`ctx.slots.register` 直接调用只在「插槽确定已经声明」时才安全；跨插件写插槽一律用 `slots.inject`。`panel-check.mjs` 的 stub 也必须跟着实现 `inject(key, cb) → cb()`，否则测试会掩盖这一类顺序依赖——现在它多了一条断言「两个条目都走了 slots.inject」。

### 4.15 会话标题藏在 projection 里，`SessionSummary` 没有它

**需求**：面板不要显示 `session-3f2a…` 这种原始 id，要显示会话标题；输入框打 `@` 要弹成员选择框。

**原因**：宿主这边 `MeshNode.sessions()` 与 agent 行原本只回 `{id, rooms}`，前端除了 id 没别的可显示。而标题不在 `SessionSummary` 里（`dsh-api-session-controller` 的类型只有 `agentAvailable/updatedAt/running/blank/cwd/projections`），它是 session projection `title`：`dsh-session-title` 注册的定义是 `apply: (state, event) => event.type === 'session/title' ? event.data.title : state`。

**修法**：`MeshNode` 多了私有 `#titleOf(member)`，用晚绑定的 `getSessionProjections: () => ctx.get('sessionProjections')` 取服务，`projections.stateOf(agents.get(sessionId).session, 'title')` 读值，读不到就回空串；`sessions()` / `catalogueAgents()` / `#roomView()` 里 leader、members 与任务 assignee、assigner 全部带上 `title`。**故意不缓存**：第一版加了 Map，标题改名后会滞后一拍，而这是活值。

`@` 选择框是纯客户端的：`mentionAt(text, caret)` 找光标前的 `@token`（要求 `@` 在行首或空白之后，`mail@x` 不算），`matchMention(members, query)` 按标题过滤并按前缀排序，Enter/Tab 取当前项、Esc 关闭，选中后用标题重写 token。

**教训**：界面上的「不可读」多半不是排版问题，而是**后端没把可读的那一列传过来**。先找真源（projection），再改前端标签，比在前端截断 id 强。

一个自抓的 bug：接受提及后 `@Beta rollout ` 结尾的空格会让 `@` 重新打开菜单，因为 token 里带空格仍然匹配。修法是 `mentionAt` 里加一条 `if (/\s$/.test(query)) return undefined;`——空格即结束。

还有一个是房间里的 agent 提出来的：两个会话可能同名（默认标题都叫「新会话」），浮层里两行一模一样，选谁全靠猜。修法是 `mentionLabels(members)` 先统计标题出现次数，只给**重名的那几行**追加 ` · 短会话id`，唯一标题不加后缀；插入文本始终用不带后缀的标题。这条后来也被 `panel-check` 钉住（54 项），断言里故意让两个 fixture 成员共用 `Beta rollout` 这个标题。

**教训**：标题化牺牲的是唯一性。任何用人类可读字段当 key 的地方，都要先问「重名怎么办」——这里是消歧后缀，房间名那边是 `AMBIGUOUS_ROOM` 报错，任务标题那边是 `AMBIGUOUS_TASK` 报错。三处不同的处理，是因为误选房间/任务的代价（改错东西）远高于误选一个 @。

### 4.16 通知的噪音：把人当路由器使

**需求原话**：一份是「我现在是在一个房间里跟我本地的两个会话做通讯，但我区分不出来到底是谁的回复。现在展示的都是我的机器名」；另一份是「Agent 之间的通话不需要通知我去看……只需要知道任务结果，可以由 Agent @我或把任务结果发出来」。

**原因**：信封里只有 `from: {nodeId, name}`，而 `name` 是**节点名**——同一台机器上的两个会话发出来的消息长得一模一样。未读计数更糟：`#unreadByRoom` 只判断 `read !== true && room !== ''`，于是 agent 之间的每一句话都给角标加一，人打开面板看到一片红点，点进去全是跟自己无关的对话。

**修法三层**：
1. 信封 `from` 增加 `sessionId` 与 `title`（**不进签名**：签名覆盖的是 `from.nodeId`，这两个是传输元数据），`sayInRoom` 填 `title = #titleOf(sender) || senderName`，`#record` 落盘透传。
2. `mentionsIn(text)` 在落盘记录时算好 `mentions: string[]`（正则 `@([^\s@,，。:：;；!！?？"'()（）[\]【】]+)`，去重小写），加载时重算所以不必额外落盘。
3. `#unreadByRoom` / `inbox({attentionOnly})` / `markRoomRead` 统一只认两种：「`@` 命中本会话标签」或「`kind === 'room-task'` 且 `to === memberKey(本会话)`」。命中判定抽成 `static #namedBy(mention, labels)`：整名、任一词、或 `label.startsWith(\`${mention} \`)` 算命中，`@Bet` 不会拉进 `Beta`。

**结果导向**：`roomTaskText()` 末尾追加一句「完成后用 `lan_mesh_room_say` 回一条结论，@ 上分配任务的人」。这样任务完成的消息天然会 @ 派活的人，落进「待你处理」，人不必去翻房间。

**一个写测试时踩的坑**：`rooms-smoke.mjs` 里断言「agent 之间的对话不进 attention」时第一次失败，是因为 fixture 用了 `read: true` 的历史任务通知——attention 现在只看未读，断言要先把那条标成已读，或者干脆用新发的消息。**断言失败先怀疑断言，但要先证明它是断言错。**

**教训**：聊天系统里「未读」有两个完全不同的含义——「有新内容」和「需要我处理」。混用一个计数器，噪音一定把人淹没。分两个字段（`rooms.unread` 与 `snapshot.attention`）比在前端过滤诚实得多。

**真机上又抓出两个漏洞（同一功能的第二轮）**：
1. **人自己没有被当成一个可被 @ 的名字**。`#labelsOf('human')` 只查 `nicknames.members[节点/human]`，而人的称呼存在 `nicknames.self` 里——于是 agent 回一句 `@老板 已完成`，消息到了节点、角标却是 0。修法是在 `#labelsOf` 里对 `HUMAN_SESSION_ID` 额外加入 `nicknames.self` 与 `identity.name`。
2. **`read: true` 掩盖了本地回信**。`#logOutgoing` 原本把 outgoing 也标 `read: true`（「发信人当然读过自己的话」），但 read 是**节点级**的：本机 A 会话发出的消息，同机 B 会话（或人）可能正是被 @ 的那个，却被这一行直接排除。改成 outgoing 落 `read: false`，另加 `#waitsOn(item, labels, address, sessionId)` —— 判定统一为「@我 / 派给我」且「不是我自己发的」且「未读」。`#unreadByRoom`、`inbox({attentionOnly})`、`markRoomRead` 三处全部走它。

**教训**：「发信人已读」这种直觉在多人共用一台机器时不成立。凡是「某条记录对某个主体是否算未读」，主体必须是会话而不是节点。

### 4.17 昵称：本地偏好不该进共享文档

**需求**：「给 Agent 设置昵称，或自定义自己的称呼」。

**设计选择**：昵称存 `$DSH_HOME/lan-mesh/nicknames.json`（`{self, members}`），**不进 `rooms.json`、不参与 merge**。理由是两个人可以给同一个会话起不同的名字，两个都对；放进房间状态会让「谁改的算数」变成一个没有正确答案的问题。

**接线点**：`#titleOf(member)` 顶部先查 `#nickOf(member)`，所以昵称在**所有**用到标题的地方（气泡发送者、成员行、@ 浮层、任务 assignee）自动生效，不用一处一处改。`#displayName(member)` 单独处理 human 的 `name`（本节点用 `nicknames.self`，对端仍看到加入时的节点名）。

**一个测试暴露的语义**：self 昵称只影响本节点——`#displayName` 里判 `member.nodeId !== this.nodeId` 就回原 `name`。最初断言写成「对端也能看到我的新称呼」，失败是正确的，代码没问题。

**教训**：本地显示偏好和共享事实要分文件。放一起的第一个后果就是「改个名字要给全网发一条同步」。

### 4.18 气泡把两个人说的话糊成一团

**需求**：「把用户发的跟 agent 回复给分开左右，消息比较密集不好分辨不同消息，可以把谁说的给标黑加粗下，消息支持 markdown 格式跟现在的普通会话一样的展示风格」。

**三件事，三个不同的成因**：

1. **左右没分开**：`mineOf()` 判「是不是我说的」，靠的是 `message.from.name` 与本地成员名相等。但 `from.name` 是**节点名**——同一台机器上两个会话共用一个节点名，于是「我的 agent 回的」和「我回的」都落进同一个分支。修法是让消息本身带上发送者：`sayInRoom` 从这时起在 `from` 里写 `sessionId` 与 `title`（`#record()` 一并透传），`mineOf` 先比 `sessionId`，旧行才回退到标题、名字、再到「本节点只有一个成员」。

2. **发送者不显眼**：原来发送者与时间挤在同一行小灰字里。改成发送者用 `strong`（`.lm-bubbleWho`，`font-weight:700` + `label-primary`）、时间降为 `.lm-bubbleWhen`，并把行距从 `gap:8px`/`padding:12px` 提到 `gap:14px`/`padding:14px 18px`——消息密度问题本质是间距问题，不是内容问题。

3. **Markdown 不渲染**：面板一直用 `String(message.text)`。壳里其实带着一个 Markdown 渲染器：`@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`，它是 **seed module**（`staticModules` 表里就有），所以 `require` 得到的是壳自己的那份，不新增依赖、不会重复打包。用法照会话的调用点：`h(MarkdownText, { text, labels })`。

**`labels` 必须填全。** `MarkdownText` 收一个 `labels` 对象，代码块工具栏、图片预览、搜索块折叠按钮都从这里取文案；漏一个 key 会在气泡中间渲染出 `undefined`。它是无 locale 座的纯渲染器（`dsh-client-ui-chat` 自己写了个 `markdownLabels(t)` 适配器），所以面板照抄了同一形状，16 个 key 一次填满，中英各一份。

**降级路径**：`require` 包在 `try/catch` 里，拿不到 `MarkdownText` 就退回 `.lm-bubblePlain`（`white-space:pre-wrap`）——和 §4.13 同一原则：可选依赖在使用点取，取不到也不能让面板白屏。

**验证**：`panel-check.mjs` 的 `require` stub 补上 primitives，`MarkdownText` 存根把 `props.text` 渲染成 `stubMarkdown` 节点，于是能断言「两条消息都走了渲染器」（`count('stubMarkdown') === 2`）与「每个气泡都有加粗发送者」（`count('lm-bubbleWho') === 2`）。58 → **60 项**。

**教训**：判断「这是谁说的」不能用显示名——显示名是给人看的、会重复、会被改（昵称）。要在数据里带**身份**（`sessionId`），显示名只在渲染最后一步换算。

---

## 5. 协议设计上的几个取舍

**信封签名用「规范化后的状态」而不是原始 JSON。** 状态签名最初写的是 `JSON.stringify(payload.state)`，但验签发生在 `normalizeStatePayload()`（内部会重排 key、丢未知字段）**之后**，于是诚实对端互相 401。改成 `canonicalStateJson()`（normalize + 按 room id 排序）后，字段顺序无关、多余字段无关，但改房间名仍然破签。

**房间消息按节点扇出，不按成员。** 10 个成员在 3 台机器上时，链路上只有 3 条消息而不是 10 条，对端自己再扇出给本地成员。

**agent 联络是异步请求-应答，不做长连接。** `dial` 投一条唤醒消息，文本里写明「完成后用 `lan_mesh_send` 回信，target 写 `<发起节点>`」。好处是断网、重启、对端关机都不需要重连逻辑；代价是拿不到流式输出。

**发现逻辑有 2.5 秒宽限期。** 刚启动的节点 peers 还是空，直接回「没有匹配的节点」会让人困惑。所以 `send` 在 peers 为空且发现服务在跑时，先等 2.5 秒再解析一次。

**唤醒用的消息 source 复用 `agent-message`**，不自造 kind。v4 会话格式只校验「非空字符串且不是 `plugin`」，所以自造 kind 在 v4 能写进去；但旧的 v2→v3 迁移用白名单，自造 kind 会在将来迁移时变成「不可安全转换」。用 `{kind:'agent-message', form:'relay', senderSessionId}` 是零风险选择。

**引入 agent 会拿到写所有权**，所以 `close()` 必须把 import 出来的 handle 一个个 `dispose()` 掉，否则下次启动撞写锁。

---

## 6. 验证体系

单进程冒烟测不出上面任何一个 bug，所以建了七个脚本：

| 脚本 | 测什么 | 规模 |
| --- | --- | --- |
| `rooms.test.mjs` | 房间纯函数：合并幂等/交换、墓碑、歧义、裁剪、改名 | 47 用例 |
| `smoke.mjs` | 双节点：身份、发现、投递、去重、持久化、安全 | 7 组 |
| `twin-transport-check.mjs` | 状态交换与签名：规范化、push/pull、401/403 | 全绿 |
| `rooms-smoke.mjs` | 房间端到端：建房→加入→派活→报进度→聊天→human 发言→未读→改名→重启→退出 | 全绿 |
| `agents-smoke.mjs` | agent 端到端：清单→跨 workspace 引入→新建→联络→唤醒→工具挂载→回收 | 41 项 |
| `schema-check.mjs` | 每个工具的 execute 输出是否满足自己声明的 schema | 39 项 |
| `panel-check.mjs` | 面板渲染与交互：用假 Host 应答在 vm 里渲染、点按钮、打字、按键，并用故意抛错的 ctx 验证 apply 不会拖垮 boot | 60 项 |

`panel-check.mjs` 是最后一个加的，因为 `node --check` 只能证明语法对，证明不了「端点名写错了」或「读了 Host 不发的字段」。它当场抓到一个真缺陷：远端 agent 行只显示 workspace，看不出是哪台机器回的。

两栏改造后它又从 11 项涨到 36 项：加了一个支持 deps 比较与 cleanup 的 hook runtime、一个按 class 点按钮的 `click()`，于是「点房间 → 进详情 → 点打开会话 → 切到非 leader 房间」这条交互链能在 CI 里跑，而不只是「渲染没崩」。它断言的是 `uiWorkspace.openSession('session-1')` 与 `layout.selectPanel(null)` **真的被调用**——这两个客户端服务是会话跳转的全部实现，断言渲染结果证明不了调用发生了。

再加四条变成 40 项（见 §4.13 与 §4.14）：喂一个严格 ctx（每个未声明服务都抛错）证明 `apply` 不抛异常、两个 slot 仍注册成功、`inject` 里只有 `slots` 一个名字、两个条目都经过 `slots.inject`。这是唯一能防住「插件把整个 Web UI 弄白屏」和「图标悄悄消失」的测试——`node --check` 和「能渲染」都抓不到它们。

做 `@` 选择框与标题展示时又加了 12 项（52 项，见 §4.15）：`typeInto()` 触发 `onChange`、`press()` 触发 `onKeyDown`，于是「打 `@` 开菜单 → 输前缀收窄 → Enter 选中 → 清空菜单且草稿变成 `@标题 `」这条链能跑；另有断言「可见文本里不含 `node-b/session-9`、该地址只活在 `title` 属性里」，把「别用 id 展示」这条需求钉成回归。

真机验证则靠两件事：

1. **带 cookie 的 `POST /api/lan-mesh`**：先 `GET /connect?token=...` 拿会话 cookie，再用同一个 WebRequestSession POST。body 必须 `[System.Text.Encoding]::UTF8.GetBytes(...)`，否则中文变乱码。
2. **读会话日志**：会话日志是多 frame 的 zstd，`zstdDecompressSync(整个文件)` 只返回第一帧，必须按 magic `28 b5 2f fd` 切片逐帧解压。§4.8/4.9 那两个「agent 到底有什么工具」的结论全是从这里读出来的。

---

## 7. 操作事故（可复用的教训）

### 7.1 一次 `-replace` 毁了 144 处中文

我为了批量把 `tools.register({` 改成 `registerTool({`，用了：

```powershell
(Get-Content index.js) -replace 'tools\.register\(\{', 'registerTool({') | Set-Content index.js
```

PowerShell 用非 UTF-8 编码读写往返，把 **144 处三字节 UTF-8 字符的第三字节替换成了 `0x3F`**。`node --check` 报语法错误，`read` 工具直接说 `invalid UTF-8 text`。工作区不是 git 仓库、profile 里是 symlink —— **没有任何退路**。

修回来的路径（折腾了十几版脚本，最后靠这条）：

1. 从本会话的 zstd 日志里导出所有字符串当参考语料（21.7MB）。
2. 纯字节反查（左右锚 + 候选交集）只能修 64/144 —— 剩下的是参考语料里不存在的片段。
3. 骨架行匹配、ASCII 编辑距离、LCS 对齐都失败（0 改动或不够）。
4. **成功的是「ASCII 骨架上的 Levenshtein」**：把每条坏行的非 ASCII 变通配符得到 ASCII 骨架，按「非 ASCII 字符数」分桶 + 首尾 10 字符签名在参考行里找候选，编辑距离唯一最小且 ≤6 才替换 → `replaced 53, open 3`，剩 3 行手工补。
5. 关键发现：纯字节修复**看不出「缺了一个 ASCII 引号」**这类损伤（第 129 行结尾的 `'` 也没了），只有行级骨架比较才会暴露。

**另一个陷阱**：`node --check` 的结果**依赖文件所在目录**。同一份字节放在工作区根（无 `"type":"module"` 生效）判 exit 0，放到 `dsh-lan-mesh/`（有 `"type": "module"`，按 ESM 解析）判 exit 1。我在根目录副本上验过好几轮「通过」，全是假的。

**规矩**：处理含中文的源文件，永远用 edit/write 工具；必须用 PowerShell 时，`[System.IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)` + `WriteAllText(..., (New-Object System.Text.UTF8Encoding($false)))`。

### 7.2 profile 的写锁被僵尸进程占着

`plugin_manager set_plugin` 报 `atomic-write: timed out waiting for the writer lock at ...package.json.lock`。查出来是一个**几小时前的** `dsh plugin add` 进程（pid 14768）持有锁不放，CPU 0.6s 不动。`taskkill /PID 14768 /T /F` 之后锁文件自动消失。

### 7.3 一次 edit 吃掉了注释开头

把 `ROUTE_PATH` 后面的 `/**` 吃掉了，`node --check` 报语法错误。补回即可，但这提醒：编辑后立刻 `node --check`，别攒着。

### 7.4 别用 `Get-Content | Set-Content`，也别用 `Add-Content -Encoding utf8NoBOM`

`utf8NoBOM` 不在 `-Encoding` 的枚举里（只有 Unknown/String/Unicode/Byte/BigEndianUnicode/UTF8/UTF7/UTF32/Ascii/Default/Oem/BigEndianUTF32），照写会静默失败。

---

## 8. 现状与已知边界

**已做完并验证**：三层功能（网络/房间/agent）、10 个工具、17 个面板端点、两栏独立操作界面（左栏房间列表与未读角标、右栏成员在线态/气泡聊天/折叠任务区/一键跳会话、`@` 成员选择浮层、界面一律显示会话标题而非会话 id）、协议版本 2、签名与白名单、七个回归脚本全绿（含 52 项面板断言）、真机双实例端到端（含跨机 agent 用工具回信、human 身份发言、改名跨节点同步、agents 端点返回真实会话标题）。

**已知边界**（都是有意的取舍，不是 bug）：

- 没有快照/压缩：`rooms.json` 会一直长。规模是「一个团队一个项目」，暂时不需要。
- 墓碑永久保留。房间退役也是墓碑，不删除。
- `resume` 用的是**本节点的默认 preset**，不是会话原来记录的那个。每个节点只跑一个 preset 时没有区别。
- 没有成员邀请审批：加入靠自助，限制靠节点层的 `clusterSecret`/`trustedPeers`。
- dial 没有进度上报：对端 agent 干到一半你看不到。
- 界面是**轮询**（房间 2 秒、全局 4 秒），没有推送。选中房间才高频轮询，没选中的不轮——所以未读角标最坏晚 4 秒。
- 跨节点成员的在线态是**节点级**：只能告诉你「那台机器的 DSH 在」，不能告诉你「那个会话还在跑」。
- **标题只有本节点能给出**：`#titleOf` 依赖本进程的 `sessionProjections`，远端成员的标题由对端在 agents 端点里带过来；对端尚未生成标题（`SessionTitle` 是异步生成的）时显示 agent 名或 id 兜底。不做「读日志捞标题」，因为那要打开并折叠整个 stored 会话，成本远高于它取代的那个 id。
- 两栏界面的视觉（300px 栏宽、气泡对齐、滚动条位置、`@` 浮层的定位）只经过 vm 渲染断言与真机端点调用验证，**没有截图级的目视确认**。

**如果要继续做**，优先级大概是：房间状态的快照压缩 → dial 的进度事件（对端主动 `room_say` 或定期发心跳）→ 成员邀请（leader 发 token）→ 跨机器文件传递 → 面板改成 Host 推送而不是轮询。
