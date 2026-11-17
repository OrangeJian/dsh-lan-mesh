# Team 人类 Owner 只读投影 · 接口契约提案（未实现）

> **状态声明（读之前请先看这一段）**
>
> 本文是**契约提案，没有任何代码实现**。当前分支 `codex/ux-workbench` 里**不存在** `teamOverview` 路由、不存在人类 Owner 读取 Team 的任何入口、不存在本节描述的响应结构。
> 除本文自身外，仓库全量搜索 `teamOverview` 命中 **0** 次；`index.js` 的端点 switch 中**没有任何 `team*` 分支**；`ui/` 目录搜索 `team` 命中 **0** 次；`lib/team-state.mjs` 搜索 `accepted` 命中 **0** 次。
>
> **不得据此认为 Team Owner 投影已交付**，也不得据此在矩阵报告里把相关用例记为 PASS。按 `docs/ux/ux0/product-baseline-v1.md:261` 的口径，未执行的用例标记 `NOT RUN`，不得记为通过。
>
> 本文只回答「接口应该长什么样、边界在哪里、怎么验收」，不包含实现代码，也不修改 Team 状态机、Room 语义或 Peer 协议。

---

## 1. 问题陈述：人类 Owner 现在看不到 Team 状态

### 1.1 Team 的五个工具全部要求「真实的本机 Agent 会话」

`lib/team-tools.mjs` 注册 5 个工具（create / dispatch / status / report / reconcile，见 `lib/team-tools.mjs:6-12`），每个工具的执行体都从**宿主执行上下文**里取身份：

```
lib/team-tools.mjs:21  async execute(args, exec) {
lib/team-tools.mjs:22    const sessionId = exec?.agent?.id;
lib/team-tools.mjs:23    if (typeof sessionId !== 'string' || !sessionId) throw Object.assign(new Error('Authenticated local session required'), { code: 'BAD_REQUEST' });
lib/team-tools.mjs:24    const method = `team${action[0].toUpperCase()}${action.slice(1)}`;
lib/team-tools.mjs:25    const value = await node[method]({ ...args, sessionId });
```

身份**只能**来自 `exec.agent.id`（`lib/team-tools.mjs:22`）。参数里自报的身份会被服务端忽略或覆盖，这一点有测试兜底：`scripts/team-service.test.mjs:20` 传 `actorKey: 'fake/leader'` 直接被 `BAD_REQUEST` 拒绝，`:22-23` 传真实 `sessionId` 但非 Room Leader 时是 `FORBIDDEN`。

人类 Owner 在面板里**没有 `exec.agent.id`**这回事。面板能拿到的只有 `HUMAN_SESSION_ID`（`lib/service.mjs:110`，固定字面量 `'human'`，背后没有 agent 进程），它不是任何工具的合法执行上下文。

### 1.2 服务层同样只认 sessionId，而且人类不是 Room Leader

`lib/service.mjs:2830-2836` 是所有 Team 方法共用的调用者解析：

```
lib/service.mjs:2831    if (this.config.teamEnabled !== true) throw new TransportError('Team execution is disabled', 'TEAM_DISABLED');
lib/service.mjs:2832    if (typeof request.sessionId !== 'string' || !request.sessionId) throw new TransportError('Authenticated local session is required', 'BAD_REQUEST');
lib/service.mjs:2834    if (!this.team) throw new TransportError('Team is unavailable', 'NOT_READY');
lib/service.mjs:2835    return `${this.nodeId}/${request.sessionId}`;
```

即使人类 Owner 手动构造 `{ sessionId: 'human' }` 调进去，它在 §1.3 的授权链上也会被拦下：`#authorizeTeam`（`lib/service.mjs:2793-2813`）的授权表条目形如 `{roomId, leaderKey, workerSessionId, workspaceRoot}`（`lib/service.mjs:2799`），并且要求 `workspaceRoot` 是绝对路径、要对一个**真实 live 本地 agent 的 cwd** 做 realpath 包含性校验（`lib/service.mjs:2805-2811`，`index.js:107-111` 的配置归一化只保留这四个键）。**人类 Owner 在这套模型里没有任何对应条目**——它不是 workspace，没有 cwd，也没有 session 可被 realpath 校验。

### 1.3 「读」这一动作已经被现有代码绑死在调用者身上

`teamStatus`（`lib/service.mjs:2850-2862`）是目前唯一的读取入口，它做了两件事：

```
lib/service.mjs:2853    const room = this.#roomOrThrow(request.roomId);
lib/service.mjs:2854    if (!room.members?.some(m => m.key === actorKey)) throw new TransportError('Room membership required', 'FORBIDDEN');
```

而返回内容里的 `localExecutions` 还进一步绑定当前 worker：

```
lib/service.mjs:2859    localExecutions: Object.values(state.workerExecutions ?? {}).filter(e => e.descriptor.roomId === room.id && e.descriptor.workerKey === actorKey),
```

也就是说：**现有 Team 读取入口是「某个 agent 会话看自己参与的 Team」**，不是「节点主人看这个节点托管的 Team」。这两件事在代码里是不同的授权来源，不能靠换个 sessionId 互换。

### 1.4 面板路由里根本没有 Team 端点

`index.js:1397` 起的 `handleEndpoint` 是一个大 switch。只读查询都有各自的分支，例如：

