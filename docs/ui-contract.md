# 面板契约（UI v2，冻结于 2026-11-01）

本文件是「独立操作界面」改造的接口契约。后端按此实现，前端按此调用。
任何一方要改字段，先改本文件。

## 1. 人的身份

人（浏览器里的你）不绑定任何 agent。加入房间时使用固定 sessionId：

```
sessionId = 'human'
key       = `${nodeId}/human`
name      = 节点的 displayName（如 DESKTOP-OTLA2LD-46a3）
role      = 'leader' | 'member'
```

人与 agent 走完全相同的 `members` 合并语义（墓碑、并集、leader 早者胜）。
`#wakeSession('human')` 找不到 agent，直接返回 false —— 人不会被打扰。

## 2. 端点全集

面板通过 `POST /api/lan-mesh` 调用，信封：

```json
{ "type": "client-request", "rpcId": "...", "method": "<endpoint>",
  "payload": { "method": "<endpoint>", "payload": { ...参数 } } }
```

响应 `{type:'server-response', rpcId, result:{ok:true,value}|{ok:false,error:{code,message,details}}}`。

| endpoint | 参数 | 返回 |
| --- | --- | --- |
| `snapshot` | `{sessionId?}` | `{self, peers, inbox, storage, attention, notify, rooms:{count, mine, all, unread}}` |
| `rooms` | `{sessionId?, all?}` | `{rooms: RoomRow[]}` |
| `roomDetail` | `{room, sessionId}` | `{room: RoomView, messages, mine, viewer}`（调用即把该房间对当前会话的关注项标为已读） |
| `roomCreate` | `{name, topic?, sessionId, sessionName?}` | `{room, forward}` |
| `roomJoin` | `{room, sessionId, sessionName?}` | `{room, added}` |
| `roomLeave` | `{room, sessionId}` | `{removed, room}` |
| `roomRename` | `{room, sessionId, name?, topic?}` | `{room}`（仅 leader） |
| `roomRead` | `{room, sessionId}` | `{flipped}`（**新增**，只翻转真正该看的） |
| `roomAssign` | `{room, sessionId, assignee, title, detail?}` | `{room, task, delivered}` |
| `roomStatus` | `{room, sessionId, task, status, note?}` | `{room, task}` |
| `roomSay` | `{room, sessionId, text, mentions?, skillRefs?, file?}` | `{room, delivered}` |
| `roomSkills` | `{}` | `{status:'ready',skills:[SkillRow]}` 或 `{status:'unavailable',skills:[],reason}`（**新增**，只读本机技能目录） |
| `send` | `{target, text, topic?}` | 投递结果 |
| `markRead` | `{}` | inbox |
| `sessions` | `{}` | `{sessions:[{id, title, name, rooms}]}` |
| `agents` | `{}` | `{self, agents, remote}` |
| `agentImport` | `{session?|cwd?, name?, title?}` | 引入/新建结果（`title` 写入真实会话标题） |
| `workspaces` | `{}` | `{workspaces:[{id, path, title, sessions}]}`（**新增**，供「选工作区新建 agent」） |
| `nickname` | `{self?|member?, name}` | `{nicknames}`（**新增**，本地偏好） |
| `agentDial` | `{target, text, topic?}` | 投递结果 |
| `agentUndial` | `{target}` | `{removed}` |
| `roomKick` | `{room, sessionId, member}` | `{room}`（仅 leader） |
| `roomInvite` | `{room, sessionId, member}` | `{room, delivered}` |
| `notifyChannels` | `{}` | `{channels:[{id,label,kind}], pending}` |
| `notifySend` | `{channel, text}` | 投递结果（单渠道自动发时用） |
| `notifyConfirm` | `{id, channel}` | `{status, summary, ok?}`（按人选定的渠道发出挂起通知） |
| `notifyDismiss` | `{id}` | `{ok}`（忽略挂起通知） |

`snapshot.notify` 是 `{pending:[{id, message, createdAt, channels:[{id,label}]}]}`。多渠道通知不会自动发，左栏「待确认通知」渲染它，点渠道按钮调 `notifyConfirm`、点忽略调 `notifyDismiss`；单渠道时 Host 直接发，不留 pending。

`snapshot.rooms.unread` 是 `{[roomId]: number}`，只统计**这个会话必须看的**：`@` 命中它的消息，以及派给它的任务。agent 之间的对话不计入。

`snapshot.attention` 是 `{messages: Message[], unread, total}`，同样的判定且只看未读——左栏「待你处理」就渲染它，用过即消失。

## 3. 数据形状

### RoomRow（左栏列表用）

```ts
{ id, name, topic, role, isMember, isLeader, members: Member[], tasks: Task[], updatedAt }
```

### RoomView（右栏详情用）

```ts
{ id, name, topic, leader: Member, members: Member[], memberCount, tasks: Task[], createdAt, updatedAt }
```

### Member

```ts
{ nodeId, sessionId, name, title: string, role, key, live: boolean }
```

