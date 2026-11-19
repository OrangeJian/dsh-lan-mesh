# dsh-lan-mesh 插件使用文档（架构 + 功能）

这份文档把插件当作一个整体产品来讲：先说清**架构是怎么设计的、为什么安全边界长这样**，再按**场景给出功能用法**。每节都标注了更细的专题文档，需要细节时按图索骥。

- 只想要「怎么点」→ 本文档 §3 + [docs/usage.md](usage.md)（房间/附件/文档的逐步走查）
- 只想要 Agent Team 端到端流程 → 本文档 §3.5 + [docs/team-m1-usage.md](team-m1-usage.md)
- 想改代码 → [docs/development.md](development.md) 与 [docs/architecture/codebuddy-handoff.md](architecture/codebuddy-handoff.md)

---

## 1. 插件是什么

把局域网里几个独立的 DSH 实例连成一张网，让你和你的 agent 能与别的机器上的人和 agent 协作一个项目。前提只有一条：**同一局域网，UDP 45870 与 TCP 45871 互通**。无中心服务器、无公网、无账号。

它不做的事：不做实时聊天（异步投递）、不做流式（看不到对端思考过程）、不共享文件系统（产物用文本/附件交换）、不移动会话（跨机唤醒不改变工作目录）。

能力分六层，自下而上：

| 层 | 能力 | 状态 |
| --- | --- | --- |
| 网络层 | UDP 发现、TCP 投递、HMAC 签名、nodeId 白名单、静态节点 | 稳定 |
| 房间层 | 房间=项目；成员=「节点+会话」；派活/进度/发言/@提及；幂等同步+墓碑 | 稳定 |
| 附件层 | Room 多附件：独立 Blob、SHA-256 校验、按需取回、容量与 GC | 已实现，待真机验收 |
| 共享文档层 | Room 内 Markdown 共编：提案/原子修订/diff3 冲突/历史/归档 | 已实现，待真机验收 |
| 项目上下文层 | 固定 revision/hash 的有界上下文包、决策/问题标注、投递审计 | 已实现，待真机验收 |
| Agent Team 层 | 显式派发、租约/ACK/uncertain、成果评审、计划草稿→批准→调度→依赖解锁→回收 | 代码完成；三设备验收 NOT RUN |

---

## 2. 架构设计

### 2.1 总体分层

```
浏览器面板（owner 认证）
   │  POST /api/lan-mesh（client-request 信封）
   ▼
┌────────────────────────── Host 服务（lib/service.mjs）──────────────────────────┐
│  房间状态机 rooms.json ←→ 附件 Blob ←→ 共享文档 ←→ 上下文包 ←→ Team 账本 team.json │
│  Coordinator（lib/team-coordinator.mjs）：单事务命令入口                          │
│  TeamStore（lib/team-store.mjs）：加载校验+无环复检，写=临时文件+rename           │
│  reducer（lib/team-state.mjs）：命令→状态，纯函数，防篡改                         │
└───────────────┬─────────────────────────────────────────────────┬──────────────┘
                │ 模型工具（RPC，agent 会话内）                      │ 节点间通道
                ▼                                                  ▼
        Agent 会话（lan_mesh_* 工具）                    GET/POST /lan-mesh/v1/*
                                                   （UDP 45870 发现 + TCP 45871）
```

三条通道，权限各自独立：

| 通道 | 谁在用 | 认证 |
| --- | --- | --- |
| `POST /api/lan-mesh`（26+ 端点） | 浏览器面板 | DSH 登录态（owner）；curl 无 cookie 得 401 是设计如此 |
| `/lan-mesh/v1/*`（info/send/hello/state/agents） | 其他 DSH 节点 | 无需登录；`clusterSecret` 非空时必须 HMAC-SHA256 签名 |
| 模型工具 `lan_mesh_*` | Agent 会话 | 调用身份由宿主执行上下文提供，不接受自报 sessionId 的写操作 |

### 2.2 房间层：唯一真相与幂等合并

- `rooms.json` 是房间状态的**唯一真相**；节点间通过 `/lan-mesh/v1/state` 同步，合并是幂等的（重复同步不产生副作用）。
- 成员身份是「节点 + 会话」组合，所以一人多机多会话可同属多个房间；人用固定成员位 `节点/human`，不占用 agent 会话。
- 离场用**墓碑**（带时间的 `left` 记录）传播，比谁的墓碑新；改名 bump `updatedAt`，旧节点推不上来旧标题。
- 权限规则：创建者即 leader；只有 leader 能派活/改名/拉人；成员可自行加入/退出（这一版没有邀请审批，范围控制交给节点层的 `clusterSecret`/`trustedPeers`）。

