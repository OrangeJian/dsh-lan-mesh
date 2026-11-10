# Agent Team M6 自动编排：可实施范围、接口草案与测试计划

> 日期：2026-11-10。类型：**纯规划/设计文档，不含任何实现**。唯一写入文件即本文。
> 依据：`docs/agent-team-v0.2-design.md`（架构已确认）、`docs/superpowers/plans/2026-11-08-agent-team-m1.md`（M1 已批准）、`docs/handoffs/dsh-after-m3-prompt.md:63-69`（M6 要求）、`docs/handoffs/m1-three-device-acceptance.md`（12 项全部未验收）、`docs/team-m1-usage.md`、`docs/ui-contract.md`（冻结 UI v2）、`docs/architecture/project-workspace.md:48-52`（待决项来源）、`ROADMAP.md:10-12`（M4/M5 设计阶段、M6 未开始）。
> 本文**不修改**任何 `lib/*.mjs`、`index.js`、`scripts/*`、`ROADMAP.md`、`docs/ui-contract.md` 或既有文档；不提交 Git；不改动协议/权限既定语义。

**状态标签约定（全文严格使用）**：
- **【已实现且验证(M1)】** — 源码 + 单元/协议/真实 HTTP smoke 已通过（仅 localhost stub，非实机）。
- **【已实现待实机(M1)】** — 源码存在，但 M1 三设备 12 项场景**全部未验收**，不得宣称可正式自动运行。
- **【设计可实现】** — 方向与接口草案明确、无需新增未授权外部资源即可编码，但**当前未实现**。
- **【待决项(资料不足)】** — 重大协议/权限行为，v0.2 与现有资料不足以确定；本文给出**接口草案 + 测试计划**，但标 OPEN，不擅自拍板。
- **【外部阻塞】** — 需负责人/Codex 提供设备、确认或决定，实施者不可自行替代。

> **诚实声明**：M6 全部编排能力（能力描述、DAG、容量匹配、拆解/调度/验收、人类可审查界面）在仓库中**均无业务代码**（已 grep 确认：`lib/` 内不存在 `capabilities`、`requiredCapabilities`、`acceptanceCriteria`、`AgentProfile`、拓扑排序、accept 命令）。本文所有字段名、工具名、端点、Schema 均为 **PROPOSAL/待固化**，依据 v0.2:104-106「具体工具名称、Schema 字段上限和界面文案留给实施计划」。**不得据此声称 M6 已完成**。

---

## 1. 目标、范围与诚实状态表

**目标**：在 M4/M5 可用后，按已确认的 v0.2 架构推进能力描述、任务依赖 DAG、容量匹配、拆解/调度/验收与人类可审查计划界面；默认 opt-in，不启用未授权执行（handoff:65）。资料不足以确定重大协议/权限行为时，交付**具体方案、接口与测试计划并列出待决项**，不编造「已完成」，也不因此停止其他已确定工作（handoff:69）。

**本文范围**：仅「可实施范围」的设计与验证规划 = 把 v0.2 的 M2/M3 目标落成可编码的接口草案、插件强制点、测试计划、待决项清单与复核入口。**不含**编码、不含真机验收执行、不含编造结果。

| 能力 | 状态 | 依据 / 说明 |
|---|---|---|
| Team 状态 v1 纯状态机（Task/Execution/Event） | 【已实现且验证(M1)】 | `lib/team-state.mjs:25` `applyTeamCommand`；`scripts/team-state.test.mjs` 通过 |
| 原子快照账本 / outbox / nonce（fail-closed） | 【已实现且验证(M1)】 | `lib/team-store.mjs:61` `openTeamStore`、`:74-99` `transact`；`scripts/team-store.test.mjs` 通过 |
| 独立 `/lan-mesh/v1/team` 认证通道 teamProtocolVersion=1 | 【已实现且验证(M1)】 | `lib/team-protocol.mjs:4`、`:20-51`；`lib/service.mjs:2386-2399` |
| 派发/ACK/start 许可/心跳/租约/结果/uncertain/恢复/reconcile | 【已实现且验证(M1)】 | `lib/team-coordinator.mjs:37-54`、`:106-129`、`:153-159`、`:168-252` |
| 5 个 host-bound 工具 + opt-in 配置 + 独立路由 | 【已实现且验证(M1)】 | `lib/team-tools.mjs:5-9`、`index.js:102-106`、`index.js:1327`、`lib/service.mjs:2409-2458` |
| M1 全链路在真实 A/B/C 三设备、真实模型下执行 | 【已实现待实机(M1)】 | 源码存在但 `docs/handoffs/m1-three-device-acceptance.md:150` 明确：12 项**全部未验收**；**外部阻塞**于设备提供（§8） |
| 能力描述 `AgentProfile.capabilities/skills/maxConcurrentTasks` | 【设计可实现】 | v0.2:33；`lib/` 无此实体（grep 确认）；本文 §4.1 草案 |
| 任务依赖 DAG + 无环校验 + 依赖已验收才可派发 | 【设计可实现】 | v0.2:34,39；**当前被代码显式拒绝**：`lib/team-state.mjs:53` `if (c.dependsOn?.length) fail('UNSUPPORTED')`；本文 §4.2 草案 |
| 容量匹配（多并发 / 能力过滤） | 【设计可实现】 | v0.2:92「可配置多并发及自动容量匹配留到 M2」；当前写死单槽 `lib/team-state.mjs:22,66`；本文 §4.3 草案 |
| 拆解 / 调度（Leader LLM 出候选，插件强制校验） | 【设计可实现】 | v0.2:24,89；无编排器代码；本文 §4.4 草案，但**本机成员调度语义**见 §5 待决 |
| 验收 `accept` / 拒绝重做（新 executionId） | 【设计可实现】 | v0.2:41；`lib/team-state.mjs:89-131` **无 accept 命令**；`lib/team-store.mjs:26` 允许 `accepted` 但无路径产生；本文 §4.5 草案 |
| 人类可审查的计划界面 | 【设计可实现】 + 【待决项】 | v0.2:90「最小界面」；`docs/ui-contract.md:4` 冻结契约「改字段先改本文件」；§4.6/§5 草案 + OPEN |
| `leaderKey/generation` 提升、generation 恢复、备份 | 【待决项(资料不足)】 | v0.2:51 允许「人工核对后建立新 generation」，但 M1 **写死 generation=1**（`lib/team-state.mjs:35`、`lib/team-coordinator.mjs:62`）；handoff/project-workspace:51 要求编码前明确；§5 |
| 离线提案 / 维护者授权 / 文档侧 generation 恢复 | 【待决项】/【外部阻塞】 | `docs/architecture/project-workspace.md:51`；属 M4 文档侧，与 Team 的 generation 是否同一栅栏**未决**；§5 |
| 自动选主 / Git 自动合并 / 跨节点文件同步 / 第三方 Agent 适配 | 【外部阻塞 / 明确不做】 | v0.2:9 明确排除，**不纳入本范围**，无需裁定 |
| 具体 HTTP 方法/Schema 上限、工具名、UI 文案 | 【待决项】 | v0.2:57,104-106 明示留给实施计划；本文只给草案标 OPEN |

> 前置顺序：`ROADMAP.md:10-12` 显示 M4（共享 Markdown）与 M5（Context Pack）仍为「设计阶段，无业务实现」，M6 为「未开始」。handoff:65 要求「在 M4/M5 可用后」推进 M6。因此 M6 与 M4/M5 存在**顺序依赖**；但按 handoff:69，资料不足不得停止已确定工作，故本文先把**不依赖 M4/M5 的骨架设计**交付，界面与 Context Pack 绑定部分标注依赖。

---

## 2. 现状核对（grounded in `lib/team-*.mjs`）

### 2.1 M1 实际实现了什么（file:line 引证）

