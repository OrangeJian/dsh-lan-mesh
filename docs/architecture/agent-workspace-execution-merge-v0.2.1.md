# dsh-lan-mesh 架构合并稿 V0.2.1（负责人冻结候选）

日期：2026-11-17。继承V0.2并按最新第二轮反馈小修订；本稿不冻结架构，不授权M6或产品开发，不替代现有ADR。V0.1保留作为变更历史。

## 一、事实基线与证据边界

已提交HEAD为384f9d6，代码交付7eff5a7/v0.4.20；当前工作树有DSH未提交的service、UI及取证修改，不属于已验收基线。本轮只读取、不覆盖、不提交这些修改。源码定位以本次读取位置为线索，正式冻结需在选定干净SHA上复核。

已核实：
- lib/store.mjs meshRootDir：默认实例保留原存储根，其他配置端口使用instances/端口子目录；注释明确不同实例不能共用节点身份。此事实不意味着nodeId就是物理设备ID，也不能据此保证所有多Host部署组合都已验证。
- lib/agents.mjs localRow：当前目录主要为nodeId、Session id、cwd、workspace标签，不等于已实现持久AgentDefinition/Binding。
- lib/team-state.mjs：现有Team存储键为roomId，create拒绝同roomId重复创建；Task/Execution均保存roomId，已有attempt、generation、租约等字段。
- lib/team-coordinator.mjs allowed：核对authorize、Room存在/未删除、Room Leader与Team Leader对应、worker仍在Room；归档拒绝create/dispatch/start。
- lib/service.mjs teamCreate要求Room Leader；teamStatus要求调用者Room成员，并按调用者筛选本地worker执行。该事实是当前权限耦合，不是Team/Room权限未来可自动继承的许可。

待核实：多Host同目录/不同端口/不同DSH_HOME及重启身份行为；最新工作树一致性修复的最终提交与回归；G2成果引用实际交付；文档ACL与全部Context/Artifact读取链；真实M1多机及UX验收结果。不得将文档摘要或代码存在写成验收PASS。

## 二、五项冻结ADR符合性

| 原冻结ADR | V0.2执行约束 | 符合性及证据门槛 |
|---|---|---|
| P2P + 每Team固定Leader | 复用现有通信及Leader账本；本机调用同样过业务门禁 | 不引入中心调度替代物、自动选主或第二任务账本；需多机验证 |
| Worker独立目录/Git Worktree | Execution绑定Workspace、repoId/baseCommit及独立运行目录 | 不覆盖用户脏目录；非Git任务也须授权隔离目录；Runner验证隔离 |
| 执行前人工批准 | 批准绑定Team、Plan revision/hash、任务集合、工作区及权限范围 | 启动前再核对当前ACL；批准不是永久权限；新调度启用门槛 |
| Leader故障暂停+人工接管 | 停止新增派发；接管按新generation及明确授权 | 不自动复制执行；旧控制事件失效；未知进程先核对 |
| Review后人工确认合并 | collect、结果提交、Review、验收、merge分别记录 | succeeded不等于accepted或merged；Runner无自动合并权 |

五项保持原意，只细化执行约束；下述新增模型和关系均仍为待批准建议。

## 三、身份、所有权与寻址

| 对象 | 建议所有权/寻址 | 明确不代表 |
|---|---|---|
| Node | 保留现有nodeId及持久化/认证语义，作为Mesh节点地址 | 不改成物理电脑ID，不由Host新ID替换旧ID |
| DSH Host | 运行并管理Session/宿主资源的进程实例；先记录与现有Node配置的关系 | 不默认与物理设备或Node永久一一对应 |
| Workspace | 节点本地授权绑定，逻辑workspaceId映射repoId和本地路径 | 不把远端绝对路径当本机可执行路径 |
| AgentDefinition | 唯一管理节点持有agentId+revision；凭据只引用本地句柄 | 不等于Session、运行进程或权限主体的全部依据 |
| AgentBinding | 指向agentId的本地执行绑定，含节点/Workspace/Runner能力 | 不自动继承Definition管理权或跨机运行权 |
| Session | 沿用nodeId+现有Session身份，由所属Host管理 | 不替代长期Agent身份 |
| WorkerInstance | Runner本地实例，关联既有Execution | 不拥有独立Task状态权威 |

