# I1 Owner通道接入（v0.4.26）

现有/api/lan-mesh精确Fetch路由新增agentRegistry与agentRegistryCommand。沿用Host Connection的Owner-only准入，不在Mesh peer HTTP或Agent工具注册；这是本机Owner对本地Registry的管理，不代表Room/Team全网管理权。

lib/agent-registry-panel.mjs提供本地适配：每个变更要求显式requestId；bind不接受localPath/workspaceId等客户端字段，只从catalogueAgents({peers:false})取得已知本机会话和cwd，realpath后生成本地workspaceId。未知Session、不可用目录、节点关闭均拒绝。列表只包含Definition身份/版本及Session、workspaceId、节点映射，不返回私有路径。Binding只表示本地配置关联，不表示可信repo/baseCommit、Worktree隔离或执行许可。

Registry懒加载且仍按meshRootDir(config.port)分槽；插件卸载关闭适配器，等待写队列并关闭MeshNode。没有自动迁移旧Session、改变Agent寻址、自动执行或M6启用。

验证：完整515/515（全套启动时已包含面板适配测试）；随后新增的实际插件注册路由测试单独1/1，通过define/list/稳定请求重放/伪造authority拒绝。该Host测试使用真实MeshNode和插件注册处理器，但Host连接认证载体为测试替身；结合之前真实安装Connection组件Owner403探针，仍不能声称真实浏览器登录/撤权端到端通过。panel283/283、schema82/82、构建与Composer rc.3通过，保护13/13。

待完成：面板可见管理UI、旧Session显式导入体验、真实Host登录撤权、Registry更完整输入/损坏数据验证、Runner及跨机器验收。单进程单写入者限制不变。只本地提交，不推送。
