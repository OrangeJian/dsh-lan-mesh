# 使用说明

这份文档讲**怎么用**。功能清单和快速开始见 [README](../README.md)，为什么这么实现见 [development.md](development.md)。

---

## 0. 它解决什么，不解决什么

它把局域网里几个独立的 DSH 实例连成一张网，让**你和你的 agent** 能和别的机器上的人与 agent 一起干一个项目。

成立的前提只有一条：**两台机器在同一个局域网里，且 UDP 45870 与 TCP 45871 互通**。不需要中心服务器、不需要公网、不需要账号。

它**不做**的事（重要，避免期待错位）：

- 不是实时聊天室。消息是异步投递，对端的 agent 可能过几十秒才回。
- 不做流式。你看不到对端 agent 的思考过程，只能收到它主动发来的结果。
- 不共享文件。跨机器的 agent 各自在自己的磁盘上干活；要交换产物就发文本或让对端自己取。
- 不移动会话。把别的 workspace 的 agent 引入进来，它的工作目录还是原来那个，只是「在这台机器上可以被唤醒」。

---

## 1. 装好并确认活着

```powershell
# 装（包目录指向源码目录即可）
plugin_manager install_bundle target="C:\path\to\dsh-lan-mesh"
plugin_manager set_plugin   target=include:dsh-lan-mesh enabled=true
```

期望返回里带 `"application": "applied"`。然后刷新浏览器页面。

确认三件事都成立：

| 检查 | 怎么看 |
| --- | --- |
| 侧栏图标 | 侧栏出现「局域网协作」 |
| 节点在监听 | 浏览器打开 `http://127.0.0.1:45871/lan-mesh/v1/info`，返回 `{"ok":true,"node":{...},"protocol":2}` |
| 模型有工具 | 新开一个会话问「看一下局域网里有哪些节点」，它应该会调 `lan_mesh_list_peers` |

`/info` 里的 `nodeId` 是这台机器的身份，`name` 是别人看到的名字，`secured` 表示有没有开 `clusterSecret`。

---

## 2. 五分钟：在一台机器上先跑通两个节点

这是最省事的验证方式，不用第二台电脑。

```powershell
# 主实例照常跑在 3080 / mesh 45871
# 第二个实例换端口和名字，否则会抢端口、共用同一份身份文件
$env:DSH_LAN_MESH_PORT='45872'
$env:DSH_LAN_MESH_DISCOVERY_PORT='45870'   # 发现端口必须一致
$env:DSH_LAN_MESH_NAME='second-instance'
dsh --profile web --port 3081 --no-open
```

两个实例起来后，各自打开面板（3080 一个、3081 一个），应该能互相看到对方的节点名（Peers 区各显示 1 个）。

在 3080 的面板里发一条消息：target 填 `second-instance`，正文随便写，点发送。到 3081 的面板 Inbox 区就能看到它。

> 第一次发送如果提示「没有匹配的节点」，等 3 秒再点一次——启动后第一轮 UDP 广播最多晚 5 秒，发送逻辑本身会先等 2.5 秒再重试一次。

存储会因为端口不同自动分槽：45871 用 `$DSH_HOME/lan-mesh/`，45872 用 `$DSH_HOME/lan-mesh/instances/45872/`。所以两个实例有各自的身份、收件箱和房间数据，不会打架。

---

## 3. 场景一：把「房间」当项目用

一个房间就是一个项目。成员身份是「**节点 + 会话**」的组合，所以你一个人在 A 机器的会话 1、B 机器的会话 2，可以同时是属于同一个房间的两个成员——这也是为什么任务能精确派到某个会话头上。

房间里可以有三类成员：

| 谁 | 成员位 | 能做什么 |
| --- | --- | --- |
| **你（人）** | `节点/human` | 发言、派活、改项目名（建房的你就是 leader） |
| 本机的 agent | `节点/session-xxxx` | 接任务、改自己任务的状态、发言 |
| 别的机器上的 agent | `那个节点/session-xxxx` | 同上，指令跨机器投递过去 |

人在面板里用 `human` 这个固定成员位，**不占用任何 agent 会话**——你不需要为了说一句话先开一个 agent。

### 3.1 建项目

面板左栏 →「新建房间」→ 填房间名和项目目标 → 点创建。创建者自动成为 **leader**。