寻址链：逻辑Agent引用 → 唯一Definition权威及已授权Binding → 现有nodeId传输地址 → 节点本地Host/Workspace/Session解析。名字只显示，不参与身份仲裁。跨节点携带有版本的逻辑引用，不能靠名字寻找同一Agent。

首期禁止Agent身份自动迁移、复制后双活或隐式变更管理节点。远程任务委托是把Task交给远端独立Agent；它不等于让远端以本机同一个agentId运行。后者需要额外Binding授权、防双活及凭据边界，首期不开放。

是否新增hostInstanceId待真实部署测试：若现有节点/存储槽即可唯一定位Host资源，则不增加协议身份；若证明重启/多Host会混淆，再提可兼容的本地实例标识及生命周期。不得预先重写nodeId。

## 四、权限和审批

审批建议记录不可变批准快照：approvalId、服务端认证的批准人、teamRef、Plan revision/hash、明确任务集合、允许的Workspace绑定/repoId/baseCommit、Runner/工具/文件读写/网络等执行权限范围、有效条件及审计信息。字段是新契约草案，不是现有全部已实现字段。

每次prepare/start及新的副作用阶段必须重新校验：当前真实调用者、当前Team/Room相关规则、当前Workspace ACL、批准是否仍有效且覆盖此Task/Execution、当前generation、容量/租约与现有M1准入。配置或范围改变必须使旧批准不可用于新范围；权限撤销优先于历史批准。分发后执行节点也须本地核对，不只信Leader声明。

Agent在线、能力匹配、Team成员或Room成员任何一项均不能单独构成执行授权。最小权限按明确的当前授权条件组合，而非取所有成员资格的并集。

Human Owner必须来自可验证的宿主身份或负责人批准的等效机制；实际身份接口、可读范围及授权能力在契约冻结前仍待核实，不能将目标模型描述为已确认的宿主能力；不得接受客户端自报owner=true、任意sessionId或借Agent工具身份代读。Owner只读Team投影需单独定义字段和成员范围，默认不暴露凭据、本地私有路径、无关Worker日志；具体可读范围仍待负责人决定。

执行中撤权：禁止新的副作用和后续启动，发出受代次约束的取消/暂停请求；不能声称已发生的副作用可撤销，也不能把请求取消当进程已退出。技术上无法中断的动作需记录并转人工核对。

## 五、Runner生命周期与唯一账本

| 阶段 | 前置/持久化要求 | 失败、幂等与恢复 |
|---|---|---|
| prepare | 现有Execution已建立且范围获批；检查当前ACL、Workspace、baseCommit、隔离目录 | 只做授权范围内的准备；记录资源归属，重复调用返回相同准备结果 |
| start | 启动前持久化启动意图及executionId/attempt/generation、幂等键、配置快照、资源定位 | 同键不能新建第二Worker；崩溃窗口无法证明未启动时进入核对，不重启有副作用执行 |
| inspect | 核对Runner实例与Execution绑定、进程身份/启动标识等证据 | PID单独不足；找不到进程不自动证明从未执行；返回观测而非自行改Task验收 |
| cancel | 当前控制者与generation有效；先留取消意图/原因 | 重复取消幂等；收到请求≠停止；不自动释放仍可能使用的容量/目录 |
| collect | 收集固定哈希Artifact、测试结果及来源Execution | 成果提交不等于Review通过；迟到旧generation成果隔离为证据，不能推进当前执行 |
| release | 账本允许释放且证明进程停止、成果已保留、目录归属明确 | 不删除未审查成果或用户目录；失败记录待清理，不伪装已回收 |

