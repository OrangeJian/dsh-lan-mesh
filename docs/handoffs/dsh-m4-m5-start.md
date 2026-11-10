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

## 团队并行执行方案（负责人追加授权）

请开启开发团队加速，不要把所有任务仍交给一个 Agent 顺序执行。建议 1 名 Leader/集成者 + 3 名实施者；有更多席位也不必全部占满。下面的并行关系优先于旧计划中逐任务串行的执行建议，但不改变业务、权限和验收约束。

### 起步：Leader 先冻结最小接口

Leader 核对现状后，先用一份短接口契约固定 ID/状态/actor、proposal/revision/audit 形状、错误码、大小限额、store 事务入口、Coordinator 方法及 panel DTO。落到受版本管理的 `docs/shared-doc-interfaces.md`。各实施者确认接口后立刻开工，不必等完整业务实现。

接口冻结不要求把所有实现预写出来。重要变更由 Leader 裁定并更新契约，通知受影响成员；不能让各人独立发明不兼容字段。给每人一份短任务说明：目标、依赖、独占文件、接口版本、测试、交付条件；不复制整段聊天历史。

### 波次 A：三条真正独立的基础工作并行

| 成员 | 工作 | 独占文件 | 可并行原因 |
|---|---|---|---|
| A 状态模型 | core Task1：实体、纯状态转换、权限/幂等/审计字段验证 | `lib/shared-doc-state.mjs`、`scripts/shared-doc-state.test.mjs` | 不依赖磁盘、网络、UI |
| B 合并算法 | core Task2：行级 diff3、patch、冲突与确定性 | `lib/shared-doc-merge.mjs`、`scripts/shared-doc-merge.test.mjs` | 只依赖冻结的字符串输入输出，不等待状态实现 |
| C 文档界面 | ui-context Task1–3：列表、编辑/diff/历史、冲突提案/确认界面 | 建议独立 `client/shared-documents.js` 或符合现有加载方式的专用模块及独立 UI 测试 | 消费冻结的 DTO/RPC adapter；用测试 fixture 开发，不等待服务上线 |

Leader 同时负责 package.json/锁文件中的 diff 依赖、官方公开组件可用性、最小加载接线和真实验收脚本框架。若现有浏览器加载方式不能直接拆模块，先确定一个可用的模块接线方式；不要让 C 单方面引入运行时无法加载的模块。不要为了并行大规模重构整个 client.js。

### 波次 B：按接口就绪解锁，不等整波结束

- A 的状态接口稳定后，A 继续 core Task3 原子 store/重建与故障测试。
- 协议 DTO 和状态校验器就绪、B 的合并模块交付后，B 负责 core Task4 独立签名协议及协议测试。协议模块通过回调依赖 coordinator，可先用受控服务实现验证；最终必须接真实 store/coordinator 验收。
- C 继续完整界面与状态/权限/草稿测试；待接口可用逐步换真实 adapter，不把 fixture 当最终交付。
- Leader 在状态/store/merge API 可用后负责 core Task5 coordinator，以及 core Task6 中 Host 身份、service/index/transport 的统一接线。协议与 store 的后续独立测试仍可并行。

### 波次 C：M4 集成与 M5 纯上下文并行

- M4 文档版本读取 API 稳定后，释放出来的实施者可先做 `lib/room-context.mjs` 和独立测试：版本/hash 固定、显式决策、限额、截断、引用及投递记录形状。不改 service/Team 共享文件，不宣称 M5 已接通。
- 另一名实施者做 Markdown 导入导出的独立校验/转换模块及测试；Host 路径授权与端点由 Leader 集成，UI 接入口由 C 处理。
- C 完成 M4 的真实 adapter 接入与界面回归。Leader 合入 M4、跑真实多节点 shared-doc smoke 后，再把纯 Context Pack 接入 mentions/任务/Team 投递和持久审计。
- 如有空闲席位，可做只读需求/权限/恢复审查，不得再组织第二套重复实现或反复跑完整套件。

### 文件所有权与合入规则

- `lib/service.mjs`、`index.js`、`lib/transport.mjs`、`lib/team-coordinator.mjs`、package.json/锁文件、ROADMAP、正式回执只由 Leader 改；实施者提交接口调用需求/补丁建议。`client.js` 的具体所有权由 Leader 与 C 开始前约定，任一时刻只能一人写。
- 测试也按文件独占，避免多人同时修改 panel-check/schema-check。独立测试各自运行；统一 harness 接线由 Leader 在合入点完成。
- 优先每人独立 worktree/分支，Leader 顺序合入；若 DSH 团队共用工作区，则严格按文件分工，Git stage/commit/push 只由 Leader 执行，禁止成员各自 `git add .` 混入别人的半成品。
- 合入必须包含实现、有效回归、实际测试结果及限制；仅有 mock/UI fixture 不算端到端完成。模块相关测试由实施者跑，Leader 在接口/阶段合入点运行完整套件，不让每个成员重复全量验证。
- 共享集成测试使用各自临时目录和独立端口；需要同一组固定端口或同一真实 Host 的测试串行运行，避免残留进程与端口占用造成假失败。
- 独立模块准备好就交付，不等其他成员；失败修复交原负责人，Leader 持续推进不受影响的分支。禁止嵌套无限开团队；成员不自行再派团队。

### 不能并行跳过的门槛

状态/协议契约未定，不能各自编写权威规则；store 事务语义未稳，不能宣称 coordinator 持久化可靠；权限/版本未接真实服务，不能验收 UI；M4 修订历史不可读，不能验收 M5 的版本固定投递；有共享文件或真实测试环境冲突时必须串行。

最终回执增加团队分工、接口版本、各模块提交及合入点，说明哪些工作并行、哪些因依赖串行。目标是缩短等待和重复劳动，不以 Agent 数量或运行时长作为成果。
