# dsh-lan-mesh 房间层接口契约（v1，唯一事实来源）

本文件冻结"房间=项目"这一层的**跨文件接口**。并行开发时任何一方都不要改这里定义的签名；
如需变更，先改本文件并同步对方。

## 0. 目标与不可动摇的约束

目标：同局域网的多个 DSH 实例上，**多个 agent 会话**可加入**多个房间**；一个房间=一个项目，
房间有一个 **leader** 负责给成员**分配任务**；房间内的消息只发给**同房间成员**。

约束（违反就会坏）：
- 只能 import `node:` 内置模块。profile 里装的是 symlink，`@deepseek-ai/*` 全部解析不到。
- 不引入任何 npm 依赖。
- 会话消息的 `source.kind` 必须复用已有 kind `agent-message` + `form:'relay'`（见 lib/service.mjs `#wake`），
  不要自定义 kind，否则旧日志迁移会炸。
- 房间状态是**可复制的文档**：每个节点有完整副本，靠合并规则收敛，不允许"某节点是唯一权威"。
- 所有跨节点能力都必须能在**单进程内**跑通（同机两实例就是单进程 + UDP + HTTP）。

## 1. 身份三元组

| 概念 | 值 | 说明 |
| --- | --- | --- |
| 节点 | `nodeId`（如 `node-371946a3`） | `$DSH_HOME/lan-mesh/.../node.json`，按端口隔离 |
| 会话 | `sessionId`（agent 的 id） | 宿主侧 `exec.agent.id` / `agents.list()` |
| 成员 | `key = `${nodeId}/${sessionId}`` | 房间成员的唯一键，`lib/rooms.mjs memberKey()` |

一个人可以在两台机器、两个会话里同时是同一房间的成员：成员永远按 (nodeId, sessionId) 判定，
**不要**用显示名判等。

## 2. `lib/rooms.mjs`（已完成，只读依赖）

纯函数，无 socket / 无 timer / 无磁盘。除已有导出外，调用方只用这些：

```js
export const ROOM_STATE_VERSION; export const TASK_STATUSES; // ['open','doing','blocked','done']
export function emptyState()                       // → {version, rooms:{}}
export function normalizeState(raw)                // 任意脏数据 → 合法 state
export function createRoom(state, {name, topic, leader:{nodeId,sessionId,name}}, randomUuid, now) // → room
export function findRoom(state, idOrName)          // → room | undefined（按 id 或忽略大小写的名字）
export function joinRoom(state, roomId, {nodeId,sessionId,name}, now)  // → {room, added:boolean}
export function leaveRoom(state, roomId, key, now) // → boolean；leader 不能离开自己的房间（throws）
export function assignTask(state, roomId, {title, detail, assignee, assigner}, randomUuid, now) // → task
export function setTaskStatus(state, roomId, taskIdOrTitle, status, note, now) // → task
export function retireRoom(state, roomId, now)     // → boolean，留下墓碑
export function mergeStates(local, remote)         // → {state, changed}，幂等/可交换
export function exportState(state)                 // → {version, rooms}
export function roomsFor(state, nodeId, sessionId) // → 该会话所在房间（含 members/tasks/isLeader/isMember）
export function allRooms(state, nodeId, sessionId) // → 本节点已知全部房间（含 isMember/isLeader），供面板发现可加入项目
export function tasksFor(state, roomId, key)       // → 指派给某成员的公开任务
export function resolveMember(room, {selfNodeId, nameOf}, reference) // 成员键/会话id/成员名/节点名 → member
export function membersByNode(room)                // → Map<nodeId, member[]>
```

**成员离开的墓碑（`room.left`）**：`members` 在合并时取并集，若只删元素，离开事件永远传不到对端（双节点实测：B 退出后 A 仍显示 `["Alpha","Beta"]`）。因此每个房间带一个内部字段 `left: { [memberKey]: ISO离开时间 }`，规则是：
- `leaveRoom` 写入墓碑，时间取 `max(now, member.joinedAt)`，保证墓碑不早于它所取消的加入；
- `normalizeRoom` / `mergeStates` 丢弃 `left[key] >= joinedAt` 的成员（墓碑按时间为准取较晚者并集）；
- `joinRoom` 重新加入时清除该 key 的墓碑（即使两节点时钟不一致）；
- `left` 是内部字段，**不得**出现在任何给客户端/RPC 的投影里。

## 3. `lib/store.mjs`（负责人：#1 transport-store）

在现有 `loadIdentity/appendInbox/readInbox` 旁新增，**不改已有签名**：