或者让 agent 做：

```text
lan_mesh_room_member action=create room=支付网关重构 topic=把老网关换成新协议，月底上线
```

返回里会带房间 id（形如 `room-8f1343773d68`）。房间 id 是全网的唯一凭据，**跨节点协作时优先用 id**。

房间会立刻同步给所有在线节点：对端的「可加入的项目」区能看到它，但那时对端还不是成员。

### 3.2 别人加入

对端面板 →「可加入的项目」→ 找到那个项目 → 点「加入」。

这里列出的是插件创建的协作 Room，不是对端磁盘上的 DSH 工作目录。面板加入的是 `nodeId/human`；要让 Agent 接任务，需要在那个 Agent 会话中单独加入。当前源码发现新节点后会补同步项目，每 10 秒重试；旧版若出现“能发现节点却看不到已有项目”，需要更新并重载插件。

或让对端的 agent 加入：

```text
lan_mesh_room_member action=join room=room-8f1343773d68
```

成员可以随时自己加入，不需要 leader 审批——这一版把「邀请」简化掉了。要限制参与范围，用 `clusterSecret` 或 `trustedPeers` 在节点层做。

### 3.3 leader 派活

**只有 leader 能派任务**，别人派会被拒（`NOT_LEADER`）。在房间详情里：选成员 → 填标题 → 填详情（验收标准、上下文）→ 派。

或让 agent 做：

```text
lan_mesh_room_task action=assign room=room-8f1343773d68 assignee=second-instance/session-abc123 \
  title=把重试逻辑挪到中间件 detail=现有三处重复实现，收敛成一个；单测覆盖超时分支
```

`assignee` 可以写成员名、会话 id 或节点名。派完之后，对端那个会话会被唤醒——它的 agent 会在自己机器上收到一条「你被派了一个任务」的用户消息，然后开始干活。

### 3.4 成员报进度

任务状态只有四档：`open`（待开始）／`doing`（进行中）／`blocked`（受阻）／`done`（已完成）。

成员改自己手上任务的进度，leader 也能改任何任务：

```text
lan_mesh_room_task action=status room=room-8f1343773d68 task=task-bc357aacfd8a status=doing note=先把超时分支的测试补上
```

`note` 会带时间戳追加到任务详情，形成一个粗糙的进度流水。

> 任务用**标题**也能定位，但如果房间里有两条同名任务，会直接报错并列出候选 id（`AMBIGUOUS_TASK`）——这是刻意的，静默改错任务比报错难查得多。长期协作建议一直用 id。

### 3.5 房间内沟通

```text
lan_mesh_room_say room=room-8f1343773d68 text=超时分支我来做，先把 retry 挪完
```

只有同房间成员收到。本节点上的其他成员逐个唤醒，远端节点按节点只发一份、由对端自己扇出——这样 10 个成员在 3 台机器上，链路上也只有 3 条消息。

在面板里你可以直接打字发言（以 `human` 身份）。输入框打 `@` 会弹出同房间成员的选择框：按标题（没有标题时按名字）过滤，↑↓ 移动、Enter 或 Tab 选中、Esc 关掉，选中后写进输入框的是 `@成员标题 `。`@` 只是**标注 + 高亮**：消息照旧广播给全房间，被 @ 的 agent 自己决定是回话，还是去给自己派活、找别人要信息。

界面上成员一律显示**会话标题**，原始 `nodeId/sessionId` 收在悬停提示里——标题来自会话自身的 `title` projection，比 id 可读得多。

房间的聊天记录会显示在房间详情里，自己发的靠右、别人的靠左。发送者自己那条也会留在本地记录里，但不计入未读。

### 3.6 改项目名与目标

只有 **leader** 能改。面板房间标题旁边的「改名」按钮，其他人看到是灰的。

改名不影响房间 id，所以已经在房间里的人不会掉出去；改名会 bump 房间的 `updatedAt`，同步时按这个时间戳决定谁的标题更新——老节点推上来的旧标题不会把新名字覆盖回去。

### 3.7 退出与离场

```text
lan_mesh_room_member action=leave room=room-8f1343773d68
```

leader 不能退出自己建的房间（要么把项目交给别人，要么整个房间退休）。