| 模块 | 实际存在 | 关键引证 |
|---|---|---|
| reducer（纯状态机） | `emptyTeamState()` = `{version:1, teams, tasks, executions, workerExecutions, outbox, nonces}`；`applyTeamCommand(state, command, {now})` 返回新状态、不修改输入；命令集 `create-team/create-task/queue/ack/start/progress/result/expire/cancel/reconcile/pause` | `lib/team-state.mjs:2-4`、`:25-133` |
| generation 栅栏 | `create-team` 写 `generation:1`；所有后续命令 `if (c.generation !== team.generation) fail('STALE_GENERATION')`；非 workerEvent 必须 `actor === team.leaderKey` | `lib/team-state.mjs:35`、`:41-43` |
| workerEvent 幂等/序号 | `ack/progress/result` 走 seq 校验：同 seq 同 fingerprint 幂等返回、同 seq 异内容 `EVENT_CONFLICT`、乱序 `EVENT_GAP`、非当前执行 `STALE_EXECUTION` | `lib/team-state.mjs:42`、`:76-88` |
| FSM 转换 | ack→acknowledged；start→running（写 `leaseExpiresAt`）；result(succeeded)→**review**、failed→failed；expire/cancel→**uncertain + task blocked**；reconcile 要求 `stopped===true`→cancelled + task ready | `lib/team-state.mjs:89-131`（result `:104-113`、expire `:114-118`、reconcile `:124-129`） |
| 容量（M1 单槽） | `unresolved = {queued,acknowledged,running,uncertain}`；queue 时同 task 有 unresolved→`UNRESOLVED_EXECUTION`，同 worker 有 unresolved→`CAPACITY`；`attempt = previous.length+1` | `lib/team-state.mjs:22`、`:62-67` |
| create-task 显式分配 | `dependsOn` 非空即 `fail('UNSUPPORTED')`；写 `dependsOn:[]`、`status:'ready'`、`currentExecutionId:null`；字段上限 title 200 / detail 4000 | `lib/team-state.mjs:51-57` |
| store | `openTeamStore({directory,io})`；`validate(state)` 严校 version:1 + 六桶 + 每记录字段（**:27 `dependsOn.length === 0`**、**:26 允许 planned/accepted 状态**）；启动时损坏 JSON→`TEAM_STORAGE` **fail-closed 不按空状态继续**；`transact` 单写者队列 + 临时文件 `writeFile→sync→rename` | `lib/team-store.mjs:6-58`、`:61-70`、`:74-99` |
| protocol | `POST /lan-mesh/v1/team`（常量 `TEAM_PATH`），body 上限 256 KiB；operations 集合 `dispatch/start/progress/heartbeat/result/status-query/cancel/reconcile/event-ack`；签名含 method/path/sender/target/time/nonce/bodyHash；`verifyTeamRequest` 验大小→trustedPeers→HMAC→method/path/target→±120s 窗口→nonce 格式→版本→operation/body/ID/actor→`authorize`→**同事务 nonce 去重与清理**；响应也签名；`sendTeamRequest` 对 dispatch 先查 `/lan-mesh/v1/info` 校验 `teamProtocolVersion===1`，404→`UNSUPPORTED` | `lib/team-protocol.mjs:4-6`、`:13-18`、`:20-51`、`:54-58`、`:60-88` |
| coordinator | `TeamCoordinator`：`allowed()` 校验 Room 未删/leader 未变/worker 在成员表（否则 `ROOM_CHANGED`）；`dispatch` **拒绝本机 worker**（`:41 REMOTE_WORKER_REQUIRED`）、单事务内 create-task+queue+写 outbox、接收端硬校验 `b.generation !== 1`（`:62`）；`handle` 分支 dispatch/cancel/reconcile/status-query/start/heartbeat/progress/result；`report`；`recover` 把 starting/running→uncertain；`#tick` 重传 outbox + 租约过期 expire + start 许可 + 心跳 | `lib/team-coordinator.mjs:10-17`、`:23-30`、`:37-54`、`:56-131`、`:133-159`、`:168-257` |
| 服务接线 | `teamEnabled===true` 才 `#startTeam()`；能力响应仅启用时带 `teamProtocolVersion:1`；`wake` 由 `exec.agent.id` 无关、改用 `catalogueAgents` 找本机会话并校验 `workspaceRoot` 路径包含关系；5 个 service 方法 `teamCreate/Dispatch/Status/Report/Reconcile`；`teamReconcile` 要求 Leader + `stopped===true` + reason，写 durable 取消 + reconcile outbox | `lib/service.mjs:504`、`:598`、`:2329-2362`、`:2364-2384`、`:2386-2399`、`:2409-2458` |
| 工具/配置 | 工具名 `lan_mesh_team_create/dispatch/status/report/reconcile`，身份取 `exec.agent.id`（`:20`），输出 `{summary,dataJson}`；配置 `teamEnabled:false`、`teamLeaseMs:90000`、`teamHeartbeatMs:20000`、`teamRequestWindowMs:120000`、`teamAuthorizations:[]`；仅启用时注册工具 | `lib/team-tools.mjs:2-25`、`index.js:102-106`、`:1327` |

### 2.2 与 M2/M3 直接相关的代码缺口（这些是 M6 必须补的真实缺口，非「已完成」）

1. **`event-ack` 是空壳**：`lib/team-protocol.mjs:6` 声明了 `event-ack` operation，但 `TeamCoordinator.handle()`（`lib/team-coordinator.mjs:56-131`）**无对应分支**，落到 `:130 fail('UNSUPPORTED')`；实际 ACK 由 progress/result 响应字段 `eventAck` 捎带（`:128`、`lib/team-coordinator.mjs:209`）。固化 Schema 时须补 handler 或从集合移除，不能当作既有能力。
2. **generation 被写死为 1**：`lib/team-state.mjs:35` 写死 `generation:1`，`lib/team-coordinator.mjs:62` 硬校验 `b.generation !== 1`，reducer 无 bump/新建 generation 命令。与 v0.2:51「变更 Leader 需人工核对后建立新 generation」冲突 → §5 待决。
3. **本机 worker 被拒绝**：`lib/team-coordinator.mjs:41` `REMOTE_WORKER_REQUIRED`。handoff:67 要求「自动调度只能选择本机已授权范围内的成员」——二者语义张力见 §5。
4. **store 不认识新桶/新字段**：`lib/team-store.mjs:6-58` `validate()` 只认 version:1 + 六固定桶，且 `:27` 强制 `dependsOn` 为空。M6 若给 `emptyTeamState` 加 `plans`/`profiles` 桶或允许非空 `dependsOn`，**必须同步改 `validate()` 并给旧 `team.json` 加缺省兼容**，否则启用 Team 时旧账本被 `:66-70` 判损坏而 fail-closed 启动失败（§9）。
5. **无 accept 路径**：`lib/team-state.mjs:89-131` switch 无 `accept`；`lib/team-store.mjs:26` 虽允许 `planned/accepted`，但 create-task 直接置 `ready`（`:54`），无任何路径产生 `planned/accepted`。验收/拒绝重做全未实现。
6. **无能力/验收/依赖字段**：`lib/` 内不存在 `capabilities`、`skills`、`maxConcurrentTasks`、`requiredCapabilities`、`acceptanceCriteria`、`AgentProfile`、拓扑排序（已 grep 确认）。M2/M3 实体与强制点全未落地。
7. **M1 源码预览的验证边界**：`docs/superpowers/plans/agent-team-m1-progress.md:30` 记录 npm test 94/94、Team real-HTTP smoke、Schema 51/51、panel 99/99；但 `:29` 明说「Team execution in a real two-PC DSH model runtime is NOT yet validated」。`docs/team-m1-usage.md:85` 与 `docs/handoffs/m1-three-device-acceptance.md:113-121` 确认 `scripts/team-smoke.mjs` 为 **localhost + 同节点两 Worker + stub followup**，仅补充自动化证据。

---

