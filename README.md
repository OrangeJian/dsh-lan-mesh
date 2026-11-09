# dsh-lan-mesh · 局域网协作

[![npm version](https://img.shields.io/npm/v/dsh-lan-mesh)](https://www.npmjs.com/package/dsh-lan-mesh)
[![license](https://img.shields.io/npm/l/dsh-lan-mesh)](./LICENSE)

让同一局域网里的多个 DeepSeek Harness 实例互相发现、互发消息，并围绕「房间＝项目」协作：每个 agent 会话可以加入多个房间，房间有 leader 给成员分配任务，房间内的沟通只发给同房间成员。

零 npm 依赖，只用 Node 内置模块。

开发预览：[Agent Team M1 使用说明](docs/team-m1-usage.md)。新增独立执行账本、派发确认、租约及结果核对，默认关闭；自动编排和验收界面尚未实现。新源码也修复了“项目早于对端启动，导致可加入列表为空”的补同步问题，更新后需重载插件。

2026-11-10 开发交接：M3 附件实现已提交，**最终审查未通过，尚未完成**。负责人要求转交 DSH 继续；先处理 [M3 整改清单](docs/handoffs/dsh-m3-review-findings.md)，再使用 [后续开发提示词](docs/handoffs/dsh-after-m3-prompt.md) 推进。已有自动化通过记录不能代替这些遗漏的回归和真实设备验收。

## 截图

> 截图待补。按下面每条说明截图，放进 `docs/screenshots/`，再把对应的 `<!-- SCREENSHOT -->` 占位行换成 `![描述](docs/screenshots/xxx.png)` 即可。

1. **面板全貌** → `docs/screenshots/panel.png` —— 侧栏「局域网协作」图标 + 主面板（左边房间列表 / 可加入项目 / 新建入口，右边成员行 + 气泡聊天 + 可折叠任务区）。
2. **房间聊天** → `docs/screenshots/room-chat.png` —— 气泡式对话；输入框打 `@` 弹出成员选择框；成员显示会话标题而非 `session-xxxx`。
3. **任务派发与进度** → `docs/screenshots/task.png` —— 房间详情里选成员、填标题派活；任务状态 open / doing / blocked / done 流转。
4. **远端 agent** → `docs/screenshots/agents.png` —— Agents 区列出远端机器可联络的 agent，点「派任务」投第一句指令。
5. **存活自检** → `docs/screenshots/info.png` —— 浏览器打开 `http://127.0.0.1:45871/lan-mesh/v1/info` 返回 `{"ok":true,"node":{...},"protocol":2}`。

<!-- SCREENSHOT: panel.png -->
<!-- SCREENSHOT: room-chat.png -->
<!-- SCREENSHOT: task.png -->
<!-- SCREENSHOT: agents.png -->
<!-- SCREENSHOT: info.png -->

## 文档

| 文档 | 内容 |
| --- | --- |
| 本文件 | 安装、配置、工具清单、架构、排障 |
| [docs/usage.md](docs/usage.md) | **使用说明**：三个场景的完整操作走查、面板每个区块怎么用、工具参数逐项说明、安全怎么想 |
| [docs/development.md](docs/development.md) | **开发过程**：选型理由、真机验证抓到的 19 个 bug、协议取舍、验证体系、事故复盘 |
| [docs/rooms-contract.md](docs/rooms-contract.md) | 房间层的冻结契约（各模块签名、RPC 端点表、合并语义） |
| [docs/ui-contract.md](docs/ui-contract.md) | 面板契约（端点全集、RoomRow／RoomView／Member／Task／Message 形状、布局、客户端服务） |
| `spec.md` / `tasks.md` | v0.2 全屏接管的**历史规划记录**，已被 `MeshNavigation` 状态机实现取代（见各文件顶部说明） |

## 功能总览

三层能力，从最原始的收发到最高层的 agent 协作：

**网络层**——同一局域网内的 DSH 实例自动互相发现（UDP 广播，5 秒一轮），按名字／nodeId／`nodeId/sessionId` 直投或 `*` 广播。可选 HMAC 签名与 nodeId 白名单。

**房间层**——房间就是项目。成员身份是「节点 + 会话」的组合，所以一个人多台机器、多个会话可以同时属于多个房间。房间里可以有三类成员：**你（人，`节点/human`，不占用任何 agent 会话）**、本机的 agent、别的机器上的 agent。创建者是 leader，只有 leader 能派任务与改名，成员报进度（open/doing/blocked/done），房间内发言只发给同房间成员。状态在节点间幂等合并，离场用墓碑传播。

**Agent 层**——能列出本机所有会话（含没启动的）和远端机器上可联络的 agent。可以：

- 把**别的 workspace** 里已存盘的会话在本机恢复成 live agent（不移动文件），或直接在某个绝对目录新建一个；
- 把第一句指令投给**别人机器上**的 agent，它干完活用自己的工具回信。

引入／新建出来的 agent 会自动继承本插件的 11 个工具、默认模型与默认 preset——这三点缺任何一样，它都动不了（详见 [docs/development.md](docs/development.md)）。

**通知层**——不绑定任何渠道。「通知」是一个预留操作：真正要发时运行时发现本机可用的通知工具（当前环境的微信 im 由 `@xmanrui/dsh-im` 提供，也可配置一个 webhook）。只发现一个就自动发；发现多个则挂起，由人在面板「待确认通知」里选一个再发；一个都没有就只记日志，绝不影响任务完成。详见 [docs/development.md](docs/development.md) §4.19。

**面板**——侧栏「局域网协作」图标打开一块**独立操作界面**：左边常驻房间列表（我的房间带未读角标、可加入的项目、新建入口），右边是选中房间的成员行（在线状态点）、气泡式聊天、可折叠任务区，以及「点一下跳到本机那个 agent 的会话」。输入框打 `@` 弹出成员选择框；成员一律显示**会话标题**而不是 `session-xxxx`，原始地址收在悬停提示里。没选中房间时显示老的兜底通道：在线节点、点对点发消息、收件箱、按目录新建 agent。

## 安装

```powershell
# 在工作区里开发，再把包目录装进当前 profile
dsh plugin install "C:\path\to\dsh-lan-mesh"
```

或者用插件管理工具指向包目录安装，然后用条目 id 启停：

```text
plugin_manager set_plugin target=include:dsh-lan-mesh enabled=true
```

装好后刷新 Web UI，侧栏出现「局域网协作」图标；模型侧多出 11 个 `lan_mesh_*` 工具。

## 快速开始

1. **确认活着**：浏览器打开 `http://127.0.0.1:45871/lan-mesh/v1/info`，应返回 `{"ok":true,"node":{...},"protocol":2}`。
2. **建一个项目**：面板「房间」区填名字 → 创建，你成为 leader。
3. **让别人加入**：对端面板「可加入的项目」里点加入（或 `lan_mesh_room_member action=join room=<id>`）。
4. **派活**：房间详情里选成员、填标题 → 派。对端会话会被唤醒，agent 开始干活。
5. **借 agent**：Agents 区看远端机器上有哪些 agent，点「派任务」把消息框内容当第一句指令发过去。

三个使用场景的完整走查、面板每个按钮的作用、所有工具参数，见 [docs/usage.md](docs/usage.md)。

## 面板操作流程

装好刷新后，左侧栏「局域网协作」图标打开面板。从选身份到派活的完整顺序：

1. **选身份** —— 面板左上「会话」下拉框默认就是 **「我 (本人)」**。旁边「你的称呼」填一个名字，这个称呼会显示给房间里所有人。人用 `节点/human` 这个特殊成员位，不占用任何 agent 会话，所以重启、切会话都不影响你的房间归属。

2. **建房间** —— 左侧「新建房间」填名字 + 一句话目标 → 创建。你成为 leader，房间记在「我」名下。

3. **拉 agent 进房** —— 打开房间，成员区下方（只有 leader 看得见）出现「拉进房」下拉框：从**本节点**已有会话里选一个 → 点「拉进来」，它正式成为房间成员。对端机器的 agent 不能这样拉（它的成员身份归对端所有），要跨机器协作走第 6 步。

4. **派活** —— 房间里「派活」表单：指派给某成员 → 一句话任务 → 可选验收标准 → 分配。对端成员会话会被唤醒，agent 开始干活，状态在 `open → doing → blocked/done` 之间流转。

5. **房间聊天** —— 底部输入框发言，`@名字` 定向提醒某成员，只发给同房间成员。

6. **跨机协作** —— 另一台机器也装好插件、同一局域网内自动互发现。对方机器上的 agent 会出现在「其他机器上的 agent」列表，点「联络」把第一句指令投过去；它干完活用 `lan_mesh_send` 回信。

关键规则：**人 = 「我 (本人)」，agent = 各自会话**，房间成员身份是「节点 + 会话」的组合；只有 leader 能拉人、派活、改名、退房（退房被拒）。

## 两种地址，别搞混

| 用途 | 地址 | 谁访问 |
| --- | --- | --- |
| 节点之间 | `http://<ip>:45871/lan-mesh/v1/*` | 局域网内的其他 DSH 节点 |
| 面板 → 本机 Host | `POST /api/lan-mesh` | 已登录的浏览器页面（cookie 认证） |

节点间通道不需要登录（可用 `clusterSecret` 加签）；面板通道走 Host 的 owner 认证，只在浏览器里可用，命令行 curl 不带 cookie 会拿到 401。

## 配置

写在 `cordis.patch.yml` 的插件 config 里，或用环境变量覆盖（环境变量优先）：

| config | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `displayName` | `DSH_LAN_MESH_NAME` | 主机名-后缀 | 别人看到的节点名 |
| `port` | `DSH_LAN_MESH_PORT` | `45871` | HTTP 直连端口；被占用会自动退到系统分配端口 |
| `discoveryPort` | `DSH_LAN_MESH_DISCOVERY_PORT` | `45870` | UDP 广播发现端口，同一局域网内要一致 |
| `clusterSecret` | `DSH_LAN_MESH_SECRET` | 空 | 非空时信封必须带 HMAC-SHA256 签名 |
| `autoWake` | — | `true` | 收到消息时是否唤醒目标会话 |
| `trustedPeers` | — | `[]` | 非空时只接受列表内 nodeId |
| `notifyWebhook` | — | 空 | 额外通知渠道：POST `{text}` 到该 http(s) 地址。留空即可，本地 IM 渠道（微信等）会在发送时自动发现 |

同一台机器上跑第二个实例时必须改端口和名字，否则两个进程会抢同一个端口、共用同一份身份文件：

```powershell
$env:DSH_LAN_MESH_PORT='45872'; $env:DSH_LAN_MESH_NAME='second-instance'
dsh --profile web --port 3081 --no-open
```

存储按端口分槽：默认端口用 `$DSH_HOME/lan-mesh/`，其他端口用 `$DSH_HOME/lan-mesh/instances/<port>/`。

## 给 agent 用的工具

网络层：

- `lan_mesh_list_peers` — 看在线节点
- `lan_mesh_send` — 发消息，`target` 可写节点名、nodeId、`nodeId/sessionId`，或 `*` 广播
- `lan_mesh_inbox` — 读收到的消息，读完标记已读

房间层（房间＝项目）：

- `lan_mesh_rooms` — 我加入了哪些房间、成员和任务
- `lan_mesh_room_member` — `action=create|join|leave`
- `lan_mesh_room_task` — `action=assign`（只有 leader 能派）／`action=status`（自己改进度）
- `lan_mesh_room_say` — 房间内发言，只发给同房间成员

成员身份是「节点 + 会话」的组合，所以一个人可以在不同机器、不同会话里同时属于多个房间。你自己（人）用的是 `节点/human` 这个特殊成员位，不需要开 agent 会话就能发言、派活、改项目名。

房间改名／改说明**只在面板里做**（端点 `roomRename`，仅 leader 可改）。改名字是人的决定，这一版没给它做模型工具。

Agent 层（把别处的 agent 拉进来干活的）：

- `lan_mesh_agents` — 本节点所有会话（运行中／已存盘）＋ 各远端节点公布的 agent
- `lan_mesh_agent_import` — 两种用法：给 `session` 把本机某个已存盘会话恢复成 live agent（它原来的 workspace 不变，只是在这里可以被唤醒）；给 `cwd` 在指定绝对目录新建一个会话
- `lan_mesh_agent_dial` — 给远端节点的某个 agent 下第一句指令，`target` 写 `nodeId/sessionId` 或名字

跨机器的 agent 不是长连接：`lan_mesh_agent_dial` 投一条唤醒消息过去，对端 agent 在自己机器上干完活，用 `lan_mesh_send` 把结果发回来（唤醒文本里带了回信 target）。这样断网、重启都不用重连。

通知层（预留操作，不绑定渠道）：

- `lan_mesh_notify` — `action=channels` 列出本机可用通知渠道；`action=send` 发一条通知（仅一个渠道时自动发，多个则挂起等待确认）；`action=confirm` 选渠道发出挂起的通知；`action=dismiss` 忽略一条挂起通知。

渠道在**发送时**才运行时发现：本地 `@xmanrui/dsh-im` 的每个 bot × target 都是一个渠道（当前环境的微信 im 就是这样自动被找到的），再加上可选的 `notifyWebhook`。房间任务被置 `done` 时也会自动触发一次通知。发现 0 个渠道只记日志、1 个自动发、**多个挂起由人在左栏「待确认通知」里二次确认**——不会替你选，也不会把消息发到写死的内网地址。

引入／新建出来的 agent 会同时继承本插件的 11 个 `lan_mesh_*` 工具：preset 只挂它自己那一组插件，宿主上的工具不会被继承，所以在 `setup` 里额外把工具定义注册到 agent 自己的 ctx 上。没有这一步，被唤醒的 agent 看得见消息却发不出回信。

## 架构

```
index.js            Host 入口：11 个工具、/api/lan-mesh 面板路由（26 个端点）、系统提示
client.js           面板：侧栏图标 + 主面板（房间、任务、聊天、agent 清单、待确认通知）
lib/discovery.mjs   UDP 广播发现（TAG dsh-lan-mesh/1，5s 公告，20s 过期）
lib/transport.mjs   HTTP JSON 直连、信封规范化、HMAC 签名、房间状态与 agent 清单交换
lib/service.mjs     MeshNode：节点状态 + 房间 CRUD + agent 引入/联络 + 唤醒与投递
lib/rooms.mjs       纯函数：房间状态的创建/加入/离开/任务/合并（唯一真相）
lib/agents.mjs      纯函数：agent 行的投影、远端清单规范化、按 id/名字解析
lib/notify.mjs      Notifier：运行时发现本地通知渠道、单渠道自动发、多渠道挂起待确认
lib/store.mjs       持久化：node.json / inbox.jsonl / rooms.json / nicknames.json（原子写）
```

状态同步：每次房间变更后向所有 peer 拉一次状态、合并、再推回去。合并是幂等且可交换的——成员取并集、leader 按加入时间早者胜、任务按 `updatedAt` 新者胜，离开用墓碑（`left`）压制并集，所以离场事件能跨节点传播，重复同步不会产生抖动。

引入 agent 会拿到它的写所有权（`ctx.agents.resume`），所以节点关闭时会把导入的 agent 一个个 dispose 掉，否则下次启动会撞写锁。

## 验证

```powershell
node --test scripts/rooms.test.mjs      # 房间状态纯函数，49 项
node --test scripts/notify.test.mjs     # 通知扩展点：渠道发现 / 自动发 / 挂起 / 确认，11 项
node scripts/smoke.mjs                  # 双节点：身份/发现/投递/去重/持久化/安全
node scripts/twin-transport-check.mjs   # 双节点状态交换与签名
node scripts/rooms-smoke.mjs            # 双节点房间端到端：建房→加入→派任务→报进度→聊天→重启→退出
node scripts/agents-smoke.mjs           # 双节点 agent 端到端：清单→跨 workspace 引入→新建→联络→唤醒→回收
node scripts/schema-check.mjs           # 每个工具的 execute 输出是否满足它自己声明的 schema（46 项）
node scripts/panel-check.mjs            # 面板渲染与交互冒烟（99 项）
node scripts/probe-live.mjs             # 黑盒探测一个正在运行的实例
```

## 排障

- **看不到对端**：确认 `discoveryPort` 一致、两台机器在同一网段、防火墙放行 UDP 45870 与 TCP 45871。
- **发消息回「没有匹配的节点」**：刚启动时首轮广播最多晚 5 秒，发送逻辑会等 2.5 秒再试一次。
- **同名房间**：两个节点可能各建了一个同名项目，按名字操作会被拒绝并列出候选 id，改用房间 id。
- **面板一直转圈**：面板走 `POST /api/lan-mesh`，需要浏览器已登录该实例；直接 curl 会 401，这是预期的。
- **工具报 `returned invalid output`**：`index.js` 声明的 output schema 与 `lib/` 实际返回的形状不一致。跑 `node scripts/schema-check.mjs` 能直接定位是哪条字段。房间有两套投影不能混用一个 schema：`ROOM_ROW_SCHEMA` 对应 `rooms.mjs` 的 `roomRow`（面向调用者的 role/isMember/isLeader），`ROOM_VIEW_SCHEMA` 对应 `service.mjs` 的 `#roomView`（面向房间本身的 leader/memberCount/createdAt）。
- **插件工具在宿主里不见了**：工具注册必须走 `ctx.inject(['tools'], scope => scope.tools…)`。`apply` 运行时 `tools` 还没挂上，直接 `ctx.get('tools')` 可能永远拿到 undefined，于是整块注册被静默跳过。
- **被 dial 的 agent 不做任何事**：先看它的会话日志里有没有 `lan_mesh_*` 工具。没有的话，说明工具没随 preset 挂上去（见上面的「引入／新建出来的 agent」一段）；再确认它的 `cwd` 目录存在，且创建时带上了默认模型，否则 turn 会在启动阶段就报错。

### Room 多附件（M3）

在 Room 输入框用 📎 多选、粘贴图片或拖入文件。默认每文件 **20 MiB**、每条消息 **8 项 / 40 MiB**；本机 Blob 总容量 **200 MiB**。实际限制由 Host 配置并在快照下发。普通文件没有 MIME 也可上传，文件夹不支持。

上传中/失败时发送按钮不可用；失败项点“重试”，移除会取消上传。发送失败保留正文、已上传文件和稳定消息 ID，重试不会重复发表同一附件消息。纯附件发送用文件名作为正文。发送期间冻结编辑；切换房间会取消未完成上传。消息中图片可看原图，其他文件可下载；不可用时可重试。只有当前房间成员能通过已登录面板读取已提交附件。

成功表示发送节点与 Room Leader 已持久保存（两者同机只算一份）；其他成员的离线或旧版本失败会单独提示并后台重试。旧记录中的内联附件仍可读，新附件不会退回 base64 发送。已准备发送的持久副本暂没有手动取消/自动释放机制，容量满会明确失败。

完整规则见 [UI contract](docs/ui-contract.md#m3-附件上传与读取)。真实浏览器与跨设备/模型联合验收由用户完成；自动化 localhost 验证不代表实机验收。