ACK丢失：以同幂等键inspect/查询已有实例，禁止盲目重发启动。Host重启：从现有Execution账本恢复任务权威，再核对本地运行资源；不以本地进程存在反向批准执行。旧generation的start/cancel/控制事件拒绝生效；旧成果只可进入隔离审查渠道。

Runner恢复记录仅含启动意图、实例定位、幂等/资源映射和观测；不得独立声明Task完成、再次派发、接受成果或替代Leader账本。具体启动标识、防重复执行技术和Host可用API待能力探针验证；本稿不承诺跨所有Runner的绝对exactly-once。

uncertain必须保留，不自动重试有副作用任务。准备/启动/停止无法证实的情况都不能靠刷新按钮消除。基础Runner探针用隔离测试任务，不经新M6调度入口，不可借探针运行用户真实需求。

### Runner补充执行约束（V0.2.1）

Native Session未证明独立工作目录、写权限约束和执行隔离有效前，只允许无代码写入的协作任务，不得作为新架构代码Worker写用户主工作树；仅更换cwd不等于隔离已验证。

执行节点无法确认当前Leader generation、批准有效性或Workspace授权时，拒绝启动新的副作用操作；已发生的执行保留证据并进入核对，不自动重试、不伪装已停止。

## 六、Team/Room/文档边界与兼容

纠正V0.1：当前不是任意teamId多对Room，Team账本实际以roomId为键，并与Room Leader/成员检查耦合。因此首期建议保持现有一个Room至多一个执行Team的表示，保留旧键与旧关联，不启用多Team共享Room。

领域职责可以分离，但ACL不能因为概念分离就直接改变现有行为：
- Team成员资格只服务执行组织及明确授权检查；未来新增独立资格时仍需兼容现有Room门禁。
- Room成员资格服务讨论与已有访问规则，不自动赋予Workspace执行或文档所有权限。
- 文档访问由文档既有权威及授权链判定，Team/Room关联不新授予读写；现有实现具体覆盖待专项核实。
- Room Leader、Team Leader和文档权威不做隐式互换。

最小迁移：首阶段只增加可选元数据和适配引用，缺字段按旧表示读取；不批量重编号、不改已有roomId/Execution/artifact引用、不双写第二账本。未来若批准独立teamId，必须有版本化旧roomId映射、冲突/失败恢复及审计迁移方案，再另行评审多Team/Room关系。旧记录保留创建时授权/关联的审计事实，但不因此获得当前执行权限。

## 七、修正后的实施依赖

1. **现有修复独立收尾**：先确认v0.4.20后续自动已读并发问题的实际修复提交和证据，保持正在开发工作不被覆盖。UX验收、SDK核对和M1真实多机验证可分工并行；各自失败不通过新架构掩盖。
2. **G2独立盘点与验收**：确认executionId+resultHash固定成果引用、授权和重放测试；未验收不能称已具备完整成果闭环。无需等待Registry即可完成。
3. **冻结接口与最小映射**：依据本轮评审确认身份/Binding、现有Team映射、Owner读取及批准范围；只在批准后实现最小兼容适配。
4. **Runner基础验证**：可在独立测试环境验证prepare/start/inspect/cancel/collect/release、崩溃/ACK丢失和Worktree；无需启用M6真实调度，也不能借此绕过授权。M1故障暴露的底层问题须先修。
5. **新调度启用门**：Plan人工批准及哈希绑定、启动前当前ACL核验、现有M1容量/租约/幂等准入、固定Leader与故障暂停，缺一不可。Runner相应能力及真实多机门槛须有证据；涉及成果验收的路径还需G2固定引用通过。
6. **M6分批恢复**：只有明确冻结架构和恢复授权后，才开展真实Task/DAG调度、Review及人工合并。UX已验证的可用路径不能在迁移中退化；真实验收须用真实任务证据，不能由模拟截图代替。

这避免了“必须先启用M6才能测试Runner、又必须Runner成熟才能实现审批”的循环。大日志索引、重载草稿恢复等既有待办不自动成为M6前置；只有与实际启用路径有关的缺陷才作为门禁，其他继续独立排期。

## 八、V0.1→V0.2变更摘要