- `case 'roomHistory'` 在 `index.js:1540-1541`，硬编码 `{ room: str('room'), sessionId: 'human', via: 'panel' }`；
- `case 'markRead'` 在 `index.js:1449-1451`；
- `case 'roomSkills'` 在 `index.js:1583-1588`（只读技能列表，缺失 registry 时返回 `unavailable` 而不是报错）。

**switch 里没有任何 `team*` case**。Team 工具只在 `index.js:1344` 被注册成 agent 工具（`if (config.teamEnabled) for (const definition of teamToolDefinitions(node)) ...`），那是给 Agent 用的通道，不是给面板用的通道。

### 1.5 结论

人类 Owner 看不到 Team 状态，**不是 UI 没做**，而是授权模型里没有「节点主人的只读身份」这一档：

1. 工具通道要求 `exec.agent.id`（`lib/team-tools.mjs:22-23`）；
2. 服务通道要求 `sessionId` + Room 成员 +（派发类）workspace 级授权（`lib/service.mjs:2832`、`:2854`、`:2793-2813`）；
3. 面板通道**没有 Team 端点**（`index.js:1397` 起的 switch）。

而面板里唯一被承认的「人类身份」是 `HUMAN_SESSION_ID`，它目前只被用于 Room 级只读/生命周期操作，例如 `roomHistory`（`lib/service.mjs:1755-1764`）、生命周期（`lib/service.mjs:933`）。

---

## 2. 不可越界的三条红线

### 红线一：不得伪造 human 身份，也不得伪造任何其他 Agent 身份

**为什么**：身份在现有代码里是**从通道推导**的，不是从 payload 声明的。`lib/service.mjs:1917-1925` 的注释把这条原则写得很直白：

> 「Which authority applies is decided by *which surface called*, never by a string in the payload. … an agent passing `sessionId: 'human'` is still just that agent, so a self-declared human is no longer sufficient to invite.」

`addRoomMember` 因此先看 `request.via === 'panel'`（`lib/service.mjs:1945`），只有面板通道才把调用者解析成 `HUMAN_SESSION_ID`（`:1946`）。

如果为了「让 Owner 看到 Team」而做下面任一件事，都会破坏这个模型：

- 让面板直接 `node.teamStatus({ sessionId: someAgentId })` —— 这等于让 Owner 借用某个 Agent 的身份去读它的 `localExecutions`；
- 让某个 Agent 传 `via: 'panel'` 来获取 Owner 权限 —— `via` 是**通道事实**，不是可以随手填的字段；
- 新增一个「超级 sessionId」或环境变量开关来代表 human —— 等于在授权表之外开后门，且无法被 `#authorizeTeam`（`lib/service.mjs:2793-2813`）的 realpath 校验覆盖。

正确做法见 §3：**新增一个只读方法，它的身份来自 `via === 'panel' && sessionId === HUMAN_SESSION_ID` 这一对通道事实**，与 `roomHistory`（`lib/service.mjs:1755-1764`）完全同构，而不是复用 `#teamCaller`。

### 红线二：只读投影不得成为派发、审批、合并的入口

**为什么**：一旦投影路由能写，就等于把 `#teamCaller` 的整套前置（`lib/service.mjs:2830-2836`）+ `#authorizeTeam` 的 workspace realpath 校验（`:2793-2813`）+ `Team` 协调器的 `allowed()` 校验（`lib/team-coordinator.mjs:23-31`）全部旁路掉。而这些校验不是装饰：

- `lib/team-coordinator.mjs:41`：`if (!team || input.actorKey !== team.leaderKey) fail('FORBIDDEN')`；
- `lib/team-coordinator.mjs:43`：`if (nodeOf(input.workerKey) === this.nodeId) fail('REMOTE_WORKER_REQUIRED')`，即**本机不能给自己派活**；
- `lib/team-coordinator.mjs:27-29`：房间被删、Leader 变更、worker 不再是成员，一律 `ROOM_CHANGED`。

投影路由的签名**只能有读取语义**：不接收 `workerKey`、`title`、`detail`、`stopped`、`reason` 这类会改变状态机的字段。请求体里出现未知字段应当被忽略且不产生任何写入——这一点要在 §6 写成断言。

### 红线三：不得用「禁用按钮」或「示例数据」把 M6 的批准 / DAG / Review / 人工合并冒充成已交付

**为什么**：产品没有这些状态，代码里也没有。事实如下：

- **任务状态枚举**（`lib/team-store.mjs:26`）是 `['planned','ready','active','review','accepted','blocked','failed','cancelled']`，其中 `accepted` 在 `lib/team-state.mjs` 里**一次都没有被写入**（全文件搜索 `accepted` 命中 0 次），只在 `lib/team-store.mjs:26` 的校验白名单里躺着。也就是说「已验收」这个状态是**表格里的空位，不是流程里的节点**。
- **执行成功只到 review**：`lib/team-state.mjs:112` `task.status = c.result.status === 'succeeded' ? 'review' : 'failed'`。succeeded ≠ accepted。
- **DAG 不存在**：`lib/team-store.mjs:27` 强制 `check(Array.isArray(value.dependsOn) && value.dependsOn.length === 0)`；`lib/team-state.mjs:54` 收到非空 `dependsOn` 直接 `fail('UNSUPPORTED')`。
- **无计划批准、无 Review 通过/拒绝、无人工合并**：全仓搜索 `teamPlan` / `approvePlan` / `reviewRejected` 在 `lib/` 下未命中 Team 相关实现。