离场用了**墓碑**机制：退出会写一条带时间的 `left` 记录，同步时比谁的墓碑更新。所以「A 退出」这件事能传到对端，重复同步也不会把人又加回来（早期版本只做成员并集，退出永远传不出去——这是一个真踩过的坑）。

---

## 4. 场景二：把你的 agent 借给对面，或把活派给对面的 agent

### 4.1 看看有什么可用的

```text
lan_mesh_agents
```

返回两段：

- **本节点**：本机所有会话，`运行中`（live）与 `已存盘`（还没启动），各自带 workspace 名字。
- **局域网其他节点**：对面节点公布的 agent 清单，带 `dialled` 标记（你是否联络过）。

### 4.2 从别的 workspace 把 agent 拉起来

本机上，某个会话在别的目录下、当前没跑。你可以在**这里**把它恢复成 live：

```text
lan_mesh_agent_import session=session-445e81dc-62a6-4345-9050-45b691d05c28
```

它会 `resume` 那个会话——工作目录不变（还是原来那个 workspace），但从现在起可以被本节点唤醒和派活。

想让某个目录下有个新 agent（目录不存在会自动创建）：

```text
lan_mesh_agent_import cwd=C:\work\new-project name=前端小工
```

这两种引入出来的 agent 都会继承本插件的 11 个 `lan_mesh_*` 工具，并且带着节点默认模型和默认 preset——没有这两样，它要么开不了口（没有工具），要么第一轮就报错（缺模型）。

> 引入 = 拿到了那个会话的**写所有权**。所以本节点关闭时会把它 dispose 掉，否则下次启动会撞上写锁。这也意味着：同一个会话不要在两台机器上同时引入。

### 4.3 给对面机器上的 agent 派第一句指令

```text
lan_mesh_agent_dial target=node-c74cbc4a/session-8eae57c4-33a4-4d08-ac49-b02c78c39926 \
  text=统计 docs 目录下所有 TODO，按文件分组列出来
```

发生的事：

1. 本节点把这段话包成一条唤醒消息投给对端节点，指定投递给那个会话。
2. 对端 agent 被唤醒，像一个刚接到任务的同事那样开始干活。
3. 它干完后用 `lan_mesh_send` 把结果发回本节点（投递文本里已经写了回信地址）。

面板上的做法更省事：Agents 区里远端那行点「派任务」，**它会把上面消息框里的内容当作第一句指令发出去**。

`dial` 是一次性的请求-应答，不是订阅：没有心跳、没有重连、也没有「对方正在输入」。对方关机了，这条消息就留在它的收件箱里，等它下次上线。

### 4.4 关于「已联络」标记

联络过的远端 agent 在列表里带 `dialled` 标记（面板显示「已联络」）。它纯粹是个记号，不影响权限，也不代表长连接还活着——随时可以再 dial 一次。

想清掉标记，用面板或直接打端点 `agentUndial`（没有对应的模型工具，这一层只给人和面板用）。

---

## 5. 场景三：不涉及 agent，纯人对人发消息

最原始的一层。

```text
lan_mesh_list_peers                  # 谁在线
lan_mesh_send target=DESKTOP-A1B2 text=构建挂了，看下 CI
lan_mesh_send target=node-c74cbc4a/session-abc text=这条只投给那个会话
lan_mesh_send target=* text=全体注意：今晚 22 点重启
lan_mesh_inbox                       # 读未读
lan_mesh_inbox unread_only=false limit=50
```

`target` 支持四种写法：节点名、nodeId、`nodeId/sessionId`（直投某个会话）、`*`（广播）。

读完自动标记已读。`autoWake=true` 时，投递给某个会话会真的把它唤醒；只想投递不想打扰，把 `autoWake` 关掉。

---

## 6. 面板速查

面板是一整块**独立操作界面**（不是塞在会话旁边的小卡片）：左边常驻房间列表，右边是被选中房间的详情与聊天。

```
┌───────────────┬────────────────────────────────────────┐
│ 本机身份       │  房间标题 / 说明        [改名·leader]    │
│ ── 待你处理 ── │  成员行（在线点 + 名字 + 私聊 + 开会话）  │
│ · 谁 @了你     │  ────────────────────────────────────  │
│ ── 我的房间 ── │  聊天区（自己右、别人左，气泡）          │
│ · 项目A   (3) │                                        │
│ ── 可加入 ──   │                                        │
│ · 项目C [加入] │  ────────────────────────────────────  │
│ [+ 新建房间]   │  [任务 ▾]   [输入框 @提及]      [发送]  │
└───────────────┴────────────────────────────────────────┘
```

