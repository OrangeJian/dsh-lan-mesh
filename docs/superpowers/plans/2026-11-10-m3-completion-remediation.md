# M3 收尾整改实施计划

> 执行者按任务逐项实施、测试和提交；可以使用 executing-plans 流程，不要求开启更多子 Agent。

**Goal:** 修复 Codex 对 DSH 提交 `6999d2a` / `bf348d8` / `7eac0b3` 的复核问题，完成 M3 后交回独立复核。本轮不实施 M4/M5、生命周期或 M6。

**Architecture:** 账本修改统一串行，网络始终在事务队列外；并发复用必须同时验证不可变内容；兼容通知不能扩大执行目标。新增独立、有界、认证的 Leader 附件清单回填路径，让迟到成员获得被授权的历史引用，再通过现有流式 GET 取得字节。

**Tech Stack:** 现有 Node.js ESM、原子 JSON 账本、签名 Mesh HTTP、React panel、node:test；不引入新的服务端框架。

**Spec:** `docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md` 的 M3 部分；原发现见 `docs/handoffs/dsh-m3-review-findings.md`。

## 全局约束

- 以实际 HEAD 为准；当前复核业务提交为 `6999d2a`，测试为 `bf348d8`，文档为 `7eac0b3`。保留现有分支和未提交工作，不 reset、不 clean、不合并 main、不发布 npm。
- 新文件字节不能进入消息 JSON；所有接收校验实际长度和 SHA-256。确认发送之前 sender 和 Leader 均持久化。
- 身份以真实调用入口和签名节点为准；精确 mentions 不允许降级成广播或扩大 Agent 唤醒。holder 声明和 digest 知识均不是读取授权。
- 历史已提交引用及审计保留；恢复不丢 read 状态、不重复消息、不盲目重复唤醒。协议新增字段必须完整签名并显式协商，不静默改变旧 canonical signing。
- 用户自行验证真实浏览器，实施者不操作或重载浏览器；自动化、localhost 和物理设备验收分开记录。
- Codex 已复跑现有专项 11/11 通过，但它们没有覆盖以下全部缺口。不要以现有测试通过代替整改。

## Review Focus

- 两个 PUT 同时落收据或 PUT 与 commit 同时进行，不能发生快照覆盖：任务 1。
- 同 ID 不同内容同时提交，第二个不能借第一个的成功结果：任务 2。
- 普通文本/附件文件名含 @，降级通知不能激活未指定 Agent：任务 3。
- 发送者离线后新成员从 Leader 获得历史引用，不能伪造作者或绕过房间权限：任务 4。
- 丢 ACK、重启、清理和旧节点混用不能导致重复发表或自动发送已放弃草稿：任务 5。

## Task 1：所有收据修改加入同一事务队列

**Files:** `lib/room-attachment-service.mjs`、`lib/room-attachment-ledger.mjs`、`lib/room-blob-protocol.mjs`；测试 `scripts/m3-review-regression.test.mjs`。

问题：`onReceived` 直接调用 `ledger.recordReceived()`，该方法直接 `save()`，绕过其他业务使用的 `ledger.run()`。并发快照写入可能互相覆盖。

- [ ] 先添加并发 RED：两个不同 ref 的真实 PUT 同时完成；另覆盖收据写入与另一条消息 prepare/commit 相交。必要时在测试实例的文件写入边界设置可控 barrier，不在产品加测试开关。
- [ ] 统一收据事务所有权：建议 `onReceived` 使用 `ledger.run(() => ledger.recordReceived(...))`。`recordReceived` 在队列内部重新读取有效 prepared 状态、期限、room、sender 和精确 ref，不能队列外筛选后保存过期目标。
- [ ] 审计所有 `ledger.save` 调用，避免其他绕队列写入；不要在已持有队列时再次 await 同一队列，不能把网络重新放回队列。
- [ ] PUT 只有收据持久化成功才返回成功。并发 prepare 续期与 PUT 的关系需明确：不允许过期或已撤销授权的上传重新获得凭据。
- [ ] 测试证明两个收据及其他消息状态都保留；新实例重开后仍能合法 commit；写盘失败不报成功。
- [ ] 运行相关回归并提交 `fix: serialize attachment receipt transactions`。