所以投影里**不能出现** `planApproved`、`dag`、`reviewPassed`、`merged` 这类字段——哪怕是 `false` 或 `null`，因为一个恒为 `false` 的 `merged` 字段会在 UI 上变成灰掉的「合并」按钮，用户会以为「只差权限」，而实际是「功能不存在」。
同理，投影里**不能有 `accepted` 的计数被展示为 0** 而不加说明——它会读成「都还没验收」，而真相是「没有任何路径能产生验收」。

这条红线与 `docs/ux/ux5a-capability-audit.md:31` 一致：「没有真实契约的能力说明为尚未交付，不以禁用按钮或模拟数字记完成。」

---

## 3. 接口契约草案：`teamOverview`（只读）

### 3.1 定位

- **端点名**：`teamOverview`（面板端点，与 `roomHistory` / `roomDetail` 同级）
- **承载方法**：`MeshNode#teamOverview(request)`（只读，不改状态机，不写 outbox）
- **授权范式**：**完全照抄** `roomHistory`（`lib/service.mjs:1755-1764`）的「通道事实 + 成员资格 + 读前后各授权一次」

参考范式原文（`lib/service.mjs:1755-1764`）：

```
lib/service.mjs:1756    if(request.via!=='panel'||request.sessionId!==HUMAN_SESSION_ID)throw new TransportError('history requires the owner human panel','FORBIDDEN');
lib/service.mjs:1757    const authorize=()=>{const room=this.#roomOrThrow(request.room),key=memberKey(this.nodeId,HUMAN_SESSION_ID);
lib/service.mjs:1758      const eligible=archived(room)?room.participants?.[key]===true:room.members.some(member=>member.key===key);
lib/service.mjs:1759      if(!eligible)throw new TransportError('human must be an eligible room member','FORBIDDEN');return room;};
lib/service.mjs:1760    const room=authorize();
lib/service.mjs:1761    const page=await readRoomHistory({...});
lib/service.mjs:1762    authorize();
lib/service.mjs:1763    return {messages:...,cursor:page.cursor,scope:'local'};
```

要点三条，逐条都必须在 `teamOverview` 复现：

1. **身份校验在最前面**（`:1756`），早于任何 I/O、早于 `#roomOrThrow`，避免未授权者通过错误码差异探测房间是否存在；
2. **成员资格是普通成员即可，归档房要求 participants**（`:1757-1759`）；
3. **读后再次授权**（`:1762`），因为读取期间可能发生成员被移除（`scripts/room-history.test.mjs:35-39` 就是这条的回归测试）。

### 3.2 请求形状

```ts
{
  room: string,            // 房间 id 或唯一名称；解析规则复用 #roomOrThrow（lib/service.mjs:2972-2989）
}
```

但**面板侧的调用形状是固定的**，与 `index.js:1541` 同构：

```js
node.teamOverview({ room: str('room'), sessionId: 'human', via: 'panel' })
```

校验顺序与错误（错误码风格照 `TransportError`，定义在 `lib/transport.mjs:106-118`，`constructor(message, code, status = 400)`）：

| # | 校验项 | 失败时的 `TransportError` | 依据 |
|---|---|---|---|
| 1 | `request.via === 'panel'` 且 `request.sessionId === HUMAN_SESSION_ID` | `('team overview requires the owner human panel', 'FORBIDDEN')` | 照 `lib/service.mjs:1756` |
| 2 | `this.config.teamEnabled === true` | `('Team execution is disabled', 'TEAM_DISABLED')` | 照 `lib/service.mjs:2831` |
| 3 | `await this.#ready()`（节点已启动） | 由 `#ready` 抛 `('the mesh node has not started', 'NOT_READY')` | `lib/service.mjs:2894-2897` |
| 4 | `this.team` 存在（Team 存储已加载） | `('Team is unavailable', 'NOT_READY')` | 照 `lib/service.mjs:2834` |
| 5 | `#roomOrThrow(request.room)` | `('unknown room "X"', 'UNKNOWN_ROOM')` / `('房间名「X」对应 N 个房间…', 'AMBIGUOUS_ROOM')` | `lib/service.mjs:2975`、`:2981-2986` |
| 6 | human 是该房成员；归档房需 `participants[key] === true` | `('human must be an eligible room member', 'FORBIDDEN')` | 照 `lib/service.mjs:1758-1759` |
| 7 | 读取后再校验一次第 5、6 项 | 同上 | 照 `lib/service.mjs:1762` |

**注意第 1 项必须在第 2 项之前**：否则 Team 关闭时，身份不合法的人会先拿到 `TEAM_DISABLED`，等于确认了「这个节点配置过 Team」。

### 3.3 响应字段表

来源全部是 `lib/team-state.mjs` 的 `state`（顶层键见 `lib/team-state.mjs:2-4`：`{version, teams, tasks, executions, workerExecutions, outbox, nonces}`）与 Room 文档。**`nonces` 与会话凭据永不出现。**

