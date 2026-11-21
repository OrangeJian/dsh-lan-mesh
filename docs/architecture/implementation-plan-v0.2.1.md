# 冻结架构 V0.2.1 分批实施与接单计划

日期2026-11-17。依据architecture-freeze-v0.2.1.md。状态：计划草案，等待DSH上一批交付检查后裁定实际下一批；不派发任务、不启动M6、不覆盖正在开发的工作。本文接口为拟定契约，不表示已实现或已经核实Host能力。

## 一、接单前置：先验收上一批，再选任务

DSH交付应提供：代码SHA、记录SHA、实际版本、工作目录/分支、与上一基线diff、测试命令/退出码、原始证据位置、未完成/失败/NOT RUN、保护清单。不要仅凭“已完成”文字接续开发。

主审检查：
1. 核对最新HEAD及脏工作树，不假定仍是384f9d6；当前未提交修改不是本轮允许覆盖的成果。
2. 自动已读必须覆盖“第一批失败第二批成功”“第一批成功第二批失败”“显式与自动交错”“close立即重启”，同时核对内存/磁盘/徽标；第二批包含旧批的记录不能仅清pending而遗漏内存同步。
3. 新生成器确实从当前组件/CSS生成；窄窗口与宽窗口窄主区分开，断言几何而非仅截图存在。
4. 回归、SDK安装位置/版本、保护文件及版本号检查。截图不是实机证据；未跑真实DSH/双机仍NOT RUN。
5. 有重要回归先开R0修复批，不将旧问题带入Registry或M6。若仅剩物理环境未验证，可并行只读契约研究，不开启真实新调度。

## 二、批次与依赖门禁

| 批次 | 范围及产物 | 开始条件 | 退出条件 |
|---|---|---|---|
| R0 既有交付复核 | 修复遗留一致性/构建/取证问题；更新UX验收矩阵 | 收到DSH实际提交 | 重要缺陷闭环；各验收明确PASS/FAIL/NOT RUN |
| C0 契约与能力探针 | 身份映射、Host身份来源、多Host/Workspace生命周期、Owner只读字段、Runner能力报告；不执行真实任务 | 上批代码状态清晰，可独立进行只读核查 | 接口与权限矩阵可审阅；不支持项明确，未知能力不默认支持 |
| G2 固定引用验收 | 独立盘点0.4.5 executionId+resultHash成果引用、读取授权与重放 | 保护原工作，选定受审候选提交 | 哈希固定、权限隔离、失败/旧版本回归有证据；不直接搬入脏文件 |
| I1 最小Registry/Binding | 稳定AgentDefinition与本地WorkspaceBinding存储、版本冲突、旧Session映射；不自动派单 | C0对应契约确认、R0阻塞关闭；独立派发实施范围 | 身份稳定、兼容旧数据、不广播敏感信息、撤销立即生效 |
| R1 Session Runner适配 | 封装现有执行路径，接既有Execution；先只读/无代码写入探针 | I1所需映射及Runner契约确认，既有M1门禁保留 | 重复调用/ACK丢失/Host重启不盲目重启；状态与证据可核对 |
| R2 隔离与恢复验证 | 独立目录/Worktree、资源归属、cancel/collect/release；Headless仅能力验证 | R1稳定，可信仓库和明确测试权限 | 隔离实际有效、脏工作不被覆盖、未知进程不释放、不重复副作用 |
| O1 Owner只读投影/UI | 人类可管理Room/Team必要字段，脱敏与读后撤权检查 | C0证明可验证身份及管理权限映射；字段契约确认 | 非管理成员/撤销权限不能读，客户端自报身份无效，无写入能力 |
| M6启用评审 | 形成真实调度实施计划，不直接启用 | 对应Runner/M1真实多机证据、Plan批准、当前ACL、准入均具备；成果链涉及G2须通过 | 负责人明确恢复M6及具体批次授权，之后才实施 |

G2、UX实机验证、C0可在不同文件/环境并行；G2不是只读Host探针前置。Owner只读投影不等待Headless，但不能跳过身份契约。任何Runner基础测试不等于新M6调度已获授权。Registry上线不自动获得执行权。

## 三、最小接口契约草案

通用：所有变更请求使用requestId与expectedRevision；服务端确定caller、ACL及管理节点。对象引用带权威节点和版本；错误区分NOT_FOUND、FORBIDDEN、CONFLICT、UNSUPPORTED、UNAVAILABLE、UNCERTAIN，未知不当成功/零值。具体字段命名/错误码须与当前实现核对后冻结。

### Agent Registry

- resolveAgent(agentRef) -> 公共身份、authorityNodeId、revision、能力声明及观测时间；不返回凭据/私有路径。
- updateAgent(agentId, expectedRevision, patch, requestId) -> 新revision及审计；仅唯一管理节点认可的当前管理者可改。
- listAgentBindings(agentRef, scope) -> 被允许查看的本地Binding投影；不能据此推断远程执行资格。
- 首期不提供跨设备同身份启动或身份迁移接口。旧nodeId/sessionId只通过显式兼容映射关联新agentId。

### Workspace Binding