## Task 2：同 ID 并发合并前检查内容

**Files:** `lib/room-attachment-service.mjs`、`lib/room-attachment-ledger.mjs`；测试 `scripts/m3-review-regression.test.mjs`。

问题：`withInFlight` 只以 sender+messageId 取 Promise，内容不同的第二个请求在进入 fingerprint 检查前就被合并。

- [ ] 添加 RED：保持第一个发送尚未完成，第二个用同 ID 改正文/ref/mentions/session，必须冲突；相同规范内容则共用一个实际发送。
- [ ] 入队前规范化、深拷贝不可变信封并计算与账本一致的 fingerprint。inFlight 保存 `{fingerprint,promise}`；同 key 不同 fingerprint 立即返回冲突，不能返回已有 Promise。
- [ ] fingerprint 包含当前定义的 room、sender/session、正文、mentions、skillRefs、全部不可变 ref；时间戳、目标节点、prepare/commit 阶段不作为内容差异。不能用未经规范化的对象键顺序代替 canonical 内容。
- [ ] Promise 完成或失败都清理对应条目；失败重试仍用原 ID。测试入口对象后续被修改不会改变已发内容。
- [ ] 检查后台扫描自身是否合并重叠调用；同 ID 去重不能被错误描述为整个扫描已去重。
- [ ] 回归双向并发、丢 ACK、同内容合并及不同内容拒绝，提交 `fix: validate content before coalescing attachment sends`。

## Task 3：旧节点通知不能扩大执行范围

**Files:** `lib/room-attachment-service.mjs`、`lib/transport.mjs`（必要时）、`lib/service.mjs`（仅限明确兼容入口）；测试 `scripts/m3-review-regression.test.mjs`。

问题：降级删除 mentions，只保留节点 `to`。现有 `#wakeRoom` 在无精确引用时可能唤醒节点上的其他 Agent。现有测试只捕获信封，不证明执行目标安全。

- [ ] 添加真实接收服务 RED：旧普通节点至少两个 Agent，消息只精确提及其中一个；另覆盖 labels 重名、未提及 Agent、正文/文件名含 @all。观察实际 wake 调用，不能只断言 `to`。
- [ ] 区分两种能力：无 blob 但支持精确 references 的节点，走现有 referencesVersion1 签名文本消息并保留 mentions/skillRefs；不得一律删引用。
- [ ] 对完全不支持精确引用的节点，不能直接向旧 room-message 通道发送会自动广播唤醒的通知。优先选双方明确支持的“人类只读/不唤醒”消息路径；没有这种能力时 fail closed，发送方明确展示“不兼容，未向该节点自动投递”，不能把该情况写成完整可读降级已实现。
- [ ] 不得仅添加旧端忽略的 unsigned `noWake` 字段自称安全。若必须覆盖更老节点，需有经过验证且不触发 Agent 的既有路径；协议新增须版本化。
- [ ] 旧 Leader 仍拒绝附件确认；字节不内联。明确 `metadataDelivered` 与 `blobDelivered` 的不同结果，不让普通 `ok:true` 掩盖字节未送达。
- [ ] 测试旧节点升级后补传只更新一条记录、不重复唤醒；重试通知不反复刷屏。提交 `fix: preserve targeting in legacy attachment notices`。

## Task 4：完成迟到成员的历史引用回填

**Files:** 建议新增 `lib/room-attachment-sync.mjs`（协议与有界清单协调）；修改 `lib/service.mjs`、`lib/room-attachment-service.mjs`、`lib/room-attachment-ledger.mjs`，按实际注册点修改 transport；新增 `scripts/room-attachment-sync.test.mjs`，扩展 `scripts/attachment-smoke.mjs`。

决定：采用独立 Leader 元数据同步端点，不把附件消息塞入 `rooms.json` 的时间戳合并状态。原发送者的作者身份保持不变，Leader 是中继/证明来源，不伪造原发送者签名。