## 3. 已确认架构复述（忠实于 v0.2，不改写语义）

- **分层职责**（v0.2:24）：Mesh=发现/传输；Registry=能力/容量；Task Engine=任务/依赖/验收；Execution Coordinator=派发/恢复；Leader LLM=拆解/候选 Worker/验收判断。**权限、容量、依赖、状态转换由插件强制检查**，不能只靠提示词（handoff:67）。
- **数据模型**（v0.2:30-37）：Team(`roomId,leaderKey,generation,revision,paused`) / AgentProfile(`memberKey,capabilities,skills,maxConcurrentTasks,observedAt`) / Task(`taskId,roomId,title,detail,dependsOn,requiredCapabilities,acceptanceCriteria,status,currentExecutionId,revision`) / Execution(`executionId,taskId,attempt,workerKey,generation,state,leaseExpiresAt,lastEventSeq,result`) / Event(`eventId,executionId,actorKey,type,seq,createdAt,payload`) / Result(`summary,artifacts,checks,error`)。旧 Room 任务维持原语义，默认不迁移（v0.2:28）。
- **Task FSM**（v0.2:41）：`planned→ready→active→review→accepted`；允许 `blocked/failed/cancelled`。**只有 Leader 可验收**，Worker 成功仅进 `review`；拒绝须记原因，重做**创建新 executionId**。依赖仅允许同 Team 已存在任务；创建/修改计划时原子校验无环，依赖任务须已验收才可派发（v0.2:39）。
- **Execution FSM**（v0.2:43）：`queued→acknowledged→running→succeeded|failed|cancelled`；无法确认结果进 `uncertain`。ACK 只记录传输事实，不推进到 acknowledged；终态不可被迟到进度覆盖（v0.2:43,72）。
- **授权边界**（v0.2:49,51,53）：固定 Leader，故障后暂停派发、**不自动 failover**；共享密钥 + 节点白名单 + **Worker 本机显式授权**（roomId/leaderKey/目标会话/工作范围），授权不由远端能力声明推导；能力声明仅用于匹配，**不授予权限**（v0.2:39）。成员退出/授权撤回后拒绝新执行，已有执行进取消协调，不声称已撤销外部副作用。Team 的 `leaderKey/generation` **不随 Room 状态合并自动变化**；发现 Room Leader 变更/退出时暂停 Team、人工核对后恢复（v0.2:53）。
- **generation 权威版本栅栏**（v0.2:51）：只允许原 Leader 暂停/恢复；变更 Leader 需人工完成旧执行核对后建立**新 generation**。旧 generation 事件保留审计但不得改变当前任务。禁止用 Room 时间戳合并规则裁决执行状态（v0.2:47）。
- **`/team` 通道**（v0.2:57-72）：独立 `POST /lan-mesh/v1/team`、`teamProtocolVersion=1`、显式能力协商启用；旧节点继续普通 Room 协作、不接收自动执行（v0.2:57）。认证覆盖 method/path/sender/receiver/sentAt/nonce/完整 body 哈希；先验证大小/Schema/身份/时间窗口/授权再处理业务；默认 ±120s 窗口（v0.2:59）。操作表：dispatch/start/progress/heartbeat/result/status-query/cancel/event-ack（v0.2:61-68）。ACK≠acknowledged；Worker 随后申请 start 许可，Leader 持久化 running+租约后返回许可，Worker 保存开始标记才唤醒；许可携带有效时长，Worker 用本机单调计时，响应抵达已过期则不得启动；续租同规（v0.2:70）。事件按 executionId 递增 seq，重复幂等、同序号异内容拒绝、乱序要求重传（v0.2:72）。
- **持久化/幂等/恢复**（v0.2:74-84）：Leader 发送前持久化 execution+outbox，Worker ACK 前持久化接收记录；同 executionId 同内容返回现有状态不重复唤醒，异内容冲突；`team.json` 单写者串行、原子快照；损坏→Team 暂停报错、**不按空状态继续**；nonce 去重持久化至窗口结束，execution ID 去重长期保留（执行幂等墓碑不清理）；租约默认 90s / 心跳 20s / 窗口 ±120s，以 Leader 时钟计。**租约过期只表示失去联系→uncertain 并占容量，不自动派发新 attempt**；重启先查询/对账；系统**不承诺外部副作用 exactly-once**（v0.2:80-84）。
- **里程碑**（v0.2:86-92）：M1 可靠执行（显式指定 Worker，已源码预览）→ M2 自动编排（能力注册/容量/DAG/候选推荐/Leader 工具）→ M3 团队闭环（验收/拒绝重做/人工接管/审计/最小界面）。**M1 每 Worker 会话最多一个未解决执行**（queued/acknowledged/running/uncertain 均占），多并发与自动容量匹配留 M2（v0.2:92）。
- **明确不做**（v0.2:9）：自动选主、Git 自动合并、跨节点文件同步、任意第三方 Agent 适配。文件路径交付物仅描述所属节点文件，不表示 Leader 已访问或验证。
- **留给实施计划**（v0.2:104-106）：固定 Leader / 授权后自动执行 / 结果不明暂停 / 首个里程碑显式分配 是默认取舍；**具体工具名称、Schema 字段上限、界面文案**留给实施计划，不能改变上述协议语义。

---

## 4. 可实施范围的具体方案（全部 = PROPOSAL / 待固化）

> 通用强制原则（承接 handoff:67）：以下每一项的**依赖校验、无环、权限、容量、状态转换、验收**都必须在 `applyTeamCommand`/`TeamCoordinator`/`store.validate()` 里以代码拒绝，**不是提示词约束**。Leader LLM 只产出「意图/候选」，插件拒绝非法意图。所有字段名带 `*` 标记者为**待固化**：v0.2:104-106 明示工具名/Schema 上限/UI 文案未定，本文提案不得当既成事实。
> 通用字段约束沿用 M1 既有校验：`teamId()` 正则 `^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$`、`teamMember()` `^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}/[^\s/]{1,128}$`、`canonicalTeamJson()` 排序序列化（`lib/team-state.mjs:11-20`）；body 上限沿用 256 KiB（`lib/team-protocol.mjs:5`）。

### 4.1 能力描述（capability description）

- **新增实体** `AgentProfile`（v0.2:33 已列字段，具体上限待固化）：
  ```
  { memberKey, capabilities: string[], skills: string[], maxConcurrentTasks: int>=1,
    observedAt: number, source: 'local-config'|'local-observation', revision: int }
  ```
  拟入 `emptyTeamState()` 新桶 `profiles:{}`（**须同步改 `lib/team-store.mjs:6-58` validate**，见 §9）。
- **语义**：`capabilities` 只用于**匹配过滤**，`source` 只能是本机配置或本机观测，**绝不从远端能力声明推导授权**（v0.2:39,49；handoff:67「能力声明不授权」）。`skills` 只提示可用能力，沿用 `docs/ui-contract.md:118-135` 技能引用「不安装、不自动执行」语义；沿用 `docs/architecture/project-workspace.md:48,50`「Agent 目录不等于标准跨 Runtime 协议，版本化能力/远端技能目录需另行批准」。
- **提议工具*** `lan_mesh_team_profile_upsert { roomId, memberKey, capabilities, skills, maxConcurrentTasks }` / `lan_mesh_team_profile_list { roomId }`；**提议 reducer 命令*** `upsert-profile`（仅 actor===leaderKey 或 memberKey 本机会话，且 `source` 不可由请求自报远端节点）。
- **插件强制点**：`upsert-profile` 在 `applyTeamCommand` 内校验 memberKey ∈ Room 成员、capabilities 每项长度/数量上限、maxConcurrentTasks 为安全整数；`store.validate()` 校验每 profile 字段。能力集合**不进入** `#authorizeTeam`（`lib/service.mjs:2364-2384`）的判定输入——授权仍只由 `teamAuthorizations` + Room 成员 + workspaceRoot 决定。
- **依赖**：若能力要绑定 M5 Context Pack 的技能引用，需 M5 可用；否则可先做本机配置来源。

