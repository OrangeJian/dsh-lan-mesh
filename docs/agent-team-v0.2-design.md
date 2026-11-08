# Agent Team v0.2 架构与执行协议草案

日期：2026-11-08。状态：设计已确认，M1 源码预览已实现；本文也包含尚未实现的 M2/M3 目标。当前使用方式与限制见 [M1 使用说明](team-m1-usage.md)。

## 目标与范围

近期实现分布式 Agent Team，长期演进为多人 AI 协同开发平台。首个验收场景为两台设备、一个 Leader、两个 Worker：Leader 创建两个可并行任务，插件可靠派发，Worker 报告结果，Leader 验收并汇总。

v0.2 不实现自动选主、Git 自动合并、跨节点文件同步或任意第三方 Agent 适配。文件路径交付物仅描述所属节点上的文件，不表示 Leader 可以访问或已验证该文件。

## 现有实现与接入点

- `lib/rooms.mjs`：Room 状态版本为 1，成员身份是 nodeId/sessionId，任务状态为 open/doing/blocked/done；normalizeTask 会丢弃未知字段。
- `lib/service.mjs`：assignTask 已检查本地调用者为 Leader，先保存任务，再投递和同步；setTaskStatus 允许 Leader 或 assignee 更新进度。
- `lib/transport.mjs`：传输协议版本为 2，签名采用固定字段拼接。新执行协议不能仅向信封追加未签名字段。
- `lib/store.mjs`：持久化目录按实例端口隔离，可复用目录定位方式。

因此，新增执行数据不能直接塞进当前 Room 任务记录，也不能把 room-task 的投递成功解释为执行成功。

## 方案与选择

采用保留 Mesh、逐步增加可靠执行层的路线，已获用户同意。另一方案是一次建设完整编排器，能够更早呈现自动组队，但同时改变调度、存储、运行时和界面，故障定位成本更高。

分层职责：Mesh 负责发现及传输；Registry 提供能力和容量；Task Engine 管理任务、依赖和验收；Execution Coordinator 管理派发及恢复；Leader LLM 决定拆解、候选 Worker 和验收判断。权限、容量、依赖和状态转换由插件强制检查。

## 数据模型

新增独立的 team 状态版本 1，以 Room ID 关联现有项目。旧任务维持原语义，默认不自动迁移为可执行任务。

| 记录 | 必备字段 |
|---|---|
| Team | roomId、leaderKey、generation、revision、paused |
| AgentProfile | memberKey、capabilities、skills、maxConcurrentTasks、observedAt |
| Task | taskId、roomId、title、detail、dependsOn、requiredCapabilities、acceptanceCriteria、status、currentExecutionId、revision |
| Execution | executionId、taskId、attempt、workerKey、generation、state、leaseExpiresAt、lastEventSeq、result |
| Event | eventId、executionId、actorKey、type、seq、createdAt、payload |
| Result | summary、artifacts、checks、error |

能力声明仅用于匹配，不授予权限。在线状态和占用由插件观测及执行记录计算。依赖仅允许同一 Team 已存在任务；创建/修改计划时原子校验无环，依赖任务须已验收才可派发。

Task 状态：planned → ready → active → review → accepted；允许 blocked、failed、cancelled。只有 Leader 可验收，Worker 成功仅进入 review。验收拒绝必须记录原因，后续重做创建新的 executionId。

Execution 状态：queued → acknowledged → running → succeeded/failed/cancelled；无法确认执行结果时进入 uncertain。投递回执只记录传输事实，不推进到 acknowledged。终态不可被迟到进度覆盖。

## 权威与授权

每个 Team 使用固定 Leader，Leader 节点故障后暂停派发；v0.2 不自动故障转移。Leader 保存任务权威记录，Worker 保存本机执行账本。禁止使用 Room 的时间戳合并规则裁决执行状态。

新执行通道要求配置共享密钥和节点白名单，并由 Worker 本机显式授权 roomId、leaderKey、目标会话及允许的工作范围；授权不由远端能力声明推导。共享密钥只识别受信集群，不能提供集群内各节点的密码学隔离；本版假设白名单节点可信。成员退出或授权撤回后拒绝新执行；已有执行进入取消协调，不能声称已撤销外部副作用。

generation 是权威版本栅栏；本版只允许原 Leader 暂停/恢复，变更 Leader 需要人工完成旧执行核对后建立新 generation。旧 generation 事件保留审计，但不得改变当前任务。

Team 的 leaderKey/generation 不随 Room 状态合并自动变化。发现 Room Leader 变更、Leader 或执行成员已退出时暂停 Team，人工核对后恢复，避免存在两个调度权威。

## 跨节点执行协议

新增独立 `/lan-mesh/v1/team` 通道和 teamProtocolVersion=1；通过显式能力协商启用。旧节点继续普通消息与 Room 协作，不接收自动执行。具体 HTTP 方法及 Schema 在实施计划中固化，旧传输签名保持兼容。

