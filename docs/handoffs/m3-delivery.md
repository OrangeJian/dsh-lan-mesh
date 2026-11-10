# M3 附件交付与验证记录

状态：**九项终审发现已逐项整改并有可执行回归，待 Codex 独立复核。** 完整问题见 [M3 终审整改清单](dsh-m3-review-findings.md)，本轮整改的问题→根因→提交→验证→剩余限制对应表见下文「M3 整改结果」。#7 只完成读取侧，「发送后才加入且发送者已离线」的迟到成员仍需元数据回填/中继，本文件不把它写成已完成。

## M3 整改结果（2026-11-10，DSH）

整改提交：`6999d2a`（源码，5 文件 267+/55-）、`bf348d8`（`scripts/m3-review-regression.test.mjs`，11 项回归）。分支 `codex/room-collaboration`，未合并 main、未发布。整改前业务基线 `221901b`，文档交接基线 `37f2ae8`。

| # | 问题（终审） | 根因 | 整改 | 提交 | 验证（命令 / 退出码 / 结果） | 剩余限制 |
|---|---|---|---|---|---|---|
| 1 阻塞 | 凭其他房间已有 digest 就能 commit/GET | `commit()` 只查节点级 `store.has(blobId)`，没有任何「本节点确实接收过这些字节、且限定了 sender/room/intent」的持久凭据 | 新增 per-intent 收据：`receiptRefKey()`、`ledger.recordReceived()`、committed 前远端必须 `receivedRefs` 命中；`createBlobHandler` 新增 `onReceived`，PUT 必须先记录收据才返回 201（失败 `RECEIPT_UNAVAILABLE` 503）；续期清空 `receivedRefs`，捕获重放不能复活授权 | `6999d2a` | `m3-review-regression.test.mjs`「#1」「#1 migration」「#1 renewal」；`npm test` 180/180 exit 0 | 收据是本地接收事实的持久化，不提供受信节点之间的独立密码学隔离；仍沿用 Mesh 集群信任边界 |
| 2 高 | 未校验签名目标、收件资格与续期新鲜度 | `receive()` 直接进 ledger，`to`、当前成员身份都不校验；续期只看 `expiresAt` | 入站持久化前校验：房间存在且 `kind==='room-message'`（否则 `BAD_ATTACHMENTS`）、`envelope.to===this.nodeId`（否则 `WRONG_TARGET`）、发送者是当前成员、本节点仍是成员;续期必须伴随同一内容的新 prepare 请求，同时清空收据 | `6999d2a` | `m3-review-regression.test.mjs`「#2」；`room-attachments.test.mjs`「expiry survives reopen, signed identical prepare renews」；`npm test` 180/180 exit 0 | 重放边界仍由 blob 协议 nonce + 120 秒窗口约束，未引入独立密钥协商或版本化签名语义 |
| 3 高 | 已读重写与重启恢复丢附件引用 | `#saveInbox()` 全量重写漏 `attachments`；`publish()` 见到同 ID 直接跳过，被剥离的记录永远补不回来 | `#saveInbox()` 复制不可变引用；`publish()` 在 existing 分支原地补 `attachments` 后 `#saveInbox()`（保留原 read 状态、不重复消息、不唤醒），启动重发（`notify=false`）顺带修复旧磁盘记录 | `6999d2a` | `m3-review-regression.test.mjs`「#3 mark-as-read」「#3 repair」；`inbox-read.test.mjs` 5/5；`npm test` 180/180 exit 0 | 修复依赖 committed ledger 仍持有该意图；账本被清空后无法回填 |
| 4 高 | 发送期间持事务队列，双节点互发互等超时；重试扫描叠加 | `send` 的整个网络流程包在 `ledger.run()` 里，入站 prepare/commit 也要排队 | 拆五阶段：P1 队列内只做原子状态（normalize/对照 uploads/prepare(local)/pin/成员/leaderNodeId），P2/P4 网络在队列外，P3 `ledger.run(commit)` 回队列，P5 落盘 result；`inFlight` 合并同 ID 发送与 retry；`close()` 前 `drain()` | `6999d2a` | `m3-review-regression.test.mjs`「#4 concurrent」「#4 queue free」；`room-attachments.test.mjs` 25/25；`attachment-smoke` 2 PASS exit 0 | 仍不承诺跨进程同时写同一目录，也不承诺所有平台掉电时的目录持久化 |
| 5 高 | 后台悄悄重发失败草稿 | `retry()` 对未提交的本地 prepared 无条件重发 | 后台扫描 `{background:true}` 跳过 `status!=='committed'`；操作员显式 retry 仍可发布；丢 ACK 走同 messageId 幂等恢复，不产生第二条 | `6999d2a` | `m3-review-regression.test.mjs`「#5 background」「#5 operator」；`attachment-smoke` 离线 Leader 恢复段 | 已提交消息不提供撤回；草稿的可编辑/放弃语义由界面持有，Host 不再代为发送 |
| 6 重要 | 生产环境无孤儿清理，放弃的上传长期占配额 | `collectOrphans()` 只有测试调用 | 接入真实节点生命周期：`attachmentGcTimer`（3600000 ms）+ 启动各执行一次；`collectGarbage()` 释放孤儿并按 `collected` 清理对应 stale upload 记录；`close()` 清理定时器 | `6999d2a` | `m3-review-regression.test.mjs`「#6 gc」「#6 stale uploads」；`room-blob-store.test.mjs` 通过 | 宽限期仍是 `orphanGraceMs`（24 h）；没有用户级「取消准备并立即释放」界面 |
| 7 重要 | holder 按需拉取未接产品，迟到成员拿不到字节 | `read()` 只开本地文件；`readPeerBlob()` 无生产调用；`declareHolder()` 未使用 | `read()` 本地无字节时遍历当前房间成员找可达 holder，`readPeerBlob()` 校验长度/mediaType/SHA-256 成功后才 `declareHolder()`；无可达 holder 抛 `attachment is temporarily unavailable; no reachable holder` | `6999d2a` | `m3-review-regression.test.mjs`「#7 holder fetch」「#7 no holder」「#7 cross-room」；`attachment-smoke` 真实双节点 | **只完成读取侧。** 真正「A 发送后才加入、A 已离线」的迟到成员在自己账本里没有 committed ref（`rooms.json` 反熵不携带附件引用，`normalizeRoom` 是固定字段集），需要元数据回填/中继，未实现；此场景不宣称通过 |
| 8 重要 | 旧普通成员看不到可读提示 | `deliverToPeer()` 对不支持 references/attachments 的旧节点直接抛错 | `replicate(e,peerId,true)` 在 peer 明确不支持附件时发送纯文本（正文 + 文件名 + 「不支持附件预览」提示），保持精确签名 `to`，不带 attachments/mentions，不扩成广播，job 保持 pending；Leader 路径不允许降级，旧 Leader 仍失败并保留草稿 | `6999d2a` | `m3-review-regression.test.mjs`「#8 old member」「#8 old leader」；`room-message.test.mjs` 默认 `UNSUPPORTED_REFERENCES` 行为保持不变 | 降级是同一 messageId 的一条纯文本；对方升级后补传由 `publish()` 原地补引用而非重复正文，但界面会出现「先文本、后附件」的同一消息 |
| 9 次要 | 同字节多附件界面 key 重复 | 卡片 `key` 只有 `blobId` | 改为 `key={\`${blobId}/${index}\`}`，存储继续按内容寻址去重 | `6999d2a` | `m3-review-regression.test.mjs`「#9」；`panel-check` 167/167 exit 0 | 纯前端 key 修正，不改变去重语义 |