| 字段 | 类型 | 是否可能为 null | 来源 | 脱敏规则 |
|---|---|---|---|---|
| `scope` | `'local'` 常量 | 否 | 照 `lib/service.mjs:1763` | 固定值，声明这是**本节点视角**，不承诺跨节点全量 |
| `known` | `boolean` | 否 | 投影器自身 | 见 §5：为 `false` 时其余字段一律不可解读为「健康」 |
| `unknownReason` | `string` | 是（`known === true` 时为 null） | 投影器自身 | 只放稳定短语，不含路径或异常堆栈 |
| `roomId` | `string` | 否 | `#roomOrThrow` 返回的 `room.id` | — |
| `roomName` | `string` | 否 | `lib/rooms.mjs:757-770`（`roomRow.name`） | 原文，不截断（已有长度约束） |
| `teamStatus` | `'absent' \| 'paused' \| 'active' \| 'archived'` | 否 | `state.teams[roomId]` + `room.lifecycle` | 见下方语义表 |
| `teamGeneration` | `number` | 是（`absent` 时 null） | `team.generation`（`lib/team-state.mjs:35`，恒 `1`） | — |
| `teamRevision` | `number` | 是（`absent` 时 null） | `team.revision`（`lib/team-state.mjs:35`） | — |
| `leaderKey` | `string` | 是（`absent` 时 null） | `team.leaderKey` | 形如 `node/session`，是**身份键而非凭据**，保留；但不在 UI 上当作权限证明 |
| `leaderLive` | `boolean` | 是（`absent` 时 null） | `#isLive(member, peers)`（`lib/service.mjs:1632-1636`） | 远端 Leader 只看 node 是否在线（`:1633`），**不代表任务在推进** |
| `taskCounts` | `Record<status, number>` | 否 | `state.tasks` 按 `roomId` 过滤 | 键集合固定为 `lib/team-store.mjs:26` 的 8 个值；**`accepted` 恒为 0 且必须带 §3.5 的注释** |
| `executionCounts` | `Record<state, number>` | 否 | `state.executions` 按 `roomId` 过滤 | 键集合固定为 `lib/team-store.mjs:33` 的 7 个值 |
| `uncertainCount` | `number` | 否 | 上表 `executionCounts['uncertain']` | 独立字段，防止 UI 只在字典里找时漏掉 |
| `tasks[]` | `object[]` | 否（空数组表示真的没有任务） | `state.tasks`，字段见下 | 见下 |
| `tasks[].taskId` | `string` | 否 | `task.taskId` | — |
| `tasks[].title` | `string` | 否 | `task.title`（≤200，`lib/team-store.mjs:25`） | 原文 |
| `tasks[].detail` | `string` | 否（缺省为 `''`） | `task.detail`（≤4000，`lib/team-state.mjs:56`） | 原文；**不得当作执行证据**（`docs/ux/ux5a-capability-audit.md:13`） |
| `tasks[].workerKey` | `string` | 否 | `task.workerKey` | 身份键，保留以便同名消歧 |
| `tasks[].status` | `string` | 否 | `task.status` | 取值域 `lib/team-store.mjs:26`；语义见 §3.4 |
| `tasks[].currentExecutionId` | `string` | 是 | `task.currentExecutionId`（`lib/team-state.mjs:55` 初值 `null`） | — |
| `tasks[].revision` | `number` | 否 | `task.revision`（`lib/team-state.mjs:133`） | 用于 UI 判断陈旧 |
| `tasks[].hasDependencies` | `false` 常量 | 否 | `task.dependsOn` 恒为 `[]`（`lib/team-store.mjs:27`） | 常量 `false`，**必须配注释「DAG 未实现」**，不得渲染成「无依赖所以可派发」 |
| `executions[]` | `object[]` | 否 | `state.executions` | 见下 |
| `executions[].executionId` | `string` | 否 | `execution.executionId` | — |
| `executions[].taskId` | `string` | 否 | `execution.taskId` | — |
| `executions[].workerKey` | `string` | 否 | `execution.workerKey` | — |
| `executions[].generation` | `number` | 否 | `execution.generation` | — |
| `executions[].attempt` | `number` | 否 | `execution.attempt`（`lib/team-state.mjs:68`） | — |
| `executions[].state` | `string` | 否 | `execution.state` | 取值域 `lib/team-store.mjs:33` |
| `executions[].resultStatus` | `'succeeded' \| 'failed'` | 是 | `execution.result?.status` | 只透传状态字符串，**不透传 summary 正文**（见 §3.5 不返回清单） |
| `executions[].uncertain` | `boolean` | 否 | `state === 'uncertain'` | 派生，便于断言 |
| `executions[].reconciled` | `boolean` | 否 | `execution.state === 'cancelled' && execution.reconciliation !== undefined` | 只给布尔，**不给 reconciliation 原文**（见 §3.5 不返回清单） |
| `pendingDelivery[]` | `{executionId, operation, lastError}[]` | 否 | `state.outbox` | **已脱敏**：照 `lib/service.mjs:2860` 只投影这三个键；`lastError` 是错误码，来源 `lib/team-coordinator.mjs:216`（`error.code ?? 'NETWORK_ERROR'`），不含堆栈 |

`teamStatus` 的四值语义（**这是「不知道」不被渲染成健康的关键**）：

| 值 | 条件 | UI 必须呈现 |
|---|---|---|
| `absent` | `state.teams[roomId] === undefined` | 「该项目尚未创建 Team」，**不是**「0 个任务、一切正常」 |
| `active` | team 存在且 `team.paused === false` | 正常展示，但仍需叠加 `known` / `uncertainCount` |
| `paused` | team 存在且 `team.paused === true`（`lib/team-state.mjs:35`，暂停由 `lib/team-state.mjs:45-48` 写入） | 必须显示「已暂停」，此时 `queue`/`start` 会 `PAUSED`（`lib/team-state.mjs:50`） |
| `archived` | `room.lifecycle.status === 'archived'` | 只读标识；Room 已归档时 Team 状态仍可读但不可再派发（`lib/team-coordinator.mjs:26` → `ROOM_ARCHIVED`） |