```js
/** 房间状态文件绝对路径；options 与 loadIdentity 一致：{port, primaryPort} */
export function roomStateFile(port, primaryPort = DEFAULT_PORT) // → string

/** 读房间状态；文件缺失或损坏 → emptyState()，绝不抛 */
export function loadRoomState(options) // options:{port,primaryPort}; → {version,rooms}

/** 原子写房间状态（tmp + rename，和 loadIdentity 同手法）；返回 void */
export function saveRoomState(state, options) // options:{port,primaryPort}
```

要求：
- 目录复用 `meshRootDir(port, primaryPort)`，文件名 `rooms.json`。
- `saveRoomState` 里的 state 先用 `normalizeState()`（`lib/rooms.mjs`）清洗，再 `JSON.stringify`。
- 读坏文件只 `log` 不抛：节点必须能起来。

## 4. `lib/transport.mjs`（负责人：#1 transport-store）

### 4.1 协议版本
`export const PROTOCOL_VERSION = 2;`（房间消息需要在信封里带上 room）。

### 4.2 信封新增字段 `room`
`normalizeEnvelope()` 额外接受并输出 `room`（字符串，`^room-[a-z0-9-]{4,64}$`，非法则 `''`），
并**参与签名**：`signingInput()` 的字段顺序改为

```
v\nid\nfrom.nodeId\nto\nkind\ntopic\nroom\ntext\nsentAt
```

`kind` 允许：`note`（默认）、`room-message`、`room-task`。其它字符串原样接受但只作为普通 note 处理。

### 4.3 状态交换（新增路由）
`MeshServer` 构造函数增加 `onState` 回调：

```js
new MeshServer({describe, secret, trustedPeers, onError, onMessage, onState})
// onState(payload) → Promise<{changed?:boolean, state?:object}|void>
//   payload.pull === true  → 必须返回 { state }（pull 方向必须能拿到状态，只返回 void 不成立）
//   payload.state 存在     → 返回 { changed }，changed 表示本地状态是否因此变化
```

路由 `POST /lan-mesh/v1/state`，body：

```jsonc
{ "v":2, "id":"<uuid>", "from":{"nodeId":"node-x","name":"DESKTOP-x"},
  "sentAt":"<iso>", "pull": true }                       // 拉取
{ "v":2, "id":"<uuid>", "from":{...}, "sentAt":"<iso>",
  "state": {"version":1,"rooms":{...}} }                  // 推送
```

响应：
- push → `200 {"ok":true,"changed":<boolean>}`（`changed` 取 `onState` 返回值，未返回则 `false`）
- pull → `200 {"ok":true,"state":<state>}`
- secret 非空 → 校验签名，失败 `401 {ok:false,error:{code:'BAD_SIGNATURE'}}`
- trustedPeers 非空 → 校验来源，失败 `403 {ok:false,error:{code:'UNTRUSTED'}}`

错误体有两种形状，**调用方必须都接受**：`/v1/state` 用嵌套 `{ok:false,error:{code,message}}`，而既有的 `/v1/send`、`/v1/hello` 保留扁平的 `{ok:false,error:'text',code}`（不改老调用方）；`deliverToPeer` 的解码器两种都吃。
正文超过 `MAX_STATE_BODY_BYTES` 时服务端直接销毁 socket，调用方观测到 `UND_ERR_SOCKET` 而非 413 —— 已知观测特征，排障时别误判成"对端不可达"。

新增导出：

```js
export const MAX_STATE_BODY_BYTES = 2 * 1024 * 1024;
export function signingInputState(payload)  // `state\n${v}\n${id}\n${from.nodeId}\n${sentAt}\n${canonicalStateJson(payload.state ?? null)}`
export function signStatePayload(payload, secret)   // → hex，空 secret 返回 ''
export function verifyStatePayload(payload, secret) // → boolean，空 secret 恒 true
export function normalizeStatePayload(raw)          // → {v,id,from:{nodeId,name},sentAt,pull,state|undefined}
export async function pullStateFromPeer({address, port, secret, timeoutMs})  // → state（已 normalizeStatePayload 校验）
export async function pushStateToPeer({address, port, payload, secret, timeoutMs}) // → {changed:boolean}
```

`pullStateFromPeer` / `pushStateToPeer` 复用现有 `fetch` + `AbortController` 写法与 `TransportError`。

