# UX-0 源码与参考研究

## 本地事实与数据映射

稳定基线 HEAD dfd8013 / 0.4.4；工作区另有未完成 0.4.5 和 M6。以下用函数/字段定位，实施时在确认的干净基线重新核对；不把当前未提交的方法称为已发布能力。

| ViewModel / 界面 | 已有读取来源 | 关键字段/转换 | 不可推出的能力与 fallback |
|---|---|---|---|
| Workbench / Rail | `index.js` snapshot → `MeshNode.snapshot()`；`client.js` Rail/MeshRailHost/MeshPanel | self、pluginVersion、rooms.mine/all/archived/unread、inbox、attention | self 中无界面版本；界面常量与服务版本分别显示；读取失败显示连接未知 |
| NodeView | snapshot.self / snapshot.peers；`service.mjs` describe、peerView、peers | nodeId 为 key，name 标签，ageSeconds 观测新鲜度；address 默认遮蔽 | peerView 只公开 nodeId/name/address/port/ageSeconds，**未公开 source、RTT、签名健康历史或实例列表**；不画隧道/推断 Peer 互连 |
| AgentView | 面板 agents → catalogueAgents，sessions | nodeId + id/sessionId 唯一；nodeName/title/name；live、status、cwd、rooms | session live 不等于派发授权；远端目录失败为 unavailable，不展示 0 个；cwd 是所属机器的路径 |
| RoomView | rooms / roomDetail → roomView | id、name、topic、leader、members、tasks、lifecycle；localPreferences | 远端 member.live 当前按 Peer 可见近似，不是远端进程运行证明；显示“设备可见/会话未核对” |
| MessageView | roomDetail 及 RoomPane 现有消息读取 | from.nodeId/sessionId/title/name、text、sentAt/receivedAt、mentions/skillRefs/attachments/contextPacket | 文档引用不唤醒；名称不能作为路由；没有稳定的引用消息定位字段时仅保证 Room 跳转 |
| InboxView | snapshot.inbox → humanInbox；`markRead {messageId?}`；roomRead | messages、unread、read、from、room、topic、kind、真实结构化 mentions | 默认仅未读，不含自己的消息；成功保存才移除。`@我` 必须基于结构化提及，旧文本不猜测；未知 kind 不编造类型 |
| ArtifactView | 现有附件 gateway、Room 附件引用与传输账本 | blobId/hash、name、size、mediaType、delivery/availability | 文件路径声明不等于已传输；附件实字节通过原 gateway，不能由 UI fetch 任意远端路径 |
| DocumentView | documents、documentRead/history/propose/confirm/import/export 等原端点 | documentId、revisionId、contentHash、title、提案与历史 | 固定修订不自动替换 head；冲突确认继续走后端校验，归档只读 |
| SkillView | roomSkills / readRoomSkills | name、description、sourceNodeId/sourceNodeName、availability | 仅提示引用；没有不可变版本证据，不写“同版本已安装” |
| ContextView | contextSelection、contextDeliveries、投递记录 | 固定 revision/hash、recipient、delivery status、观测时间 | 有记录不等于 Agent 已理解；过期与最新版本差异需按可读来源核对 |
| RoomTaskView | roomDetail.tasks、roomAssign、roomStatus | 房间任务状态及 assigner/assignee | 与 Team Task 是两类账本，不能按同 title/id 拼接合并 |
| TeamTaskView | `teamStatus` 服务和现有工具；TeamCoordinator/TeamStore | task.status、execution.state/attempt/result、uncertain、pendingDelivery | **稳定 owner 面板没有通用 teamStatus RPC**；UX-5 若需新只读面板接口先审批契约。teamPlan 面板是暂停草稿，不复用作已授权入口 |
| DiagnosticView | scripts/mesh-diagnostics.mjs 及现有说明 | 分项结果、NOT RUN、错误码、脱敏信息 | 无现成浏览器报告接口，先给操作说明/人工导入既有报告；如需新只读读取另行审批，不运行 Shell |

### 现有源码结构需要保留的边界

`client.js` 以宿主 ModuleLoader 注入 React 与公开客户端入口，目前聚合导航、文档、Room、收件箱和根面板。改造应通过构建后的同一入口拆分 UI 组件与纯 ViewModel，先验证宿主加载方式；不能假设浏览器可直接 import 仓库源文件。

已有 `scripts/panel-check.mjs` 依赖组件 harness，拆分后需保留可测入口或更新 harness；不为保持旧字符串检查而保留失效组件。`schema-check` 与 `composer-compat-check` 保持原契约。主题继续使用 DSH 公共变量，不使用私有 Session Composer 发送通道。

