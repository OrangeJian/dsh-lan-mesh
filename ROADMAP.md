# dsh-lan-mesh 路线图

核对基线为 2026-11-21 本地提交 `3d71f9e`，插件版本 `0.4.38`。本地跟踪状态显示该分支比远端跟踪引用领先 9 个提交。

## 当前状态

- M6 已接入候选预览、批准版本、固定成果评审及可选派单工具。D6 的代码实现采用 Leader 授权范围内的远端 Worker，生产多机派单仍为 `NOT RUN`。见 [候选授权与验证边界](docs/architecture/m6-candidate-scope.md)。
- R2 已记录宿主实例和唤醒生命周期。生产宿主缺少确认后代进程退出的后端，现有回收入口会拒绝缺少证明的操作。见 [CodeBuddy 交付记录](docs/architecture/codebuddy-handoff.md)。
- UX 已完成房间文档双栏、归档确认和刷新状态等交互调整。真实 DSH 客户端和物理节点的联合验收待记录。见 [UX 改版记录](docs/ux/interaction-optimization-proposal-v1.md)。

## 接下来的开发与验收

| 优先级 | 工作 | 完成判据 |
|---|---|---|
| P0 | 防止已批准的新版本派发旧任务。当前 `dispatchPlanTask` 复用已有 taskId 时只比较 Worker，并从旧任务取标题和详情。 | 在入队事务中绑定经批准的规格。覆盖同 ID 更新标题、详情和依赖、与已有任务冲突及拒绝后重做；拒绝时 outbox 无新增。 |
| P0 | 为候选发布提交建立统一验证记录。 | 在同一 SHA 跑全量测试、客户端构建检查、面板、schema 和 Team HTTP smoke。记录实际命令、退出状态及环境限制。 |
| P1 | DSH 真机和多节点验收。P0 通过后在隔离 Room 手动开关 M6。 | 验证发现、批准、派单、成果确认、撤权、断连恢复及重放，记录设备、版本和结果；尚未运行的用例保留 `NOT RUN`。 |
| P1 | R2 接入宿主后代进程退出证明，可与 M6 真机准备并行。 | 对当前执行及其后代确认退出；补进程未退出、身份不符、证明撤回及宿主重启测试，再用专用临时工作树验证回收。 |
| P2 | 整理发布说明及升级回滚步骤。 | 真机结果齐备后决定发布范围，记录 M6 开关和旧账本升级行为。 |

## 文档入口

- 产品与安装：[插件指南](docs/plugin-guide.md)、[离线安装和升级](docs/offline-install-and-upgrade.md)。
- 当前设计：[M6 接入顺序](docs/architecture/m6-integration-sequence.md)、[房间契约](docs/rooms-contract.md)、[面板契约](docs/ui-contract.md)。
- 工程验证：[开发流程](docs/development-workflow.md)、[多设备验收用例](docs/handoffs/m1-three-device-acceptance.md)。
- 历史资料：[文档归档索引](docs/archive/README.md)。