**签名输入的规范化（重要，早先的契约文本这里是错的）**：不能对原始 `payload.state` 直接 `JSON.stringify`。验签发生在 `normalizeStatePayload()` 之后，而 `normalizeState()` 会重排 key、丢弃未知字段、约束 `left` 墓碑等；对原始 json 签名会让**诚实对端互相 401**。正确做法是先 normalize、再按 `Object.keys(rooms).sort()` 排序后序列化（`canonicalStateJson`）。于是字段顺序与多余字段都不影响验签，而改动房间名或任何被 normalize 保留的字段仍然破签。第三方实现必须按这条规则对齐。

## 5. `lib/service.mjs`（负责人：#2 service）

`MeshNode` 新增（**内部形状保持不变**，`constructor({config,agents,log})` 不变）：

```js
// 启动：start() 里在 readInbox 之后 loadRoomState，然后再起 server/discovery
// 关闭：close() 里 saveRoomState

get roomState()                                   // 当前 state（只读视图，别让调用方改）
async syncRooms(peerNodeIds?)                     // 反熵：拉取 peer 状态 → mergeStates → 落盘 → 若 changed 推送给其余 peer
async createRoom({name, topic, sessionId, sessionName})   // → {room, forward:{nodeIds}}  （forward 可空数组）
async joinRoom({room, sessionId, sessionName})            // → {room, added}
async leaveRoom({room, sessionId})                        // → {removed:boolean}
async assignTask({room, sessionId, assignee, title, detail}) // → {task, delivered:[{name,ok}]}
async setTaskStatus({room, sessionId, task, status, note})   // → {task}
async sayInRoom({room, sessionId, text})                     // → {room, delivered:[{name,ok}]}
listRooms({sessionId})                            // → roomsFor(state, nodeId, sessionId)
roomDetail({room, sessionId})                     // → {room:{...公开字段}, messages:[最近20条该房间 inbox]}
```

语义要求：
1. **房间消息** `sayInRoom`：
   - 本节点上该房间的成员会话（`membersByNode(room).get(this.nodeId)`，排除发送者）全部**本地投递**：
     `appendInbox` 记录 `{id, at, from:{nodeId,name}, room:room.id, kind:'room-message', topic:room.name, text}`，
     `autoWake` 时对每个成员会话 `agent.followup(...)`。
   - 远端：对该房间成员所在的每个 peer 节点发一张信封，`kind:'room-message'`、`room:room.id`、`to:peerNodeId`
     （不是单播到某会话：对端按房间成员自行 fan-out）。`deliverToPeer` 失败只记 note，不抛。
2. **状态变更**（create/join/leave/assign/status）：改完 `saveRoomState`，然后
   `syncRooms()`（推送新状态）。`assignTask` 额外给被指派人所在节点发 `kind:'room-task'` 信封
   （`to: assignee.nodeId/assignee.sessionId`），对端 `receive()` 收到后唤醒该会话并把任务摘要写进 inbox。
3. **receive(envelope)**：
   - `kind==='room-message'` → 找 `room = findRoom(state, envelope.room)`，收进 inbox（`room` 字段），
     唤醒本节点该房间的所有成员会话（排除信封 `from.nodeId` 过来的同一发送者无意义，按 session 判）。
   - `kind==='room-task'` → 原有 `#wake` 单播路径 + inbox 记录 `kind:'room-task'`。
   - 其它 kind → 现有行为不变。
4. `snapshot()` 增加字段：**实际约定**：`snapshot({sessionId})` 返回
   `{self, peers, inbox:{unread,messages}, rooms:{count, mine:[...roomsFor], all:[...allRooms]}}`。
   - `mine`：当前会话已加入的房间（`roomsFor`），未传 `sessionId` 时 `[]`。
   - `all`：本节点已知的全部未退休房间（`allRooms`），每项带 `isMember`/`isLeader`。
     **必须提供**：房间由任意节点创建并同步过来，若面板只看 `mine`，对端就永远没有入口去加入别人的项目。
   - 两个数组的元素形状一致（都是 `roomRow()` 的投影），`left` 墓碑等内部字段**不得**透出。
5. `sessions()` 新方法：`agents.list()` → `[{id, rooms:[roomId...]}]`，给 UI 选会话用，取不到 `agents` 时返回 `[]`。

## 6. `index.js`（负责人：Lead）

新工具 4 个（在现有 3 个之后追加，命名与 `parameters` 见实现）：

- `lan_mesh_rooms`：列出我（当前会话）所在房间，含成员、指派给我的任务、未读房间消息数。
- `lan_mesh_room_member`：`action: create|join|leave`。
- `lan_mesh_room_task`：`action: assign|status`。
- `lan_mesh_room_say`：向房间发消息。

