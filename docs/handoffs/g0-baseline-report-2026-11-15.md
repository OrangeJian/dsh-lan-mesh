# G0-A 已提交基线核查

## 基线及证据

2026-11-15，分支codex/room-collaboration，基线e863dc3，插件0.4.1。当前工作区另有本轮提前编写但暂停的M6草稿，未提交、不列为已实现。为避免混入，使用git archive独立导出该HEAD再验证；不覆盖工作区文件。远端状态未fetch确认，不根据本地ahead判断负责人是否已手推。

独立副本准备测试要求的.test-tmp目录后，全量396/396通过，0失败/取消/跳过，耗时85.2秒；原始日志.test-tmp/g0-baseline-full-prepared.log。首次导出副本未创建该父目录，26项出现测试夹具mkdtemp ENOENT，原始失败保留g0-baseline-full.log，不列业务失败或隐去。

官方schema82/82、panel198/198通过。宿主现为DSH0.2.2-rc.3，旧rc.1矩阵门禁首先报版本漂移；人工复查四个公开client声明，并精确比较exports和inject，除版本外一致。更新矩阵后原兼容脚本通过。没有运行浏览器、物理设备或真实模型。

## 模块和接口映射

| 层 | 实际实现 | 结论及边界 |
|---|---|---|
| Mesh | discovery、transport、service.resolvePeers/syncRooms | 广播发现、HTTP消息/反熵；地址或端口变化触发重同步已在0.4.1修正。静态Peer配置尚未实现，trustedPeers是授权白名单而非地址表 |
| Runtime | service.sessions/catalogueAgents/importAgent/createAgentIn、#wakeSession与Team wake回调 | 有宿主发现/恢复/创建/唤醒适配；followup接收不表示模型完成；不存在可承诺杀死外部副作用的取消接口 |
| 身份和存储 | store.meshRootDir/loadIdentity、nodeId/sessionId | 不同端口隔离实例目录，同节点多会话已支持；未证明必须新增instanceId |
| Room | rooms、service、0.3偏好、0.4生命周期 | 管理状态反熵；不能作为执行事务权威或自动改变Team Leader |
| 文件 | room-blob-store/protocol、attachment ledger/service/sync | 内容哈希、授权、配额、提交/补传、迟到历史已实现；不等同完整Artifact审查服务，不宣称任意断点续传 |
| 文档/上下文 | shared-doc-*、room-context-*、context-delivery-store | 固定revision/hash、提案/审计/冲突与投递已实现；Skill仍为提示引用，不保证不可变Skill版本 |
| Team执行 | team-state/store/coordinator/protocol/tools | 独立账本、start许可、幂等、租约、uncertain、恢复/对账存在且基线测试通过；三机真实验收未关闭 |
| M6 | 尚无已提交实现 | 草稿/审批/DAG/验收不计入当前基线；本轮暂停草稿有未解决审查项，不能发布 |

## 必须保留的兼容及风险

1. 0.4有密钥state pull强制reply proof，不能混称旧版无缝兼容；应全量升级，不能回退旧插件编辑有生命周期的房间。旧默认active不能撤销更高代归档。
2. Team generation目前固定1，本机Worker派发明确拒绝；发现generation字段不代表支持故障接管。新Leader必须先核对旧执行和旧Leader隔离。
3. task dependsOn当前显式UNSUPPORTED，Worker成功只进review，无完整accept/拒绝重做闭环。
4. event-ack在协议枚举中但无handler；当前事件ACK依赖响应eventAck。此接口差异列入G1协议澄清任务，不无证据重构。
5. 权限撤销/房间负责人变化会暂停Team，但尚无完整恢复/迁移入口。取消和超时只能触发uncertain或对账，不保证外部进程停止。
6. 0.4.1修正端口变化通知；修正测试清理后附件文件连续复测通过，尚无证据将历史全部Leader unavailable/Windows EPERM归为同一已根治缺陷。

## 剩余顺序与验收矩阵

| 阶段 | 下一交付 | 退出条件 |
|---|---|---|
| G0-B | 四个参考项目固定SHA/源码机制/许可映射 | 外部结论有源码依据，不复制第二个Coordinator；本报告未冒充完成此研究 |
| G1 | 接口差异澄清、运行诊断及可执行三机验收 | 自动化异常证据与物理三机/真实模型证据分别齐备；目前后者NOT RUN |
| G2 | @文档、成果引用、Skill版本边界与过期提示 | 复用现有文件和Context通道，权限和固定版本验证通过 |
| M6-A | Registry/计划/审批版本 | 未批准不进入新编排执行，改范围重新审批，留档 |
| M6-B/C | DAG调度和Review交付 | 依赖已验收、授权/容量门禁、uncertain不自动重跑、人工确认合并 |

真实三机仍使用m1-three-device-acceptance.md，负责人操作设备；普通双机基本可用反馈不能替代12项正式执行验收。已异步询问可用设备数量，不阻塞其他独立工作。

暂停M6草稿审查留存：审批scope未绑定成员资格代次，同key重入可能恢复旧批准；事务Worker检查使用排队前成员快照。到达M6时修复，当前不集成或宣布交付。工作区恢复曾被自动审批拒绝，故原样保留，采用独立副本核查。