### 2.3 附件层（M3）

- 附件是独立 Blob，与消息解耦；上传后按 SHA-256 校验，下载时校验长度与哈希才使用。
- 权限跟着房间走：知道摘要不等于有权限读取；换房间、或本机碰巧有同样文件，都拿不到访问权。
- 发送语义是「持久意图」：Leader + 发送节点持久接受即算已提交，普通成员离线由后台补投；回执丢失可对账，不重发第二条。
- 旧版本兼容分级：支持精确 @ 的旧端收到「正文+文件名」纯文本（`metadataDelivered:true, blobDelivered:false`）；连精确 @ 都不支持的旧端**不投递**（避免唤醒全体 agent），界面明确显示「对方版本不兼容」。

### 2.4 共享文档层（M4）

- 纯状态设计：文档修订、提案（proposal）、三方 diff（base/当前/提案）都是确定性数据；无冲突直接保存，旧 base 的非重叠修改自动合并，真冲突必须由房间 Leader 或授予的文档维护者**人工确认**。
- Agent 可提交普通修改（`lan_mesh_document_propose`），永远拿不到人类确认权。
- 离线：已有缓存可离线阅读；离线保存显示 pending，恢复后按原 proposalId 同步；首次读取需要当前 Leader 在线。
- 旧版本恢复产生新提案，不覆盖历史。

### 2.5 项目上下文层（M5）

- 上下文包是**有界**的：只包含人显式选择的文档（固定 revision/hash，最多 8 份）与显式标记块（`:::context-decision` / `:::context-question`），硬上限 64 KiB，实际发送上限 16 KiB。
- 引用固定到所读版本，不随 head 更新而悄悄变化——agent 看到的永远是 Owner 当时核对过的那份。
- 携带上下文要求对端支持 `roomContextVersion:1`，旧端明确拒绝，不静默丢弃。
- 「上下文投递记录」是审计：`delivered` 表示 Host 已接受 followup，**不等于模型已完成任务**；`unknown` 必须核对，不能盲目重跑。

### 2.6 Agent Team 层（M1–M6）：可靠执行与编排

Team 的目标是「显式派发 + 可靠执行 + 人工验收」，所有状态收在实例目录的 `team.json` **权威账本**里（任务、执行、outbox、nonce），写入先同步临时文件再 rename，损坏账本会让启用的 Team 启动失败而不会静默清空。

核心状态机（任务）：

```
planned ──(依赖全部 accepted)──▶ ready ──queue──▶ active ──succeeded──▶ review ──Owner 接受──▶ accepted
                                    ▲                                  │
                                    └────── failed / blocked / cancelled ◀┘
```

- **单事务命令**：Coordinator 的每个入口（dispatch、schedule）在同一个 `store.transact` 里重读全部前置条件——批准版本（planId+revision+fingerprint）、批准记录、Team generation、依赖快照、当前授权、容量——任一变化即拒绝（`STALE_GENERATION`/`APPROVAL_BINDING_MISMATCH`/`DEPENDENCY_NOT_ACCEPTED` 等），从根上消除「检查和执行之间状态被改」的竞态。
- **执行可靠性（M1）**：先落盘再发送；Worker 保存接收记录→ACK→取得启动许可→请求宿主唤醒；事件按 seq 去重，回执丢了重传即可。每个 Worker 会话**最多一个未解决执行**（含 uncertain）——容量按槽计算，不是按任务数。
- **uncertain 不自动重跑**：启动等待超租约、租约过期、Worker 重启等进入 uncertain，保留容量，**不自动再次唤醒**。过期后到达的进度/结果只作核对证据。必须人在 Worker 机器确认旧执行真的停了，再由 Leader `lan_mesh_team_reconcile` 记录原因。
- **M6 计划编排**（默认关闭，`teamPlanScheduling: true` 开启）：
  1. Agent 从**已批准**的计划草稿生成 plan（含任务依赖 DAG）；
  2. Owner 在面板「计划草稿与批准」核对这个**确切版本**（版本号+指纹）后批准——批准只绑定指纹，改一个字就要重新批准；
  3. 预览给出依赖顺序与每个任务的候选状态（可派发/等待依赖/无可用候选）与排除原因；
  4. Leader Agent 会话用 `lan_mesh_team_schedule` 调度：单事务重读全部前置条件后进入既有执行链路；
  5. 依赖任务被 Owner 在成果评审中接受后，下游任务才从 `planned` 变 `ready`。
