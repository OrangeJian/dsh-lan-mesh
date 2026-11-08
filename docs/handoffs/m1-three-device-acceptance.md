# M1 真实三设备验收准备清单（准备阶段 · 全部未验收）

编制依据：`docs/handoffs/dsh-development-handoff.md` 的「M1 真实设备验收」章节、`docs/team-m1-usage.md`、`docs/architecture/project-workspace.md` 的「待验收」段落，以及用户本批次要求「整理 M1 真实三设备验收准备清单；没有实际设备运行证据的场景标记为『未验收』，不能用 localhost 或 stub 测试替代」。

适用状态：**本批次仅完成准备清单整理，未安排、未运行任何真实设备。所有场景一律记为「未验收」。** 本清单是交回负责人/Codex 的待执行作业指导书，不是通过证明；测试通过与实机验收分开记录。

适用边界（来自交接包「保留边界与风险」）：ACK 至少一次不等于业务 exactly-once；shared secret 仅提供集群信任，明文 HTTP 与开放模式的风险如实保留；Team v1 与 Room 任务、Mesh v2、referencesVersion1 边界保持不变；`uncertain` 必须有明确人工流程，禁止自动重跑。

---

## 1. 前置条件与角色

| 项 | 要求 |
| --- | --- |
| 角色 A | 真实 Leader（创建 Room 的 Agent 会话，通过公开工具 `lan_mesh_team_create` / `lan_mesh_team_dispatch`） |
| 角色 B | 真实 Worker #1（独立物理/虚拟设备，独立 Agent 会话，真实模型执行） |
| 角色 C | 真实 Worker #2（独立物理/虚拟设备，独立 Agent 会话，真实模型执行） |
| 设备来源 | **由负责人提供或确认**三台可用设备与授权测试目录；实施者不得自行假定、伪造或替代 |
| 红线 | 实施者**不得伪造设备结果**、不得关闭安全策略（不得关闭 cluster secret / trusted peers / 双边授权 / 目录准入来「方便通过」）；不得影响其他网络或生产进程 |
| 网络 | 三设备须在可互通的局域网内，能互相访问 LAN 地址；B/C 不得与 A 同机、不得用 localhost/回环地址代替 |
| 模型 | B/C 必须调用**真实模型**执行任务，不得用 stub followup；`scripts/team-smoke.mjs` 的模拟运行不计入 |
| 测试目录 | 先验证授权 workspace 目录**不含生产数据**，且为专用测试目录 |

说明：`docs/team-m1-usage.md` 第 9 行明确——面板创建项目的 Leader 是 `nodeId/human`，M1 不提供将 human 转移为 Agent Leader 的功能；面板「加入」只是加入人的成员位，不能代替 Worker Agent 自己加入。因此 A 必须是真正的 Agent 会话 Leader，B/C 必须由各自会话执行 `lan_mesh_room_member action=join`。

---

## 2. 设备信息登记表（模板，待现场填写）

> **不得记录 cluster secret / 授权令牌 / 任何密钥材料。** 下表只登记可脱敏的标识与版本信息；密钥仅由负责人线下核对「两端一致」并单独确认，不写入本表、日志或截图。

| 字段 | 设备 A（Leader） | 设备 B（Worker #1） | 设备 C（Worker #2） |
| --- | --- | --- | --- |
| OS 名称与版本 | 待填 | 待填 | 待填 |
| DSH 版本 | 待填 | 待填 | 待填 |
| 插件 `dsh-lan-mesh` 版本 | 待填 | 待填 | 待填 |
| 运行 commit（base/head SHA） | 待填 | 待填 | 待填 |
| nodeId（`/lan-mesh/v1/info`） | 待填 | 待填 | 待填 |
| Agent sessionId | 待填 | 待填 | 待填 |
| LAN 地址（IP:port，可脱敏末段） | 待填 | 待填 | 待填 |
| 授权 workspace 绝对路径 | 待填 | 待填 | 待填 |
| 目录已确认不含生产数据（是/否 + 核对人） | 待填 | 待填 | 待填 |
| Team opt-in 已开启（`teamEnabled:true`） | 待填 | 待填 | 待填 |
| `autoWake:false` 已设置 | 待填 | 待填 | 待填 |