### 左栏

- **本机身份**：节点名、你当前会话的标题（标题还没生成时退回到会话 id）。第一行永远是你自己这台机器。下面的「你的称呼」是你以人的身份在房间里显示的名字，改完离开输入框即保存（只存在本机）。
- **待你处理**：真正需要你看的东西——**有人 @ 了你**，或者**有人派活给你**。点一行直接跳到那个房间。agent 之间的互相通话不进这里，读过之后就从列表消失，所以这一栏通常很短。
- **我的房间**：你（以人的身份）加入的项目。后面的数字是**待处理条数**，打开房间即清零。
- **可加入的项目**：同一个局域网里别人建、你还没加入的项目，带「加入」按钮。
- **新建房间**：名字 + 目标（一句话说明这个项目要做什么）。建完你就是 leader。

> 你以「人」的身份进房间，用的是 `节点/human` 这个特殊成员位，**不占用任何 agent 会话**。成员表里它显示成你的机器名，或你设的称呼。

### 右栏 · 房间详情

- 顶部：房间名、说明、成员数。**只有 leader 能改名 / 改说明**，其他人看到按钮是灰的。
- 成员行：左边的圆点是**在线状态**。
  - 本节点上的 agent —— 会话真在跑才亮。
  - 别的节点上的 agent —— 那台机器在线就亮（跨机逐会话问一次太贵）。
  - 你自己（`human`）—— 一直亮。
  - 名字一律显示**会话标题**（没有标题才退回到 agent 名 / 会话 id），原始 `nodeId/sessionId` 只放在鼠标悬停提示里。
  - 名字后面的「打开会话」按钮只对**本机**的 agent 出现：点一下跳到那个 agent 的对话（`ctx.uiWorkspace.openSession`），这是「从房间跳到干活的地方」的最短路径。
  - 「私聊」按钮把右栏切到单发模式，用 `send` 端点，只发给他一个人。
- 聊天区：气泡。自己发的靠右，别人靠左，发送者的会话标题**加粗**显示在气泡上方（后面跟时间）。消息正文按 Markdown 渲染，和普通会话一样——列表、表格、代码块、链接都正常显示。只显示聊天消息（`kind === 'room-message'`）；派活通知归下面的任务区，不混在聊天里。回车发送、Shift+Enter 换行。
- 输入框打 `@` 会弹出成员选择框，按标题/名字过滤，↑↓ 选、Enter 或 Tab 确认、Esc 关掉。选完写进去的是 `@标题 `，这只是标注 + 高亮，消息仍然广播给全房间 —— 被 @ 的 agent 自己决定是回话还是去派活。两个会话标题重名时，浮层里那几行会带一个短会话 id 后缀区分，插入文本仍然只用标题。
- 成员行右上角的铅笔按钮给这个成员起**昵称**：只存你自己的机器上，别人看到的还是原名。用昵称可以一眼分清「本机两个会话」里哪一个回了话。
- 任务区（可折叠）：标题、状态、assignee。leader 能派活，assignee 能改自己的状态。派活通知里已经要求执行者完成后回一条结论文（@ 派活的人），所以结果会直接出现在「待你处理」里。

### 右栏 · 没选中房间时

显示老的「原始能力」：在线节点（Peers online）、收件箱（Inbox）、点对点发送，以及**选一个工作区 + 填标题**新建 agent。这些是房间层之外的兜底通道，保留着就是为了「对方还没进房间」时也能把人拉进来。

> 新建 agent 就是新建一个会话：从下拉里选一个已有的工作区（不是手打路径），再给它一个标题，建出来的会话就当作 agent 用——它继承本插件的 10 个 `lan_mesh_*` 工具，标题也就是别人在房间里看到的名字。

### 刷新节奏

选中的房间 2 秒刷一次详情、4 秒刷一次总览；agent 清单**不参与轮询**——每刷一次都要向每个 peer 发请求，代价不低，需要时点刷新。

---

## 7. 工具速查

十一个工具，分四层。全部可以直接用自然语言驱动，工具名和参数如下。