### 3.4 任务状态在投影里的语义（必须写进 UI 契约）

- `review`：Worker 报告了 `succeeded`，但**只到待验收**（`lib/team-state.mjs:112`）。不得显示「已完成」/「已合并」。
- `accepted`：枚举里有（`lib/team-store.mjs:26`）但**代码中无写入路径**。投影可返回该计数但必须恒为 0，且响应里要能区分「0 个已验收」与「不存在验收动作」——建议 `taskCounts.accepted` 永久为 0 并在契约里声明「本字段当前无语义」。
- `blocked` + execution `uncertain`：超时/取消会置 `execution.state='uncertain'` 且 `task.status='blocked'`（`lib/team-state.mjs:115-124`）。这个组合**绝不能**渲染成成功，也不能自动重试——reconcile 要求 `execution.state==='uncertain' && c.stopped===true`（`lib/team-state.mjs:126`），且用户必须显式提供原因（`lib/service.mjs:2876`、`lib/team-tools.mjs:11` 的工具描述明写「不要仅因超时自动调用」）。
- 重启恢复：`lib/team-coordinator.mjs:174` 把 `starting/running` 一律置 `uncertain`。**页面刷新、节点重启都不能让这样的任务看起来还在跑。**

### 3.5 明确不返回的字段清单

以下字段**无论请求什么参数都不出现在响应里**，这是契约的硬边界：

| 不返回 | 理由 | 现状位置 |
|---|---|---|
| `config.clusterSecret`、`teamAuthorizations`、`trustedPeers` | 集群凭据与授权表；拿到即可伪造 peer 身份 | `lib/service.mjs:2793-2813`、`index.js:107-111` |
| `teamAuthorizations[].workspaceRoot` | **其他节点的绝对路径** | `lib/service.mjs:2799` |
| Team 存储文件路径 | 绝对路径（`meshRootDir(config.port)/team.json`） | `lib/team-store.mjs:63`、`lib/service.mjs:2752` |
| `state.nonces` | 请求防重放凭据 | `lib/team-state.mjs:3` |
| `state.outbox[*].body` 全文 | 含派发描述符与可能存在的 `contextPacket` | `lib/team-coordinator.mjs:66`、`:166` |
| `execution.events[*].payload` / `.fingerprint` | 原始命令输出与幂等指纹；payload 是 `structuredClone(c)`（`lib/team-state.mjs:87`），可能含 Agent 内部信息 | `lib/team-state.mjs:87` |
| `execution.result.summary` / `artifacts` | 自由文本与「工件声明」；`docs/ux/ux5a-capability-audit.md:29` 已判定工件 type/value 只代表声明，不应直接提供本机路径下载 | `lib/team-state.mjs:109` |
| `execution.reconciliation` 原文 | 自由文本，可能含路径；只给 `reconciled: boolean` | `lib/team-state.mjs:127` |
| `state.workerExecutions` | 其它 worker 会话在本机的执行副本，只在 `teamStatus` 里按 `actorKey` 过滤给本人（`lib/service.mjs:2859`） | `lib/team-state.mjs:42-49` |
| **其他 Room 的 team / tasks / executions** | 跨项目越权；投影必须按 `roomId` 严格过滤 | `lib/service.mjs:2857-2858` 同款过滤 |
| 任何 `pendingDelivery` 的目标节点地址 | 只给 `{executionId, operation, lastError}` | `lib/service.mjs:2860` |

再补一条**同节点多 Owner 场景**（未来）：若一个节点以后支持多个人类身份，投影必须按「该 human 是哪个 Room 的成员」过滤，**不得**返回未授权 Owner 的 Team。当前只有单一 `HUMAN_SESSION_ID`（`lib/service.mjs:110`），所以这一条是约束而非现状差异。

---

## 4. 权限矩阵

身份四类 × 动作四类。**凡代码中没有对应实现的，一律写「未实现」；凡现有代码会拦下的，写「拒绝」并给出拦截点。**