补充：DSH 更新后须重载或重启才运行新代码（`docs/team-m1-usage.md` 第 11 行）。记录每台是否完成重载/重启及时间。

---

## 3. 配置检查清单（逐台核对，执行前逐项打勾）

- [ ] **Team opt-in**：每台 `teamEnabled: true`（默认关闭，独立执行账本）。
- [ ] **clusterSecret**：两端/三端一致；仅线下核对，**不写入任何交付物**。共享密钥不提供加密或独立身份认证（`docs/team-m1-usage.md` 第 45 行），风险如实保留。
- [ ] **trustedPeers**：Leader 列出 B、C 的 nodeId；每个 Worker 列出 Leader 的 nodeId（`/lan-mesh/v1/info` 先确认真实 nodeId，不使用占位符）。
- [ ] **双边授权 `teamAuthorizations`**：Leader 侧 `{roomId, leaderKey:<A nodeId>/<A sessionId>, workerSessionId:'', workspaceRoot:<测试目录>}`；每个 Worker 侧各一项 `{roomId, leaderKey, workerSessionId:<本 Worker 会话ID>, workspaceRoot:<测试目录>}`。
- [ ] **workspaceRoot**：真实路径等于授权目录或位于其下；Worker 会话已打开且可读取；目录检查只控制插件准入，不能代替 DSH 工具权限或系统沙箱。
- [ ] **专用测试目录**：三台各自/共享的授权目录已确认不含生产数据，允许生成含 executionId 的独立结果文件。
- [ ] **`autoWake:false`**：关闭旧的普通消息自动唤醒，Team 使用自己的授权和启动许可。
- [ ] **可选参数一致性**：`teamLeaseMs`（≥1000，默认 90000）、`teamHeartbeatMs`（≥250 且 < 租约一半，默认 20000）、`teamRequestWindowMs`（正数，默认 120000）；时钟偏差超窗口会拒绝请求，记录三台时钟同步情况。
- [ ] **容量约束**：M1 每个 Worker 会话最多一个未解决执行（含 uncertain），配置/用例不与之冲突。
- [ ] **账本位置**：实例目录 `meshRootDir(...)/team.json` 为权威账本，单目录只能有一个活动写入者；损坏账本会使启用的 Team 启动失败且不静默清空，先备份再核对。
- [ ] **Room 已建立**：A 用 `lan_mesh_room_member action=create` 建项并记 roomId；B/C 各自会话 `action=join`，确认三个成员均出现在 Room。

---

## 4. 五步验收流程（照交接包，待执行）

### 步骤 ① 真实模型执行两项无副作用任务
- A 作为真实 Leader 调用 `lan_mesh_team_create roomId=<roomId>`，再 `lan_mesh_team_dispatch` 分别派发给 B、C 各一项任务（共两项）。
- 两项任务均为**无副作用**任务：各自在授权目录生成一个**含 executionId 的独立结果文件**，便于核对「每项任务、每台设备只产生一次对应副作用」。
- B/C 由**真实模型**执行，并使用 `lan_mesh_team_report` 汇报进度与 `status=succeeded` 的结果（含 summary；如需 artifacts 使用 Worker 机器本地路径，文件不会自动同步）。
- 记录每次 dispatch 返回的 executionId。派发返回信息**不代表执行已成功**（`docs/team-m1-usage.md` 第 59 行）。

### 步骤 ② 状态与磁盘核对
- 用 `lan_mesh_team_status` 逐项检查：ACK（received→acknowledged）、**start permission**（有效启动许可）、running、result、review（`succeeded` 使任务进入 review，M1 无自动验收/改 accepted 的工具）。
- 读取磁盘权威记录：每台 `team.json` 的 `tasks` / `executions` / `workerExecutions` / `outbox` / `nonces`，以及步骤 ① 生成的两个结果文件。
- 保存**脱敏证据**（不含 secret/令牌）：工具输出、`dataJson`、磁盘记录片段、必要截图。