- [ ] 先定义并测试 `roomAttachmentSync:1` 能力与只读分页操作，例如 `/lan-mesh/v1/room-attachment-sync`，请求含 room、cursor、limit；默认每页 50 条、最大 100 条，响应上限 1 MiB。超限明确错误或继续分页，不能截断一条消息后当合法清单。
- [ ] 认证覆盖 method/path、发送/接收节点、时间、nonce 和完整请求/响应内容 hash；复用现有合适的签名请求封装。请求时间窗默认 120 秒，重放记录至少覆盖有效窗口，重启策略明确。
- [ ] 服务端必须确认自身为当前认可的房间 Leader、请求节点当前有授权的人类/Agent 成员。仅输出已 committed 的房间消息/不可变 refs，不暴露 prepared、其他房间、路径、密钥或任意聊天数据。
- [ ] 同一房间的新成员可读取该房间已提交附件历史；这是本项已确认的功能范围。历史作者已退出不应丢失合法记录；当前读取资格依然由现成员权限判断。
- [ ] 客户端只接受当前认可 Leader 的签名清单，核对房间、结构、大小、原作者和不可变内容；同 sender+ID 不同 fingerprint 报冲突并停止该条导入，不覆盖本地历史。
- [ ] 增加单独的 `importCommittedManifest` 服务/账本事务：保存中继来源与校验凭据、幂等引用及分页进度；不能把中继记录伪装成远端普通 prepare/commit，不能靠 `local:true` 跳过收据安全门。
- [ ] 元数据导入不要求立即拥有字节，也不自动唤醒 Agent。修正启动恢复的 pin 重建：只有本地已验证字节才可 pin；远程引用不应因本地缺 blob 导致启动失败。保留原 read 状态。
- [ ] 在人类/Agent 合法加入并同步房间后触发有界清单回填，支持显式重试、重启继续和分页幂等。网络放在账本事务外，不让离线 Leader 卡住普通启动。
- [ ] 下载时优先本地，再找可信 Leader/已知 holder；必须使用已授权的 committed ref。流式校验完整长度/hash 后才能落盘、pin 及声明 holder。清单/holder 本身不能越权。
- [ ] 先用真实三节点 RED：A 发送、B Leader 持久化；A 关闭后 C 才加入。C 不预先手工注入 ledger，必须通过产品入口获得引用、展示并从 B 下载原字节。
- [ ] 继续覆盖分页、Leader 重启、重复同步、错误签名/节点/房间、非成员、篡改 ref、无 holder、已读恢复、不重复 wake。提交 `feat: sync authorized attachment history for late members`。

## Task 5：完成 M3 整体验收与诚实交接

**Files:** `scripts/m3-review-regression.test.mjs`、`scripts/attachment-smoke.mjs`、`docs/handoffs/dsh-next-development-report.md`、`docs/handoffs/m3-delivery.md`、`ROADMAP.md`、`docs/usage.md`、`docs/ui-contract.md`。

- [ ] 对照原九项发现与本计划逐项列出“问题→修复提交→实际测试→剩余限制”，重点复核过期 prepare 续期的新鲜度，不能把清空收据等同于旧 prepare 不可重放。
- [ ] 验证 Leader 已提交但 ACK 丢失：后台可以查询并恢复确定决策，但不能重发已放弃草稿。若当前 prepared 一律跳过导致丢 ACK 永久悬空，补只读状态对账，区分“未知”与“明确失败”。
- [ ] 验证 GC 不清有效 pending/read/write；拉取的 committed bytes 需 pin，不能下载后又被孤儿 GC 回收。清理与收据/提交并发不能覆盖账本。
- [ ] 运行 `npm test`、panel/schema/compat/twin、rooms smoke、attachment smoke 和新 sync smoke。schema 使用实际安装的官方 validator，不硬编码本机路径。
- [ ] 保留首次失败与重跑证据；本轮仅称自动化完成，浏览器/物理设备保持用户待验收。
- [ ] 更新回执中的旧 HEAD、“待提交”段落及状态矛盾。M3 未满足不得写“九项全部完成”；M4/M5/生命周期/M6 均不在本轮实现范围。
- [ ] 分阶段提交，按已有仓库授权推送当前开发分支，核对远端 HEAD；不 force push、不合并、不发布。
- [ ] 交回 Codex 复核：base/head、提交列表、关键协议/迁移说明、每项验收结果、剩余限制。完成后停止，不自动开始 M4。