### 4.2 任务依赖 DAG（acyclicity + 依赖已验收才可派发）

- **Task 扩展**（v0.2:34 已列，上限待固化）：在现有 `lib/team-state.mjs:54` 的 task 上增加 `requiredCapabilities: string[]`、`acceptanceCriteria: string`（≤4000*）、允许非空 `dependsOn: taskId[]`。**移除** `:53` 的 `fail('UNSUPPORTED')`，但保留「依赖仅允许同 Team 已存在任务」（v0.2:39）。
- **提议工具*** `lan_mesh_team_task_create { roomId, taskId, title, detail, dependsOn, requiredCapabilities, acceptanceCriteria, workerKey? }`（M1 的 `dispatch` 仍保留显式分配路径）与 `lan_mesh_team_plan_submit { roomId, tasks: TaskSpec[], planRevision }`（人类可审查计划的写入口，见 §4.6）。
- **无环校验（插件强制，原子）**：在 `applyTeamCommand` 的新命令 `create-task`/`set-plan` 中，对全 Team 的 `dependsOn` 做拓扑排序；自环、跨 roomId 引用、引用不存在 taskId、检测到环 → `fail('CYCLE'|'BAD_DEPENDENCY')`，**整批事务回滚**（`store.transact` 已保证原子，`:74-99`）。不依赖调用方自觉。
- **依赖 ready 门槛（插件强制）**：`queue` 命令在 `lib/team-state.mjs:62-73` 现有 `UNRESOLVED_EXECUTION`/`CAPACITY` 检查**之前**增加：遍历 `task.dependsOn`，**每一依赖任务 `status === 'accepted'`** 才允许，否则 `fail('DEPENDENCY_NOT_ACCEPTED')`。accepted 只能由 §4.5 的 `accept` 产生，Worker `succeeded` 仅进 `review`（`lib/team-state.mjs:111`），因此「依赖须已验收」是代码事实而非约定。
- **状态字段**：沿用 `lib/team-store.mjs:26` 已允许的 `planned`；新建带依赖任务置 `planned`，依赖全 accepted 且自身检查通过后才转 `ready`（新增 `mark-ready` 命令*，由 `accept` 后由 tick 或显式命令触发）。
- **强制点汇总**：`applyTeamCommand`（无环、依赖门禁、状态迁移）+ `store.validate()`（允许非空 dependsOn 并校验引用存在）+ `TeamCoordinator.dispatch` 拒绝非法派发。

### 4.3 容量匹配（capacity matching）

- **现状**：M1 写死单槽 —— `unresolved` 集合（`lib/team-state.mjs:22`）+ `queue` 的 `CAPACITY` 检查（`:66`）+ Worker 接收端 `CAPACITY`（`lib/team-coordinator.mjs:71`）。v0.2:92 明确把「可配置多并发及自动容量匹配」留到 M2。
- **提议**：`AgentProfile.maxConcurrentTasks`（§4.1）作为**每 memberKey 上限**；`queue` 把 `:66` 的「存在任一 unresolved → CAPACITY」改为「同 workerKey 的 unresolved 数 ≥ min(profile.maxConcurrentTasks, 配置硬上限) → CAPACITY」。配置提议 `teamMaxConcurrentPerWorker*` 默认 **1**（保持 M1 行为，opt-in 提升）。
- **能力过滤（插件强制）**：调度候选时，`task.requiredCapabilities ⊆ profile.capabilities` 才入选；但**入选 ≠ 授权**——最终派发仍走 `#authorizeTeam`（`lib/service.mjs:2364-2384`），能力声明永远不写进授权依据。容量计数必须把 `uncertain` 计入 unresolved（v0.2:82；handoff:67）。
- **提议工具*** `lan_mesh_team_capacity { roomId }` 返回 `{members:[{memberKey, active, limit, available}], uncertainCount}`；候选推荐结果含 `reason` 说明为何排除（能力不符/容量满/未授权/非本机范围）。
- **本机范围约束**：候选集**只能**是本机 `teamAuthorizations` 已授权范围内的成员（handoff:67）；与 M1 `REMOTE_WORKER_REQUIRED`（`lib/team-coordinator.mjs:41`）的张力见 §5 待决。

### 4.4 拆解 / 调度（decomposition + scheduling）

- **职责边界**（v0.2:24）：Leader LLM 产出「拆解出的 TaskSpec 列表 + 候选 Worker 建议」，**插件**负责把所有约束用代码落地。提议引入纯函数 `lib/team-planner.mjs`（PROPOSAL，不写）暴露：
  ```
  proposePlan({ team, tasks, profiles, authorizations, localNodeId }) -> { plan, candidates, violations }
  validatePlan(plan, ctx) -> { ok, errors:[{code, taskId}] }   // 纯函数，可单测
  ```
- **提议工具***（host-bound，身份仍取 `exec.agent.id`，参照 `lib/team-tools.mjs:20`）：
  - `lan_mesh_team_plan_propose { roomId, goal, tasks }` → 返回**只读** plan 草案 + 每项 `violations`，**不写权威状态、不派发**。
  - `lan_mesh_team_plan_commit { roomId, planId, planRevision }` → 在**单一 `store.transact`** 内做：无环校验、依赖引用校验、权限校验、容量校验、状态迁移，全部通过才落库；任一失败整批回滚且 `fail(code)`。
  - `lan_mesh_team_schedule { roomId }` → 在 `#tick`（`lib/team-coordinator.mjs:168-252`）的调度循环里，只对 `status === 'ready'` 且依赖全 accepted 的任务，从**本机已授权**成员中挑候选，生成新 executionId 走既有 `dispatch` 链路（`lib/team-coordinator.mjs:37-54`）。**不自动重跑 uncertain**，不新建 attempt（§7）。
- **插件强制点**：`validatePlan` 是纯函数、被 `plan_commit`/`schedule` 共同调用；`schedule` 每次派发前重新校验授权、Room 成员、generation、容量、依赖，绝不缓存信任 LLM 输出。调度**不得**因 Room Leader 合并/接管而绕过 generation 栅栏（handoff:67；v0.2:51-53）。
- **明确不做**：跨节点文件同步、第三方 Agent 适配（v0.2:9）；调度不替人类确认、不自动验收。

### 4.5 验收（acceptance，reject→redo 新 executionId）

- **现状缺口**：`lib/team-state.mjs:89-131` 无 `accept` 命令；`lib/team-store.mjs:26` 允许 `accepted` 但无路径产生；`teamStatus` 仅回报 review（`lib/service.mjs:2421-2433`）。
- **提议 reducer 命令***（仅 `actor === team.leaderKey`，generation 匹配，v0.2:41）：
  ```
  accept   { roomId, taskId, generation, actorKey, decision:'accepted'|'rejected',
             reason*, checks*: [{name, passed, detail}], reviewedExecutionId }
  ```
  - `decision:'accepted'`：要求 `task.status === 'review'` 且 `reviewedExecutionId === task.currentExecutionId`；写 `task.status='accepted'`、`task.revision++`、追加审计 Event*（含 `checks`、reason、Leader 身份、generation）；触发依赖它的任务重算 ready（§4.2）。
  - `decision:'rejected'`：要求记 `reason`（`text`，≤4000*），`task.status` 回到 `ready`（或 `planned`），**记录拒绝原因审计**；后续重做**必须创建新 executionId**——由 `queue` 的既有 `attempt = previous.length+1`（`lib/team-state.mjs:67`）与 `CONFLICT`（`:63` 同 executionId 已存在）保证不能复用旧 ID；旧 execution 保持 `succeeded` 终态不被覆盖（v0.2:43）。