- **候选授权（D6 裁决，fail closed）**：
  - Leader 空会话授权（`workerSessionId: ''`）= **本机授权范围门**，决定谁能出现在候选里；
  - Worker 侧精确会话授权（`workerSessionId: <id>`）= **派单准入**，永不枚举进候选集；
  - `teamCapabilities` 能力声明**只用于匹配**，绝不等于授权；
  - 缺授权 delegate、推导失败 → 一律 `UNAUTHORIZED`/`CANDIDATES_UNAVAILABLE`，宁可拒绝不可放行。
- **回收边界（R2，fail closed）**：回收工作区前必须确认执行及其**后代进程**已停止。运行实例身份（`hostInstanceId`，非持久）、唤醒生命周期记录与停止证明源已实现；后代进程确认后端尚缺——**缺失时所有停止证明被拒绝，回收不会被放行**。会话空闲、缺席、归档只作诊断证据，不构成停止证明。

### 2.7 信任与安全模型

三层旋钮，各管一段：

| 旋钮 | 保护范围 | 效果 |
| --- | --- | --- |
| `clusterSecret` | 节点间通道 | 所有请求必须 HMAC-SHA256 签名，不符 401 |
| `trustedPeers` | 节点间通道 | 只接受列表内 nodeId，其余 403 |
| `teamAuthorizations` | Team 执行 | 逐 Room、逐（Leader 会话，Worker 会话）授权工作目录；目录检查只控插件准入，**不能代替 DSH 工具权限或系统沙箱** |

Team 建议关闭 `autoWake`：普通消息唤醒和 Team 唤醒是两套授权，Team 场景下前者只会扩大攻击面。共享密钥不提供加密、也不提供受信节点之间的独立身份认证——局域网里有别人的机器时必设前两个旋钮。

### 2.8 存储

都在 `$DSH_HOME/lan-mesh/`（非默认端口在 `instances/<port>/`）：

| 文件 | 内容 | 删掉的后果 |
| --- | --- | --- |
| `node.json` | 节点身份（nodeId/name） | 换新身份，对端看到的是「新节点」 |
| `inbox.jsonl` | 收到的消息（追加写） | 收件箱清空 |
| `rooms.json` | 全部房间状态（唯一真相） | 所有房间消失 |
| `nicknames.json` | 本机昵称 | 显示名回到默认 |
| `team.json` | Team 权威账本 | Team 任务/执行/去重记录消失，**不要为重跑而删** |

---

## 3. 功能使用

### 3.1 安装与确认

```powershell
plugin_manager install_bundle target="C:\path\to\dsh-lan-mesh"
plugin_manager set_plugin   target=include:dsh-lan-mesh enabled=true
```

确认三件事：侧栏出现「局域网协作」；`http://127.0.0.1:45871/lan-mesh/v1/info` 返回 `{"ok":true,...}`；新会话问「看一下局域网里有哪些节点」能触发 `lan_mesh_list_peers`。

单机双实例验证：第二个实例改端口/名字/发现端口，详见 [docs/usage.md](usage.md) §2。

### 3.2 场景 A：房间=项目（纯协作）

完整走查见 [docs/usage.md](usage.md) §3、§6。要点：

- 面板左栏「新建房间」→ 建房者是 leader；对端在「可加入的项目」点加入，或其 agent `lan_mesh_room_member action=join room=<roomId>`。
- 派活（仅 leader）：面板任务区，或 `lan_mesh_room_task action=assign ...`；状态 open/doing/blocked/done，`note` 形成进度流水。
- 发言 `lan_mesh_room_say`；输入框 `@` 提及只是标注+高亮，消息仍广播全房间。
- 任务用 id 定位；同名任务报 `AMBIGUOUS_TASK` 是刻意的。

### 3.3 场景 B：跨机借用 agent

- `lan_mesh_agents` 看本机与远端 agent；
- `lan_mesh_agent_import session=<id>`（恢复别的 workspace 的会话）或 `cwd=<绝对路径>`（新建）；引入=拿到写所有权，本机关闭时会 dispose，**同一会话不要在两台机器同时引入**；
- `lan_mesh_agent_dial target=<nodeId>/<sessionId> text=<第一句指令>`：一次性请求-应答，对方关机就留在收件箱等上线。

### 3.4 场景 C：共享文档与项目上下文

面板房间右侧切「文档」标签：新建/编辑/比较差异/历史/归档，保存填提交说明；冲突时三方对照，人类确认。完整行为见 [docs/usage.md](usage.md) 尾部 M4/M5 一节。

Agent 侧工具：`lan_mesh_document_list/read/propose/history` 与 `lan_mesh_room_context`（按显式选择构造有界包）。改文档前先 `read` 固定版本再 `propose`。

### 3.5 场景 D：Agent Team 全流程（M1–M6）