`live` 含义：同一节点上的成员看会话是否活着；跨节点成员看**那台机器是否在线**
（节点级存在性，不是会话级 —— 跨机查每个会话要一次往返，太贵）。

`title` 是会话语义标题（来源：session projection `title`），可能是空串。客户端
**优先渲染 `title`，退回 `name`，最后才用会话 id**——原始 `nodeId/sessionId` 只放在
悬停提示里，不进可见文本。

### Task

```ts
{ id, title, detail, status: 'open'|'doing'|'blocked'|'done',
  assignee: Member, assigner: Member, createdAt, updatedAt }
```

### Message

```ts
{ id, receivedAt, read: boolean, from: {nodeId, name, sessionId, title}, to, kind, topic, room, text,
  mentions: string[], structuredMentions?: {memberKey, label}[], skillRefs?: SkillRef[] }
```

`structuredMentions` 与 `skillRefs` 都只在发送方显式带过时出现，缺失即"旧消息"，
渲染时按纯文本处理。两者都不改变 `text` 的内容——`text` 始终是原样发出的正文，
旧节点忽略元数据也照样能读。

### SkillRef

```ts
{ name: string, sourceNodeId: string, sourceNodeName: string }
```

一个技能引用只是**来源明确的提示**，不是指令、不是安装请求、不是执行授权：

- `name` 是技能名（不带 `/`），`sourceNodeId`/`sourceNodeName` 是那台机器的节点标识
  与显示名。三字段就够了；版本与环境**没有**表达，也不在本批次范围内。
- 去重键是 `(sourceNodeId, name)`——同名不同来源是两条不同的引用，绝不折叠。
- 接收方本机没有同名同源技能时，**仍然展示**，加"未安装"标记，且不提供任何动作。
  收到引用的 Agent 可以自行决定用不用本机某个技能，但系统绝不隐式安装或执行。
- 上限 32 条；`name` ≤128、`sourceNodeId` ≤64、`sourceNodeName` ≤128，禁止控制字符
  （校验在 `lib/room-message.mjs`，越界直接拒绝整条消息）。

### SkillRow（`roomSkills` 返回）

```ts
{ name: string, description: string, sourceNodeId: string, sourceNodeName: string }
```

`roomSkills` 是**只读投影**，只列本机公开目录里 `userInvocable` 的技能，按 name 排序，
最多 200 条。它绝不返回技能文件路径、`resourceBase`、`provider` 或指令正文——
白名单只挑上面四个字段。技能注册表不可用时返回 `{status:'unavailable', skills:[], reason}`
而不是空目录，否则会读成"这台机器没有技能"。该端点从不调用 `get()`/`invoke()`。

`kind` ∈ `'room-message'`（房间聊天）`| 'room-task'`（派活通知）`| 'note'`（点对点）。
聊天窗口渲染时 **按 `kind === 'room-message'` 过滤**，派活通知单独用任务区展示。

## 4. 面板布局

单页两栏，`main` slot，key `dsh-lan-mesh`。

```
┌───────────────┬────────────────────────────────────────┐
│ 左栏 300px     │ 右栏（flex 1）                          │
│               │                                        │
│ [本机节点名]   │  房间标题 / 说明        [改名·仅leader]   │
│ [会话标题]     │  ────────────────────────────────────  │
│               │  成员行（头像点 + 标题 + 在线点 + 私聊）  │
│ ── 我的房间 ── │  ────────────────────────────────────  │
│ · 房间A  (3)  │  聊天区（滚动，气泡：自己右、别人左，正文按 Markdown 渲染）│
│ · 房间B       │                                        │
│               │  ────────────────────────────────────  │
│ ── 可加入 ──   │  [任务 ▾]（折叠列表，leader 可派活）     │
│ · 房间C [加入] │  ────────────────────────────────────  │
│               │  [@成员选择浮层]                        │
│               │  [输入框]                     [发送]     │
│ [+ 新建房间]   │                                        │
└───────────────┴────────────────────────────────────────┘
```