### 网络层

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `lan_mesh_list_peers` | 无 | 列出已发现节点 |
| `lan_mesh_send` | `target`(必), `text`(必), `topic` | 发消息；target 支持名字/nodeId/`nodeId/sessionId`/`*` |
| `lan_mesh_inbox` | `limit`(默认20，最大200), `unread_only`(默认true) | 读消息，读完标记已读 |

### 房间层

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `lan_mesh_rooms` | 无 | 我加入的房间 + 成员 + 任务 |
| `lan_mesh_room_member` | `action`(create/join/leave), `room`, `topic`, `member_name` | 建房/加入/退出 |
| `lan_mesh_room_task` | `action`(assign/status), `room`, `assignee`, `title`, `detail`, `task`, `status`(open/doing/blocked/done), `note` | 派活 / 报进度 |
| `lan_mesh_room_say` | `room`, `text` | 房间内发言 |

> 面板上的**改名 / 改说明**目前只在面板里做（端点 `roomRename`），没有对应的模型工具 —— 改项目名字是人的决定，不该由 agent 代劳。需要让 agent 改时，让它调端点或你直接点。

### Agent 层

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `lan_mesh_agents` | 无 | 本机会话 + 远端可联络 agent |
| `lan_mesh_agent_import` | `session` 或 `cwd`（二选一）, `name`, `title` | 恢复别的 workspace 的会话 / 在指定目录新建（`title` 就是会话标题） |
| `lan_mesh_agent_dial` | `target`(必, `nodeId/sessionId`), `text`(必), `topic` | 给远端 agent 第一句指令 |

### 通知层（预留操作）

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `lan_mesh_notify` | `action`(channels/send/confirm/dismiss), `text`, `id`, `channel` | 发通知：运行时发现本机可用渠道（微信 im 等），单渠道自动发、多渠道挂起等人确认 |

通知渠道不写死：发送那一刻才去发现本地 `@xmanrui/dsh-im` 有哪些 bot×target（当前环境的微信 im 即由此自动找到），加上可选的 `notifyWebhook`。发现多个渠道时消息会挂在左栏「待确认通知」，由人选一个再发；一个都没有只记日志。房间任务被置 `done` 时会自动触发一次。

错误码会直接出现在返回里，常见几个：`NOT_LEADER`（只有 leader 能派活/改名）、`AMBIGUOUS_ROOM`／`AMBIGUOUS_TASK`／`AMBIGUOUS_AGENT`（同名，请改用 id）、`UNKNOWN_ROOM`／`UNKNOWN_AGENT`、`BAD_REQUEST`（参数不对，例如相对路径 cwd）。

---

## 8. 面板背后的 HTTP 端点

面板不走工具的 RPC，而是 `POST /api/lan-mesh`，信封是 DSH 的 client-request：

```json
{"type":"client-request","rpcId":"...","method":"snapshot",
 "payload":{"method":"snapshot","payload":{"sessionId":"..."}}}
```

端点共 26 个：`snapshot`、`rooms`、`roomRead`、`send`、`markRead`、`sessions`、`roomCreate`、`roomJoin`、`roomLeave`、`roomKick`、`roomInvite`、`roomRename`、`roomAssign`、`roomStatus`、`roomSay`、`roomDetail`、`agents`、`agentImport`、`workspaces`、`nickname`、`agentDial`、`agentUndial`、`notifyChannels`、`notifySend`、`notifyConfirm`、`notifyDismiss`。

字段契约见 [ui-contract.md](ui-contract.md)。其中两处值得记住：

- `snapshot.rooms.unread` 是 `{[roomId]: number}`，只算**别人发来的未读**房间消息；`roomDetail` 一调用就清零。
- `Member.live` 是必填布尔值，语义见上面「成员行」。

**这个通道只对已登录的浏览器开放**（owner 认证）。命令行直接 curl 会拿到 401，这是设计如此，不是 bug。

节点之间的通道是另一套，不需要登录：`GET /lan-mesh/v1/info`、`POST /lan-mesh/v1/send`、`POST /lan-mesh/v1/hello`、`POST /lan-mesh/v1/state`（房间状态同步）、`POST /lan-mesh/v1/agents`（agent 清单）。开了 `clusterSecret` 之后这些请求必须带 HMAC 签名。

