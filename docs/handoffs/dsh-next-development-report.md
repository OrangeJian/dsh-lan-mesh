# DSH 开发转交报告（M3 收尾整改）

> 日期：2026-11-11　分支：`codex/room-collaboration`　HEAD：`313e398`
> 复核入口：本文件「4. 复核入口」+「5. 结论口径」。
> **本文不是「M3 已通过终审」的声明。** 本轮按 [M3 收尾整改计划](../superpowers/plans/2026-11-10-m3-completion-remediation.md) 完成 5 个 Task，每项先复现 RED 再修，终审结论由 Codex 独立复核给出。

---

## 0. 一句话结论

本轮只做 M3。第一轮九项终审整改（`6999d2a`/`bf348d8`）之上，按收尾计划补完 5 个此前未被覆盖的真实缺口：收据写入的事务串行（`d3558e5`）、同 ID 并发的内容校验（`d595118`）、旧节点通知的定向保真（`2b7388b`）、迟到成员的授权历史同步（`f538cbc`）、丢 ACK 的只读对账（`313e398`）。全量自动化验证 198/198（`npm test`），另有 M3 回归 23/23 与三节点同步 6/6。**M4 / M5 / 房间生命周期 / M6 本轮没有写任何实现代码。** 真实浏览器操作与两台物理设备验收仍未执行。

---

## 1. 本轮实际做了什么

| 项目 | 状态 | 证据 |
|---|---|---|
| Task 1 收据写入纳入事务队列 | 已实现，RED→GREEN | `d3558e5` |
| Task 2 同 ID 并发先校验内容 | 已实现，RED→GREEN | `d595118` |
| Task 3 旧节点通知不得扩大唤醒目标 | 已实现，RED→GREEN | `2b7388b` |
| Task 4 迟到成员经 Leader 同步历史引用与字节 | 已实现，三节点 RED→GREEN | `f538cbc` |
| Task 5a 丢 ACK 只读对账 | 已实现，RED→GREEN | `313e398` |
| Task 5b 续期新鲜度 + GC 并发复核 | 已加固并有测试 | `313e398` |
| Task 5c 全量验证 | 通过，见 §3 | — |
| Task 5d 文档与推送 | 本提交 + `git push` | 见 §6 |
| M4 / M5 / 生命周期 / M6 | **未实现**（各自仅设计或计划文档） | 见 §5 |

### 提交清单（业务基线 `221901b` → HEAD）

| 提交 | 类型 | 内容 | 文件 |
|---|---|---|---|
| `37f2ae8` | 基线 | 上一批交接文档（本轮起点） | — |
| `6999d2a` | 代码 | 第一轮 M3 #1–#9 整改 | 5 文件 267+/55- |
| `bf348d8` | 测试 | 第一轮 9 项发现的可执行回归 | 新增 456 行 |
| `7eac0b3` | 文档 | ROADMAP / ui-contract / usage / m3-delivery / 生命周期设计 / M6 计划 / 首版报告 | 7 文件 1057+/5- |
| `d3558e5` | 代码+测试 | **Task 1** 收据事务串行 | 3 文件 118+/7- |
| `d595118` | 代码+测试 | **Task 2** 同 ID 内容校验 | 3 文件 104+/10- |
| `2b7388b` | 代码+测试 | **Task 3** 通知定向保真与 fail-closed | 2 文件 163+/19- |
| `f538cbc` | 功能+测试 | **Task 4** 迟到成员授权历史同步 | 8 文件 1080+/1- |
| `313e398` | 代码+测试 | **Task 5a/5b** 丢 ACK 对账 + 续期/GC 加固 | 4 文件 305+/1- |

累计代码差异：12 文件 2365+/60-（不含文档）。**未合并 main，未发布 npm，未 reset / 未 clean / 未 force push / 未改写历史。**

---

## 2. 五个 Task：问题 → 根因 → RED → 提交 → 验证 → 剩余限制

完整对应表见 [`docs/handoffs/m3-delivery.md`](m3-delivery.md)「M3 收尾整改结果（第二轮）」。此处列关键点。

