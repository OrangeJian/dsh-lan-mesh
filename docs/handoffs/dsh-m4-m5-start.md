# DSH 下一批启动说明：M4 共享文档 → M5 项目上下文

2026-11-11，负责人授权开启后续阶段。本文件取代旧交接稿中“先完成 M3 整改”“本轮仅 M3”的启动顺序；旧问题清单保留为历史回归资料，不要重复实施已完成修复。

## 基线和范围

- 分支 `codex/room-collaboration`，业务基线 `8bbeb6f`。此前 `04e579e` 修复清单引用、分页对账、响应边界、Agent 身份回填；`8bbeb6f` 修复人类查看房间时普通 Agent 回复仍未读。
- 基线验证：`04e579e` 完整自动化 202/202、panel167/167；`8bbeb6f` inbox专项4/4、panel167/167。后者没有重跑完整套件；本轮先建立实际基线。浏览器及物理设备验收仍由负责人执行，不冒充已通过。
- 本批完整实现 M4，再实现 M5，然后交 Codex 复核。房间生命周期及 M6 先保留现有方案，不混入本批；这不是它们已获最终设计验收的声明。
- 已有授权内的局部实现、契约新增、测试及提交自主推进，更新契约后实现，不必每完成一个模块重复请求确认。真正无法由既定规则裁定的重大权限/协议歧义记录阻塞，同时继续独立工作。

## 先读这些文件

1. AGENTS.md（如存在）、ROADMAP.md、docs/architecture/project-workspace.md。
2. docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md。
3. docs/superpowers/plans/2026-11-08-shared-documents-core.md。
4. docs/superpowers/plans/2026-11-08-shared-documents-ui-context.md。
5. docs/ui-contract.md、docs/development-room-composer-compat.md、docs/development-workflow.md。
6. docs/handoffs/2026-11-11-m3-boundary-fixes.md 与现有代码，用于了解最新 M3 边界；不要仅相信旧交接状态。

执行顺序：shared-documents-core 全部任务 → ui-context 的文档列表/编辑/历史/冲突界面 → Markdown导入导出 → 版本固定的 Context Pack 与投递审计 → 整体交付。旧计划中的 M1 字样指文档功能首版时，不能误认作 Agent Team M1。按当前代码调整接口接线，不能机械照抄旧行号。

## M4 必须实现的结果

- 多人/跨系统共同修改澄清和设计 Markdown 文档，提供列表、创建、阅读、编辑、diff、历史、归档及冲突界面；不能后端做完就称阶段完成。
- 纯状态模型、确定性行级三方合并、原子存储、独立签名同步和服务协调都要有实现。使用计划规定的 diff 依赖；版本或接口如已变化，先核对正式公开接口，不引入未验证私有路径。
- 无冲突自动提交；过期 base 的非重叠编辑可合并，真正冲突才确认。不能覆盖 head 或把冲突标记当成功文本。
- 所有人类成员都能提出解决方案；只有 Leader/文档维护者确认冲突，Agent 可提案但不能确认。权限由 Host/协议实际身份绑定，不能信任 payload.actor/sessionId 自报人类。
- 正常无冲突提案不增加逐次人工审批。文档维护授权与 Team 执行授权分开，不扩大其他节点工作范围。
- 每次操作保留作者、节点、base、提交说明、proposalId、revision、审计及关联任务。恢复历史产生新提案/修订，不改写过去。
- Leader 对 canonical revision 排序，generation+seq 而非墙钟；revision/event/head/幂等/outbox 同一原子提交。同检查点不同 hash 暂停并报错，不静默取最新。
- 离线提案保留，同 proposalId 重试，改变内容不能复用同 ID。任何网络等待不占用接收端所需事务队列，所有元数据写入走统一串行入口。
- 人类界面保存失败保留草稿；历史只读；导入须显式选择并留审计，导出不覆盖未授权文件。不自动双向同步磁盘或 Git。

## M5 必须实现的结果

- 有界 Context Pack：显式选择的文档版本、明确标记的决策/未决问题、相关消息及附件/技能引用。不复制完整聊天，不靠猜测形成“已确认决策”。
- 每个文档项固定 revisionId+hash，记录哪个 Agent 实际收到哪些版本；head 变化不能改写已投递记录。
- 确定性限额与截断，超量给授权工具读取入口。历史版本、归档文档及附件不可达时状态明确。
- 接入 @ 与任务派发，保留精确成员引用、机器消歧和技能仅提示语义，不扩大执行权限；不把上下文送达当成任务完成。
- 回归 M3 图片/文件、迟到成员、分页/大小限制、丢 ACK、已读计数和草稿；保留 Team uncertain 的人工对账约束，不自动新建 attempt 重跑。

## 测试和提交

- 每项新行为先写有效失败回归再实现；记录实际命令、退出码、首次失败与修正。不要为凑数字增加源码字符串断言。
- 覆盖同内容幂等/不同内容冲突、真实并发、丢 ACK、重启、损坏状态、写入失败、越权、分页与大小上限、旧协议及无冲突/冲突合并。
- 完成每个可审查模块就提交。新协议先更新 docs/rooms-contract.md / ui-contract.md，再接线；版本/完整签名/目标/时间/nonce/边界与恢复规则明确。
- 运行 npm test、panel/schema/compat/twin、rooms/attachment/Team相关smoke，以及计划中的 shared-docs/context smoke。schema validator 从真实安装定位，不把本机路径写入产品。
- localhost/stub/harness 与真实浏览器/多物理设备分开记录。用户自行操作浏览器，不要重载其浏览器、伪造截图或修改网络配置。
- 保留开发分支、工作区和历史；不 reset/clean/force push、不合并 main、不发布 npm。普通阶段提交并推送当前开发分支；不能因单项外部验收阻塞而停止其余已授权实现。
- 更新 ROADMAP、usage、契约及正式回执，关键记录不能只保存在被忽略的临时目录。

## 最终交回

创建 `docs/handoffs/dsh-m4-m5-development-report.md`：base/head、每个阶段的代码/界面/测试对应、协议与迁移说明、失败记录、实际验证、未实现项及剩余限制。给出明确复核命令，区分已实现自动化通过、待用户实机、设计未实现和外部阻塞。

M4/M5 完成后停止，交 Codex 独立复核；不要自动开始生命周期或 M6。不要用“运行很久”或测试数量代替完成条件。
