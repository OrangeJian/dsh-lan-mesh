# Agent Team M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为显式指定 Worker 的任务提供持久化派发、启动许可、结果收集和不确定状态恢复。

**Architecture:** 保留现有 Room 和传输协议，新增独立 Team 状态及认证通道。Leader 管理任务权威记录，Worker 保留执行账本；网络重传不会创建新执行。

**Tech Stack:** Node.js >=22.19、ES modules、node:test、Node 内置 crypto/http/fs；不新增运行时依赖。

**Spec:** `docs/agent-team-v0.2-design.md`（已获用户确认）

**执行记录：** M1 源码预览已实现，验证与评审修复见 [执行记录](agent-team-m1-progress.md)。开发分支为 `codex/agent-team-m1`，实际提交状态以 Git 历史为准；尚未发布正式版本。

## Global Constraints

- Team 状态版本 1，teamProtocolVersion=1；不改变旧 Room 状态版本 1 和旧传输协议版本 2。
- 固定 Leader；Room 权威或成员关系不一致时暂停 Team。
- 新执行要求共享密钥、节点白名单、本机显式授权，默认关闭。
- 租约 90 秒、心跳 20 秒、请求时间窗口 ±120 秒；允许配置，但必须验证取值。
- 每个 Worker 会话最多一个未解决执行；uncertain 继续占用容量。
- 不自动重试 uncertain，不声称外部副作用 exactly-once，不迁移旧任务为自动执行任务。
- 本计划仅覆盖 M1；自动匹配、DAG 调度与完整验收界面归 M2/M3。

## Review Focus

- ACK 后崩溃：恢复后不能重复唤醒，由 Task 4 的开始标记崩溃测试覆盖。
- 磁盘损坏或写失败：不得按空账本启动，由 Task 2 故障测试覆盖。
- 同一身份并发请求：不能绕过容量与 nonce 检查，由 Task 3/4 并发测试覆盖。
- 迟到结果与重复事件：不得回退状态，由 Task 1/4 序号和恢复测试覆盖。
- Room 变更或授权撤销：不能继续派发，由 Task 5 集成测试覆盖。

## 文件边界

| 文件 | 职责 |
|---|---|
| lib/team-state.mjs | 纯状态转换、身份/版本/序号校验 |
| lib/team-store.mjs | 串行原子快照，账本、outbox、nonce 持久化 |
| lib/team-protocol.mjs | 请求 Schema、认证、序列化及 HTTP 请求适配 |
| lib/team-coordinator.mjs | Leader/Worker 协调、许可、重传、恢复与计时 |
| lib/service.mjs、lib/transport.mjs | 生命周期和独立路由接线 |
| index.js | 默认关闭的配置、RPC 与 Agent 工具注册 |
| scripts/team-*.test.mjs | 纯函数、持久化、认证及故障集成测试 |

### Task 1: 纯状态机

**Files:** Create `lib/team-state.mjs`, `scripts/team-state.test.mjs`.

**Interfaces:** `emptyTeamState() -> object`; `applyTeamCommand(state, command, {now, id}) -> {state, value}`。返回新状态，不修改输入；command.type 为 create-team/create-task/queue/ack/start/progress/result/expire/cancel/reconcile/pause。错误携带稳定 code。

- [x] 写测试：ack 不等于 running；result(succeeded) 只使 Task 进入 review；相同 seq 相同内容幂等，不同内容拒绝；终态拒绝进度回退；错误 actor/generation 拒绝。
- [x] 运行 `node --test scripts/team-state.test.mjs`，确认因缺少实现失败。
- [x] 实现上述接口。Execution 包含规范规定字段；任务先支持显式分配，拒绝非空 dependsOn，避免 M1 暗示已有依赖调度。校验 ID、字符串上限及合法状态转换。
- [x] 增加 expire→uncertain、人工 reconcile 后方可新 attempt 的断言，运行同一命令全部通过。
- [ ] 检查 diff，形成独立提交（仅在执行环境允许写 Git 元数据时）。

### Task 2: 持久化事务

**Files:** Create `lib/team-store.mjs`, `scripts/team-store.test.mjs`.

**Interfaces:** `openTeamStore({directory}) -> Promise<store>`；`store.read() -> snapshot`；`store.transact(fn) -> Promise<value>`，fn 接收隔离快照并返回 `{state,value}`。复用 meshRootDir 的实例隔离，生产存储文件 `team.json`。

- [x] 写临时目录测试：重启保留执行/outbox/nonce；并发事务不丢更新；损坏 JSON 报错；不存在文件才允许新建空状态。
- [x] 运行 `node --test scripts/team-store.test.mjs` 确认失败。
- [x] 实现单写者队列、同目录临时文件、文件同步后 rename；事务失败不得改变内存快照或返回成功，错误保留诊断信息。文档明确平台掉电持久性边界。
- [x] 用可注入文件 I/O 故障验证写入/rename 失败；运行测试通过并检查临时文件处理。
- [ ] 检查 diff，形成独立提交。

### Task 3: 独立认证协议

**Files:** Create `lib/team-protocol.mjs`, `scripts/team-protocol.test.mjs`.

**Interfaces:** `encodeTeamRequest({operation,body,identity,target,secret,now,nonce}) -> {headers,bytes}`；`verifyTeamRequest({method,path,headers,bytes,policy,now,store}) -> Promise<request>`；`sendTeamRequest({peer,request,signal}) -> Promise<response>`。