| Task | 根因（一句话） | 整改要点 | RED 证据（先失败） | 剩余限制 |
|---|---|---|---|---|
| 1 | `onReceived` 绕过 `ledger.run()` 自己 `save()`，两个并发 PUT 各自快照 | 收据写进同一串行队列；`recordReceived` 在队列内 clone 上重新校验有效期/房间/发送者/精确 ref | 并发 barrier 测试首跑 `AssertionError: receipt for A survived`；另发现 `#receiptTargets` 返回 boolean 被当 `.length` 用，导致所有收据被静默拒绝、PUT 恒 503 | 收据是本节点本地事实，不提供节点间独立密码学证明 |
| 2 | `withInFlight` 只按 `sender+messageId` 取 Promise，在 fingerprint 校验之前就合并 | 入队前规范化+深拷贝+算 canonical fingerprint；`inFlight` 存 `{fingerprint,promise}`，不同 fingerprint 立即冲突；`sayInRoom` 在首个 await 前快照入参 | 首跑 `Missing expected rejection`（改正文/附件/mentions/session 四个变体都没拒绝） | 只解决同节点内并发；跨节点同名 ID 由 Leader fingerprint 拒绝 |
| 3 | 降级通知删掉 `mentions`，接收端回退到正文 token 推导，`@all` 命中即全节点唤醒 | 有 `roomReferences:1` 的旧节点走签名 references 消息并**始终带 `mentions`**；完全没有精确引用能力的节点 **fail closed**；新增 `metadataDelivered`/`blobDelivered` 区分元数据与字节 | 三个测试首跑全失败：`blobDelivered` 不存在；`@all.txt` 把 `['b-one']` 变成 `['b-one','b-two']`；无 references 节点仍 `ok:true` 收到消息 | 极旧节点不再收到任何投递，只能升级后补传；界面须显示「不兼容」而非「已送达」 |
| 4 | `rooms.json` 反熵不携带附件引用，迟到节点账本里没有 committed ref | 独立 Leader 元数据通道：`roomAttachmentSync:1` + `POST /lan-mesh/v1/room-attachment-sync`，双向 HMAC、页面 hash、分页 50/100、响应 ≤1 MiB；Leader 端重校验 Leader 身份与成员资格，只输出 committed；客户端 `importManifest()` 独立事务导入（同 ID 同 fingerprint 幂等、不同 fingerprint 报冲突不覆盖）；导入不唤醒、不要求本地有字节；`joinRoom` 后由产品入口有界回填 | 三节点真实测试首跑超时：迟到成员拿不到清单（根因 `roomAttachmentHandler()` 返回 handler 而非 service，`service.ledger` 为 `undefined`） | 依赖 Leader 在线提供清单；Leader 离线时不阻塞启动也不伪造历史；只同步 committed |
| 5a | 丢 ACK 后本地停在 prepared 且无 result，后台按设计跳过未提交草稿 → 永久悬空 | `recordReconcile()` + `api.reconcile()` + `reconcileRoomAttachmentDeliveries()`：队列外分页拉 Leader 清单，只认本节点作者；未出现→`absent`（明确失败，可显式重试）；一致→导入并发布（不唤醒）；不一致→`unknown` 不采纳；Leader 不可达→不写任何结论 | 用 HEAD 版 lib 单跑新测试：18 pass / 3 fail，全部 `TypeError: a.reconcileRoomAttachmentDeliveries is not a function` | `absent` 不自动重发，需操作员决定 |
| 5b | 续期清空收据是否足以防止旧请求复活；GC 是否与收据/提交并发冲突 | 测试固化：续期后捕获的旧 prepare 重放仍 commit 失败，只有新 nonce 的新 PUT 才能重新铸收据；GC 不动已 committed pin、不动对应 uploads、与在途发送并发后账本仍可重开且一致 | 该 Task 为复核+加固，无独立 RED（测试与实现同批） | 掉电时目录元数据持久化仍不承诺 |

### 第一轮九项（已在前批完成，本轮未回退）

