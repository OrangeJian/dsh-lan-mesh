# dsh-lan-mesh 开发交接

## 接手基线

- 集成与后续开发使用 `origin/codex/ux-workbench`。已验证代码基线为 `534f5d7`，插件版本为 `0.4.38`。从远端分支最新提交开始，其中包含本文。
- 已验收交付以 cherry-pick 或合并提交进入集成分支，原工作树分支可能仍显示未合并。以集成分支的文件和测试为准，避免重复搬运原提交。
- `room-collaboration` 等并行工作树有独立开发。当前工作树里的五份未跟踪架构稿也属于本机资料，接手时保留。本文与提交历史足以定位本批交付。

## 已集成

| 范围 | 已交付 | 关键入口 |
|---|---|---|
| M6 计划 | 依赖图、候选筛选函数、计划与批准账本、Owner 草稿提交和按确切版本批准、只读依赖预览 | `lib/m6-plan-dag.mjs`、`lib/m6-worker-candidates.mjs`、`lib/m6-plan-service.mjs`、`index.js`、`ui/tasks/owner-plan-panel.mjs` |
| M6 成果 | 执行 ID 与结果哈希绑定，Owner 对当前代次成果接受或附原因驳回，记录可重放 | `lib/m6-review-ledger.mjs`、`lib/m6-result-review.mjs`、`ui/tasks/owner-result-panel.mjs` |
| R2 | 固定基准工作树准备，账本归属、显式回收、中断恢复、移除前复核授权和宿主证明 | `lib/runner-workspace.mjs`、`lib/runner-resources.mjs`、`lib/runner-reclaim-evidence.mjs` |
| 回归与 UX | Windows 短暂占用时有限重试原子替换，附件传输回归使用确定的节点地址，A10/A11/A12 补充状态展示证据 | `lib/atomic-replace.mjs`、`scripts/room-attachment-sync.test.mjs`、`docs/ux/` |

## 继续开发

1. **M6 候选数据**。已完成（见下批交付记录）。D6 裁定与接线见 [M6 候选授权范围](m6-candidate-scope.md)。
2. **M6 派单接入**。隔离环境验证已完成（`scripts/team-m6-schedule.test.mjs`）；真实派单启用和多机验收依照 [M6 接入顺序](m6-integration-sequence.md) 仍为 `NOT RUN`。
3. **R2 宿主停止证明**。运行实例身份、唤醒生命周期证据与真实 `readStopProof` 源已接入（`lib/host-stop-evidence.mjs`，wake 路径记录 start/end）；**后代进程确认后端仍缺**，无后端时所有停止证明拒绝（fail closed），回收依旧不会被放行。会话空闲、缺席和归档仍仅可用于诊断。
4. **集中验收**。开发批次完成后跑全量回归、客户端构建一致性和面板验证。DSH 真机、双机发现与恢复、真实派单与回收继续记为 `NOT RUN`，交付时附设备、步骤和确切提交。

## 本批交付（CodeBuddy，基于 0ab0852）

| 范围 | 交付 | 关键入口 |
|---|---|---|
| M6 候选授权 | D6 裁定落地：Leader 空会话授权=本机范围，Worker 精确会话授权仍为派单准入；能力声明仅匹配 | `lib/m6-candidate-authority.mjs`、`index.js`（preview 接线、`teamPlanScheduling`/`teamCapabilities` 配置） |
| M6 派单接入 | Coordinator 单事务重读批准版本/指纹/代次/依赖/授权/容量后进入既有执行链路；reducer 支持 dependsOn 与 `DEPENDENCY_NOT_ACCEPTED`；`lan_mesh_team_schedule` opt-in 工具 | `lib/team-coordinator.mjs` `dispatchPlanTask`、`lib/team-state.mjs`、`lib/team-store.mjs`、`lib/team-tools.mjs` |
| R2 停止证明 | 进程级运行实例身份 + 唤醒生命周期记录 + 真实 stop-proof 源；后代进程确认留 Owner 后端（缺失即拒绝） | `lib/host-stop-evidence.mjs`、`lib/service.mjs`（`hostInstance`、`teamStopEvidence`、wake 记录） |
| 回归 | 新增 34 项测试；全量 `npm test` 799/799、panel 286/286、schema 82/82、composer 兼容、twin transport、Team HTTP smoke、client build 一致性均通过 | `scripts/m6-candidate-authority.test.mjs`、`scripts/team-state-deps.test.mjs`、`scripts/team-m6-schedule.test.mjs`、`scripts/host-stop-evidence.test.mjs` |

## 验证

- `534f5d7` 上 `npm test` 为 765/765。最近一次 UI 集成已通过 `npm run check:client-build`，较早的面板基线通过 `node scripts/panel-check.mjs` 的 286/286 断言。
- 修改前端源码后用 `npm run build:client` 更新 `client.js`，提交时同时带上源码和生成产物。
- 设计依据见 [M6 设计与待决项](../superpowers/plans/2026-11-10-agent-team-m6-plan.md) 和 [宿主身份验证结果](m6-host-approval-identity-report.md)。设计文档中的历史实现状态以当前代码为准。
