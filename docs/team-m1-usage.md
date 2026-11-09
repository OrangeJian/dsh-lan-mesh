# Agent Team M1：显式派发与可靠执行

开发中的 M1 功能，默认关闭，使用独立执行账本。支持远端显式派发、进度、结果和故障核对；自动拆解、能力匹配、DAG、验收工具与专用界面留至后续里程碑。

## 先建立协作项目

DSH 本地工作目录不会自动成为协作项目。先在 Leader Agent 会话中调用 `lan_mesh_room_member action=create room=Team试运行`，记下 roomId，再让每个 Worker 在自己的会话中调用 `lan_mesh_room_member action=join room=<roomId>`。

Team Leader 必须是创建 Room 的那个 Agent 会话。面板创建项目的 Leader 是 `nodeId/human`；M1 不提供将 human 转移为 Agent Leader 的功能。面板“加入”也只是加入人的成员位，不能代替 Worker Agent 自己加入。

新源码会在发现节点时补同步，并每 10 秒重试已有项目状态，解决项目早于对端上线时“可加入”为空的问题。更新插件后须重载或重启 DSH 才运行新代码。

## 两端配置

用 `/lan-mesh/v1/info` 确认双方 nodeId，然后配置共享密钥、对端白名单及本机授权。不要将占位符原样用于真实部署。

Leader 机器：

```yaml
clusterSecret: <两端一致的密钥>
trustedPeers: [<Worker节点ID>]
autoWake: false
teamEnabled: true
teamAuthorizations:
  - roomId: <roomId>
    leaderKey: <Leader节点ID>/<Leader会话ID>
    workerSessionId: ''
    workspaceRoot: 'F:\workspace\project'
```

Worker 机器（每个 Worker 会话各加一项）：

```yaml
clusterSecret: <两端一致的密钥>
trustedPeers: [<Leader节点ID>]
autoWake: false
teamEnabled: true
teamAuthorizations:
  - roomId: <roomId>
    leaderKey: <Leader节点ID>/<Leader会话ID>
    workerSessionId: <Worker会话ID>
    workspaceRoot: 'D:\projects\project'
```

`autoWake:false` 关闭旧的普通消息自动唤醒；Team 使用自己的授权和启动许可。Worker 须已打开、工作目录可读取，真实路径等于授权目录或位于其下。建议专用空闲会话。目录检查只控制插件准入，不能代替 DSH 工具权限或系统沙箱；共享密钥不提供加密或受信节点之间的独立身份认证。

可选参数：`teamLeaseMs:90000`、`teamHeartbeatMs:20000`、`teamRequestWindowMs:120000`。租约至少 1000 毫秒；心跳至少 250 毫秒且小于租约一半；时间窗口须为正数。时钟偏差超出窗口会拒绝请求。M1 每个 Worker 会话最多一个未解决执行，包括 uncertain。

## 执行流程

Leader 调用：

```text
lan_mesh_team_create roomId=<roomId>
lan_mesh_team_dispatch roomId=<roomId> workerKey=<Worker节点ID>/<Worker会话ID> title=核对接口 detail=检查指定接口并提交结果
lan_mesh_team_status roomId=<roomId>
```

派发返回 executionId。插件先落盘再发送；Worker 保存接收记录后 ACK，获得并保存有效启动许可后才请求宿主唤醒。返回派发信息不表示已经执行成功。

Worker 汇报：

```text
lan_mesh_team_report executionId=<executionId> note=正在核对
lan_mesh_team_report executionId=<executionId> status=succeeded summary=检查完成，未发现不一致
```

失败使用 `status=failed`。支持 `artifacts:[{type:"file",value:"D:\\projects\\project\\report.txt"}]`；路径属于 Worker 机器，不会自动同步文件。succeeded 使任务进入 review，M1 没有自动验收或改为 accepted 的工具。

工具输出包含 summary 和 dataJson（结构化状态的 JSON 文本）。当前不开放接受自报 sessionId 的 Team 面板写接口，调用身份由宿主执行上下文提供。

## 故障与人工核对

- 回执丢失：相同 executionId 重传，事件按 seq 去重。
- 启动等待超过租约时长、运行租约过期、启动结果不明或 Worker 重启：进入 uncertain、保留容量，不自动再次唤醒。过期后到达的进度/结果仅作核对证据，不直接通过验收。
- 外部进程可能继续运行；插件不能保证停止 Shell 或撤销外部副作用。
- 在 Worker 机器人工确认旧执行确实停止，再由 Leader 调用 `lan_mesh_team_reconcile executionId=<id> stopped=true reason=<人工核对原因>`。Leader 持久化取消记录，拒绝旧执行的启动，并将核对通知放入 outbox；`remotePending:true` 表示 Worker 还未确认，后续会重传。Worker 未核对的槽位仍保留，可能暂时拒绝新任务；不能仅因等待时间长就核对放行。
- Leader/成员关系变化或授权撤回会停止派发。M1 没有自动选主和恢复暂停 Team 的管理工具，须保留账本人工处理。
- 损坏账本会使启用的 Team 启动失败，不会静默清空。先备份并核对运行状态，不要删账本直接重跑。

存储为实例目录 `meshRootDir(...)/team.json`，包含权威任务、Worker 执行、outbox 和 nonce，不自动清理执行去重记录。写入先同步临时文件再 rename，不承诺所有文件系统/掉电场景的绝对持久性。目录只能有一个活动写入者。

## 验证

`node --test scripts/team-*.test.mjs` 与 `node scripts/team-smoke.mjs`。后者使用两个真实 HTTP MeshNode、两个 Worker 会话及模拟 followup，不调用模型。真实 DSH 跨机器执行仍需两端启用新配置后单独验收。