- [x] 写测试：篡改 body/path/目标节点失败；缺密钥/白名单/授权拒绝；±120 秒边界；重复 nonce 在重启后仍拒绝；并发同 nonce 仅一条通过。
- [x] 运行 `node --test scripts/team-protocol.test.mjs` 确认失败。
- [x] 使用 POST `/lan-mesh/v1/team`，固定 UTF-8 JSON 请求字节及 SHA-256 body 哈希；签名包含 method/path/sender/receiver/sentAt/nonce/bodyHash，字段采用 JSON 数组编码避免换行歧义。严格验证 body.operation 与 actor，完整 body 上限 256 KiB；nonce 校验和插入由 Task 2 同一事务完成。
- [x] 返回统一 `{teamProtocolVersion:1,ok,value}` 或 `{teamProtocolVersion:1,ok:false,error:{code,message}}`；能力不匹配返回 UNSUPPORTED，不回落为 room-task 执行。
- [x] 测试超大/无效 JSON、错误版本及超时，运行测试全部通过并检查 diff。

### Task 4: 执行协调器

**Files:** Create `lib/team-coordinator.mjs`, `scripts/team-coordinator.test.mjs`.

**Interfaces:** `new TeamCoordinator({store,clock,send,wake,authorize,getRoom})`；方法 `dispatch(input)`, `handle(request)`, `tick()`, `recover()`, `close()` 均返回 Promise。clock 提供 wallNow 和 monotonicNow；wake 接收 executionId、sessionId 和任务正文。

- [x] 写测试：重复 dispatch 只落一个执行；接收落盘后才 ACK；持久化 outbox 后才发送；同会话并发派发只接受一个。
- [x] 运行 `node --test scripts/team-coordinator.test.mjs` 确认失败。
- [x] 接入 Task 1–3。Worker ACK 后申请 start；Leader 落盘许可，Worker 按申请起点单调时钟扣减响应耗时，过期不唤醒。保存开始标记后调用 wake；该窗口内崩溃恢复进入 uncertain。
- [x] 写故障测试：丢 ACK 用 status-query 恢复；丢结果确认重传；乱序事件补传；断网过租约 uncertain；许可迟到不启动；重复 start 不延长未经确认的期限。
- [x] 实现每执行事件 seq 和 event-ack、持久化重传、20 秒心跳和 90 秒租约；旧执行迟到结果留审计并进入核对，不覆盖人工决定。取消失败或运行状态无法证实时进入 uncertain。
- [x] 加入进程重启、唤醒失败、存储写失败测试；运行四组 Team 测试全部通过并检查 diff。

### Task 5: 服务、工具和配置接入

**Files:** Modify `lib/service.mjs`, `lib/transport.mjs`, `index.js`, `README.md`, `docs/usage.md`; Create `scripts/team-service.test.mjs`.

**Interfaces:** 服务暴露 `teamCreate`, `teamDispatch`, `teamStatus`, `teamReport`, `teamReconcile`；工具分别为 `lan_mesh_team_create/dispatch/status/report/reconcile`。所有接口由宿主上下文绑定本机会话身份，不接受请求自报本机调用者。

- [x] 阅读现有 Schema/RPC/工具注入和 stop 生命周期；写测试固定默认关闭、旧节点拒绝自动执行、授权撤回和 Room 变更暂停。
- [x] 运行 `node --test scripts/team-service.test.mjs` 确认失败。
- [x] 新配置 `teamEnabled:false`、`teamAuthorizations:[]`；授权项固定 roomId、leaderKey、workerSessionId、workspaceRoot。工作范围为插件准入及提示约束，不能声称已提供宿主工具沙箱。执行仍受 DSH 自身权限约束。
- [x] 将独立路由交给 Task 3，启动时先 recover 后开启调度；停止时清理 timer/请求并刷新事务。能力响应仅启用时声明 teamProtocolVersion=1。
- [x] 工具支持显式进度及结构化结果；reconcile 仅 Leader 可调用，要求核对原因和已确认旧执行停止的标记。工具成功完成不得自动声称已通过验收。
- [x] 文档给出配置、授权、两机操作和 uncertain 处置说明；运行集成测试和现有 Schema 检查通过。

### Task 6: 双节点故障验收及交付

**Files:** Create `scripts/team-smoke.mjs`; update this plan and `docs/agent-team-v0.2-design.md` implementation status.

- [x] 使用独立临时目录和回环端口构建两个真实 HTTP 节点、一个 Leader 与两个 Worker 会话；注入可计数 wake，禁止写真实 DSH_HOME。
- [ ] 实测两项并行任务、结果提交及 review 状态；注入 ACK 丢失、断网、重启、重复派发，断言没有额外 wake，账本可解释每次状态变化。DAG 汇总任务保留给 M2/M3 验收。
- [x] 运行 `node scripts/team-smoke.mjs`、`node --test scripts/team-*.test.mjs`、`node --test scripts/rooms.test.mjs scripts/notify.test.mjs`、`node scripts/schema-check.mjs`、`node scripts/panel-check.mjs`。读取其他 smoke 脚本的运行前提，再执行适用的隔离回归。
- [x] 对修改的 JS/MJS 执行 `node --check`，运行 `git diff --check`；确认无未清理监听器、timer 或测试目录。
- [x] 最终代码评审，修复阻碍问题；报告实际通过数量和未验证范围。真实 DSH/跨机器条件不足时明确未验证，不将模拟 wake 作为真实执行证据。

## 自审记录

M1 的授权、持久化、幂等、租约、恢复、取消、显式工具和兼容性均有对应任务。DAG、自动匹配及 Leader 验收工具明确留至 M2/M3；两 Worker 并行可在 M1 验证，完整三任务闭环在后续里程碑验证。具体 HTTP/状态机 Schema 在对应实现中由测试固定，不改动既定权限及重试语义。