### 步骤 ③ 故障注入（交接包 7 类；第 6 类「重启」按 Leader/Worker 拆两个子场景记录，只使用批准的测试进程与可逆网络方式；不影响其他网络或生产进程）
1. **重复 dispatch / 丢 ACK**（交接包合并为一类）：相同 executionId 重传验证事件按 seq 去重、不重复唤醒/重复副作用；Worker 保存接收记录后 ACK 丢失/延迟，验证 outbox 重传与 `status-query` 核对路径。
2. **短时断网**：可逆的短时网络中断（批准的方式），验证恢复后 outbox 重传、租约未过期时的正常续跑。
3. **超过租约离线**：离线时长超过租约，验证进入 `uncertain`、保留容量、不自动再次唤醒；过期后到达的进度/结果仅作核对证据，不直接通过验收。
4. **Worker 进程退出**：批准的测试进程退出，验证 `recover()` 将 starting/running 置 uncertain、权限清空。
5. **Leader 重启**：账本持久记录一致、`remotePending` 重传、旧启动被拒绝。
6. **Worker 重启**：账本持久记录一致、`remotePending` 重传；注意「外部进程可能继续运行，插件不能保证停止 Shell 或撤销外部副作用」。
7. **结果回传丢失**：result outbox 丢失/延迟，验证重传与 seq 去重，结果状态最终可解释。

### 步骤 ④ 每场景记录表（待填模板）

| taskId | executionId | 场景 | 预期状态 | 实际状态 | wake 次数 | 副作用次数 | 恢复动作 | 日志/持久记录（脱敏） | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 待填 | 待填 | … | … | … | … | … | … | … | 待填 |

判定纪律：
- **无法确认结果必须标 `uncertain`**，不能因等待时间长就核对放行。
- 仅在**人工确认旧执行确实停止**后，由 Leader 调用 `lan_mesh_team_reconcile executionId=<id> stopped=true reason=<人工核对原因>`；Worker 未核对的槽位仍保留、可能暂时拒绝新任务。
- **禁止自动重跑**；Leader/成员关系变化或授权撤回会停止派发，须保留账本人工处理。

### 步骤 ⑤ 缺口处理
- 缺设备、或无法按批准方式注入某类故障时，该项记 **「未验收」**。
- **不得以 localhost stub 通过代替**；不得以 `scripts/team-smoke.mjs` 的通过作为三设备验收证据。

---

## 5. 通过条件与补充证据说明

真实验收「通过」须同时满足：
1. A/B/C **真实模型**执行成功（两项任务均由真实 Worker 会话完成并 report）。
2. 异常状态可解释，且**无不明重复副作用**（含 executionId 的结果文件数量与 wake 次数可对齐）。
3. 重启/恢复后磁盘账本记录一致（tasks/executions/workerExecutions/outbox/nonces 自洽）。
4. `uncertain` 有明确人工流程（人工确认停止→reconcile→记录原因），未发生自动重跑。

**关于 `scripts/team-smoke.mjs`（仅补充自动化证据，不替代验收）**：经只读核对确认——
- 文件头注释：`/** Two real HTTP MeshNodes, two Worker sessions, stub model runtime. */`；
- 第 18 行：两个 Worker 会话 `worker-1`、`worker-2` 都建在**同一节点 `b`**；
- 第 39–40 行：`resolvePeers` 使用 `address: '127.0.0.1'`（**localhost**）；
- 第 13–15 行 `runtime(ids)` 的 `followup` 是**写入数组 stub**，不调用模型；
- `docs/team-m1-usage.md:85` 亦明确「使用两个真实 HTTP MeshNode、两个 Worker 会话及模拟 followup，不调用模型。真实 DSH 跨机器执行仍需两端启用新配置后单独验收」；
- `docs/architecture/project-workspace.md:62` 记录「`scripts/team-smoke.mjs` 明确 stub followup，使用 localhost，两 Worker 同节点；不能替代三设备验收」。

因此它只能作为 **HTTP 链路 + 状态机的补充自动化证据**，不能证明三设备、真实模型、跨机器网络与故障注入行为。`node --test scripts/team-*.test.mjs` 同理属单元/协议层证据。

---

## 6. 「场景 × 状态」矩阵（本批次全部未验收）

> 状态列一律为「未验收」。「翻成『验收通过』所需证据」列写明每项必须补齐的现场证据；未补齐即保持「未验收」。