| 身份 \ 动作 | 读取投影（`teamOverview`） | 派发任务（`teamDispatch`） | 批准计划 | 合并 |
|---|---|---|---|---|
| **人类 Owner**（`via='panel'`，本机 `human`） | **未实现**（本提案）；现状无端点可调：`index.js:1397` 起的 switch 无 `team*` 分支 | **拒绝** — `#teamCaller` 要求 `sessionId`（`lib/service.mjs:2832`），且 `teamCreate`/`dispatch` 需要 `room.leader.key === actorKey`（`lib/service.mjs:2841`、`lib/team-coordinator.mjs:41`）；human 不是任何 Room 的 leader 实体 | **未实现** — 无该流程（`lib/team-store.mjs:26` 状态枚举里没有 pending-approval） | **未实现** — 无人工合并入口；`review` 不是 `accepted`（`lib/team-state.mjs:112`） |
| **Team Leader Agent**（`room.leader.key`，本机或受信远端） | **拒绝** — 面板通道只接受 owner principal（`index.js:1352-1356`），且 `via !== 'panel'` 必被 `FORBIDDEN`（照 `lib/service.mjs:1756` 范式）。Leader 的读取入口是 `teamStatus`（`lib/service.mjs:2850-2862`），**不是**投影 | **允许** — 依据：`lib/service.mjs:2845-2848` → `lib/team-coordinator.mjs:39-71`；前置校验 `lib/team-coordinator.mjs:41`（`actorKey === team.leaderKey`）+ `lib/service.mjs:2793-2813`（workspace realpath 授权）+ `lib/team-coordinator.mjs:23-31`（房间未删、Leader 未换、worker 是成员）。注意 `:43` 禁止派发给本机 worker | **未实现** — 无计划对象可批准 | **未实现** — 无合并动作 |
| **普通成员 Agent**（在 `room.members` 中但非 Leader） | **拒绝** — 同一面板校验；成员只能调 `teamStatus`，且其 `localExecutions` 仍按 `actorKey` 过滤（`lib/service.mjs:2859`） | **拒绝** — `lib/team-coordinator.mjs:41`（`actorKey !== leaderKey` → `FORBIDDEN`）；即使绕过协调器，`lib/service.mjs:2793-2813` 的授权表条目也对不上 | **未实现** | **未实现** |
| **其他节点的同名 Agent**（如 `remote-node/human` 或与 Leader 同名但不同节点） | **拒绝** — `via` 通道事实不成立；即便伪造 `via`，human 身份键是 `memberKey(this.nodeId, HUMAN_SESSION_ID)`（`lib/service.mjs:1757`），带本机 nodeId，跨节点必然对不上 | **拒绝** — `lib/service.mjs:2797`（actorNode 必须本机或 `trustedPeers` 内）+ `lib/team-coordinator.mjs:41` + `:27-29`（`ROOM_CHANGED`）。同名不构成身份 | **未实现** | **未实现** |

**统计：16 格中「允许」只有 1 格**（Team Leader Agent × 派发任务），有 6 格是现有代码明确「拒绝」，其余 9 格是「未实现」。

这张表本身就是结论：**Team 领域目前只有一条被实现的写权限路径（Leader 派发），读取侧对人只有 `NOTHING`。** 任何声称「Owner 已经能看 Team」的说法都与代码不符。

---

## 5. 失败与脱敏语义

### 5.1 逐场景返回

| 场景 | 返回 | 备注 |
|---|---|---|
| `via` / `sessionId` 不符 | `TransportError('team overview requires the owner human panel', 'FORBIDDEN')` | 消息风格照 `lib/service.mjs:1756`（小写英文祈使句 + 明确 surface 名） |
| Team 功能未启用 | `('Team execution is disabled', 'TEAM_DISABLED')` | 照 `lib/service.mjs:2831`；**必须排在身份校验之后** |
| 节点未启动 | `('the mesh node has not started', 'NOT_READY')` | 由 `#ready` 抛，`lib/service.mjs:2896` |
| Team 存储未加载（`this.team` 为空） | `('Team is unavailable', 'NOT_READY')` | 照 `lib/service.mjs:2834` |
| **Team 不存在**（房间存在，但从未创建 Team） | **不是错误**。`200` + `teamStatus: 'absent'`、`teamGeneration`/`leaderKey`/`leaderLive` 为 `null`、`tasks: []`、`taskCounts` 全 0，**并且 `known: true`** | 关键：`absent` 与「0 个任务」必须在字段上可区分（`teamStatus` + `leaderKey===null`），否则 UI 会把「没启用」画成「一切正常、暂无任务」 |
| **非成员**（human 不在该房） | `('human must be an eligible room member', 'FORBIDDEN')` | 照 `lib/service.mjs:1759` |
| **归档房 + 非 participant** | 同上 `FORBIDDEN` | 照 `lib/service.mjs:1757-1759` 的 `archived(room)` 分支 |
| **身份不匹配**（面板传来的 `sessionId` 不是 `human`） | `FORBIDDEN`，消息里必须出现 `human` 字样 | 便于 `scripts/room-history.test.mjs:30` 那种 `/human/i` 断言 |
| **房间不存在** | `('unknown room "X"', 'UNKNOWN_ROOM')` | `lib/service.mjs:2975` |
| **同名多房** | `('AMBIGUOUS_ROOM')` + 候选 id 列表 | `lib/service.mjs:2981-2986` |
| **存储损坏**（`team.json` 解析/校验失败） | 错误码 `TEAM_STORAGE`，消息形如 `'Cannot load Team storage: <原因>'` | `lib/team-store.mjs:69`。**注意**：这条错误发生在 `openTeamStore` 期间（`lib/service.mjs:2752`），即启动时而非查询时；因此**查询期更可能遇到的是 `this.team` 为空 → `NOT_READY`**。两种都不得让投影返回「0 个任务」 |
| **Leader 离线** | **不是错误**。`200` + `leaderLive: false`、`teamStatus` 保持 `active` 或 `paused` 原值 | 判定依据 `#isLive`（`lib/service.mjs:1632-1636`）：远端 Leader 看 node 是否在 `peers()` 里（`:1633`）。**`leaderLive:false` 必须让 UI 停止「自动推进」的暗示**，对应 `docs/ux/ux0/product-baseline-v1.md:255` UX-A11「不显示成功或安全自动重试；任务停止自动推进」 |
| **存在 uncertain 执行** | **不是错误**。`uncertainCount > 0` 且对应 task `status === 'blocked'` | `lib/team-state.mjs:115-124`。**不得**在投影里把这类任务标为 `done`/`accepted` |