- resolveWorkspace(bindingRef) -> 节点、逻辑repoId、可读能力；本地路径仅在必要授权范围内返回。
- verifyWorkspace(bindingRef, repoId, baseCommit, requestedPermissions) -> 当前检查结果与时间，不产生长期通行证。
- prepareExecution(executionRef, approvedScope) -> 隔离资源handle与准备证据；拒绝任意远端路径、脏目录覆盖和目录逃逸。
- Workspace绑定、可执行文件/工具与凭据引用都留在所属节点；平台差异通过绑定解决，不同步任意目录。

### 授权与Owner投影

- evaluateAdmission(executionRef, approvalRef, requestedOperation) -> 当前允许/拒绝、原因与权威代次，仅有效于本次检查；不取代后续副作用前再校验。
- readManagedTeam(ownerContext, roomRef, fields) -> 当前有权管理的Team必要字段；ownerContext由服务端生成，不接受客户端owner角色或伪造Agent会话。
- 不能默认“本机Owner=全网管理员”。敏感执行日志/私有路径额外授权；具体管理关系和Host身份接口C0待核实。

### Runner

- probe() -> 支持的操作、隔离/恢复限制及证据；没有证明的能力返回unknown/unsupported。
- prepare(executionRef, scopeSnapshot, requestId) -> 准备资源handle；资源由Execution归属。
- start(executionRef, generation, idempotencyKey, preparedHandle) -> 实例handle或uncertain；启动前持久意图，同键不重复创建实际Worker。
- inspect(handle, executionRef) -> 进程/Session观测与时间、核对证据；PID单独不足，不写Task验收状态。
- cancel(handle, generation, reason) -> 取消请求记录；必须另行证明停止。
- collect(handle, executionRef) -> 固定哈希成果引用及测试证据；迟到旧代次成果隔离，不能推进新Execution。
- release(handle, executionRef) -> 有证据的资源释放或待清理；禁止清掉未审查成果和用户目录。

Runner恢复记录只保存启动/实例/资源映射和观测，Task/Execution权威仍在既有账本。无法确认当前批准、ACL或generation时拒绝新的副作用。新契约不能要求把整个现有同步API直接改异步；兼容边界需逐调用点设计。

## 四、验收矩阵与证据

| 领域 | 必测反例 | 证据 |
|---|---|---|
| 身份 | 同名跨节点、多Host、重启、Session重建 | ID/权威映射前后快照，未知Host关系明确标记 |
| Registry | 并发更新、旧revision、非管理者、撤销 | 冲突/拒绝回归及审计，不泄露凭据 |
| Workspace | Windows/macOS不同路径、脏目录、路径逃逸、基准提交不符 | 独立测试仓库及文件指纹；不得用用户生产目录破坏性测试 |
| 审批 | Plan改版、任务越界、撤权、Leader代次过期、ACL不可达 | 启动被拒绝且无新副作用，已有执行保留证据 |
| Runner | 重复start、启动后ACK丢失、崩溃窗口、Host重启、取消未停止 | 实际实例数与账本对应；无法确认时uncertain，无盲重启 |
| 结果 | 旧generation迟到结果、hash变化、伪造来源 | 隔离/拒绝，原成果不可变，不当已验收/已合并 |
| Owner | 普通成员、无管理关系、客户端自报Owner、读中撤权 | 服务端拒绝及脱敏，无越权读写 |
| 兼容 | 旧节点/无新字段/不支持Runner | 明确降级或拒绝，不建第二账本 |
| UX/多机 | 本机、同机多Host、两台物理机器分别验证 | 场景/版本/SHA/命令/时间；模拟与物理结果分开 |

每个实施批次：先最小失败回归，再实现；适量相关测试与必要全套门禁，版本/package-lock/client同步；产物构建一致；记录实际SDK与SHA。日志/截图归档，测试DSH_HOME隔离。不得把NOT RUN补成PASS。

## 五、下一批DSH候选任务：暂不派发

上一批通过后，推荐下一批先C0（契约与能力核实），而非直接写完整Registry或M6。

候选任务单：
- A：核实多Host/Node/Workspace与Session生命周期，只读探针，回答hostInstanceId是否确有必要。
- B：核实Owner身份和管理权限映射，输出字段/脱敏/当前ACL检查矩阵，不实现未经核实的读取旁路。
- C：核实现有Session Runner公开能力及启动幂等、取消/恢复的缺口，形成隔离测试设计，不跑用户真实任务。
- 主Agent：汇总当前代码差距、G2/M1/UX证据及接口草案，列出可立即实现的I1最小范围和明确门槛。

各自只写分配文档/探针与独立测试；client/index/service/package/build等共享入口由主Agent整合。没有必要拆成大量小Agent或反复重跑完整套件；避免同文件并行写。

若上一批只剩小缺陷：先R0修复，C0只读研究可并行。若交付涉及新权限/账本变更或未验收G2合入：先审查，不自动接受。实际派发文本将在收到上一批SHA和回执后，基于真实差距生成，不提前把候选任务当已下发。

## 六、交付与停止边界

不指定尚未取得的下一版本号或新SHA；DSH接单时再定版本、起点提交和文件归属。禁止修改原未完成0.4.5/M6工作区；保持推送暂停。冻结架构不等于M6恢复授权、Headless上线或真实执行审批。

本轮仅新增本计划，不修改产品代码、不通知DSH开工。等待上一批交付后先复核，再确定R0/C0实际任务单。