RPC 端点（走 `ctx.inject(['connection'], scope => scope.connection.fetch.register({path:'/api/lan-mesh', …}))`；
**不要**用 `connection.rpc.handle(channel, …)`——它在 `ctx.inject` 的 scope 里会抛
`cannot get property "webServer" without inject`，因为 `get rpc()` 内部拿 `this.ctx` 去访问 `owner.webServer`，
而 `scope.get('connection')` 返回的是包在外层 ctx 上的 traceable 代理）：

| endpoint | payload | 返回 |
| --- | --- | --- |
| `snapshot` | `{sessionId?}` | `MeshNode.snapshot(payload)` |
| `sessions` | `{}` | `{sessions:[{id,rooms}]}` |
| `roomCreate` | `{name, topic, sessionId, sessionName}` | `{room}` |
| `roomJoin` | `{room, sessionId, sessionName}` | `{room, added}` |
| `roomLeave` | `{room, sessionId}` | `{removed}` |
| `roomAssign` | `{room, sessionId, assignee, title, detail}` | `{room, task, delivered}` |
| `roomStatus` | `{room, sessionId, task, status, note}` | `{room, task}` |
| `roomSay` | `{room, sessionId, text}` | `{room, delivered}` |
| `roomDetail` | `{room, sessionId}` | `{room, messages}` |
| `markRead` | `{}` | `{unread:0}` |
| `send` | `{target, text, topic?}` | `MeshNode.send(payload)` |

成功 `{ok:true,value}`，失败 `{ok:false,error:{code,message,details}}`（`code` 用 `BAD_REQUEST`/`NOT_LEADER`/`UNKNOWN_ROOM`/`AMBIGUOUS_ROOM`/`UNKNOWN_ENDPOINT`）。

请求与响应包络（浏览器 `parseConnectionResponse` 强制要求）：
请求 `{type:'client-request', rpcId, method:endpoint, payload:{method:endpoint, payload:{…实际参数…}}}`
（`payload` 双层是刻意的：外层 `method` 供 Host 分派，内层 `payload` 才是工具参数）；
响应 `{type:'server-response', rpcId, result:{ok:true,value}}` 或
`{type:'server-response', rpcId, result:{ok:false,error:{code,message,details:{}}}}`（`details` 必须是 object）。

## 7. `client.js`（负责人：#3 ui-client）

在现有面板里加"房间"区，走同源 `fetch('api/lan-mesh', …)`（**不是** `connection.rpc.call('/lan-mesh', …)`；
后者依赖一个注册不上的 channel）：
- 顶部：本节点信息 + 会话选择（`sessions` 端点，默认选 `snapshot.self` 之后第一个；持久化到 `localStorage` 键 `dsh-lan-mesh.session`）。
- 房间列表：名字、成员数、我的角色（leader/member）、指派给我的未完成任务数。
- 新建房间表单（名字 + 一句目标）→ `roomCreate`。
- 加入房间表单（房间名或 id）→ `roomJoin`。
- 房间详情：成员列表、任务列表（状态用现有状态色 token）、leader 可指派任务表单 → `roomAssign`、
  任何人可 `roomStatus` 改自己任务状态、消息输入框 → `roomSay`，最近消息来自 `roomDetail.messages`。
- 轮询复用现有 4 秒 `snapshot`；切到房间详情时额外 `roomDetail`。
- 只使用已登记主题 token；类名继续 `lm-` 前缀；文案中英双语（现有 `COPY` 模式）。

## 8. 测试（负责人：Lead + #3 辅助）

`scripts/rooms.test.mjs`：`node:test`，覆盖 `lib/rooms.mjs` 纯函数（含 mergeStates 交换律/幂等、墓碑、上限裁剪）
与 `lib/store.mjs` 房间落盘往返。`scripts/rooms-smoke.mjs`：两节点（独立 DSH_HOME）建房→加入→派任务→
房间消息→状态收敛。

## 9. 验证门槛（谁都不能跳过）

1. `node --check` 每个改过的文件。
2. `node scripts/smoke.mjs` 仍然 **all checks passed**（不能回归）。
3. `node --test scripts/rooms.test.mjs` 全绿。
4. `node scripts/rooms-smoke.mjs` 输出 `rooms interop ok`。
5. 装回 profile：`plugin_manager set_plugin {target:'include:dsh-lan-mesh', enabled:false}` 再 `true`，
   返回 `application: applied`，且 host `Tool.listTools` 能看到全部 7 个工具。