### 5.2 「不知道」不得渲染成「健康 / 0 个任务」

这是本契约最重要的一条，且已有代码范式可抄：`index.js:369-389` 的 `readRoomSkills` 在缺少 registry 时返回

```
{ status: 'unavailable', skills: [], reason: 'the skill registry is not available on this node' }
```

——**用一个显式的 `status` 字段把「读不到」与「读到了、是空的」分开**，而不是返回空数组了事。

投影照此必须满足：

1. `known: false` 时，`taskCounts` / `executionCounts` **必须整体为 `null`**（不是全 0），`tasks` 必须为 `null`（不是 `[]`）；
2. `known: true` 且 `teamStatus: 'absent'` 时，可以返回 `tasks: []`，但 `teamStatus` 必须让 UI 说出「未创建 Team」；
3. 任何情况下 `unknownReason` 有值时，UI 不得显示绿色/✓/「全部完成」；
4. `pendingDelivery.length > 0` 表示有未送达的协议消息（`lib/team-coordinator.mjs:216` 只写错误码），此时同样不得显示「一切同步」。

对应 `docs/ux/ux5a-capability-audit.md:51`：「Team开关关闭/工具不可用 → 不用0或绿色表现未知，不渲染假Team数据」。

### 5.3 错误码在面板层会被吞掉（必须一并处理）

`index.js:1592-1604` 的错误映射目前是：

```
index.js:1594    const declared = typeof error?.code === 'string' ? error.code : '';
index.js:1595-1603  /leader/i → NOT_LEADER；AMBIGUOUS_* → 原样；UNKNOWN_AGENT → 原样；/unknown room/i → UNKNOWN_ROOM；
index.js:1603    : 'LAN_MESH_FAILED';
```

也就是说 `FORBIDDEN`、`TEAM_DISABLED`、`TEAM_STORAGE`、`NOT_READY` 到了面板**全部退化成 `LAN_MESH_FAILED`**。这会让「你不是这个房的人」与「Team 存储坏了」在 UI 上不可区分，直接违反 §5.2。所以契约要求：新增 `teamOverview` 时，`index.js` 的错误映射必须为这几个 code 补显式分支（**只在此声明要求，不写实现**）。

---

## 6. 验收条件草案（每条都可写成 `node:test` 断言）

测试文件建议 `scripts/team-owner-projection.test.mjs`，环境样板照 `scripts/team-service.test.mjs:14-19`（`mkdtemp` + `process.env.DSH_HOME` + `MeshNode` + `t.after` 清理），配置照 `scripts/team-service.test.mjs:17`。

**A. 授权（照 `scripts/room-history.test.mjs:25-39` 的写法）**

1. 缺 `via`：`await assert.rejects(node.teamOverview({ room: room.id, sessionId: 'human' }), /panel/i)`
2. `via:'panel'` 但 `sessionId:'agent'`：`await assert.rejects(..., /human/i)`
3. human 不是成员：清空 `room.members` 后 `assert.rejects(..., /member/i)`
4. 归档房且 `participants` 无本机 human：`assert.rejects(..., /member|eligib/i)`
5. 归档房且 `participants['<node>/human'] === true`：读取成功
6. **读后重授权**：`const pending = node.teamOverview(...); room.members = []; await assert.rejects(pending, /member|eligib/i)`（照 `scripts/room-history.test.mjs:37-38`）
7. `teamEnabled: false`：`assert.rejects(..., { code: 'TEAM_DISABLED' })`，且消息**不是** panel 相关（证明顺序：身份校验先于开关校验）——或反过来，二者择一写死在契约里，不留给实现随意决定

**B. 形状与脱敏**

8. 响应 `JSON.stringify` 后不含绝对路径：`assert.equal(/[A-Za-z]:\\\\|(^|[^\\w])\/(home|Users|tmp|var)\//.test(text), false)`
9. 响应不含被禁键：对 `['nonces','workerExecutions','clusterSecret','trustedPeers','teamAuthorizations','workspaceRoot','events','fingerprint','reconciliation','summary','artifacts','body','outbox']` 逐个 `assert.equal(Object.hasOwn(value, key), false)`
10. `executions[0]` 的键集合**恰好**等于契约定下的集合：`assert.deepEqual(Object.keys(exec).sort(), [...].sort())`（防止将来字段悄悄膨胀）
11. `pendingDelivery` 每项只有三个键：`assert.deepEqual(Object.keys(item).sort(), ['executionId','lastError','operation'])`

**C. 语义（这一组最重要）**