- **插件强制点**：只有 `accept` 能产生 `accepted`；Worker 的 `result(succeeded)` 永远只到 `review`（`lib/team-state.mjs:111`）；`accept` 拒绝非 Leader、错误 generation、非 review 状态、缺 reason 的 reject。`store.validate()` 校验审计 Event 字段。
- **提议工具*** `lan_mesh_team_accept { roomId, taskId, decision, reason?, checks? }`（host-bound，Leader-only）与 `lan_mesh_team_plan_audit { roomId }`（返回按 generation+seq 排序的审计，禁止墙钟排序，参照 `docs/handoffs/dsh-after-m3-prompt.md:40` M4 排序纪律）。

### 4.6 人类可审查的计划界面（human-reviewable plan interface）

- **契约约束**：`docs/ui-contract.md:4`「任何一方要改字段，先改本文件」；`:2` 端点经 `POST /api/lan-mesh` 信封；`:31-59` 端点全集；`roomDetail`/`roomAssign` 等既有模式。**新增任何 Team 面板端点/字段都必须先改 ui-contract，本文不修改它**。
- **提议只读端点***（Owner-only，参照 `docs/ui-contract.md:155` 面板入口 owner-only）：
  ```
  teamPlan        { roomId, sessionId } -> { team:{leaderKey,generation,paused}, planRevision,
                                            tasks:[TaskView], profiles:[AgentProfileView],
                                            edges:[{from,to}], violations:[...], executions:[...],
                                            audit:[...], pendingHumanReviews:[...] }
  ```
  `TaskView` = `{taskId,title,detail,dependsOn,requiredCapabilities,acceptanceCriteria,status,currentExecutionId,attempt,review,checks,dependsOnAccepted}`。
- **提议人类动作端点***（均需明确「人类确认」语义，参照 M4「Agent 可提方案，不能伪装人类确认」dsh-after-m3-prompt.md:38）：
  ```
  teamPlanApprove { roomId, planId, planRevision, sessionId }   // 人类批准计划
  teamPlanReject  { roomId, planId, reason, sessionId }          // 人类驳回
  teamAcceptConfirm { roomId, taskId, decision, reason?, sessionId } // 人类最终验收确认（可选双签）
  ```
  权限由**入口**（owner-only connection）派生，不接受 payload 自报身份（参照 `docs/ui-contract.md:155-165` `via:'panel'` 模式）。
- **视图要求（草案，UI 文案待固化）**：计划以 DAG 列表/图展示 `dependsOn` 边与每任务状态；`uncertain` 执行高亮并标注「占容量、需人工对账」；`review` 任务列出 `checks`/`artifacts` 与「仅 Leader 验收」；每步显示 `generation` 与审计序号，禁止靠墙钟排序；错误保留草稿（参照 `docs/ui-contract.md:264` 草稿纪律）。
- **插件强制点**：面板**只提交意图**，所有校验仍由 `plan_commit`/`accept`/`#authorizeTeam` 在服务端重做；面板不持有写权威状态的能力，不绕过 host-bound 工具身份。
- **依赖**：完整界面与 M4 文档修订、M5 Context Pack 的关联显示绑定；最小只读视图可先做，但**界面文案/具体字段属于待决项**（§5）。

---

## 5. 协议与权限待决项清单（全部标 OPEN）

> handoff:69 要求「资料不足 → 交付具体方案、接口与测试计划，列明待决项；不要编造已完成，也不要因此停止其他已确定开发」。以下每项都给**提议接口 + 测试计划草图**，但结论标 **OPEN**，需负责人/Codex 裁定后方可编码。`project-workspace.md:51` 明确「离线 proposal、generation 恢复、维护者授权及备份策略必须在编码前明确」。

| # | 待决项 | 为何资料不足 / 冲突 | 提议接口（草案） | 测试计划草图 | 状态 |
|---|---|---|---|---|---|
| D1 | `/team` 精确 HTTP 方法与完整 Schema | v0.2:57「具体 HTTP 方法及 Schema 在实施计划中固化」；M1 已固定 `POST /lan-mesh/v1/team`（`lib/team-protocol.mjs:4,28`）但那是 M1 实现，不等于 M6 批准扩展 | 沿用 `POST` + `teamProtocolVersion:1` + 256 KiB + 固定签名；新增 operation 须加进 `:6` 集合并补 handler；每字段上限列表写入实施计划 | 篡改 method/path/body/nonce/版本、超大 body、错误 operation 全部拒绝；`verifyTeamRequest` 单测 | **OPEN** |
| D2 | 工具名 / Schema 字段上限 / UI 文案 | v0.2:104-106 明示留给实施计划；`docs/ui-contract.md:4` 改字段先改契约 | §4 各 `lan_mesh_team_*` 名称与字段均为提案；上限沿用 M1（title 200/detail 4000/summary 4000）或新列表 | `scripts/team-tools.test.mjs` 扩展：缺参/越界/未知字段拒绝；schema-check 用实际 DSH 安装校验器 | **OPEN** |
| D3 | `event-ack` 是补 handler 还是移除 | `lib/team-protocol.mjs:6` 声明但 `handle()` 无分支、`lib/team-coordinator.mjs:130` `UNSUPPORTED`；v0.2:68 要求 event-ack | 二选一：(a) 在 `handle` 加 `event-ack` 分支幂等确认 seq；或 (b) 从集合移除并文档化「ACK 由响应 `eventAck` 捎带」 | 同 seq 重复/乱序/跨执行 event-ack 的幂等行为；与 `:209` 现有捎带路径互斥性 | **OPEN** |
| D4 | generation 提升 / 新 generation 建立 / 恢复 | v0.2:51 允许「人工核对后建立新 generation」，但 M1 写死 `generation:1`（`lib/team-state.mjs:35`、`lib/team-coordinator.mjs:62`），无 bump 命令；project-workspace:51 要求编码前明确 | 新增 `bump-generation { roomId, actorKey, newLeaderKey, reason, reconciledExecutionIds[] , oldGeneration }`；仅原 Leader + 全部旧执行已人工对账；旧 generation 事件保留审计；`b.generation !== 1` 硬编码改为 `!== team.generation` | 旧 generation 迟到事件不改当前任务；未对账执行拒绝 bump；重启后 generation 持久一致；Room Leader 变更**不**自动 bump | **OPEN** |
| D5 | 维护者授权 / 离线 proposal / 备份策略 | project-workspace:51 指文档侧（M4）「离线 proposal、generation 恢复、维护者授权及备份策略必须在编码前明确」；是否与 Team generation 同一栅栏未定 | 文档侧 `proposalId` 幂等、离线保留、同 ID 内容变化拒绝（参照 dsh-after-m3-prompt.md:40）；维护者授权独立于 Team Leader；备份 = `team.json` + 文档审计快照，恢复不改写历史 | 离线提案重试同 ID、内容冲突拒绝；备份恢复后 generation/审计一致；维护者≠Team Leader 时不得接管执行 | **OPEN / 依赖 M4** |
| D6 | 自动调度「本机已授权范围」的精确定义 | handoff:67「自动调度只能选择本机已授权范围内的成员」；M1 `dispatch` 拒绝**本机** worker（`lib/team-coordinator.mjs:41 REMOTE_WORKER_REQUIRED`）；语义张力未裁定 | (a) 「本机」指 Leader 侧 `teamAuthorizations` 授权集，派发仍走远端 Worker；或 (b) 增加本机 worker 派发路径并删除 `:41` | 两种解释各写一组：本机 worker 是否可派发、跨节点未授权成员是否被拒、能力声明是否能绕过授权 | **OPEN** |
| D7 | 人类可审查计划界面的具体形态 | v0.2:90 仅「最小界面」；`docs/ui-contract.md` 冻结，字段未定 | §4.6 只读 `teamPlan` + 三动作端点；DAG 图/列表、双签验收、草稿保留为草案 | 面板 harness 渲染（非真实浏览器）；owner-only 403；payload 自报身份无效；错误保留草稿 | **OPEN** |
| D8 | 验收是否需人类二次确认 | v0.2:41「只有 Leader 可验收」；M4 纪律「Agent 可提方案，不能伪装人类确认」；M6 是否要求人类 Leader 之外的双签未定 | `accept` 由 host-bound Leader 工具触发；若 D7 启用 `teamAcceptConfirm` 则为可选双签，二者互斥且都写审计 | 非 Leader 调用 accept 拒绝；双签缺失时 accepted 不产生；审计含决策者身份 | **OPEN** |
| D9 | 备份 / 账本迁移与旧账本兼容 | M6 必改 `emptyTeamState` 桶与 `store.validate()`（`lib/team-store.mjs:6-58`、`:27`），旧 `team.json` 否则被判损坏 fail-closed | 见 §9：version:1 + 可选新桶缺省、非空 dependsOn 兼容；迁移是「加缺省」不是「改写历史」 | 旧 M1 账本（无 profiles/plans、dependsOn 全空）在启用 M6 后能加载且状态不变；损坏账本仍 fail-closed | **OPEN** |