### 整改后的自动化验证（全部为 2026-11-10 在 `codex/room-collaboration` 实测）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm test`（第一次） | 1 | Windows EPERM `rename`：`.attachment-test-*\lan-mesh\instances\39001\blobs\.metadata-*.tmp` → `metadata.json`；保留原始失败记录，不计为产品通过 |
| `npm test`（重跑） | 0 | **180/180 pass**（原 169 + 新增 11） |
| `node scripts/panel-check.mjs` | 0 | `panel check: 167/167 assertions passed`（事件/渲染 harness，非真实浏览器） |
| `node scripts/schema-check.mjs`（`DSH_TOOLS_MODULE=file:///D:/softwareNew/nodejs/node_global/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`） | 0 | `schema check ok — 72/72`；原始 Windows 路径会报 `Received protocol 'd:'`，故必须用 `file:///` URL |
| `npm run check:composer-compat` | 0 | `PASS composer compatibility: DSH 0.2.2-rc.1, 4 public client entry points` |
| `node scripts/twin-transport-check.mjs` | 0 | `twin transport ok` |
| `node scripts/attachment-smoke.mjs` | 0 | 2 PASS：在线流式二进制/hash/双端 pin/授权下载/同 ID 去重；Leader 实际关闭重启后的离线恢复与补传 |
| `node scripts/rooms-smoke.mjs` | 0 | `rooms interop ok` |
| `node scripts/smoke.mjs` | 0 | `all checks passed` |
| `node scripts/agents-smoke.mjs` | 0 | `agents interop ok` |
| `npm run test:team:smoke` | 0 | 2 PASS：两个 Worker 各唤醒一次并落 review；吊销本机授权阻止执行 |

