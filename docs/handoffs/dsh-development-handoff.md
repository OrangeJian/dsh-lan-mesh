# DSH 开发交接候选稿

状态：项目负责人已确认交接方案并授权实施第一批次；DSH 已完成第一批次的 M2 技能引用选择器与 M1 验收准备清单，交回 Codex 独立审查。2026-11-08 编写，同日实施。阅读本稿、ROADMAP 和所列代码即可开始，不要求读取聊天历史。

**本批次结果见文末「第一批次实施回执」**；该节记录 base/head commit、实际测试命令与结果、浏览器验证、未解决问题与设计偏差。M1 设备验收**仍未执行**，不可据本稿认为 M1 已通过。

## 现状与工作区

项目从 LAN Agent 通信演进到 Project Workspace：一个 Room 对应一个项目，沟通、工作目标、执行、文件、文档和知识分别建模并关联。长期目标包括自动编排，本批次仅 M2 收尾、M1 实机验收准备/执行；M3 作为下一批。

- 当前分支 `codex/room-collaboration`，HEAD `4a6cddf`；业务代码核对时工作区干净。
- 当前 Worktree：`C:/Users/jian/.codex/worktrees/room-collaboration/dsh-lan-mesh`。
- 原 Worktree：`F:/workspace/dsh-lan-mesh`，分支 `codex/agent-team-m1`，HEAD `d7a1c72`；比本地 origin 跟踪引用领先1提交。
- main/origin-main 本地均 `253f272`，未包含上述开发分支。当前分支比本地 origin/agent-team-m1 多7提交。没有联网 fetch，远端实时状态未核验。
- 禁止切分支、reset、清理 Worktree 或自动合并。Git 写入可能需权限，因为 Worktree index 在原仓库 `.git`。

可复用提交：M1 `b6979d7`；加入按钮 `6c2a4b9`；人类身份 `62e5ded`；兼容矩阵 `4f0cdf4`；机器消歧 `efdddc4`/`35dbe17`；引用协议 `693147c`；长会话身份 `4a6cddf`。

## 第一个实施批次：M2 技能引用选择器

先读 `docs/development-room-composer-compat.md`、`docs/superpowers/plans/2026-11-08-room-composer-references.md` Task4，再读 `client.js` RoomPane、`index.js` handleEndpoint/工具Schema、`lib/room-message.mjs`、`lib/service.mjs` receive/sayInRoom/#record/#waitsOn、`lib/transport.mjs` 签名与引用入口。

当前机器标识、精确引用和 skillRefs 传输已实现；缺少技能菜单、确认标签、删除、接收展示。官方 InputBar 绑定 Session，不能直接套用；只使用公开组件/接口及 Room 自有适配。当前官方包版本0.2.2-rc.1。

步骤：
1. 为 `roomSkills` owner panel endpoint 写真实请求测试；使用公开 `ctx.skills.list()` 异步全局目录，过滤 userInvocable，延迟解析服务；服务缺失返回 unavailable，不影响启动。
2. `/` 与技能按钮共用搜索菜单。返回 name/description/sourceNodeId/sourceNodeName，不暴露文件路径，不调用 get/invoke。
3. 仅用户确认的菜单项创建 skillRefs；普通 `/foo` 只是文本。引用可删除；发送包含来源节点；历史与对端展示保留来源，同名不同源不能折叠。目录当前只本机，全节点目录不在本批次。
4. 对端缺少技能时展示不可用引用，Agent 仍可读取引用元数据并自主选择本机可用技能；不得隐式安装/执行。
5. 保留 Enter/Shift+Enter、@ 键盘导航、机器标识、@all 广播与精确投递边界；所有新改动需回归。

测试：`npm test`、`node scripts/panel-check.mjs`、`npm run check:composer-compat`、`node scripts/twin-transport-check.mjs`；Schema 使用 `DSH_TOOLS_MODULE` 指向实际安装的 dsh-tools/lib/index.js 后运行 `node scripts/schema-check.mjs`。不要复制机器路径作为产品默认值。历史最新证据 npm106、panel111、schema55，数量是基线而非要求固定数字。

验收：选择/搜索/删除/序列化/历史恢复、不可用技能、同名不同来源显示均有行为测试；不执行技能；@功能无回归；真实浏览器截图与手工操作记录交回 Codex。协议/权限变化先提出建议等待确认。

## M1 真实设备验收

先读 `docs/team-m1-usage.md`、`lib/team-state.mjs`、`team-store.mjs`、`team-protocol.mjs`、`team-coordinator.mjs`、`team-tools.mjs` 及 `scripts/team-smoke.mjs`。

由负责人提供或确认 A/B/C 可用设备和测试目录；实施者不能伪造设备结果或关闭安全策略。记录每台 OS、DSH/插件版本、commit、nodeId、Agent session、LAN地址（不得记录 secret）。配置 Team opt-in、cluster secret、trusted peers、双边授权、指定测试 workspace；先验证目录不含生产数据。