- 左栏常驻（自上而下）：本机身份（节点名 + **会话标题** + 你自己的称呼输入框）、**待你处理**（`snapshot.attention`，只列未读的 `@` 与派给你的任务，点一行跳到那个房间）、我的房间（带待处理角标）、可加入项目（带「加入」按钮）、新建房间入口。
- 右栏只在选中房间时显示房间内容；未选中时显示提示 + 旧的 Peers/Inbox/点对点/新建 agent 概述。
- **新建 agent = 新建会话**：下拉选已有工作区（`workspaces` 端点），填标题（`agentImport.title`），建出来的会话就当作 agent 用。
- **聊天气泡**：自己发的靠右（`lm-bubbleMine`）、别人靠左。气泡上方一行把**发送者加粗**（`lm-bubbleWho`，取 `from.title`，昵称优先）再加灰色时间；正文用壳自带的 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText` 渲染（seed module，不新增依赖），`labels` 由面板自己填满中英文案，拿不到渲染器时退回 `white-space:pre-wrap` 纯文本。
- **`owner` 判定**：先比 `from.sessionId`（等于当前会话，或 `human`），旧行回退到标题/名字/「本节点只有一个成员」。显示名会重复也会被改，身份不能拿显示名判。
- 轮询：选中房间 2 秒一次 `roomDetail` + 4 秒一次 `snapshot`；agent 清单与工作区列表手动刷新（不进轮询）。
- 每个成员的「私聊」按钮：把右栏切到单发模式，用 `send` 端点，`target = `${nodeId}/${sessionId}``。
- **昵称 / 身份**：成员行的铅笔按钮调 `nickname {member, name}`，这类对他人的昵称只存在本机。身份卡的输入框 `onBlur` 调 `nickname {self:true, name}`；本机身份会同步到已加入项目的成员记录，并用于新消息的发送者名称。
- 会话跳转：成员行上的「打开会话」按钮与左栏的 agent 行都只调用
  `ctx.uiWorkspace.openSession(sessionId)`——原生会话占据 main 区，而左栏本身是
  `sidebar.workspaces` 槽里的组件，仍在原地，所以不会「跳出」插件页。
  `ctx.layout.selectPanel(null)` 留给左栏导航（项目/收件箱/看板），用于把插件
  body 重新放回 main。跨节点成员没有本地会话，按钮不渲染。
- **`@` 提及**：输入框打 `@` 时按光标前的 token 过滤成员（按标题/名字，前缀优先），
  浮层最多 8 行；`↑`/`↓` 移动、`Enter`/`Tab` 选中、`Esc` 关闭；选中后用
  `@标题 ` 替换 token。`@` 必须位于行首或空白之后（`mail@x` 不触发），
  token 里出现空白即结束（避免接受后菜单又弹回来）。
  两个会话标题相同（如都叫「新会话」）时，**浮层里重名的那几行**追加
  ` · 短会话id` 区分；唯一标题不加后缀，插入文本始终是不带后缀的标题
  （`@` 只是标注，不是地址）。
- **不显示原始 id**：所有成员/会话一律 `title → name → shortId` 逐级兜底，
  `nodeId/sessionId` 只作为悬停 `title` 属性出现。唯一的例外是上面那个重名消歧后缀。

- **技能引用**：两种入口打开**同一个**菜单——输入框里打 `/`（行首或空白后，`/`
  之前不能有空白，`a/b` 这种路径不触发），或点工具栏上的 `/技能` 按钮。菜单是一个
  可搜索列表，每行显示 `/<技能名>`、技能所属节点名、以及一句描述，最多 8 行；
  `↑`/`↓` 移动、`Enter`/`Tab` 确认、`Esc` 关闭。

  菜单里的**确认动作**才产生引用：选中后技能变成一个 chip 显示在输入框上方，正文里
  那个 `/` token 被消费掉。**没有经过菜单确认的 `/foo` 永远只是普通文本**——它会原样
  发给房间，不产生任何元数据，也不会被解释成技能。chip 上的 `×` 删除引用；
  删掉 chip 不会改动正文，正文里本来就没有 token。

  引用按 `(sourceNodeId, name)` 区分，所以两台机器上的同名技能在菜单里是两行、
  发送后是两条引用，**绝不折叠**。每行都写出来源节点名，这是避免同名歧义的唯一
  依据（不靠技能名、不靠顺序）。

  发送时 `skillRefs` 随消息一起走（见 §3）。接收方渲染时把引用显示在气泡底部，
  标注"引用的技能"和来源节点；**本机没有这个技能的引用仍然显示**，加虚线和
  "本机未安装此技能"标记，且不提供点击动作——引用是提示，不是安装或执行请求。
  Agent 读到引用后可以自己决定用不用本机某个技能，但没有任何隐式安装或隐式执行。

  技能目录只列**本机**的：`roomSkills` 返回本机公开目录，不跨节点拉取远端目录
  （跨节点技能目录需要协议层另行批准）。目录不可用时菜单显示"本机技能目录不可用"，
  而不是一个空列表。

## 5. 前端可用的客户端服务

```js
inject: ['slots']            // 只有插槽是启动期硬依赖
const serviceOf = (name) => ctx.get(name)   // 其余服务点击时现取，取不到就降级
serviceOf('layout')?.selectPanel(null)             // 释放原生选择，让插件 main 重新显示
serviceOf('uiWorkspace')?.openSession(sessionId)   // 原生会话占用 main，侧栏不受影响
```

**不要把 `layout` / `uiWorkspace` 写进 `inject`**：客户端 `inject` 是「没有它我就不该
启动」，写进去会让 fiber 停在 pending，整个 Web UI 白屏（`web boot: 1 entry did not
activate`）。同理两个 slot 注册都必须走 `ctx.slots.inject(key, () => register(...))`，
直接 `register` 会在 owner 声明插槽之前注册，条目静默消失。

`openSession` 只接受**本机** session id；跨节点的 agent 没有本地会话对象。