| # | 等级 | 关键整改 | 剩余限制 |
|---|---|---|---|
| 1 | 阻塞 | per-intent 收据 `receivedRefs`，PUT 先落收据才 201 | 同上：无节点间独立密码学证明 |
| 2 | 高 | 入站校验 `to`/room/kind/双方成员；续期须内容一致新 prepare 且清空收据 | 重放边界由 nonce + 120 s 窗口约束 |
| 3 | 高 | `#saveInbox()` 复制 attachments；publish 原地补引用并保存 | 依赖 committed ledger 仍持有该意图 |
| 4 | 高 | 五阶段发送，网络移出队列；`inFlight` 合并；`drain()` | 不承诺跨进程同写同目录 |
| 5 | 高 | 后台跳过未提交草稿 | 已提交不提供撤回 |
| 6 | 重要 | GC 接入节点生命周期（每小时+启动），清理 stale uploads | 宽限期仍 24 h |
| 7 | 重要 | 读取侧按需取字节并校验后 pin；**本轮补齐元数据回填侧** | 依赖 Leader 在线 |
| 8 | 重要 | 定向保真（本轮重做，见 Task 3） | 极旧节点 fail closed |
| 9 | 次要 | `key=\`${blobId}/${index}\`` | 无 |

---

## 3. 验证证据（2026-11-11 实测，全部记录退出码）