> 以上 OPEN 项**不阻塞** §4 中不依赖它们的骨架设计（能力数据结构、无环校验纯函数、依赖门禁、accept 命令骨架、容量计数重构）先行进入编码准备；但 D4/D6/D7/D8 涉及**权限/协议语义**，按 handoff:69 必须在编码前由负责人/Codex 明确，实施者不得自行拍板。

---

## 6. 默认 opt-in 与授权边界

- **默认关闭**：`index.js:102` `teamEnabled: value.teamEnabled === true`；`lib/service.mjs:504` 仅 `teamEnabled===true` 才 `#startTeam()`；`index.js:1327` 仅启用时注册 5 个工具；`lib/service.mjs:598` 仅启用时能力响应带 `teamProtocolVersion:1`。M6 新增工具/端点**沿用同一开关**，默认绝不启用。
- **配置**（`docs/team-m1-usage.md:19-47`）：`clusterSecret` / `trustedPeers` / `autoWake:false` / `teamEnabled:true` / `teamAuthorizations:[{roomId,leaderKey,workerSessionId,workspaceRoot}]`；可选 `teamLeaseMs:90000`、`teamHeartbeatMs:20000`、`teamRequestWindowMs:120000`（`docs/team-m1-usage.md:47` 约束：租约≥1000、心跳≥250 且 < 租约一半、窗口为正；校验在 `lib/team-coordinator.mjs:12` 与 `lib/service.mjs:2331`）。
- **授权边界**（`lib/service.mjs:2364-2384` `#authorizeTeam`）：启用 + secret + trustedPeers 三者齐备；`actorKey` 须为本机或白名单节点；`workerKey` 若为远端须在白名单；`teamAuthorizations` 中 `roomId+leaderKey` 精确匹配、`workspaceRoot` 为绝对路径且 Worker 会话 `cwd` 经 `realpath`+`relative` 校验落在授权目录内。目录检查**只控制插件准入，不代替 DSH 工具权限或系统沙箱**（`docs/team-m1-usage.md:45`）。共享密钥只识别受信集群，**不提供集群内密码学隔离**（v0.2:49；`docs/team-m1-usage.md:45`）。
- **能力声明不授权**（v0.2:39；handoff:67）：§4.1 的 `capabilities` 仅进入匹配过滤，**绝不**作为 `#authorizeTeam` 的输入；`upsert-profile` 不得写入授权表；Room `roomInvite` 明确「不授予 Team 执行权限」（`docs/ui-contract.md:165`）。
- **自动调度仅本机已授权范围**（handoff:67）：§4.4 `schedule` 的候选集从本机 `teamAuthorizations` 与 Room 成员求交，未授权成员即使能力匹配也不入选；与 D6 的精确定义**待决**。
- **generation 栅栏不自动变化**（v0.2:51,53；handoff:67）：Leader 变更/房间接管/Room 状态合并**不得**自动改 `leaderKey/generation`；`lib/team-coordinator.mjs:23-30` `allowed()` 发现 Room Leader 不符即 `ROOM_CHANGED` → `#tick`（`:172-178`）暂停 Team。**不接管运行中任务**：`lib/service.mjs:1695` 注释与 `docs/ui-contract.md:165` 明确房间管理者不自动成为 Team 执行 Leader、不继承其他节点授权、不能接管运行中任务。
- **无授权则不执行**：Worker 侧 `verifyTeamRequest`（`lib/team-protocol.mjs:20-51`）先验认证/白名单/窗口/授权再处理业务；旧节点无 `teamProtocolVersion:1` 能力时 `sendTeamRequest`（`:63-69`）返回 `UNSUPPORTED`，不回落为 room-task 执行（v0.2:57,78）。

---

## 7. uncertain 与人工对账

- **uncertain 占容量**：`unresolved` 集合含 `uncertain`（`lib/team-state.mjs:22`）；`queue` 的 `CAPACITY`/`UNRESOLVED_EXECUTION`（`:65-66`）与 Worker 接收端 `CAPACITY`（`lib/team-coordinator.mjs:71`）均把它们计入；`expire`/`cancel` 置 uncertain + task blocked（`lib/team-state.mjs:114-123`）；`recover()` 把 starting/running→uncertain（`lib/team-coordinator.mjs:153-159`）；`#uncertain`（`:254-257`）。
- **禁止自动重跑 / 禁止新建 attempt**（v0.2:82,84；handoff:67）：租约过期只表示失去联系，进入 uncertain 并占容量，**不自动派发新 attempt**；`lib/team-coordinator.mjs:9` 注释 "no automatic retry of an uncertain execution"；重启先查询/对账（`:153-159`、`:191-194` status-query）。Worker 失去续租许可不启动新工作（`:219-229`）。结果提交无需租约有效但只进恢复核对，不直接覆盖人工处置（`lib/team-state.mjs:105-113`）。
- **人工对账流程**（`docs/team-m1-usage.md:75-78`；`lib/service.mjs:2442-2458`）：
  1. 在 Worker 机器**人工确认旧执行确实停止**（不能仅因等待时间长就放行）；
  2. Leader 调 `lan_mesh_team_reconcile { executionId, stopped:true, reason }`；
  3. `teamReconcile` 校验 Leader + `stopped===true` + reason + 状态∈{uncertain,cancelled}，写 durable 取消 tombstone + reconcile outbox（`lib/service.mjs:2447-2455`）；`remotePending:true` 表示 Worker 未确认，重传（`:2458`）；
  4. `applyTeamCommand` 的 `reconcile` 要求 `stopped===true` 才 `uncertain→cancelled` + task ready（`lib/team-state.mjs:124-129`）；Worker 侧 reconcile 同样置 cancelled（`lib/team-coordinator.mjs:85-89`）。
- **不承诺外部副作用 exactly-once**（v0.2:84；`docs/team-m1-usage.md:76`）：插件无法保证已启动的 Shell/外部操作被终止或撤销；`docs/handoffs/m1-three-device-acceptance.md:7` 红线保留。M6 的 `accept`/redo 不得隐式扩大此承诺。
- **执行变更 / 房间接管不绕过 generation 与人工对账**（handoff:67）：D4 的 `bump-generation` 须附带 `reconciledExecutionIds[]` 人工对账证据；未对账旧执行禁止提升 generation；Room Leader 变化只暂停 Team，不静默改写执行。

---

## 8. 验收与测试计划

### 8.1 强制分离：localhost stub 证据 ≠ M1 三设备 12 场景真实验收

