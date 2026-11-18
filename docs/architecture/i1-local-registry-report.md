# I1 第一批：本地 Registry 数据层（v0.4.24）

依据冻结V0.2.1，实施可独立验收的本地身份与兼容Session映射。不是整个Registry上线。

## 已实现

lib/agent-registry.mjs：独立agentId、唯一authorityNodeId、revision；define/rename/bind/unbind；Session只能显式绑定一个Definition；同名不参与寻址；expectedRevision不符拒绝；外来权威字段拒绝。publicAgent仅包含身份、名称、权威及版本，不含私有路径。

lib/agent-registry-store.mjs：单写入进程目录；排队执行时调用必需的服务端authorize，再执行版本校验；临时文件、fsync、rename成功后发布内存。失败保留原状态，队列可继续；重开重建并检查本地权威与Session映射。不共享现有Team账本，不新建执行账本。

调用方必须在服务端生成nodeId/authorize，不能将请求体中的canManage等字段当认证。纯模型不构成网络认证层。publicAgent是字段投影，不是授权接口；调用前ACL由服务层负责。localPath只是本地配置数据，不是已验证可信仓库或代码执行授权。

## 验证与边界

七项相关测试通过：身份/Session分离、公开字段、旧revision、非管理与外来节点、重复绑定、重开/撤权、并发版本竞争、落盘失败重试（部分断言在同一测试）。完整回归另记结果。

尚未接入MeshNode、RPC、工具或UI；未自动迁移旧Session，未注册远程Definition，未启用Runner或任何派单。当前只支持同进程单写入者；请求ID持久重放、事务审计、真实身份与撤权宿主验证尚待后续接入前完成，不能声称I1整体验收通过。

原五份未跟踪架构文件和未完成0.4.5/M6工作不动。不推送。

最终门禁：完整512/512，0失败/跳过；panel283/283、schema82/82，构建一致，Composer rc.3通过；原保护基线13/13未变。本批代码仅数据层，未计作产品可用Registry或执行授权。