证据边界：以上全部是单机、localhost、stub runtime / panel harness 级别的自动化证据。**真实浏览器操作与两台物理设备验收仍未执行**，本轮没有操作或重载任何浏览器，也没有使用 stubbed followup 冒充真实模型跨设备执行。`python`/`pwsh` 环境下的 Windows EPERM 属于文件锁竞态，重跑通过，但首次失败必须与重跑结果一起记录。

### 不得据此宣称的结论

- 不能说 #7 已完整通过：迟到成员获取被授权引用依赖 Leader 回填元数据，未实现。
- 不能说 M3 已通过终审：本轮只是把九项发现整改到「有可执行回归且全绿」，终审结论由 Codex 独立复核给出。
- 不能把本地 HTTP / stub runtime / panel harness 结果当作真实浏览器或双设备验收。

## 整改前基线（历史记录，保留原文）

> 以下为终审前 M3 的实施与验证记录，用于对照，不代表当前代码状态。

完整问题与验证要求见 [M3 终审整改清单](dsh-m3-review-findings.md)。

## 实施提交与自动化证据

本次 M3 基线 `2776bda`。已提交存储 `8d8d79b` / `2c5d7a4`、传输 `de2e8e7`、消息协调 `62c3d73` / `08d4d87` / `498cd26`、界面与 Host 集成 `221901b`。终审范围为 `2776bda..221901b`，结论为规格未通过、质量需整改；后续文档提交不改变业务基线。

终审发现：跨房间 digest 授权绕过、目标/收件成员/续期新鲜度缺失、已读重写丢引用、网络持事务队列造成双向阻塞、后台发送失败旧稿、生产 GC 未接、holder 按需读取未接、旧普通节点可读降级遗漏，以及重复界面 key。**下述行为是已实现部分及原设计目标，不代表这些缺口已修复。** DSH 必须先整改并回归。

`221901b` 的实施者最终记录如下，原始本地日志与任务报告保留在 `.superpowers/sdd/2026-11-08-room-attachments/`；关键结果同步到本文件以便其他机器阅读：

| 检查 | 实际结果 |
|---|---|
| `npm test` | 169/169，exit 0 |
| `node scripts/panel-check.mjs` | 167/167，exit 0；事件/渲染 harness，非真实浏览器 |
| `node scripts/schema-check.mjs` | 官方校验器 72/72，exit 0；使用本机实际 `DSH_TOOLS_MODULE` |
| `npm run check:composer-compat` | DSH 0.2.2-rc.1 公共接口兼容检查通过 |
| `node scripts/twin-transport-check.mjs` | 通过，exit 0 |
| `node scripts/rooms-smoke.mjs` | 通过，exit 0 |
| `node scripts/attachment-smoke.mjs` | 真实本地双节点：65,537 字节二进制内容、双端 pin、授权下载、Leader 实际关闭/重启、补传与同 ID 去重通过，exit 0 |

过程中保留了真实失败与修正记录：存储发布竞态、消息权限与配置恢复、旧格式写入、网关取消时未处理流错误、界面切房间竞态均有 RED/GREEN 回归。部分受限环境网络检查先报 EACCES，允许本地测试网络后运行通过；此前全量测试遇过 Windows EPERM rename，原始失败及重跑记录均保留，不计作产品已通过的首次结果。

