# DSH 开发交接：v0.4.21 收尾基线

交接日期：2026-11-17（Asia/Shanghai）。这是当前开发入口，旧 handoff 文件只作历史参考。

## 工作区和禁止覆盖的成果

- 工作目录：C:/Users/jian/.codex/worktrees/ux-workbench/dsh-lan-mesh；分支 codex/ux-workbench。
- 已提交基线：3b80fac / v0.4.19 → 7eff5a7（+ 384f9d6 文档）/ v0.4.20 → 本批 v0.4.21（SHA 见 `git log --oneline`；不要以旧文档 SHA 代替当前 HEAD）。
- 原工作区 C:/Users/jian/.codex/worktrees/room-collaboration/dsh-lan-mesh 的未完成 0.4.5 任务成果引用与暂停 M6 草稿禁止覆盖、清理、合入或重置。本批开工与收尾两次核对，该工作区仍是 14 项变更，关键文件 SHA256 前 12 位未变（room-context.mjs 9A1F8D78A4DD、service.mjs 97112A591FC5、team-coordinator.mjs FFEFB103A039、client.js 239AE2B64EA8、team-store.mjs 9DD07F42A178、index.js DC3FC027A11A）。
- 工作树里有 5 份**不是本批产出**的未跟踪架构文档（docs/architecture/agent-workspace-execution-merge-v0.1.md / v0.2.md / v0.2.1.md、architecture-freeze-v0.2.1.md、implementation-plan-v0.2.1.md），来自另一 DSH 会话。本批提交时用 `:!docs/architecture` 排除，**未删、未改、未提交**。
- 用户要求每批版本号明确、本地 Git 留档；GitHub 推送继续暂停。不要自动 merge/push 或自动发布。日常可逆实施无需逐步询问。

## 本批实际交付（v0.4.21）

1. 跨批自动已读回滚一致性（P0）：`#enqueueInboxSave` 每个队列任务携带自己的 batch，成功只认领本批、失败只回滚未被任何成功写入覆盖者，`state.queue = settle`。回归已证旧码必失败。
2. Room 历史偏移索引（P1）：新增 `inbox.room-index.json` sidecar（每 Room 保留最近 400 条记录的字节偏移，4096 字节尾部 sha256 + 全量 digest 双钉）；任何异常一律回退全量扫描且结果逐字节相同；`readRoomHistory` 内部走 `queueInboxWrite` 与日志共用写队列；`rewriteInbox` rename 后 unlink 索引。`scripts/history-index.test.mjs` 5 例，用读取字节数而非墙钟时间作断言。
3. Network 与任务看板取证生成器：`scripts/network-workbench-preview.mjs`（`npm run preview:network`，11 例）、`scripts/task-board-preview.mjs`（`npm run preview:board`，19 例）。产物幂等（连跑两次 sha256 一致）。
4. 任务看板容器查询修复：`ui/tasks/room-task-board.css` 增加 `container-type:inline-size` + `@container lm-task-board (max-width:650px)` 驱动筛选/行头；padding 仍留在 `@media`（元素不能是自己的容器）。上一批唯一 FAIL 转 PASS。
5. Team 只读 Owner 契约（P2，只文档）：`docs/ux/team-owner-readonly-contract.md`（257 行，三条红线、`teamOverview` 契约、16 格权限矩阵、23 条验收条件）。**未写实现代码**。
6. UX-6 矩阵：`docs/ux/ux6-matrix-report.md`（346 行），15 项逐项 PASS/FAIL/NOT RUN 并标 L0—L4 证据级别。
7. 版本一致性门禁：`scripts/version-consistency.test.mjs` 2 例，四处版本号 + 三个 preview script 指向。

## 构建与验证

- UI 源文件在 ui/，`node scripts/build-client.mjs` 零依赖嵌入 client.js；禁止只改生成块不回写源。改完跑 `node scripts/build-client.mjs --check`。
- 当前最终完整测试 **499/499**，0 fail / 0 skipped / 0 todo（duration_ms 102562.45）；panel **283/283**；schema **82/82**；构建一致；Composer 兼容 PASS。
- 全套测试请设置 DSH_HOME 到新的隔离目录，使用 `node --test --test-concurrency=1 --test-timeout=120000 scripts/*.test.mjs`；不要让测试使用用户真实 .dsh。
- Composer 兼容门禁 PASS：本机实际解析宿主 `@deepseek-ai/dsh` 为 **0.2.2-rc.3**，4 个公开 client 入口，无私有 import 要求。换机若复现 rc.1/rc.3 不符，须先核对安装位置与实际版本，不能只改矩阵绕过断言。
- `scripts/schema-check.mjs` 不需要外部注入 DSH_TOOLS_MODULE。注意 `@deepseek-ai/dsh-tools` 不导出 `./lib/index.js`，必须先解析它的 package.json 再拼 `lib/index.js`。
- 完整测试与兼容检查顺序运行并记录实际 SDK 版本。真实 DSH React/键盘/上传、多机仍未验收，不把 mock 或 localhost 算物理两机。
- 本批三份取证产物均已由生成器刷新：inbox 7 例、network 11 例、board 19 例，全例 overflow/rootOverflow false、clipped 0、runtimeErrors 空。
- 本机 `http://127.0.0.1:3080` 直接 fetch 恒返回 401 `dsh web authentication required; reopen the URL printed by dsh web.`——真实宿主验收无法自动化，必须人工操作浏览器。本机 Web GUI 通过 `C:/Users/jian/.dsh/profiles/web/package.json:31` 的 link 加载本工作树。