在 `C:\Users\jian\.codex\worktrees\room-collaboration\dsh-lan-mesh`、分支 `codex/room-collaboration`、HEAD `313e398` 上实测：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --test scripts/m3-review-regression.test.mjs` | 0 | **23/23 pass**（3.3 s） |
| `node --test scripts/room-attachment-sync.test.mjs` | 0 | **6/6 pass**（三节点真实 HTTP） |
| `node --test scripts/*.test.mjs`（≡ `npm test`） | 0 | **198/198 pass**，72 477 ms |
| `node scripts/panel-check.mjs` | 0 | `panel check: 167/167 assertions passed` |
| `node scripts/schema-check.mjs` | 0 | `schema check ok — 72/72` |
| `npm run check:composer-compat` | 0 | `PASS composer compatibility: DSH 0.2.2-rc.1, 4 public client entry points` |
| `node scripts/twin-transport-check.mjs` | 0 | `twin transport ok` |
| `node scripts/rooms-smoke.mjs` | 0 | `rooms interop ok` |
| `node scripts/attachment-smoke.mjs` | 0 | **3 PASS**（第三条为本轮新增：发送者离线后迟到成员从 Leader 同步历史并校验字节） |
| `node scripts/smoke.mjs` | 0 | `all checks passed` |
| `node scripts/agents-smoke.mjs` | 0 | `agents interop ok` |
| `npm run test:team:smoke` | 0 | 2 PASS |

`schema-check` 需要官方校验器路径：
`$env:DSH_TOOLS_MODULE='file:///<实际 dsh 安装>/node_modules/@deepseek-ai/dsh-tools/lib/index.js'`（原始 Windows 路径会报 `Received protocol 'd:'`）。

### 保留的失败记录（未计为通过）

| 场景 | 现象 | 处置 |
|---|---|---|
| 第二轮首次 `npm test` ×2 | 挂起 >600 s | 查明是被 kill 的上一轮 `node --test` 残留进程占端口/MeshNode 句柄；清理后 `--test-timeout=90000` 跑通 193/193 |
| `npm test` 再跑 | EXIT=1，Windows EPERM `rename` `.room-blob-test-*/\.metadata-*.tmp` → `metadata.json` | 文件锁竞态；原样重跑 193/193 exit 0。首次失败与重跑并列记录 |
| `room-attachment-sync.test.mjs` | 首跑 1 pass / 5 fail | 3 项为真实产品缺陷（按需读取未 pin、策略错误被抹成 `SYNC_FAILED`、回填拿不到 service），2 项为测试写法错误；均已修正 |
| `m3-review-regression.test.mjs` 三批新测试 | Task 1 首跑 `receipt for A survived`；Task 2 首跑 `Missing expected rejection`；Task 3 首跑三处语义失败；Task 5a 用 HEAD lib 跑出 3 fail | 每项均为「先看到失败、再修到通过」，见 §2 RED 列 |

### 证据边界（不得混淆）

- 以上全部是 **单机 / localhost / stub runtime / panel harness / 多进程 MeshNode** 级自动化证据。
- **真实浏览器操作：未执行。** 本轮没有操作、重载或截图浏览器；没有伪造任何截图或真机结果。按用户要求浏览器由用户自行验证。
- **两台物理设备 / 真实模型跨设备验收：未执行。** M1 三设备 12 项场景仍全部「未验收」。
- 三节点同步测试证明的是**同一台机器上三个真实 HTTP 进程**的协议行为，不等于跨物理机与真实模型验收。

---

## 4. 复核入口

1. **结论口径**：先读本文件 §5 的四类划分。
2. **看收尾计划**：[`docs/superpowers/plans/2026-11-10-m3-completion-remediation.md`](../superpowers/plans/2026-11-10-m3-completion-remediation.md)（已随 `f538cbc` 提交），5 个 Task 的验收要求。
3. **看代码差异**：`git diff 37f2ae8..313e398 -- lib client.js index.js`。
4. **看逐项对应表**：[`docs/handoffs/m3-delivery.md`](m3-delivery.md)「M3 收尾整改结果（第二轮）」与「M3 整改结果（第一轮）」。
5. **重点复核 Task 4 的协议**：`docs/rooms-contract.md` §4.4；实现 `lib/room-attachment-sync.mjs`（395 行）+ `lib/room-attachment-ledger.mjs` 的 `committedPage`/`importManifest`。
6. **重点复核迟到成员是否真的走产品入口**：`scripts/room-attachment-sync.test.mjs` 首个测试与 `scripts/attachment-smoke.mjs` 第三条 —— 都不预置账本，而是 `joinRoom()` → 后台回填 → `readRoomAttachment()` 下载校验。
7. **重跑**：
   ```powershell
   npm test                                  # 期望 198/198
   node --test scripts/room-attachment-sync.test.mjs   # 期望 6/6
   node scripts/panel-check.mjs              # 期望 167/167
   $env:DSH_TOOLS_MODULE='file:///<实际安装>/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
   node scripts/schema-check.mjs             # 期望 72/72
   npm run check:composer-compat
   node scripts/twin-transport-check.mjs
   node scripts/attachment-smoke.mjs         # 期望 3 PASS
   node scripts/rooms-smoke.mjs
   ```
8. **质疑诚实性**：核对本文件、`m3-delivery.md`、`ROADMAP.md`、`docs/ui-contract.md`、`docs/usage.md` 是否把未实现写成已实现；M4/M5/生命周期/M6 是否被误标为有代码。

---

## 5. 结论口径（四类，不得混用）

### 已实现且验证（自动化层面）

- M3 第一轮 #1–#9 全部整改。
- M3 第二轮 Task 1–5a 全部实现；Task 5b 加固并有测试。
- 具体：per-intent 收据与串行事务、入站目标/成员校验、续期新鲜度、已读重写保留引用、网络移出事务队列、同 ID 内容校验、后台不代发草稿、生产 GC、按需 holder 读取、旧节点定向通知与 fail-closed、迟到成员元数据同步并下载校验、丢 ACK 只读对账、附件卡 per-item key。

### 已实现待实机

- M3 全部整改的**真实浏览器**行为：代码与本地自动化就绪，未在真实浏览器操作验证。
- **双/多物理设备**行为：三节点同步只在单机多进程下验证。
- M1/M2 既有实现同样只到 localhost/stub 级别。

### 设计 / 未实现

- **M4 共享 Markdown**：无业务实现（状态模型、diff3 合并、审计链、协议、界面均未写）。
- **M5 Project Context**：无实现。
- **房间生命周期**：只有设计方案 `docs/superpowers/specs/2026-11-10-room-lifecycle-design.md`（465 行），无代码、无测试；方案内 9 条本地裁定与全部待决项待负责人复核。
- **M6 自动编排**：只有实施计划 `docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md`（326 行），无代码；D1–D9 九项协议/权限待决项均标 OPEN，工具名与字段为 PROPOSAL。

### 外部阻塞

- **M1 三设备 12 项验收**：需负责人提供 A/B/C 设备与真实模型，实施者无法替代。
- **真实浏览器验收**：按交接要求由负责人自行执行。
- **房间生命周期进入实现**：`docs/development-workflow.md` 要求方案先获负责人确认。
- **M6 重大协议/权限（D1–D9）**：资料不足，需负责人/Codex 裁定；M6 还依赖 M1 实机验收与 M5。
- **迟到成员同步的跨机行为**：协议与实现已就绪，但只有在两台真实机器上才能确认端口/发现/防火墙路径。

---

## 6. 推送与最终状态

- 分支：`codex/room-collaboration`
- 本轮开始前远端 HEAD：`37f2ae8`（与本轮 base 相同）
- 本轮结束后推送：本地 `313e398` → `origin/codex/room-collaboration`
- 推送方式：普通 `git push`（快进，远端为本地祖先），**未 force push，未合并 main，未发布 npm**
- 未提交内容：仅 `.test-tmp/`（本地临时目录：提交信息草稿、调试脚本、测试 HOME），按约定不入库

---

## 7. 升级 / 回退

- **升级**：拉取 `codex/room-collaboration` 到 `313e398` 后重载插件。协议对旧节点保持协作降级（Task 3）：支持精确引用的旧节点仍收可读文本，完全不支持的 fail closed 并明确报不兼容。
- **回退到 `f538cbc` 之前**：迟到成员拿不到历史引用、丢 ACK 无法对账；已导入的 `imported` 条目仍按 committed 处理，不丢历史，只失去回填与对账能力。
- **回退到 `6999d2a` 之前**：重新暴露 #1 跨房间授权绕过，只能作为临时手段。
- **存储兼容**：账本新增 `receivedRefs`、`imported`、`relayNodeId`、`reconcile`，全部向前读兼容（缺字段按缺省）；旧代码忽略新字段；无迁移脚本。
- **不建议**：未复核前合并 main 或发布 npm。

---

## 8. 剩余问题（交负责人 / Codex 决定）

1. **迟到成员同步的 Leader 依赖**：Leader 离线时迟到成员只能看到「暂时不可用」。是否需要多 holder 清单（由任意持有者提供）作为后续增强？
2. **极旧节点 fail closed 的产品口径**：完全不支持精确引用的节点不再收到任何投递，是否需要提供一个更老的、经验证不触发 Agent 的只读通道？这属于新增协议版本，超出本轮授权。
3. **`absent` 对账后的产品动作**：目前只标记明确失败并允许人工重试，是否需要「一键重发」显式按钮？
4. **M4 起步**：纯状态/合并模块可在无待决项下开工，但审计链原子性与新增端点需先改冻结契约 `docs/ui-contract.md`。
5. **生命周期 9 条本地裁定**与 **M6 D1–D9**：需负责人逐条确认或否决。
6. **真实浏览器 / 三设备验收**：仍待负责人执行。

---

## 9. 给 Codex 的复核提示

- 本轮**没有**把任何「待整改」写成「已通过」。`ROADMAP.md` M3 行写的是「九项终审发现已整改 + 第二轮收尾整改已实现（待 Codex 独立复核）」。
- 本轮**没有**对 M4/M5/生命周期/M6 声称实现。
- RED 证据是本轮**当场复现**的（§2 末列与 §3「保留的失败记录」），不是事后追述；Task 5a 的 RED 用 HEAD 版 `lib/` 单独跑 `.test-tmp/red/` 副本得到 3 个 `TypeError`。
- `m3-review-regression.test.mjs` 每个 `test()` 名称直接对应终审编号或 Task 编号，可逐条对照验收要求。
- 首轮报告中的「#7 只完成读取侧」已在本轮由 `f538cbc` 补上元数据回填侧；`docs/handoffs/m3-delivery.md` 与 `ROADMAP.md` 已同步改写，不再残留旧结论。
- 首次失败、挂起、EPERM 与重跑结果均如实并列记录，未作为「一次通过」。
