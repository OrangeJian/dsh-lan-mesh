# DSH 连续开发转交报告（M3 整改 → 收尾）

> 日期：2026-11-10　分支：`codex/room-collaboration`
> 复核入口：本文件「4. 复核入口」+「5. 结论口径」。
> **本文不是「M3 已通过终审」的声明。** 本轮只把九项终审发现整改到「有可执行回归且全绿」，终审结论由 Codex 独立复核给出。

---

## 0. 一句话结论

M3 的九项终审发现（1 阻塞 / 4 高 / 2 重要 / 1 重要 / 1 次要）已逐项整改并配有可执行回归，全量自动化验证通过（`npm test` 180/180）。M4 / M5 / 房间生命周期 / M6 **本轮没有写实现代码**，各自停留在「设计/计划文档」状态。**#7 只完成读取侧**，迟到成员的元数据回填未实现；真实浏览器操作与两台物理设备验收仍全部未执行。

---

## 1. 本轮实际做了什么

| 项目 | 状态 | 证据 |
|---|---|---|
| M3 九项终审整改 | 已实现，自动化验证通过，**待 Codex 复核** | 提交 `6999d2a` |
| M3 回归测试（11 项） | 已实现并通过 | 提交 `bf348d8`，`scripts/m3-review-regression.test.mjs` |
| 房间生命周期 | **只写设计方案**，无代码 | `docs/superpowers/specs/2026-11-10-room-lifecycle-design.md`（465 行，未提交→见 §6） |
| M6 可实施范围 | **只写实施计划**，无代码 | `docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md`（326 行，未提交→见 §6） |
| M4 共享 Markdown | **未实现** | 无 |
| M5 Project Context | **未实现** | 无 |
| 文档同步 | ROADMAP / ui-contract / usage / m3-delivery 已更新 | 见 §3 |

### 提交清单

| 提交 | 类型 | 内容 |
|---|---|---|
| `37f2ae8` | 基线 | 上一批交接文档（本轮起点） |
| `6999d2a` | 代码 | M3 #1–#9 整改，5 文件 267+/55- |
| `bf348d8` | 测试 | 9 项发现的可执行回归，新增 456 行 |
| 待提交 | 文档 | ROADMAP / ui-contract / usage / m3-delivery / 生命周期设计 / M6 计划 / 本报告 |

业务基线 `221901b` → 当前 `bf348d8`（代码）。**未合并 main，未发布 npm，未 reset / 未 clean / 未改写历史。**

---

## 2. 九项终审发现：问题 → 根因 → 提交 → 验证 → 剩余限制

完整表格见 [`docs/handoffs/m3-delivery.md`](m3-delivery.md)「M3 整改结果」。此处只列要点与剩余限制。

| # | 等级 | 根因（一句话） | 整改要点 | 剩余限制 |
|---|---|---|---|---|
| 1 | 阻塞 | `commit()` 只查节点级 `store.has(blobId)`，没有针对 sender/room/intent 的持久授权凭据 | 新增 per-intent 收据 `receivedRefs` + `recordReceived()`；PUT 必须先落收据才返回 201（否则 503）；续期清空收据 | 不提供受信节点间独立密码学隔离；沿用 Mesh 集群信任边界 |
| 2 | 高 | `receive()` 不校验签名 `to`、双方当前成员资格；续期只看 `expiresAt` | 写盘前校验 room/kind/`to`/发送者成员/接收方成员；续期须内容一致的新 prepare | 重放边界仍由 nonce + 120 s 窗口约束 |
| 3 | 高 | `#saveInbox()` 全量重写漏 `attachments`；`publish()` 见同 ID 直接跳过 | 重写复制不可变引用；publish 在 existing 分支原地补引用并保存（保 read、不重复、不唤醒） | 依赖 committed ledger 仍持有该意图 |
| 4 | 高 | `send` 的整个网络流程包在 `ledger.run()` 内 | 拆五阶段，网络在队列外；`inFlight` 合并同 ID；`close()` 前 `drain()` | 不承诺跨进程同写同目录、不承诺掉电目录持久化 |
| 5 | 高 | `retry()` 对未提交本地 prepared 无条件重发 | 后台扫描跳过未提交草稿；显式重试仍可发布 | 已提交消息不提供撤回 |
| 6 | 重要 | `collectOrphans()` 只有测试调用 | 接入节点生命周期（每小时 + 启动）；清理 stale uploads | 宽限期仍 24 h；无「立即释放」界面 |
| 7 | 重要 | `read()` 只开本地文件；`readPeerBlob()` 无生产调用 | 本地无字节时向房间成员按需拉取，校验长度/MIME/SHA-256 后才 `declareHolder()` | **只完成读取侧**：真正迟到成员无 committed ref，需元数据回填/中继，未实现 |
| 8 | 重要 | 旧节点不支持 references 时直接抛错 | 对明确无能力的普通成员发纯文本（正文+文件名+不支持预览），精确 `to`、无 attachments/mentions、不广播、job 保持 pending；Leader 不降级 | 同一 messageId 会先文本后附件 |
| 9 | 次要 | 卡片 `key` 只有 `blobId` | `key=\`${blobId}/${index}\``，存储仍按内容去重 | 无 |