## 固定版本参考

### LinYanZhi/dsh-mesh

- 固定 SHA：`8e105334218613930e4b1473e6d23c7d1ba08616`。
- 核查 `packages/dsh-mesh-ui/package.json`：UI **0.0.87**，依赖 dsh-mesh-node 0.0.22。
- 已实际查看仓库 `docs/images/ai-network.png`。它展示本机中心拓扑、节点卡、连接图例、缩放、实例和委托/告警/诊断折叠区。它是**仓库内参考截图，不是本轮运行该产品截得**；截图内 UI 版本文本不能替代源码包版本。
- 已读 `packages/dsh-mesh-ui/lib/client.js`：Topology、viewport fit/pan/zoom、TransferHistory、数据刷新和错误状态、详情折叠布局；`lib/delegations.js`：读取委托、远端产物时间线与状态。
- 采用：本机中心关系图、列表平等入口、详情侧栏、诊断就近、委托状态分层；隐藏敏感地址。
- 不采用：其公网 relay / frps 图例、Bridge、多通道探测、远端文件路径读写和信任模型。我们没有对应字段时不能照抄绿色连线或 RTT 数字。
- 对照截图：本项目用户图缺少网络工作区；参考图能迅速看设备关系，但折叠区与底层连接信息较密。新稿保留第一屏关系和选择详情，将管理说明移出主流程。
- MIT：LinYanZhi and dsh-mesh contributors。此次没有复制其业务代码、图标或截图到产品；截图只用于本地设计研究。

源码链接：[client.js](https://github.com/LinYanZhi/dsh-mesh/blob/8e105334218613930e4b1473e6d23c7d1ba08616/packages/dsh-mesh-ui/lib/client.js)、[参考截图](https://github.com/LinYanZhi/dsh-mesh/blob/8e105334218613930e4b1473e6d23c7d1ba08616/docs/images/ai-network.png)。

### Orca

- 固定 SHA：`8728a3260052cb71b4d005dde2dbc7657a21a682`。
- 本轮读取固定 SHA 的 `src/renderer/src/components/AgentStateDot.tsx`、`AgentWorkingSpinner.tsx`：working/monitoring/blocked/waiting/interrupted/failed/done/idle/unverifiable/unconfirmed/permission 有独立标签，身份图标与状态图标分开；转圈支持屏外暂停、减少动态效果。
- 读取 `app-shell/AppWorkspaceShell.tsx`、`components/task-page/{TaskPage,Frame,ListChrome}.tsx`：工作区壳、任务独立页、来源选择/可用性说明/过滤、主体与详情职责分离；任务来源不可用也有明确说明。
- 前序固定源码研究已读取 coordinator decision-gates 与 task dispatch：批准绑定具体 task/dispatch，派发与观测分离。UX 采用这一层次表达，业务仍由本项目 M1/M6 控制。
- 采用：会话身份与运行状态分开、未知状态不变绿、任务来源/详情清楚、Review 为独立人工步骤。暂不把 Orca 的全部状态枚举移植成本项目状态机。
- 不采用：完整 IDE、终端/远控、多外部任务平台、其恢复调度逻辑。本轮未运行 Orca、未获得其真实产品截图；不将源码阅读伪装成运行目测。
- MIT，Lovecast Inc.。本轮只借鉴布局与交互原则。

源码链接：[AgentStateDot](https://github.com/stablyai/orca/blob/8728a3260052cb71b4d005dde2dbc7657a21a682/src/renderer/src/components/AgentStateDot.tsx)、[AppWorkspaceShell](https://github.com/stablyai/orca/blob/8728a3260052cb71b4d005dde2dbc7657a21a682/src/renderer/src/app-shell/AppWorkspaceShell.tsx)、[任务页](https://github.com/stablyai/orca/blob/8728a3260052cb71b4d005dde2dbc7657a21a682/src/renderer/src/components/task-page/Frame.tsx)。选取文件下载后按本地固定 Git tree 的 blob hash 校验，记录见 reference-validation.json。

### dsh-agent-teams 与 DSH

前序固定 SHA `4354b0f6a793b75c1904c0ee85eef4043a37c733` 研究已核对 scheduler 的成员、容量和依赖门禁；借鉴 Captain/成员与依赖分层，不照搬共享目录协调。本轮没有重新运行或截图该项目。

DSH 本机已安装 0.2.2-rc.3，0.4.4 兼容检查有已提交证据。新视觉稿沿用官方中性主题与输入区习惯，不把宿主版本升级或 Session Composer 替换纳入本批授权。