> 最常见的坑放最前面：**Team Leader 必须是创建 Room 的那个 Agent 会话**。面板建房时 Leader 是 `节点/human`，面板「加入」也只是人的成员位，都不能代替 Worker Agent 自己加入。所以：先在 Leader Agent 会话里 `lan_mesh_room_member action=create room=<项目名>` 建房，再让每个 Worker 会话 join。

**第一步：两端配置**（完整示例见 [docs/team-m1-usage.md](team-m1-usage.md)）

- 两台机器：`clusterSecret` 一致、`trustedPeers` 互列、`autoWake: false`、`teamEnabled: true`；
- Leader 机器：`teamAuthorizations` 加 `{roomId, leaderKey: <Leader节点/会话>, workerSessionId: '', workspaceRoot}`（空会话授权=本机范围门）；
- 每个 Worker 会话各加一项 `workerSessionId: <Worker会话ID>` 的精确授权；
- 可选：`teamLeaseMs` / `teamHeartbeatMs` / `teamRequestWindowMs`；开启 M6 调度加 `teamPlanScheduling: true`，能力声明用 `teamCapabilities`（仅匹配用）。

**第二步：显式派发（M1，始终可用）**

```text
lan_mesh_team_create roomId=<roomId>
lan_mesh_team_dispatch roomId=<roomId> workerKey=<Worker节点/会话> title=核对接口 detail=...
lan_mesh_team_status roomId=<roomId>
```

Worker 侧汇报进度与结果：

```text
lan_mesh_team_report executionId=<id> note=正在核对
lan_mesh_team_report executionId=<id> status=succeeded summary=检查完成，未发现不一致
```

`succeeded` 只是让任务进入 review——**没有自动验收**，必须 Owner 在面板「成果评审」中对照执行 ID、结果摘要与指纹，手动接受（accepted）。

**第三步：计划编排（M6，可选，默认关闭）**

1. Agent 生成计划草稿（任务+依赖 DAG）；
2. Owner 在面板「计划草稿与批准」：核对版本与指纹 → 批准。批准只绑定这个确切版本；
3. 点「预览」：看依赖顺序、每个任务的状态（可派发/等待依赖/无可用候选）与排除原因（未授权/无能力声明/能力不匹配/槽已占用）；
4. Leader Agent 会话调度：

```text
lan_mesh_team_schedule roomId=<roomId> planId=<planId> \
  expectedRevision=<批准时的版本> fingerprint=<批准时的指纹> taskId=<任务ID>
```

调度内部在单事务里重读批准版本、代次、依赖、授权与容量；`workerKey` 可省略（用 recommended 首选）。返回派发描述后，Worker 侧仍执行本机准入。
5. 下游任务在依赖被 Owner 评审接受后自动从 `planned` 转 `ready`；届时再调度。

**第四步：故障与人工核对**

- 执行状态 uncertain：去 Worker 机器**人工确认旧执行确实停止**（含它启动的子进程），然后 Leader 调 `lan_mesh_team_reconcile executionId=<id> stopped=true reason=<人工核对原因>`。不要仅因超时就核对放行。
- 回收（R2）：回收工作区要求停止证明，含后代进程确认；当前后代确认后端未接入，**回收一律拒绝**——这是 fail closed，不是故障。
- Leader/成员变化、授权撤回会停止派发；没有自动选主，暂停的 Team 须人工恢复。
- 账本损坏：先备份核对，不要删账本重跑。

### 3.6 工具速查

基础 11 个（网络/房间/agent/通知）见 [docs/usage.md](usage.md) §7。Team 与文档工具：

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `lan_mesh_team_create` | `roomId` | 由当前 Room Leader 创建 Team |
| `lan_mesh_team_dispatch` | `roomId`, `workerKey`, `title`, `detail?` | 显式派发，返回执行 ID |
| `lan_mesh_team_status` | `roomId` | 任务、执行与本机执行记录 |
| `lan_mesh_team_report` | `executionId`, `status?`(succeeded/failed), `summary?`, `note?`, `artifacts?` | Worker 汇报；`artifacts` 路径在 Worker 机器，不自动同步文件 |
| `lan_mesh_team_reconcile` | `executionId`, `stopped`, `reason` | 仅人工确认停止后调用 |
| `lan_mesh_team_schedule` | `roomId`, `planId`, `expectedRevision`, `fingerprint`, `taskId`, `workerKey?` | M6 调度，需 `teamPlanScheduling: true`，工具才会注册 |
| `lan_mesh_document_list/read/propose/history` | 见 §3.4 | 共享文档；提案不授予确认权 |
| `lan_mesh_room_context` | `roomId`, `contextSelection` | 有界上下文包 |