### 具体改动文件（`6999d2a`）

```
client.js                       |   6 +-
lib/room-attachment-ledger.mjs  |  58 ++++-
lib/room-attachment-service.mjs | 181 ++++++++++++++++-----
lib/room-blob-protocol.mjs      |  14 +-
lib/service.mjs                 |  63 +++++-
```

- `lib/room-attachment-ledger.mjs`：`receiptRefKey()`、`recordReceived()`、commit 的远端收据门、prepare 续期清空收据、open() 的迁移校验。
- `lib/room-blob-protocol.mjs`：`createBlobHandler` 新增 `onReceived`，PUT 落盘后先记收据再 201。
- `lib/room-attachment-service.mjs`：全量重写为 188 行，五阶段发送、`inFlight`、`drain`、`collectGarbage`、按需 holder 读取、旧成员降级、后台重试门。
- `lib/service.mjs`：`receive()` 入站校验、`#saveInbox()` 保留附件、`publish()` 原地修复、GC 定时器、`drain()`、`collectRoomAttachmentGarbage()`。
- `client.js`：附件卡 per-item key。

---

## 3. 验证证据（2026-11-10 实测，均记录退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm test`（第一次） | **1** | Windows EPERM `rename`：`.attachment-test-*\lan-mesh\instances\39001\blobs\.metadata-*.tmp` → `metadata.json`。**保留原始失败，不计为通过** |
| `npm test`（重跑） | 0 | **180/180 pass**（原 169 + 新增 11） |
| `node scripts/panel-check.mjs` | 0 | `panel check: 167/167 assertions passed` |
| `node scripts/schema-check.mjs` | 0 | `schema check ok — 72/72`（需 `DSH_TOOLS_MODULE=file:///...dsh-tools/lib/index.js`，原始 Windows 路径会报 `Received protocol 'd:'`） |
| `npm run check:composer-compat` | 0 | `PASS composer compatibility: DSH 0.2.2-rc.1, 4 public client entry points` |
| `node scripts/twin-transport-check.mjs` | 0 | `twin transport ok` |
| `node scripts/attachment-smoke.mjs` | 0 | 2 PASS（在线流式二进制/双端 pin/授权下载/同 ID 去重；Leader 关闭重启后的离线恢复） |
| `node scripts/rooms-smoke.mjs` | 0 | `rooms interop ok` |
| `node scripts/smoke.mjs` | 0 | `all checks passed` |
| `node scripts/agents-smoke.mjs` | 0 | `agents interop ok` |
| `npm run test:team:smoke` | 0 | 2 PASS |
| `node --test scripts/m3-review-regression.test.mjs` | 0 | **11/11 pass** |

### 证据边界（不得混淆）

- 以上全部是 **单机 / localhost / stub runtime / panel harness** 级自动化证据。
- **真实浏览器操作：未执行。** 本轮没有操作、重载或截图浏览器；没有伪造任何截图或真机结果。
- **两台物理设备 / 真实模型跨设备验收：未执行。** M1 三设备 12 项场景仍全部「未验收」。
- **Windows EPERM 首次失败已保留**，与重跑结果并列记录，不作为「一次通过」。

---

## 4. 复核入口

Codex 可按以下顺序独立复核：

1. **读结论口径**：本文件 §5，确认四类状态划分。
2. **看代码差异**：`git diff 221901b..bf348d8 -- lib client.js`（2 个提交；`37f2ae8` 是其父提交）。
3. **看回归**：`scripts/m3-review-regression.test.mjs`，每个 `test()` 名称直接对应 `docs/handoffs/dsh-m3-review-findings.md` 的编号。
4. **重跑**：
   ```powershell
   npm test                      # 期望 180/180
   node scripts/panel-check.mjs  # 期望 167/167
   $env:DSH_TOOLS_MODULE='file:///<实际 dsh 安装>/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
   node scripts/schema-check.mjs # 期望 72/72
   npm run check:composer-compat
   node scripts/twin-transport-check.mjs
   node scripts/attachment-smoke.mjs
   node scripts/rooms-smoke.mjs
   ```
5. **重点质疑 #7**：`lib/room-attachment-service.mjs` 的 `read()` 只解决「已有 committed ref 但本地无字节」。请按 §5 的「设计/未实现」核对，不要据代码推断迟到成员场景已通。
6. **复核文档诚实性**：`docs/handoffs/m3-delivery.md`、`ROADMAP.md`、`docs/superpowers/specs/2026-11-10-room-lifecycle-design.md`、`docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md` 是否把未实现写成已实现。

---

## 5. 结论口径（四类，不得混用）

### 已实现且验证（自动化层面）

- M3 #1、#2、#3、#4、#5、#6、#8、#9：源码 + 回归 + 全量套件通过。
- M3 #7 的**读取侧**（本节点无字节时按需向 holder 取并校验）。

