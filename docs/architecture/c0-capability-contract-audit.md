# C0 第一轮：源码核实与能力探针契约

日期2026-11-17。依据已批准V0.2.1；静态核实产物，不是Registry/Runner实现或M6启用授权。

## 已核实与不可推导的结论

| 领域 | 源码事实 | 不能据此声称 |
|---|---|---|
| Node/实例 | store.meshRootDir按默认根及配置端口分槽；identity持久化在所属槽 | nodeId等同物理电脑、多Host任意共享目录安全 |
| Agent | agents.localRow围绕现有Session ID、nodeId、cwd及目录状态 | 已有独立持久AgentDefinition或跨设备迁移 |
| Owner | index面板路由声明Owner-only，服务端将人类动作绑定human，不采信任意客户端Session；参见team-owner-readonly-contract.md | 已有跨节点人类身份或全网管理权限；真实Host认证与撤销语义仍须测 |
| Team | 当前按roomId建账，create/allowed核对Room Leader/成员；Team工具使用真实本机会话 | Owner可冒充Agent调用Team工具、允许多Team共享Room |
| Runner | service有agent.followup、目录约束及既有执行账本路径 | 新Session Runner已具备原子启动幂等、进程级取消、代码写入隔离或Headless恢复 |

## 探针任务单（下一实施批，未自动运行）

A 身份拓扑：同Host多Workspace；同机不同Host/端口；同机不同DSH_HOME；两物理机。每项记录nodeId、存储槽、Session引用、重启前后身份、是否冲突。仅用临时目录，不能复制生产node.json。只有观察到现有寻址无法区分资源，才提hostInstanceId。

B Owner信任边界：固定实际SDK版本与认证路由，测试未认证/普通连接/Owner连接，客户端自报owner与sessionId无效，权限撤销后读请求被拒。跨节点“本人管理”映射若无可信机制，首期投影仅本节点且服务端可证明的管理范围；这是待确认的实现契约，不能擅自放宽为全网。

C Runner公开能力：记录Session创建/恢复/目录绑定、followup、取消、状态观测、资源释放的实际公开接口和scope。每项返回supported/unsupported/unknown及证据，不能用SDK方法存在替代行为测试。无隔离证据前只做不写代码的临时探针；拒绝运行用户真实任务。

D 账本映射：明确executionId+attempt+generation与本地Session/资源handle的唯一关联；启动前持久意图、同键inspect、不确定时拒绝重启。恢复记录不独立推进Task状态。

## 准备给下一批的最小接口

resolveAgent引用现有node/session兼容映射；Definition新增独立agentId+管理节点+revision（不迁移）。WorkspaceBinding只表示经授权的本地repoId/path/baseCommit，路径不公开广播。Runner prepare/start/inspect/cancel/collect/release返回能力及观测，不直接写Task accepted。Owner投影遵循只读、最小字段、当前ACL与读后复核。

进入I1前必须完成：实际上一批提交验收；A/B/C探针回执；新schema和旧数据兼容策略；最小API/文件归属及失败测试审查。G2和M1真实多机、UX实机验证保持独立门禁；新调度仍需Plan批准+当前ACL+M1准入，不因C0文档完成而启用。

## 当前未完成

未运行真实多Host、真实Owner撤权、Runner生命周期或物理两机探针；未新增Registry/Binding存储；未实现Team Owner接口；未启用Headless/M6。原0.4.5/G2及M6工作树不动。