| # | 场景 | 状态 | 翻成「验收通过」所需的具体证据 |
| --- | --- | --- | --- |
| 1 | A/B/C 三设备就位与配置（opt-in / secret / trustedPeers / 双边授权 / 测试目录） | 未验收 | 三台设备信息登记表（脱敏）、三台 `/lan-mesh/v1/info` 输出、三台 `teamEnabled/trustedPeers/teamAuthorizations` 配置截图或脱敏片段、测试目录不含生产数据的核对记录 |
| 2 | 步骤①：两项无副作用任务的真实模型执行与 report | 未验收 | A 的 create/dispatch 工具输出（含两个 executionId）、B/C 各自模型执行日志、`lan_mesh_team_report` 输出、两台各自生成的含 executionId 独立结果文件（磁盘截图/内容片段） |
| 3 | 步骤②：ACK / start permission / running / result / review 状态核对 | 未验收 | 三台 `lan_mesh_team_status` 输出快照（按阶段）、`team.json` 的 tasks/executions 片段、review 状态证据、脱敏日志 |
| 4 | 故障③-1：重复 dispatch / 丢 ACK | 未验收 | 相同 executionId 重传日志、wake 次数记录、副作用文件计数（应为 1）、事件 seq 去重的账本片段；人为丢弃/延迟 ACK 的可逆操作记录、outbox 重传日志、`status-query` 核对输出、最终状态可解释证据 |
| 5 | 故障③-2：短时断网 | 未验收 | 批准的网络中断方式与时窗记录、三台各自日志时间线、恢复后 outbox 重传证据、租约未过期续跑的输出 |
| 6 | 故障③-3：超过租约离线 | 未验收 | 离线时长与租约参数记录、`uncertain`/`blocked` 状态账本片段、无自动再次唤醒的 wake 计数、过期后到达结果仅作核对证据的说明 |
| 7 | 故障③-4：Worker 进程退出 | 未验收 | 批准的进程退出操作记录、重启后 `recover()` 置 uncertain 的账本片段、权限清空证据、三台各自输出 |
| 8 | 故障③-5：Leader 重启 | 未验收 | 重启前后账本一致性 diff（脱敏）、`remotePending` 重传日志、旧启动被拒绝证据、Leader 侧输出 |
| 9 | 故障③-6：Worker 重启 | 未验收 | 重启前后账本一致性 diff（脱敏）、`remotePending` 重传日志、Worker 侧输出、外部进程可能继续运行的风险核对记录 |
| 10 | 故障③-7：结果回传丢失 | 未验收 | 人为丢失/延迟 result 的可逆操作记录、outbox 重传与 seq 去重账本片段、最终 result/review 状态证据 |
| 11 | uncertain → 人工确认停止 → reconcile 流程 | 未验收 | 人工确认旧执行已停止的记录（含核对人）、`lan_mesh_team_reconcile stopped=true reason` 输出、账本 cancelled/reconciliation 记录、无自动重跑的证明 |
| 12 | 通过条件汇总（真实模型成功、无不明重复副作用、重启记录一致、uncertain 有人工流程） | 未验收 | 上述 1–11 全部证据齐备后的汇总核对表、三设备各自最终输出、Codex 独立复验记录 |

证据格式要求：脱敏日志、磁盘记录（`team.json` 片段）、截图、三设备各自输出；**不得包含 cluster secret 或授权令牌**。每台证据须能回溯到具体 taskId/executionId 与时间点。

---

## 7. 结论

**本批次未做任何真实设备运行。** 负责人尚未提供/确认 A/B/C 三台可用设备与授权测试目录，未进行任何真实模型执行、故障注入或 reconcile 操作；因此 M1 的**全部场景（矩阵第 1–12 项）均为「未验收」**。

本批次产出仅为可交回 Codex 审查的**准备清单**，不构成验收通过证明。`scripts/team-smoke.mjs` 与 `node --test scripts/team-*.test.mjs` 的自动化证据（如有）只能作为补充，不能替代三设备真实验收。待负责人确认设备与测试目录后，按第 3、4 节执行并逐项补齐第 6 节证据，再由 Codex 独立复验、负责人确认后方可关闭 M1。

本清单不改动协议、数据模型、权限或核心架构；如执行中发现需调整，按 `docs/development-workflow.md` 记录建议并等待负责人确认后再处理。
