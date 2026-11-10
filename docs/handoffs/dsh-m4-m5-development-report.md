# M4/M5 接续开发交付回执

日期：2026-11-11。分支 `codex/room-collaboration`。负责人要求接续 DSH 的中间成果，本批止于 M4/M5，不实现房间生命周期或 M6，不合并 main、不发布 npm。

## 基线、团队与范围

交接起点 `6d89385`；DSH 已有提交 `e21ea39`、`9c5489e`、`624653f`、`6d308ee`、`e1d1228`，以及未提交的约 1,150 行文档 UI。本批保留这些成果，补齐安全边界、产品接线和验收，未重置、删除或改写其历史。

接续核心修正提交 `2ad89a8`，业务接线/界面/M5 提交 `bd6582a`；后续仅文档提交不改变该业务基线。查看 `git diff e1d1228..bd6582a` 可复核本次接续业务改动，完整 DSH+Codex 批次范围为 `6d89385..bd6582a`。

- 核心实施者：状态/store/coordinator 的 Leader 权威、可信远端作者、提案幂等、完整冲突数据、人工确认、原子 outbox 和副本校验。
- 界面实施者：接续现有 client，完成文档列表/编辑/diff/历史/冲突/导入导出/版本选择及真实组件事件回归。
- 上下文实施者：纯 Context Pack、持久投递审计、Team 可选 adapter 与相关测试。
- 主控：`shared-doc-service`、Host/工具/传输/普通任务/M5 实际接线，真实 HTTP 验收、统一测试和 Git。
- 独立只读集成审查：发现“先保存任务后校验上下文”和“选择字段没有实际过滤”两项，均已修正并定向复核通过；不以实施者自述代替审查。

## 已实现对应表

| 要求 | 实现及证据 |
|---|---|
| 文档版本与历史重建 | shared-doc-state/store/merge；纯模块及真实磁盘回归，恢复历史为新提案 |
| 仅 Leader 排序 | shared-doc-service 按房间 Leader 路由；core 校验权威节点，实际非 Leader 经 HTTP 创建/编辑/历史读取 |
| 真实 actor | 本地工具只接实际执行会话；Host 固定 owner human；远端通过已认证节点的内部 facade 派生作者，不信用户 actor 字段 |
| 幂等与并发 | 创建/import requestId 原子 receipt；提案保存原始请求指纹，自动合并后重试不比较错误的最终 hash；事务串行 |
| 自动合并与冲突确认 | 无冲突直接提交；所有人类可提出解决，Agent 禁止人类解决/确认；仅合法 Leader/维护者确认；解决后的 head 再变化必须重新解决 |
| 冲突资料留档 | 原始正文、base、作者、解决正文及每次解决版本保存在持久 receipt；另一成员/重启后仍能查看三方及解决正文 |
| 原子审计与 outbox | 每次核心事务同时保留修订/事件/head/幂等/outbox；Leader 后台补传，当前成员节点全部 ACK 后才标 sent |
| 副本同步 | 独立签名结果绑定请求、双方节点及房间；16,000 字符分片、整包 hash、完整历史/审计校验；迟到读取可拉取，旧快照不覆盖新 head，冲突持久阻止该房间新写入 |
| 离线提案 | 已缓存 base 的提案可显式保存 pending 到本机事务；重启后向 Leader 用稳定 ID 同步；其他失败不假报已提交 |
| 文档产品入口 | 房间“文档”页；Host document* 端点；Agent list/read/propose/history 工具；显式浏览器文本导入与 Markdown 下载，无任意 Host 路径访问 |
| 固定上下文 | 用户显式选择文档版本，Host 按权限读取并校验 revision/hash；64 KiB 硬上限，本批实际投递 16 KiB；不复制整个聊天 |
| 决策与问题 | 只读取显式 `:::context-decision` / `:::context-question` 块，不由模型推测普通正文 |
| @ / 普通任务 | 独立签名 contextPacket 字段及能力协商；只进入 Agent prompt，不把 JSON 放进聊天正文；先记录 prepared/dispatching，再调用 Host，再记录结果 |
| Team | 在原有显式授权后构建并固定包，和 descriptor/outbox 一起持久化；Worker audit 失败则 uncertain，不唤醒、不自动重跑 |
| 投递审计 | 记录实际接收 Agent、消息/执行 ID、固定 packet 和 outcome；后续 head 更新不改过去的证据 |