请求采用版本化的固定序列化规则，认证覆盖 method、path、senderNodeId、receiverNodeId、sentAt、nonce 及完整 body 哈希。先验证大小、Schema、身份、时间窗口和授权，再处理业务。建议默认时间窗口 ±120 秒，参数可配置；偏差超限时返回明确错误，不自动放宽。

| 操作 | 发送方 | 语义 |
|---|---|---|
| dispatch | Leader | 持久化同一 executionId 的不可变执行描述，Worker 落盘后 ACK |
| start/progress/heartbeat | Worker | 显式开始、进度及续租申请 |
| result | Worker | 持久化结构化结果，重复提交返回相同确认 |
| status-query | Leader | 查询同一 executionId，恢复丢失回执 |
| cancel | Leader | 请求停止；Worker 返回实际停止状态或 uncertain |
| event-ack | Leader | 确认已持久化的 Worker 事件序号 |

ACK 只表示接收。Worker 随后申请 start 许可；Leader 持久化 running 状态与租约后返回许可，Worker 保存开始标记后才能唤醒。许可携带有效时长，Worker 从本次申请发送时起以本机单调计时计算剩余期限；响应抵达时已过期则不得启动。续租采用同样规则。重复许可申请不能扩大未获 Leader 确认的执行期限。

Worker 事件按 executionId 使用递增 seq；重复事件幂等确认，同序号不同内容拒绝，乱序要求重传缺失事件。Leader 只接受当前执行、指定 Worker、正确 generation 的合法转换。结果提交无需租约仍有效，但只进入恢复核对，不能直接覆盖已被人工处置的任务。

## 持久化、幂等与恢复

Leader 在发送前持久化 execution 和 outbox；Worker 在 ACK 前持久化 execution 接收记录。重复 dispatch 的 executionId 与内容一致时返回现有状态，不重复唤醒；内容不同返回冲突。

账本和 outbox 使用实例目录下的独立 team 存储，单写者串行提交，以同一原子快照保存关联状态。I/O 错误不发送成功确认。损坏文件使 Team 暂停并报错，不能按空状态继续调度。清理必须保留执行幂等墓碑；v0.2 默认不自动清理。

nonce 去重持久化至时间窗口结束，执行 ID 去重长期保留；网络重传使用新 nonce、相同 executionId。租约默认建议 90 秒、心跳 20 秒，以 Leader 接收时钟计算，不依赖 Worker 时钟。

租约过期只表示失去联系，进入 uncertain 并占用容量，不自动派发新 attempt。Worker 失去续租许可时不启动新工作，并尽力暂停运行；插件无法保证已经启动的 Shell 或外部操作被终止。

重启后先查询/对账：有终态则补传结果；已 ACK 但未开始可继续；运行中且无法确认宿主会话状态则 uncertain。持久化开始标记与唤醒不是原子操作，崩溃窗口内不得自动再次唤醒。人工确认旧执行停止，或任务明确允许重复执行，才可创建新 attempt。系统不承诺外部副作用 exactly-once。

## 首个里程碑及后续顺序

1. M1 可靠执行：纯状态机、授权门槛、账本/outbox、派发确认、结果和 uncertain 恢复。先显式指定 Worker，不自动匹配。
2. M2 自动编排：能力注册、容量限制、DAG、候选推荐及 Leader 工具接入。
3. M3 团队闭环：验收、拒绝重做、人工接管、审计和最小界面。

M1 即强制每个 Worker 会话最多一个未解决执行，queued、acknowledged、running、uncertain 均占用名额，由 Worker 接收端原子检查。可配置多并发及自动容量匹配留到 M2。

建议新增 `lib/team-state.mjs`、`lib/team-store.mjs`、`lib/team-protocol.mjs`、`lib/team-coordinator.mjs`；service 只负责接线，避免先做整体目录重构。

## 验收与验证

M1 必须验证重复派发只产生一次唤醒、ACK 丢失后可查询恢复、结果重传幂等、乱序事件不回退状态、重启后不盲目重跑、断网进入 uncertain、无授权请求拒绝、旧节点不执行 Team 请求，以及存储损坏时暂停。

最终演示包含两个并行任务和一个依赖两者验收的汇总任务。保存任务/执行 ID、事件记录和检查结果，证明收到、开始、成功、验收是不同事实。

保留现有 rooms、schema、panel 及双节点测试作为回归。新增纯状态机测试与隔离临时目录的双节点故障测试；真实 DSH 唤醒和跨机器验证单独记录，不以模拟测试替代。

## 评审时需要确认

本文提出的默认取舍是：固定 Leader；授权后自动执行；结果不明暂停；首个里程碑只支持显式分配。具体工具名称、Schema 字段上限和界面文案留给实施计划，不能改变上述协议语义。