1. A真实Leader，B/C各真实Worker；公开工具创建/派发两项无副作用任务（各在授权目录生成含executionId的独立结果），实际模型执行并report。
2. 检查 ACK、start permission、running、result、review 状态，读取磁盘执行与任务记录，保存脱敏证据。
3. 分别验证重复dispatch/丢ACK、短时断网、超过租约离线、Worker进程退出、Leader/Worker重启、结果回传丢失。只使用批准的测试进程与可逆网络方式；不影响其他网络或生产进程。
4. 每场景记录 taskId/executionId、预期/实际状态、wake次数与副作用次数、恢复动作、日志与持久记录。无法确认结果必须 uncertain；人工确认停止后 reconcile，禁止自动重跑。
5. 缺设备或无法注入故障时记“未验收”，不要以localhost stub通过代替。

通过条件：A/B/C真实模型执行成功；异常状态可解释且无不明重复副作用；重启恢复记录一致；uncertain有明确人工流程。现有真实HTTP stub smoke仅补充自动化证据。

## 下一批 M3（本批次不实施）

读附件计划与设计：独立内容寻址 BlobStore、不可变引用/可变holder、流式授权传输、长度/hash校验、重试、sender+Leader持久化后提交、图片/文件预览、多选/粘贴/拖拽。先确认限制默认值、类型策略、pin/GC、同机副本语义及离线失败行为，再冻结接口。旧单文件base64仅兼容读取，不扩容JSON。需要业务实现前另行交接批准。

## 保留边界与风险

- Mesh v2、Team v1 和 referencesVersion1边界保留；精确mentions不降级广播，skillRefs不授予执行权限。
- Room任务与Team执行独立；未来Runtime adapter/能力标准/Orchestrator另行设计。
- Session截断与同前缀歧义须拒绝；显示名不做授权证据。
- ACK至少一次不等于业务exactly-once。shared secret集群信任、明文HTTP与开放模式风险如实保留。
- M4版本化文档、回滚产生新revision、不可改写审计、无冲突自动提交和冲突人类提案/Leader或维护者确认的既有需求保留。

## DSH交回材料

提交base/head、变更清单、实际命令/退出码/日志、浏览器证据、设备验收矩阵、未解决问题、风险、设计偏差和升级说明。更新ROADMAP；不得自行合并或宣称整个路线图完成。Codex独立读diff、复跑必要回归，输出通过/整改清单，负责人确认后才结束该批次。

## 第一批次实施回执

2026-11-08 实施，分支 `codex/room-collaboration`，未合并、未发布。

### base / head

- base：`4a6cddfb8e1b9fe0ad6f8a20f365e013c0ba9a9d`（`4a6cddf fix: resolve long room reference caller identities`）
- head：`43e572cd51554b30e4b62fbfd3a4ee2405bc8e4b`（`43e572c feat: add room skill references and human member invites`）
- 未合并、未发布、未推送；分支仍为 `codex/room-collaboration`。

### 修改文件

| 文件 | 改动 |
|---|---|
| `client.js` | Room Composer 技能引用选择器：行首 `/` 与工具栏 `/技能` 共用可搜索菜单、chip 删除、发送 `skillRefs`、气泡展示引用与"本机未安装"标记；邀请行由 leader 扩大到房间的人类成员 |
| `index.js` | 新增 `roomSkills` panel endpoint（只读投影本机技能目录，白名单字段，缺失/异常一律 `unavailable`） |
| `lib/service.mjs` | `addRoomMember` 授权改为「leader 或本房间人类成员」，其余事实（调用者身份、成员资格、目标会话归属）全部服务端派生，客户端 `memberNodeId`/`human`/`role` 声明一律忽略 |
| `scripts/panel-check.mjs` | 新增 23 项技能选择器/引用渲染断言与 2 项邀请行断言（共 136 项） |
| `scripts/schema-check.mjs` | 新增 `roomSkills` 真实 RPC 校验（unavailable/ready/同名不折叠/不泄露路径/字段白名单/抛错与畸形降级，共 66 项） |
| `scripts/room-invite.test.mjs` | 新建，8 条邀请权限测试 |
| `docs/ui-contract.md` | `roomSay` 形参补 `mentions?`/`skillRefs?`；新增 `roomSkills` 端点、`SkillRef`/`SkillRow` 类型、§4「技能引用」交互段 |
| `ROADMAP.md` | M2 置为「本批次完成（待 Codex 独立验收）」，M1 保持「设备验收未完成（全部场景未验收）」，M3–M6 标注本批次不做 |
| `docs/handoffs/m1-three-device-acceptance.md` | 新建，M1 真实三设备验收准备清单（12 项场景全部「未验收」） |

### 实际测试命令与结果