### 3.7 配置速查

基础配置见 [docs/usage.md](usage.md) §9。Team 相关（写在 profile patch 层）：

| config | 默认 | 说明 |
| --- | --- | --- |
| `teamEnabled` | `false` | 启用 Agent Team |
| `teamAuthorizations` | `[]` | 双边授权：`roomId` + `leaderKey` + `workerSessionId`（空=本机范围门）+ `workspaceRoot` |
| `teamPlanScheduling` | `false` | 开启 M6 计划调度与 `lan_mesh_team_schedule` 工具 |
| `teamCapabilities` | — | `{roomId, memberKey, capabilities}` 能力声明，仅匹配用，不构成授权 |
| `teamLeaseMs` / `teamHeartbeatMs` / `teamRequestWindowMs` | 90000 / 20000 / 120000 | 租约 ≥1000ms；心跳 ≥250ms 且 < 租约一半；时间窗口须为正 |

---

## 4. 排障

常见条目见 [docs/usage.md](usage.md) §11 与 [README](../README.md) 排障节。Team 专属：

| 现象 | 原因与处理 |
| --- | --- |
| 派发报 `NOT_LEADER` | Room Leader 不是当前会话；面板建房的 Leader 是 `节点/human`，Team 要 Agent Leader，须 Agent 会话建房 |
| 派发报 `FORBIDDEN` | 该 Worker 会话无精确授权（`workerSessionId` 不匹配）或撤权 |
| 报 `DEPENDENCY_NOT_ACCEPTED` | 依赖任务未在成果评审中 accepted；先评审再调度 |
| 报 `STALE_GENERATION` / `APPROVAL_BINDING_MISMATCH` | 批准之后 Room/Team/计划版本变了；重新批准新版本再调度 |
| 报 `NO_DISPATCHABLE_CANDIDATE` | 无候选同时满足授权+能力+容量；看面板预览的排除原因 |
| 报 `CANDIDATES_UNAVAILABLE` | 授权数据不可用，已按安全策略拒绝（fail closed）；检查 `teamAuthorizations` 配置 |
| 工具列表里没有 `lan_mesh_team_schedule` | 未开启 `teamPlanScheduling: true`，或插件更新后未重载 |
| 执行卡 uncertain | 不自动重跑；人工核对停止后 `lan_mesh_team_reconcile` |
| 启动 Team 报账本错误 | `team.json` 损坏或校验失败（含依赖环，防篡改账本）；备份后人工核对，勿直接删除 |
| 回收一直被拒 | 停止证明要求后代进程确认，当前后端未接入，fail closed；等待后端接入后再验证回收 |

---

## 5. 当前边界与验收状态

如实记录，避免期待错位（详见 [ROADMAP.md](../ROADMAP.md) 与 [docs/architecture/codebuddy-handoff.md](architecture/codebuddy-handoff.md)）：

- **三设备真机验收 NOT RUN**：M1 的 12 项场景、双机发现恢复、真实派单与回收，均未在真实设备上执行过；自动化覆盖为 localhost 多节点 HTTP smoke（`node scripts/team-smoke.mjs`）与 800+ 项单测。
- **回收不会自动放行**：后代进程确认后端未接入，停止证明一律拒绝。
- **浏览器与物理设备验收**由负责人执行；自动化不冒充跨设备验收。
- 没有自动选主；暂停/损坏的 Team 走人工核对路径。
- 附件/文档/上下文层已通过 localhost 多节点与渲染 harness 验证，真实浏览器截图与手工操作记录由负责人补齐。

---

## 6. 文档地图

| 想了解 | 去看 |
| --- | --- |
| 房间/面板/工具的逐步操作 | [docs/usage.md](usage.md) |
| Team M1 配置与执行细节 | [docs/team-m1-usage.md](team-m1-usage.md) |
| M6 候选授权裁决与接线 | [docs/architecture/m6-candidate-scope.md](architecture/m6-candidate-scope.md) |
| M6 接入顺序与验收清单 | [docs/architecture/m6-integration-sequence.md](architecture/m6-integration-sequence.md) |
| M6 总体计划与待决项 | [docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md](superpowers/plans/2026-11-10-agent-team-m6-plan.md) |
| 面板端点与数据形状契约 | [docs/ui-contract.md](ui-contract.md) |
| 房间层冻结契约 | [docs/rooms-contract.md](rooms-contract.md) |
| 开发选型/事故复盘/验证体系 | [docs/development.md](development.md) |
| 当前交付基线与继续开发清单 | [docs/architecture/codebuddy-handoff.md](architecture/codebuddy-handoff.md) |
