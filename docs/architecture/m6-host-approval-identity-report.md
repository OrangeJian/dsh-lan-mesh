# M6 人类操作入口前置：本机授权适配证据

基线 `9f41030`，独立 worktree / 分支 `OrangeJian/m6-host-approval-identity`。本批只交付**可被 M6 人类批准入口调用的本机授权适配、探针与定向测试**。账本与 UI 入口另批，未启用真实派单，未改 `index.js` / `lib/service.mjs` / Team 状态机 / protocol / tools / coordinator / client / ui。

## 复用的已验证生产路径（未重新实现、未新增绕行）

1. **Host 身份 / 通道**：`index.js:1355-1387` 的 owner-only Fetch 路由 + `index.js:1419-1420` 的 `teamOverview` 桥。连接服务的 `createSharedFetchHandler('/api')` 在处理器之前对非 owner principal 直接 403，伪造 body/header 无效。
2. **生产身份 + 当前 Room 管理权限**：`lib/service.mjs:2870` `MeshNode#ownerTeamOverview(roomId)`。人类身份由节点持久化 `node.identity.nodeId` 与固定 `HUMAN_SESSION_ID` 推导为 `memberKey(nodeId, 'human')`（`lib/service.mjs:111`、`lib/rooms.mjs:79`），并要求该人类**当前**是 Room leader 且是成员；leader 变更即撤权，未知 Room 由 `#roomOrThrow`（`lib/service.mjs:3034`）拒绝。

`lib/m6-host-approval-adapter.mjs` 的 `authorizeM6HumanApproval(node, request, caller)` 是唯一新增调用边界：

- `caller` 必须是宿主桥提供的 **owner 准入事实**（owner principal / browserPeer 形状，`kind:'owner'`），否则 `NOT_OWNER`。它证明的是**调用路径**（请求已在 owner-only 路由被接纳），**不是请求级身份**：公开路由处理器只收到 `Request`，见下节实测边界；
- 能力白名单 `CAPABILITIES = ['teamOverview','resultReview']`，未知能力 `UNKNOWN_CAPABILITY`，且在任何 Room 访问之前判定；
- 请求体仅读取 `capability` 与 `roomId` 作为数据；`sessionId`/`actorKey`/`via`/`owner`/`principal`/`role`/`leaderKey` 一律不读、不进入决策；
- 当前管理权限完全委托 `node.ownerTeamOverview(roomId)`，其拒绝（FORBIDDEN / UNKNOWN_ROOM / AMBIGUOUS_ROOM / NOT_READY / TEAM_DISABLED）原样 fail-closed；
- **严格成功判定**：要求 `overview.known === true`（缺失 / `undefined` / 非布尔真值一律拒绝，不再用 `!== false`）；并要求 `overview.scope === 'local'`；
- **权威 Room ID**：只用投影返回的 `overview.roomId` 规范 ID，缺失即 `MISSING_CANONICAL_ROOM`；禁止回退到请求里的 room 字符串（它可能是显示名）；
- 成功决策为冻结对象，`producesExecution:false`，不含凭据、不创建执行、不改状态。

## 当前 SDK 证据（`scripts/m6-host-identity-probe.mjs`）

可复跑命令：`node scripts/m6-host-identity-probe.mjs`。结果 `status: PASS`，SDK `hostVersion 0.2.2-rc.3`，Node `v24.11.1`，平台 `win32`。

- 公开声明：`@deepseek-ai/dsh-client-connection` 导出 `HostConnectionService`（`lib/types/index.d.ts` sha256 `131cbee…`），声明 `browserPeer: PeerScope` 与 `createSharedFetchHandler('/api')`（`rpc-host.d.ts` `398786…` / `rpc.d.ts` `fd97fb…`）；`@deepseek-ai/dsh-typert-protocol` 声明 `PrincipalMap.owner.kind='owner'`（`types.d.ts` `2b6ced…`）。
- 组件实测（认证 stubbed deny-all）：非 owner principal 携伪造 `x-owner:true` 与 `{owner:true,sessionId:'human'}` 在处理器前被 403、处理器调用数 0；真实 `browserPeer` owner principal 命中 200；dispose 后精确路由 404。
- **处理器实际调用上下文实测**：精确路由处理器只收到 1 个参数且类型为 `Request`（`handlerArgCount:1`、`handlerReceivesRequestLevelPrincipal:false`）。准入 principal 由 `createSharedFetchHandler` 消费，**不会**转发进处理器；因此探针**不**用 `connection.browserPeer` 冒充请求身份，适配器只在已准入的 owner-only 路由内被调用，第三参数是显式 owner 准入事实，`requestLevelIdentityVerified:false`。
- SDK **不提供** 人类/会话身份（`sdkProvidesHumanSessionIdentity:false`），也**不提供** 任何 per-Room 权限模型（`sdkProvidesRoomPermissionModel:false`）。因此适配器的本机人类身份只能来自节点持久化身份 + 当前 Room 管理权限，缺失即 fail-closed。
- 真实只读结构核对：`MeshNode#ownerTeamOverview` 在所有返回分支都带 `known`，且 `roomId` 恒为 `#roomOrThrow` 解析出的规范 `room.id`（Team 不存在时仍 `known:true, status:'absent'`）。定向测试直接调用真实方法核对了这一点。
- 未验证（明确记录）：请求级 principal 校验、浏览器 Cookie 认证、远端 owner 身份、物理两机、活体 Host 上的 leader 撤权、真实派单、活体 per-Room ACL。

## 定向测试结果（`scripts/m6-host-approval-adapter.test.mjs`）

`node --test scripts/m6-host-approval-adapter.test.mjs`：7/7 PASS。覆盖：请求体自报身份无效；Agent/非 owner 无法冒充人类；非管理者 / 撤权 / 错 Room 经生产路径拒绝；未知 Host 能力（含 `dispatch`、`approvePlan`）拒绝且零 Room 访问；授权决策不产生执行；**缺字段回归**：`known` 缺失 / `undefined` / 非严格 `true` 一律拒绝、真实 `ownerTeamOverview` 始终带 `known:true` 与规范 `roomId`、投影缺规范 ID 时 `MISSING_CANONICAL_ROOM` 且不回退请求字符串、投影规范 ID 优先于请求显示名。

## 边界与未决

- 这是**授权门**，不是批准/评审/派单实现；`resultReview` 仅表示允许进入纯评估路径，实际评审仍走 `lib/m6-result-review.mjs`（由后续批次接线）。
- JS 对象无法密码学证明来源，且公开处理器**不提供请求级 principal**；机密性依赖 owner-only 路由在处理器前拒绝非 owner principal，以及适配器对非 owner 准入事实的 fail-closed。该适配器证明“请求已经过 owner-only 路由”，**不声称**请求级身份已验证。与仓库现有 `via:'panel'` 通道事实信任模型一致。
- 不调用任何私有 API、不新增 `sessionId`/环境变量代表 human 的后门；账本与 UI 入口保持未实现。