| 命令 | 结果 |
|---|---|
| `npm test` | `tests 114 / pass 114 / fail 0`（exit 0） |
| `node scripts/panel-check.mjs` | `panel check: 136/136 assertions passed` / `panel check ok`（exit 0） |
| `$env:DSH_TOOLS_MODULE=<dsh-tools/lib/index.js 的 file:// URL>; node scripts/schema-check.mjs` | `schema check ok — 66/66`（exit 0） |
| `npm run check:composer-compat` | `PASS composer compatibility: DSH 0.2.2-rc.1, 4 public client entry points; no private-import requirement`（exit 0） |
| `node scripts/twin-transport-check.mjs` | `twin transport ok`（exit 0） |
| `node --test scripts/room-invite.test.mjs` | `tests 8 / pass 8 / fail 0`（exit 0） |

沙箱注意事项：`npm test` 在受限文件/进程沙箱下会以 `Error: spawn EPERM`（`errno: -4048`，`syscall: 'spawn'`）失败，因为 `node --test` 需要为每个测试文件派生子进程并捕获管道。这是沙箱边界，不是测试失败；在允许进程派生的环境下直接通过。`schema-check.mjs` 必须显式注入 `DSH_TOOLS_MODULE`，否则会报 `cannot locate the framework schema validator`（脚本设计如此，未硬编码机器路径）。

### 浏览器操作验证

**未完成。** 本批次所有 UI 断言来自 `scripts/panel-check.mjs` 的 DOM 级渲染测试（vm 加载 `client.js` + stub React + stub `fetch`），它验证组件树与 RPC 载荷，**不验证真实浏览器渲染、样式与拖拽/焦点行为**。交付时未启动 `http://127.0.0.1:3080` 做实机点击，因此下列操作仍需 Codex 或负责人用真实浏览器补做并截图：

1. 在房间内输入 `/` → 菜单出现、来源节点名可见、`↑`/`↓`/`Enter` 选中后出现 chip；
2. 直接输入 `/foo` 不选菜单 → 原样发送、气泡无引用块；
3. chip 上 `×` → 引用消失、正文不变；
4. 发送后气泡底部出现「引用的技能」块并显示来源节点；
5. 对端（不同节点）收到后，本机不存在的技能显示虚线 + 「本机未安装此技能」；
6. 非 leader 的人类成员在成员面板看到邀请行并能成功拉入一个本机会话；
7. 非成员看不到邀请行。

### 未解决问题与风险

1. **M1 完全未验收**：本批次没有任何真实设备运行。`docs/handoffs/m1-three-device-acceptance.md` 的 12 项场景全部为「未验收」，`scripts/team-smoke.mjs` 仍是 stub runtime + localhost + 同节点双 Worker，不能替代。
2. **技能目录只本机**：`roomSkills` 只列本节点技能。跨节点技能目录需要新的协议与信任模型，本批次未做，也未定义。因此「同名不同源」在本机目录中不会出现（registry 已按 rank 去重），该去重键 `(sourceNodeId, name)` 目前只是为将来预留的正确形状。
3. **接收方无法验证来源**：`skillRefs` 的 `sourceNodeId`/`sourceNodeName` 由发送节点自行填写，接收方无法独立验证其真实性。它只是提示性元数据，不参与任何授权判断，但如果将来基于它做安装或执行决策，必须重新设计。
4. **`skillRefs` 无版本**：引用中没有记录技能版本或环境。文档中明确保留为下一批议题。
5. **邀请权限的边界**：人类成员可以拉入本节点任意可达会话（含已存盘可恢复的会话），但没有「这个会话是否应该进这个项目」的额外策略。若需要按 workspace 或角色限制，需要新的设计。
6. **Agent 加入房间不授予 Team 执行权限**：本批次保持了这一边界，`addRoomMember` 不写 Team 账本，但这一点只有代码约定，没有独立的回归测试断言。
7. **`addRoomMember` 的错误码**：权限失败统一返回 `NOT_LEADER`，目标会话非法返回 `BAD_REQUEST`。错误码沿用了旧语义（`NOT_LEADER` 现在覆盖「非 leader 且非人类成员」），前端只展示消息文本，不影响行为，但如果外部有按错误码分支的调用方需要同步。

### 设计偏差

1. **没有复用官方 InputBar / 技能选择器组件**：官方 InputBar 绑定 Session，Room 没有 Session；`@deepseek-ai/dsh-client-ui-skill` 也没有公开的独立 picker 组件。因此菜单、chip、键盘路由都是 Room 自有实现，只消费 `ctx.skills.list()` 这个公开服务接口。这与 `docs/development-room-composer-compat.md` 记录的结论一致。
2. **`roomSkills` 是新增 panel endpoint**，不是工具（不进 `ctx.tools`）。原因是它是面板渲染用的只读投影，不需要 Agent 侧可见；这也避免扩大 Agent 的工具面。
3. **邀请权限从「仅 leader」放宽到「leader 或人类成员」是行为变更**，由负责人本轮明确授权。规划文档（`ROADMAP.md` 与 `docs/architecture/project-workspace.md`）中关于权限的描述需要相应更新——本批次已更新 ROADMAP，架构文档中「显式授权」的具体表述留给下一批一致性整理。
4. **`schema-check.mjs` 仍要求外部注入 `DSH_TOOLS_MODULE`**，本批次按交接包要求「不要复制机器路径作为产品默认值」，未改动这一约定。