## 下一步优先级

P0 实机验收（仍未执行，不许记 PASS）：
- 四页签、原生返回/侧栏、图片上传中切页、跨 Room 草稿、@精确 Agent、固定文档版本、技能提示、设为任务。
- Room 与 Inbox 计数、单条/批量失败重试、重启持久化：本批有跨批回滚与关闭等待的软件级证据，仍需实机复核徽标与重载后一致性。
- 真双机：发现/失联恢复/加入、同名设备/Agent 消歧、归档/静音/@例外、历史与附件读取。旧版本已裁掉的数据不凭空恢复。

P1 UX-6 剩余矩阵：
- 按 `docs/ux/ux6-matrix-report.md` 的逐项结论推进：现在最该做的是**一次真实 DSH 实例目测**（1440/1280/1024 + 深浅 + 键盘），它一次解锁 A01（折叠态 70px 目前零测量，设计值见 `docs/ux/ux0/design-review.md:42`）、A02、A07、A13 的生产列；然后**一次真双机联调**覆盖 A05/A08/A11/A15。
- 判据与实现的缺口（比补证据更要紧）：A10 判据点里的「离线」在 Network 组件不存在（只有 local/stale），A12 的「计划未批准 / Review 未通过」在看板 `states` 里不存在。**先做需求侧定性，不得改判据措辞绕过。**
- 历史索引已知边界：多进程同写无跨进程锁（靠 size+tail 与逐条复核兜底，正确性不掉、性能退化）；第 8 页起按设计回退全量扫描；>1GB 与跨平台路径未实测。若要继续，优先做跨进程安全与更大文件的实测。
- 草稿仍只存页面内存，整页重载会丢；禁止偷偷把 File/正文写 localStorage。

P2 Team 与 M6 前置：
- 先看 `docs/ux/team-owner-readonly-contract.md` 与 `docs/ux/ux5a-capability-audit.md`。Team status 依赖真实 Agent 身份，无 Owner 面板读取路由；禁止伪造 human/其他 Agent 身份。
- 实现投影前必须先修 `index.js:1592-1604` 的错误码吞并：`FORBIDDEN`/`TEAM_DISABLED`/`TEAM_STORAGE`/`NOT_READY` 现在全兜底成 `LAN_MESH_FAILED`，「不是这个房的人」与「存储坏了」在 UI 上同形。
- absent / NOT_READY / 真的 0 个任务必须靠 `known` + `teamStatus:'absent'` + `taskCounts:null` 在字段层区分，不能都渲染成 0。
- 暂停 M6 的计划批准/DAG/Review/人工合并仍未交付或验收，不能用禁用按钮/示例数据称完成。

## 可并行工作分配（沿用上一批）

- Agent A：UX-6 本机/键盘/容器布局和证据；只改 UI/验收文档。
- Agent B：历史分页性能与索引的跨进程安全，或 service/store 其余一致性；只改 service/store 及相关测试，先写失败回归。
- Agent C：Team 只读 Owner 接口实现与真实 M1/M6 门槛审计；先补 index.js 错误码映射，再谈投影。
- 主 Agent：SDK 核对、共享 client/build/package/index 集成、完整回归、版本和本地提交。不要让多 Agent 同时编辑这些共享入口。

## 本批协作方式与教训

- 四个子代理并行（network-evidence、board-evidence、matrix-audit、agent-1 历史索引、agent-2 Team 契约），共享入口全部由主 Agent 独占。
- 教训一：`container-type:inline-size` 量的是内容盒，断点阈值必须落在「主区宽 − 两侧 padding」，否则边界用例会差一个像素地判错。
- 教训二：元素不能是自己的容器，所以「给面板自己换 padding」只能留在 `@media`，容器查询只对后代生效。
- 教训三：把 `readline` 换成自写行迭代器时，删掉 import 后旧代码仍引用 `createInterface`，中途报过一次 `ReferenceError`——重构底层读取要连调用点一起看。
- 教训四：索引类缓存必须能「随时被删除而结果不变」，否则它就成了正确性的一部分。
- 教训五：`git status` 里的 M 可能是 `core.autocrlf=true` 的 stat 脏，先 `git hash-object` 与 HEAD blob 比对，不要 checkout/reset。

每批交付记录：实际 SHA/版本、改动范围、测试结果、截图是否模拟、未完成边界。不要清理其他工作区；不要把未执行验收记 PASS。