---

## 9. 配置与存储

配置写在 profile 的 patch 层，或用环境变量覆盖（环境变量优先）：

| config | 环境变量 | 默认 |
| --- | --- | --- |
| `displayName` | `DSH_LAN_MESH_NAME` | 主机名-后缀 |
| `port` | `DSH_LAN_MESH_PORT` | `45871` |
| `discoveryPort` | `DSH_LAN_MESH_DISCOVERY_PORT` | `45870` |
| `clusterSecret` | `DSH_LAN_MESH_SECRET` | 空 |
| `autoWake` | — | `true` |
| `trustedPeers` | — | `[]` |

磁盘上四个文件，都在 `$DSH_HOME/lan-mesh/`（非默认端口则在 `instances/<port>/`）：

- `node.json` — 节点身份（`nodeId`、`name`、创建时间）。删了会重新生成新身份，等于换了张脸。
- `inbox.jsonl` — 收到的消息，一行一条，追加写。
- `rooms.json` — 全部房间状态。**这是房间的唯一真相**，删了等于所有房间消失。
- `nicknames.json` — 本机给别人起的昵称和你自己的称呼。只影响这台机器的显示，删了只是名字回到默认。

---

## 10. 安全怎么想

默认是「相信我所在局域网」。要更严一点，两个旋钮：

- `clusterSecret`：设了之后，节点间所有请求必须带 HMAC-SHA256 签名（签名覆盖协议版本、消息 id、来源、目标、类型、主题、房间、正文、时间）。对不上直接 401。适合「局域网里有别人的机器」的场合。
- `trustedPeers`：设了之后只接受列表里的 nodeId，其他节点即使发现得到也会被 403 拒掉。

这两条都保护**节点间**通道。面板通道走 DSH 自己的浏览器登录态，另算。

另外：`autoWake` 意味着「谁给我发消息都能唤醒一个 agent turn」。在不可信的网络上跑，要么关掉它，要么至少设 `trustedPeers`。

---

## 11. 出问题了看这里

- **看不到对端**：发现端口不一致、不在同一网段、防火墙拦了 UDP 45870 或 TCP 45871。
- **面板一直转圈**：`POST /api/lan-mesh` 需要浏览器登录态；换个标签页重新登录试试。
- **房间名操作报错并列出一堆 id**：两个节点各建了一个同名项目，改用 id。
- **派活返回 `NOT_LEADER`**：当前不是这个房间的 leader。用「人」的身份建的房间，leader 就是你（`节点/human`）；用 agent 会话建的房间，leader 是那个会话——面板里换身份也接管不了，得让那个会话自己改，或者另建一个项目。
- **改名按钮是灰的**：同上，只有 leader 能改。
- **成员圆点不亮**：本机 agent 要点亮需要那个会话真在跑；别的节点上的 agent 要点亮需要那台机器的 DSH 在线（UDP 发现能看到它）。
- **分不清本机两个会话谁回的**：气泡的发送者就是会话标题；标题一样时用成员行的铅笔给其中一个起昵称。
- **界面还有英文**：面板每读一条文案都重新判定 `document.documentElement.lang`，若整页仍是英文，说明 DSH 的界面语言还没切到中文（设置 → 通用 → 语言）。
- **未读角标不清零**：角标只统计**你真正需要看的**（有人 @ 你、有人派活给你），打开房间即清零。agent 之间互相说话不算，所以角标不来是对的。
- **被 dial 的 agent 没反应**：先看它的会话日志里有没有 `lan_mesh_*` 工具（没有说明工具没挂上），再确认 `cwd` 目录存在、创建时带了默认模型。
- **工具报 `returned invalid output`**：插件声明的 output schema 和实际返回的形状对不上，跑 `node scripts/schema-check.mjs` 能指出是哪条字段。
- **刷新页面白屏，提示 `web boot: … entry did not activate / dsh-lan-mesh: failed`**：客户端半把某个客户端服务写成了启动期硬依赖，而当前 profile 没挂它。现已改为按需取用（见 `docs/development.md` §4.13），若仍出现，先看浏览器控制台的 `[dsh-lan-mesh]` 日志，再 `node scripts/panel-check.mjs` 复现。

其余排障条目见 [README 的排障一节](../README.md#排障)。