12. **Team 不存在**：`assert.equal(value.teamStatus, 'absent')`、`assert.equal(value.leaderKey, null)`、`assert.equal(value.known, true)`、`assert.notEqual(value.teamStatus, 'active')`
13. **不确定任务不得是完成**：造一个 `expire`（`lib/team-state.mjs:115-119`）后，`const task = value.tasks.find(t => t.taskId === id)`，`assert.equal(task.status, 'blocked')`、`assert.notEqual(task.status, 'accepted')`、`assert.notEqual(task.status, 'review')`、`assert.equal(value.uncertainCount, 1)`
14. **succeeded 只到 review**：Worker 报 `succeeded` 后 `assert.equal(task.status, 'review')`、`assert.notEqual(task.status, 'accepted')`、且 `value.taskCounts.accepted === 0`
15. **DAG 未实现**：`assert.equal(value.tasks.every(t => t.hasDependencies === false), true)`，并且响应里**不存在** `dependencies` / `dag` 字段
16. **M6 未实现字段不存在**：`assert.equal(['planApproved','merged','reviewPassed','reviewRejected','canMerge','canApprove'].some(k => Object.hasOwn(value, k) || Object.hasOwn(value.tasks[0] ?? {}, k)), false)`
17. **未知不健康**：把 `node.team` 置空后调用 → `assert.equal(value.known, false)`（或直接 `NOT_READY`），但**绝不能** `assert.notEqual(value.taskCounts.active, 0)` 式的「0 等于健康」
18. **Leader 离线**：Leader 为远端且 `peers()` 中无该节点时 `assert.equal(value.leaderLive, false)`。注意这里**不能**顺带断言 `teamStatus !== 'active'`——Team 记录本身仍是 active，只是 Leader 不可达；「因此不得自动推进或自动重试」属于 UI 用例，写进 §6 之外的界面验收（对应 `docs/ux/ux0/product-baseline-v1.md:255` UX-A11）

**D. 边界（不写实现也要写进契约）**

19. **不会写**：调用 `teamOverview` 前后 `assert.deepEqual(node.team.store.read(), before)`（存储对象不变），并且 `node.team.send` 调用计数为 0
20. **未知字段被忽略**：传 `{ workerKey: 'x/y', title: 'hack', stopped: true, reason: 'x' }` 后存储仍不变
21. **跨 Room 隔离**：两个房各建一个 Team，读 A 房时 `assert.equal(value.tasks.some(t => bTaskIds.has(t.taskId)), false)`，且 `value.executions.some(e => bExecutionIds.has(e.executionId)) === false`

**E. 面板层**

22. `handleEndpoint('teamOverview', ...)` 在没有任何 `team*` 分支时返回 `UNKNOWN_ENDPOINT`（`index.js:1589-1590`）——这是**当前**应断言的行为，用来证明「提案未实现」
23. 实现后：`FORBIDDEN` 不得被映射成 `LAN_MESH_FAILED`（针对 `index.js:1603` 的回归）

---

## 7. 实现它需要改动哪些文件（只列文件名，不含实现）

| 文件 | 需要做什么（一句话） |
|---|---|
| `lib/service.mjs` | 新增 `teamOverview(request)` 只读方法，复用 `#roomOrThrow` / `memberKey` / `#isLive` / `HUMAN_SESSION_ID`，读前后各授权一次 |
| `index.js` | 端点 switch 增加 `case 'teamOverview'`（硬编码 `sessionId:'human', via:'panel'`），并为 `FORBIDDEN`/`TEAM_DISABLED`/`TEAM_STORAGE`/`NOT_READY` 补错误映射分支 |
| `scripts/team-owner-projection.test.mjs` | 新增 §6 的断言（或并入 `scripts/team-service.test.mjs`） |
| `docs/ux/ux6-matrix-report.md` | 实现并验收后更新 A11/A12 口径（当前均为 NOT RUN，见 `docs/ux/ux6-matrix-report.md:153-154`；该文件由矩阵负责人维护） |

**明确不涉及**：`lib/team-state.mjs`、`lib/team-store.mjs`、`lib/team-coordinator.mjs`、`lib/team-tools.mjs`（状态机与工具契约不变）、`lib/transport.mjs`、Peer 协议、`client.js`、`ui/`（本契约不含界面实现）。

---

## 8. 风险与未决

1. **错误码在面板层被吞并**（`index.js:1592-1604`）：这是最容易在实现时被忽略、又最容易让「未授权」显示成「未知故障」的一处。契约要求先补映射再上投影。
2. **`absent` 与「0 个任务」的区分**只能靠字段语义，UI 很容易抹平。已有反面教训：`docs/ux/ux5a-capability-audit.md:51` 明确要求「不用 0 或绿色表现未知」。
3. **`accepted` 是幽灵状态**（`lib/team-store.mjs:26` 有枚举、`lib/team-state.mjs` 无写入）：投影若返回 `taskCounts.accepted`，必须同时在文档里声明它当前无语义，否则会诱导 UI 做「验收按钮」。
4. **`leaderLive` 只是节点可达性**（`lib/service.mjs:1633`），不是任务在推进的证据。把它当作「Leader 在线所以会自动推进」是误读。
5. **归档房双重判定**：Room 归档（`room.lifecycle`）与 Team 归档（`lib/team-coordinator.mjs:26` 的 `ROOM_ARCHIVED`）是同一件事的两种表现，投影只应给一个 `teamStatus: 'archived'`，不要让 UI 自己组合。
6. **本文档未经验收**：字段清单、错误码、断言编号都可能在实际实现时被修订，修订必须回到本文件走评审，而不是在代码里悄悄改语义。

---

> **再次声明**：本文是**契约提案，没有代码实现**。
> 在 `lib/service.mjs` 出现 `teamOverview`、`index.js` 出现 `case 'teamOverview'`、`scripts/` 出现本文件 §6 的断言并通过之前，
> **Team 人类 Owner 只读投影一律视为未交付**，矩阵与报告不得据此记 PASS。