- **补充自动化证据（仅此）**：`scripts/team-smoke.mjs`（文件头 "Two real HTTP MeshNodes, two Worker sessions, stub model runtime"；`:39-40` 用 `127.0.0.1`；`:18` 两 Worker 同节点 `b`；`:13-15` followup 写数组 stub）、`node --test scripts/team-*.test.mjs`。`docs/handoffs/m1-three-device-acceptance.md:113-121` 与 `docs/team-m1-usage.md:85` 明确它们**只能作为 HTTP 链路 + 状态机补充证据**，不能证明三设备、真实模型、跨机器网络与故障注入。
- **M1 真实验收 12 项全部「未验收」（仍为前置条件，handoff:69）**，逐项列于 `docs/handoffs/m1-three-device-acceptance.md:129-142`，本计划**不翻绿任何一项**：
  1. A/B/C 三设备就位与配置（opt-in/secret/trustedPeers/双边授权/测试目录） — 未验收
  2. 步骤①两项无副作用任务的真实模型执行与 report — 未验收
  3. 步骤② ACK/start permission/running/result/review 状态核对 — 未验收
  4. 故障③-1 重复 dispatch / 丢 ACK — 未验收
  5. 故障③-2 短时断网 — 未验收
  6. 故障③-3 超过租约离线 — 未验收
  7. 故障③-4 Worker 进程退出 — 未验收
  8. 故障③-5 Leader 重启 — 未验收
  9. 故障③-6 Worker 重启 — 未验收
  10. 故障③-7 结果回传丢失 — 未验收
  11. uncertain → 人工确认停止 → reconcile 流程 — 未验收
  12. 通过条件汇总（真实模型成功、无不明重复副作用、重启记录一致、uncertain 有人工流程） — 未验收
- 红线（`docs/handoffs/m1-three-device-acceptance.md:19-22`）：不伪造设备结果、不关闭安全策略、B/C 必须真实模型、不得与 A 同机或用 localhost 代替；设备由负责人提供（**外部阻塞**）。**不凭 localhost stub 宣称可正式自动运行**（handoff:69）。

### 8.2 M6 新增测试计划（全部为「待写/待运行」，非已完成）

测试分层：纯函数（`validatePlan`/拓扑排序/capacity 计数）→ reducer（`scripts/team-state.test.mjs` 扩展）→ store 迁移/损坏（`scripts/team-store.test.mjs`）→ 协议（`scripts/team-protocol.test.mjs`）→ coordinator 故障（`scripts/team-coordinator.test.mjs`）→ 服务/工具/权限（`scripts/team-service.test.mjs`、`scripts/team-tools.test.mjs`）→ 双节点 HTTP smoke（**新脚本草案** `scripts/team-m6-smoke.mjs`，PROPOSAL，本文不创建）。

`scripts/team-m6-smoke.mjs` 草图（独立临时目录 + 回环端口 + 可计数 wake，禁止写真实 DSH_HOME，参照 `docs/superpowers/plans/2026-11-08-agent-team-m1.md:111-112`）：

| 用例 | 断言（插件强制，非提示词） |
|---|---|
| DAG 无环 | 自环 / A→B→C→A / 跨 roomId 引用 / 不存在 taskId：`plan_commit` 整批回滚、`fail('CYCLE'|'BAD_DEPENDENCY')`，账本无半写入 |
| 依赖门禁 | 依赖任务为 `review`（Worker succeeded 未 accept）时 `queue` 返回 `DEPENDENCY_NOT_ACCEPTED`；仅全部 `accepted` 后才允许派发 |
| 容量 | `maxConcurrentTasks=1` 时第二 unresolved（含 uncertain）→ `CAPACITY`；uncertain 计数入容量；能力不符候选被排除且有 reason |
| 状态转换强制 | 非 review→accept 拒绝、非 Leader→accept 拒绝、错误 generation 拒绝、终态被迟到进度覆盖拒绝（沿用 `lib/team-state.mjs:76-88`） |
| 验收 / 重做 | accept→accepted 写审计；reject 必须 reason；重做生成**新 executionId**、新 `attempt`（`lib/team-state.mjs:67`），旧 execution 终态不变 |
| generation 栅栏 | 旧 generation 迟到事件不改当前任务（D4 行为）；Room Leader 变更**不**自动改 leaderKey/generation，触发 `ROOM_CHANGED`→暂停 |
| uncertain 处理 | 租约过期→uncertain+占容量、**无自动 wake、无新 attempt**；仅 `reconcile(stopped=true,reason)` 后释放；Worker 未确认仍占槽 |
| 未授权拒绝 | 能力匹配但 `teamAuthorizations` 缺失 → `#authorizeTeam` false、`FORBIDDEN`；profile 写入不改变授权判定；payload 自报身份无效 |
| 旧节点不执行 | 对端无 `teamProtocolVersion:1` → `UNSUPPORTED`，不回落 room-task（`lib/team-protocol.mjs:66,69`） |
| 损坏账本暂停 | 损坏 `team.json` → `TEAM_STORAGE` fail-closed，启用 Team 启动失败、不静默清空（`lib/team-store.mjs:66-70`） |

- **回归纪律**（handoff:73-76；`docs/superpowers/plans/2026-11-08-agent-team-m1.md:113-115`）：`npm test`、`panel-check`、`schema-check`、`check:composer-compat`、`twin-transport-check`、`rooms/team smoke`；schema 校验器从实际 DSH 安装定位，不把本机绝对路径写入产品默认值；每项记录命令/退出码/结果，保留首次失败及重跑，Windows EPERM 先调查、环境阻断与业务失败分开记。
- **证据分类**（handoff:76）：localhost HTTP / stub runtime / panel harness / 真实浏览器 / 多设备验收**分别记录**；浏览器由负责人自行验收（handoff:30），不伪造截图/真机结果。

---

## 9. 升级 / 回退与兼容

- **默认 opt-in**：M6 能力全部挂在 `teamEnabled===true` 下（§6）；关闭即回到 M1 行为，不注册新工具、不声明新能力、不启用自动调度。
- **旧节点继续普通 Room 协作**：`teamProtocolVersion=1` 经 `/lan-mesh/v1/info` 显式能力协商（`lib/team-protocol.mjs:63-67`、`lib/service.mjs:598`）；旧节点不接收自动执行、不回落为 room-task（v0.2:57；`lib/team-protocol.mjs:78`）。旧 Room 状态版本 1 与旧传输协议版本 2 不变（`docs/superpowers/plans/2026-11-08-agent-team-m1.md:17`）。
- **账本迁移（关键真实约束）**：M6 若给 `emptyTeamState()` 加 `profiles`/`plans` 桶、允许非空 `dependsOn`、给 Task 加 `requiredCapabilities/acceptanceCriteria`，**必须同步改 `lib/team-store.mjs:6-58` `validate()`**（当前 `:27` 强制 `dependsOn.length===0`、`:8` 只认六桶）。策略：保持 `version:1`，对旧账本**加缺省**（缺桶→空对象、缺字段→默认空数组/空串），**不改写历史记录、不迁移旧 Room 任务为自动执行任务**（v0.2:28）。迁移在同一 `transact` 原子快照内完成（`lib/team-store.mjs:74-99`）；否则旧 `team.json` 在 `:66-70` 被判损坏 → 启用 Team 直接 fail-closed 启动失败。迁移行为列入 D9 待决并写测试（§8.2 旧账本加载用例）。
- **fail-closed**：损坏文件/写失败/Rename 失败不返回成功确认、不按空账本继续（`lib/team-store.mjs:66-70`、`:87-91`；`lib/team-coordinator.mjs:169`）；`docs/team-m1-usage.md:79-81` 要求先备份再核对，不删账本直接重跑。备份策略属 D5/D9 待决。
- **回退**：关闭 `teamEnabled` 或回退到 M1 构建即停止新编排；`team.json` 保持可读（M6 只加缺省字段，不删除 M1 字段）；**不**自动清理执行幂等墓碑（v0.2:78）；回退不改写已产生 `accepted`/审计历史。
- **配置迁移**：新增 `teamMaxConcurrentPerWorker*` 等键须有安全默认值（默认 **1** 保持 M1 单槽），校验取值（`lib/team-coordinator.mjs:12` 模式）；不把占位符用于真实部署（`docs/team-m1-usage.md:15`）。