### 已实现待实机

- M3 全部整改的**真实浏览器与双设备**行为：代码与本地自动化已就绪，但未在真实浏览器操作、未在第二台物理机验证。
- M1/M2 的既有实现同样只到 localhost/stub 级别。

### 设计 / 未实现

- **M3 #7 的元数据回填**（真正「发送后才加入且发送者已离线」的迟到成员获得被授权引用）：未实现。原因：`lib/rooms.mjs` 的 `normalizeRoom` 是固定字段集，`rooms.json` 反熵不携带附件引用，迟到节点账本里没有 committed ref。
- **M4 共享 Markdown**：无任何业务实现（状态、合并、审计、协议、界面均未写）。
- **M5 Project Context**：无任何实现。
- **房间生命周期**：只有设计方案（`docs/superpowers/specs/2026-11-10-room-lifecycle-design.md`），**无代码、无测试**；方案内 9 条本地裁定与全部待决项均待负责人复核。
- **M6 自动编排**：只有实施计划（`docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md`），**无代码**；D1–D9 九项重大协议/权限行为标 OPEN。

### 外部阻塞

- **M1 三设备 12 项验收**：需要负责人提供 A/B/C 设备与真实模型，实施者无法替代；`docs/handoffs/m1-three-device-acceptance.md` 全部「未验收」。
- **房间生命周期进入实现**：`docs/development-workflow.md:7` 要求方案先获负责人确认；本文待决项未确认前不得开工。
- **M6 重大协议/权限（D1–D9）**：资料不足，需负责人/Codex 裁定；M6 还依赖 M1 实机验收与 M5。
- **真实浏览器验收**：按交接要求由负责人自行执行，实施者不操作、不重载、不伪造。

---

## 6. 未提交内容与原因

以下文件**已在工作区生成但尚未提交**（本轮收尾时会一并提交或明确说明）：

| 路径 | 原因 |
|---|---|
| `docs/superpowers/specs/2026-11-10-room-lifecycle-design.md` | 本轮新增设计文档，随收尾提交 |
| `docs/superpowers/plans/2026-11-10-agent-team-m6-plan.md` | 本轮新增计划文档，随收尾提交 |
| `ROADMAP.md`、`docs/ui-contract.md`、`docs/usage.md`、`docs/handoffs/m3-delivery.md` | 本轮文档同步，随收尾提交 |
| 本报告 | 待提交 |
| `.test-tmp/` | 本地临时目录（含提交信息草稿、测试 HOME），**不提交** |

---

## 7. 升级 / 回退

- **升级**：`codex/room-collaboration` 拉到 `bf348d8`（或收尾文档提交）后重载插件。附件协议对旧节点保持协作降级（见 #8），不需要同时升级全网。
- **回退**：`git revert 6999d2a bf348d8`（或回到 `37f2ae8`）。**注意**：回退会重新暴露 #1 跨房间授权绕过，只能作为临时手段。
- **存储兼容**：ledger 新增 `receivedRefs` 字段。向前读兼容（缺字段视为空）；回退到旧代码时该字段被忽略，旧代码仍按原逻辑工作，但**旧 prepared 意图在回退后不再受收据保护**。无需数据迁移脚本。
- **不建议**：在未复核前合并 main 或发布 npm。

---

## 8. 剩余问题（交给负责人 / Codex 决定）

1. **M3 #7 元数据回填**：是否需要做？若做，涉及 `rooms.json` 增加附件引用字段（协议变更）或 Leader 中继端点（新增 API），二者都超出本轮授权范围。
2. **生命周期的 9 条本地裁定**：需负责人逐条确认或否决（见设计文档 §17）。
3. **M6 D1–D9**：需裁定具体 HTTP 方法、Schema、工具名、界面形态、验收是否双签、账本迁移策略。
4. **M4 起步顺序**：`docs/superpowers/plans/2026-11-08-shared-documents-core.md` 的纯状态/合并模块可在无待决项情况下直接开工；但审计链原子性与 `ui-contract.md` 冻结契约的新增端点需先经确认。
5. **真实浏览器与三设备验收**：仍待负责人执行。

---

## 9. 给 Codex 的复核提示

- 本轮**没有**把任何「待整改」写成「已通过」。`ROADMAP.md` M3 行写的是「九项终审发现已整改（待 Codex 独立复核）」，不是「M3 通过」。
- 本轮**没有**对 M4/M5/生命周期/M6 声称实现。
- 回归测试是按「先复现 RED 再修复」写的，但由于整改与测试同批完成，无法提供逐项 RED 的历史截图证据；复核时请以「把 `6999d2a` 的源码改回 `37f2ae8` 版本、跑 `m3-review-regression.test.mjs` 应失败」的方式验证测试有效性。
- 首次 `npm test` 的 EPERM 失败与重跑通过均如实记录在 §3 与 `docs/handoffs/m3-delivery.md`。