| V0.1问题/模糊点 | V0.2修订 |
|---|---|
| Node被描述成设备/Host边界，可能重定义旧身份 | 明确保留nodeId；Host关系和新增实例ID由测试决定 |
| Agent可跨节点Binding的含义不清 | 区分远程委托与运行同一Agent，首期不开放迁移/双活 |
| 审批仅强调计划版本 | 增加Team、任务集合、Workspace和执行范围，并要求当前ACL复核 |
| Runner只有接口列表 | 增加启动前持久化、ACK丢失、重启核对、旧代次/迟到成果与释放条件 |
| 暗示一个Room可多Team | 依据当前roomId键及Leader耦合收紧为兼容的至多一个Team；共享关系待决定 |
| 领域分离容易误解成权限自动继承 | 显式区分Team、Room、文档和Workspace权限 |
| G2/Runner/M6顺序不够明确 | 分离基础探针和真实调度，定义批准/当前ACL/M1联合启用门 |
| 能力摘要易当验收结论 | 已核实、建议、待核实明确分栏；工作树改动不计已交付 |

## 九、最多五项负责人决策

1. 是否批准首期AgentDefinition单管理节点、禁止迁移/跨设备同身份执行，仅允许向远端独立Agent委托？
2. 是否批准先保持现有Room至多一个Team的兼容映射，多Team共享Room延期，未来独立teamId另行迁移评审？
3. 人类Owner的Team只读范围应覆盖哪些Room/Team、哪些字段；哪些本地执行日志必须额外授权？
4. 是否批准节点预备仓库+repoId/baseCommit核对+独立Worktree，首期不由Mesh同步任意源码目录？
5. 首期Runner交付是否先现有DSH Session适配，Headless仅做能力/恢复探针后再独立批准上线？

hostInstanceId是否必要列为测试结论，不在没有证据时要求负责人猜选。批准快照字段、执行中撤权及迁移失败行为仍须在接口契约阶段细化，但不得削弱本稿门禁。

## 十、交付状态

本稿为待冻结V0.2，只新增此文档，不修改代码、不推送、不启动M6、不覆盖V0.1及当前DSH工作。完成后停止，等待下一轮架构冻结评审。


## 十一、最新复审意见与ADR候选（V0.2.1）

依据会话6afc5c70-2d94-83ee-8fcb-5ab3d7391050最新评审：V0.2方向通过，无需新一轮大范围研究；正式冻结仍需负责人确认。外部评审未证明当前Host接口或实机验收已经完成。

| 候选决策 | 推荐冻结口径 | 当前状态 |
|---|---|---|
| C-01 Agent归属 | 唯一管理节点；首期不迁移，不跨设备运行同一身份，远端独立Agent委托协作 | 待负责人批准 |
| C-02 Team/Room | 保留一个Room至多一个执行Team；多Team共享延期 | 待负责人批准 |
| C-03 Owner范围 | 默认只读本人当前有权管理的Room/Team的必要字段；敏感日志/私有路径额外授权，不能把宿主Owner自动解释为全网管理员 | 待负责人明确；身份与管理权限映射须服务端核实 |
| C-04 仓库准备 | 节点预配可信仓库，核对repoId/baseCommit，代码任务独立Worktree；不自动同步任意目录 | 待负责人批准 |
| C-05 Runner顺序 | Native Session适配先行，但未验证隔离前禁止代码写入；Headless通过能力与恢复验证后独立启用 | 待负责人有条件批准 |

本轮变更仅三处约束：Native写入隔离、无法确认授权时拒绝新副作用、Owner身份接口待核实；五项原ADR及G2/M1/UX/M6依赖不变。第九节决策由本表明确化，未因评审建议或本轮“确认方案”的技术核对而自动获得批准。

结论：建议确认本候选的技术方向，等待负责人明确上述五项后冻结；架构冻结也不等于M6开发授权或任意真实任务执行批准。此后才制定分批实施计划，并维持原工作树保护、当前缺陷收尾和推送暂停。