---

## 10. 局部裁定记录（源文档留白、本文给出的取舍及理由）

| # | 源文档留白 | 本文裁定 | 理由 |
|---|---|---|---|
| R1 | v0.2:104-106 工具名/Schema 上限/UI 文案未定 | 一律以 `*` 标 PROPOSAL/待固化，§5 D2 列 OPEN，不写死为既成事实 | 遵守「不能改变既定协议语义」且避免把提案伪装成已确认接口 |
| R2 | v0.2:86-90 M2/M3 目标 vs 本文状态表 | 把「可实施范围」拆为 6 项设计草案 + 逐项强制点，状态一律【设计可实现】或【待决项】，**不**写「已实现」 | handoff:69 禁止编造「已完成」；`lib/` 无相关代码（已 grep） |
| R3 | `lib/team-state.mjs:53` 拒 dependsOn、`:54` 直接 ready | 提案移除 `:53` 拒绝、引入 `planned` 与 `mark-ready` 命令（草案），但保留「依赖须已验收才派发」为 `queue` 的硬校验 | v0.2:39,41 要求依赖门禁由插件强制；`lib/team-store.mjs:26` 已允许 planned/accepted，顺势补齐 |
| R4 | M1 单槽写死（v0.2:92 把多并发留 M2） | `maxConcurrentTasks` 默认 **1**，opt-in 提升；容量计数把 uncertain 计入 | 保持 M1 行为为默认，升级不破坏既有不变量；handoff:67 要求 uncertain 占容量 |
| R5 | `lib/team-protocol.mjs:6` 声明 `event-ack` 但无 handler | 不假定其可用，列为 D3 OPEN（补 handler 或移除二选一） | 避免把「声明过」当作「已实现」，与 §2 诚实核对一致 |
| R6 | v0.2:51 允许新 generation，M1 写死 1 | generation 提升/恢复列为 D4 OPEN，**不在本文擅自定义 bump 语义** | 属 handoff:69 所指「重大权限/协议行为资料不足」，须负责人/Codex 裁定；`lib/team-coordinator.mjs:62` 硬编码是真实约束 |
| R7 | handoff:67「本机已授权范围」vs `lib/team-coordinator.mjs:41` 拒本机 worker | 列为 D6 OPEN，给出两种解释 + 各自测试，不擅自删改代码 | 两种解释权限后果不同，不能由规划文档替实施者拍板 |
| R8 | `docs/ui-contract.md:4` 冻结契约 | §4.6 端点全部标 PROPOSAL 且声明「改字段先改契约」，本文**不修改** ui-contract | 遵守冻结契约；把界面具体形态列 D7 OPEN |
| R9 | project-workspace.md:51 文档侧待决项是否并入 M6 | 单列 D5「OPEN / 依赖 M4」，不与 Team generation 合并 | 文档侧与执行侧栅栏是否同一机制未定，合并会掩盖权限歧义 |
| R10 | `scripts/team-m6-smoke.mjs` 是否算验收 | 明确为「待写/待运行」的补充自动化证据，与 M1 12 项真实验收**严格分离** | handoff:69、76；`docs/handoffs/m1-three-device-acceptance.md:113-121` 先例 |
| R11 | M4/M5 未实现却要求 M6 | 声明顺序依赖仍有效（ROADMAP.md:10-12），但按 handoff:69 先交付不依赖 M4/M5 的骨架设计 | 「不要因此停止已确定的其他开发」；界面/Context Pack 绑定部分标注依赖 |
| R12 | 验收是否需人类二次确认 | 列为 D8 OPEN（Leader-only 工具 vs 可选双签），不在本文定论 | v0.2:41 只说「只有 Leader 可验收」，M4 纪律又要求人类确认不可伪装，二者交集未定 |

---

## 11. 复核入口（独立 reviewer / Codex 如何验证本计划）

**必读文件（按顺序）**：
1. `docs/handoffs/dsh-after-m3-prompt.md:63-69`（M6 原始要求）、`:71-79`（验证纪律）— 核对本文是否覆盖 opt-in、插件强制、uncertain、资料不足不停止、不伪造。
2. `docs/agent-team-v0.2-design.md`（全文，尤其 `:9,24,30-43,49-53,57-84,86-106`）— 核对 §3 复述是否忠实、§4 是否违背既定语义。
3. `docs/superpowers/plans/2026-11-08-agent-team-m1.md` 与 `docs/superpowers/plans/agent-team-m1-progress.md` — 核对「已实现且验证(M1)」的范围与 94/94 等数字的语境。
4. `docs/handoffs/m1-three-device-acceptance.md:19-22,113-121,129-142,150` — 核对 12 项是否**全部**保持「未验收」、localhost stub 是否被降级为补充证据。
5. `docs/team-m1-usage.md`、`docs/ui-contract.md:4,31-59,155-165`、`docs/architecture/project-workspace.md:48-52,60-62`、`ROADMAP.md:10-12` — 核对 opt-in 配置、冻结契约、待决项来源、M4/M5/M6 顺序。
6. **源码实读**：`lib/team-state.mjs`、`lib/team-store.mjs`、`lib/team-protocol.mjs`、`lib/team-coordinator.mjs`、`lib/team-tools.mjs`、`lib/service.mjs:2329-2458`、`index.js:102-106,1327` — 核对本文每条 `file:line` 引证是否属实、§2 缺口是否真实存在。

**逐项检查清单**：
- 状态表（§1）是否有任何「未实现」被标成「已完成」；§4 所有字段名/工具名是否都带「PROPOSAL/待固化/*」标记。
- §2 的 7 条缺口能否在源码中逐条复现（尤其 `event-ack` 空壳、generation 写死 1、`:27 dependsOn.length===0` validate、无 accept 命令、无 capabilities 字段）。
- §5 九项待决是否都标 OPEN 且各带「提议接口 + 测试计划草图」；D4/D6 是否如实反映源码与 handoff 的张力。
- §6/§7 是否完整覆盖 hard constraints：默认 opt-in、能力不授权、本机范围调度、generation 栅栏、不接管运行中任务、uncertain 占容量/禁止自动重跑/禁止新 attempt/人工对账/不承诺 exactly-once。
- §8 是否把 localhost stub 与 12 项真实验收**分开**，12 项是否全为「未验收」且无编造结果。
- §9 是否指出「改 `emptyTeamState` 必须同步改 `store.validate()` 否则旧账本 fail-closed」这一真实迁移约束。
- §10 每条裁定是否给了「因为」；§11 是否给出可操作的复核路径。

**什么算「编造 / 不通过」**：
- 出现「M6 已实现 / 已验收 / 测试通过」而无对应源码与真实运行证据；
- 把 M1 三设备 12 项中任意一项标为「验收通过」或把 `scripts/team-smoke.mjs` 当作真机证据；
- 把 §4/§5 的 PROPOSAL 字段名、工具名、端点写成既有事实（未带待固化标记）；
- 声称 generation 可自动随 Room 合并变化、能力声明可授权、uncertain 可自动重跑、外部副作用 exactly-once；
- 引用 `file:line` 与源码不符，或把 `event-ack`/`accept`/`capabilities` 说成已存在；
- 本文之外出现任何 `lib/`、`scripts/`、`ROADMAP.md`、`docs/ui-contract.md` 的修改或 Git 提交（本任务**唯一写入**应为 `docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md`）。

> 结论：本文是**可实施范围的设计与测试计划**，不是完成证明、不是验收报告、不是接口冻结。所有 OPEN 项（尤其 D4 generation、D6 本机范围、D7 界面、D8 双签）需在编码前由负责人/Codex 明确；M1 三设备 12 场景仍是「未验收」前置条件，设备由负责人提供（外部阻塞）。按 handoff:69，这些未决项**不构成停止其他已确定开发的理由**。
