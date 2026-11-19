# M6 候选授权范围裁定（D6 落地）

> 日期：2026-11-19。基线 `0ab0852`（origin/codex/ux-workbench）。本文记录 handoff 第 1 项「M6 候选数据」中 D6 待决项的实现裁定与接线方式；以当前代码为准。

## 裁定内容

D6（自动调度「本机已授权范围」的精确定义）按交接决策落地为解释 (a)：**「本机」指 Leader 侧授权集，派单仍只走远端 Worker**。`teamAuthorizations` 的两半用途不同，永不混用：

| 数据 | 归属 | 用途 | 是否进入候选集 |
|---|---|---|---|
| Leader 空会话授权（`workerSessionId: ''`，匹配 roomId+leaderKey，workspaceRoot 为绝对路径） | Leader 节点配置 | 本节点对本 Room 的编排授权，即 D6 的授权门 | 是——缺失时授权集为空，所有候选按 `UNAUTHORIZED` 排除（fail closed） |
| Worker 精确会话授权（`workerSessionId` 精确匹配 + workspaceRoot realpath 校验） | Worker 节点配置 | Worker 侧派单准入（`#authorizeTeam`，未改动） | 否——永不枚举、永不复制进候选数据 |
| 能力声明（`teamCapabilities` 宿主配置） | Leader 节点配置 | 仅匹配（`requiredCapabilities ⊆ capabilities`），绝不授权 | 只作为 `profiles` 输入 |
| 容量 | Team 账本执行快照 | M1 单槽规则不变，`uncertain` 占槽 | 由 `filterWorkerCandidates` 现算 |

实现入口：`lib/m6-candidate-authority.mjs`（纯函数 `deriveCandidateAuthority`）。授权集 = 当前 Room 成员 ∩ 远端（nodeId ≠ 本节点）∩ trustedPeers，且必须存在当前 Leader 空会话授权；能力声明不参与该集合。

## 接线点

1. **预览**：`index.js` `createM6PlanEntry.preview` 在读取账本快照后从当前宿主数据派生候选授权，传入 `previewPlanOrchestration`。此前 preview 不传 `authorizations/profiles`，候选过滤全部以 `CANDIDATE_FILTER_FAILED` 呈现；现在能给出真实的 `recommended/excluded`（含排除原因）。派生失败 fail closed（全部 `UNAUTHORIZED`）。
2. **调度**：`TeamCoordinator.dispatchPlanTask`（`lib/team-coordinator.mjs`）在**同一个 `store.transact`** 内重读：批准版本（planId/revision/fingerprint，来自账本 `verifyPlanRecord`）、approval 记录、Team 代次、依赖门禁（`validatePlanDeps` 对当前任务快照）、当前授权与能力（`candidateAuthority` delegate，事务内调用，缺失即 `CANDIDATES_UNAVAILABLE`）、M1 容量（reducer `queue` 原检查）。通过后进入**既有**执行链路（create-task + queue + outbox dispatch，新 executionId）。Worker 侧准入未改。
3. **reducer**：`create-task` 放开 `dependsOn`（同 Room 已存在任务、无自引用/重复、全图无环）；依赖未全 `accepted` 时任务置 `planned`，`queue` 硬门禁 `DEPENDENCY_NOT_ACCEPTED`。`accepted` 仅由 M6 成果评审账本产生（不变）。未加 `mark-ready`：依赖验收后 `planned` 任务可直接入队（与 reducer `queue` 不检查 status 的既有事实一致）。`lib/team-store.mjs` validate 同步允许非空 `dependsOn` 并在加载时复检引用与无环；旧账本（dependsOn 全空）加缺省兼容，不变。
4. **工具/配置**：`teamPlanScheduling`（默认 false）+ `teamCapabilities` 新配置键；`lan_mesh_team_schedule` 工具仅在 `teamEnabled` 且 `teamPlanScheduling` 开启时注册。显式派单 `lan_mesh_team_dispatch` 不受影响。

## 证据边界

- 隔离环境（本地临时目录账本 + stub send/wake）已覆盖：批准绑定、代次/修订/指纹栅栏、依赖门禁、撤权（事务内重读）、能力不匹配、容量（含 uncertain）、重放/重复调度、租约过期→uncertain→人工 reconcile→新 executionId 重做、账本重开校验。见 `scripts/team-m6-schedule.test.mjs`、`scripts/team-state-deps.test.mjs`、`scripts/m6-candidate-authority.test.mjs`。
- 真实派单启用、多机发现与恢复、双机验收仍按 [m6-integration-sequence.md](m6-integration-sequence.md) 记为 `NOT RUN`。