用户明确要求自行打开验证，因此本轮未重载或操作真实浏览器产品界面，未执行两台物理电脑验收。

## 已确定的行为

- 新附件使用独立内容寻址存储，消息只有引用，不包含 base64 文件数据。旧消息中的内联附件继续可读，新写入旧格式被拒绝。
- 默认单文件 20 MiB、每条最多 8 个、每条合计 40 MiB、本节点文件总量 200 MiB；具体以 Host 当前公布的配置为准。
- 文件按实际字节数与 SHA-256 校验。发送节点和房间 Leader 都持久化、固定引用后才确认发送；两者同一节点时只有一份物理副本。
- Leader 离线或不支持附件时返回可重试失败，保留准备状态；不能显示为发送成功。普通成员离线产生持久补传任务，恢复后重试。
- 稳定 messageId 支持丢回执后安全重试；同 ID 改变内容会拒绝。超时准备状态只可通过身份验证且内容一致的新 prepare 续期，PUT/commit 自身不续期。
- 授权以房间和成员身份为准，知道文件摘要不能跨房间读取。人类面板与 Agent 工具的身份由调用入口绑定。

## 关键裁定与代价

1. 使用 pin/unpin 与持久消息账本保护已引用文件。否则孤儿清理可能删除已发送附件；代价是保守保留，待处理任务也可能持续占用配额。
2. 独立签名 prepare/上传/commit，默认准备期 15 分钟；精确绑定发送节点、房间、摘要及不可变消息内容。代价是多一次握手和账本写入。
3. 同内容的新签名 prepare 可续期，旧 PUT/commit 不能自行续期。代价是继续信任现有集群认证模型；仍不提供受信节点之间的独立密码学隔离。
4. 配置与浏览器/模型入口统一在界面集成阶段接入；结构校验和可配置接收限额分离。代价是恢复时按历史合法内容校验，调低配额不会自动清除旧内容。

## 尚须明确保留的限制

- 自动化本地 HTTP 测试不等于两台物理电脑验收，也不等于真实模型的跨设备执行验收。
- 原子文件写入采用文件 fsync+rename；不承诺跨进程同时写同一目录或所有平台掉电时的目录持久化。
- 待处理 pin/提案保守保留，不自动删除已提交引用。暂未提供用户级取消准备状态及释放其 pin 的清理界面；配额耗尽会明确失败。
- Agent 唤醒不承诺外部副作用 exactly-once；崩溃在持久化与唤醒之间可能遗漏一次唤醒，重启不会盲目重跑。
- 附件签名/开放集群身份沿用 Mesh 的信任边界；能力声明本身不授权。

## 负责人在其他机器上的验收步骤

1. 两端同步同一开发分支及提交，重载插件，核对可见节点、房间成员与 Leader；避免一端仍加载旧源码。不要覆盖有未提交修改的工作区。
2. 在非 Leader 机器加入房间，选择多个普通文件和一张图片，验证预览、移除、粘贴图片与拖入文件；发送后在两端查看及下载，比较原始文件内容。
3. 测试仅附件不填正文，确认文件名可读；超过数量/单文件/合计限制应明确拒绝，保留可继续编辑的草稿。
4. 让 Leader 的测试实例暂时不可达，尝试发送，确认不报成功、保留草稿；恢复该实例后重试，确认消息只有一条且文件能读。不修改整机防火墙或影响其他工作。
5. 普通成员离线时发送，恢复成员后检查补传；重载两端再查看历史并下载。
6. 在另一个未引用同一文件的房间尝试读取应被拒绝。旧单文件历史仍能显示。
7. 回归 @ 同名 Agent 的机器消歧、精确唤醒、技能只引用、设为任务、运行转圈、收件箱已读和自身消息排除。

发现问题时保留两端 commit、具体操作、错误提示、脱敏控制台/Host 日志；不要记录共享密钥。

## 后续开发

将 [DSH 启动提示词](dsh-after-m3-prompt.md) 交给 DSH。先完成 [M3 整改](dsh-m3-review-findings.md)，再按共享文档、项目上下文、房间生命周期、编排的顺序推进；交回正式回执后由 Codex 独立复核。