## 验证及复核入口

完整套件 `node --test --test-timeout=120000 scripts/*.test.mjs`：**370/370 通过，0失败/取消/跳过**。随后仅作者展示及主动上下文工具增加针对性断言，`node scripts/shared-docs-smoke.mjs` 两个真实集成场景再次通过，覆盖这些最后接线；没有把此前的全套运行描述成最后细节改动后的重新全量运行。原始失败和绿色输出保存在本地 `.test-tmp/codex-m4-m5-*.log`，关键结论同步本文件，缓存不提交。

- `node scripts/shared-docs-smoke.mjs`：真实 localhost HTTP + 磁盘 + Host，覆盖创建/编辑、旧修订回读、自动合并重试、跨人类冲突、确认权限、离线提案重开恢复、outbox ACK、Unicode 分片、错误响应签名拒绝、普通 @/任务上下文和旧版本审计。
- `node scripts/attachment-smoke.mjs`：3 PASS，既有二进制双端 pin/Leader 重启/迟到成员路径通过。
- 官方 `schema-check`：**82/82**，通过；`panel-check`：最终 **193/193**，通过；composer compatibility 及 twin transport 通过；`git diff --check` 通过。
- 新增共享文档/主动上下文工具通过官方 schema 注册检查；Host 集成测试实际执行 owner RPC、Agent 读取与构造上下文、伪造身份忽略和有审计的导入/导出。
- 初始 Host 测试因请求夹具缺 Content-Type 失败，已修测试请求；初始任务审计因 UUID 与规范 taskId 不一致失败，已改用实际创建 ID。
- 受限环境首次 schema/文件用例遇 EPERM，正常本地权限执行通过。第一轮全套 366/366、第二轮 368/368；这些是中间证据，不覆盖后续变更，最终套件另行记录。

## 实施取舍与限制

- 副本采用独立 RPC 分片快照，不将文档塞入 Room 时间戳合并状态。房间快照硬上限 32 MiB，RPC 响应上限 2 MiB；超限明确失败，缓存分片有效 120 秒，过期可重试。完整历史仍留在源存储，不静默裁剪。
- 首次认可的 Leader key 持久绑定。后续 Leader 改变或检查点冲突会拒绝新 canonical 写入，须显式人工核对，不自动选主/取最大时间戳。
- RPC 写入请求防重放记录持久保存至时间窗口结束；重启后已接收但结果未知的原封请求不重做，创建/提案通过稳定业务 ID 查询或重试。集群内仍沿用 shared-secret 信任边界，不提供节点私钥隔离。
- Context audit 的 delivered 表示 Host 接受 followup，不表示模型完成、理解或执行成功。崩溃在调用外部 Agent 边界仍可能 unknown，不承诺外部副作用 exactly-once，也不盲目再唤醒。
- 文档离线读取限本机已有缓存；写作提案可 pending，首次创建等未接收操作会保留界面草稿并报不可用。
- 本批导入/导出采用用户显式选择的文本和浏览器下载，不实现任意磁盘路径或自动 Git/目录双向绑定。
- 没有操作或重载用户浏览器。组件 harness、真实 localhost HTTP、stub Agent 与物理多机/真实模型验收严格分开；后两项仍由负责人验证。

## 负责人验证步骤

1. 同步开发分支，两端重载；加入同一房间，在“文档”创建和编辑 Markdown，另一端刷新列表阅读。
2. 两端从同一 base 修改不同段落，检查自动合并；修改同一段，检查三方内容和人工解决。普通人类可提方案，非维护者看不到确认，Leader/维护者才可确认。
3. 阅读旧修订、恢复为新提案、导入/下载 Markdown；确认旧历史不变。
4. 选择某个文档版本为上下文，回聊天 @ Agent 或派普通任务；检查实际提示中的固定版本，之后修改 head，再看旧投递审计仍指向旧版本。未选择时普通消息不携带新 context 协议。
5. 在测试实例暂时离线时保存已有文档提案，恢复后检查同步；重启查看历史、已读与附件均保留。无需更改整机防火墙。

生命周期与 M6 仍未实施，不应据本回执推断其方案已获最终验收。
