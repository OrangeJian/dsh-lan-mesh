# v0.4.21 跨批已读一致性、历史索引与取证补齐

上一基线 7eff5a7 / v0.4.20（其前 3b80fac / v0.4.19）；本批为 0.4.21。GitHub 仍暂停，只本地提交。

本批第一次按交接文档 line 48-53 的分工用四个子代理并行：Agent A 做 Network 与任务看板的取证生成器，Agent B 做历史分页索引，Agent C 做 Team 只读 Owner 契约与 UX-6 矩阵，主 Agent 负责 P0 修复、共享入口（client.js / build / package / index）与全量回归。共享入口没有让任何子代理碰。

## 1. 跨批自动已读回滚缺陷（本批 P0，交接 m00654 指定）

0.4.20 的队列只回滚「本批」，但失败分支写的是 `for (item of pendingRead) item.read = false`，而 `pendingRead` 是从调用方传进来的、可能包含**上一批还没落地的记录**。于是复现出用户描述的那条路径：

1. 批次 N 写盘失败（`.tmp` 目录被占）→ 队列 catch 把批次 N 的记录翻回未读，同时把批次 N+1 已被乐观标为已读的记录也一并翻回；
2. 批次 N+1 随后成功写盘 → 磁盘上 `read:true`；
3. 内存里那批记录仍是 `read:false`。

即**磁盘已读、内存未读**，重启后才"自愈"，期间徽标虚高。

修法（lib/service.mjs 的 `#enqueueInboxSave`）是把「谁认领谁」写进不变量：

- 每个队列任务携带自己的 `batch`（= 传入的待存集合 ∪ 当前 `state.pending`）；
- 写入成功后**只**把这批清出 `state.pending` 并保持 `read:true`；
- 写入失败时逐条 `if (!state.pending.delete(item)) continue;` 再 `item.read = false` —— 已经被任何一次成功写入认领过的记录不会被回滚；
- `state.queue = settle`（settle 而不是 write），保证等待队列的人看到的是回滚后的最终态。

回归 `scripts/inbox-read.test.mjs`：`a failed read batch never reverts a later batch that already made the same record durable`。做法是注入 `log` 回调，在第一次出现 `cannot rewrite the inbox log` 时 `rmSync` 掉 `.tmp` 目录解除阻塞，让第二批得以成功；断言磁盘 `read===true` 且内存 `read===true`、`unread===0`。

**旧码必失败已验证**：把 `git show HEAD:lib/service.mjs` 写回后单跑该用例，得到 `AssertionError [ERR_ASSERTION]: memory must agree with the durable flag  actual: false, expected: true`，随后按字节还原。inbox-read.test.mjs 现 14 个用例全 pass。

## 2. 任务看板唯一的 FAIL：容器查询 vs 媒体查询（本批 P1 收口）

上一批 `board-1440-light-main640`（窗口 1440、主区 640）判 FAIL：窄布局没生效。根因是 `ui/tasks/room-task-board.css` 只有 `@media(max-width:650px)`，它看的是**窗口宽度**，主区被宿主压窄时不会触发。

改为 `container-type:inline-size; container-name:lm-task-board` + `@container lm-task-board (max-width:650px)` 驱动筛选换行与行头 `flex-wrap`；padding 那一条**必须留在 `@media` 里**——元素不能是自己的容器，容器查询只对后代生效。因此「主区 640 时是窄布局但仍是 24px 内边距」是设计行为，不是回归。

生成器 `scripts/task-board-preview.mjs` 的断点随之重定基准：`inline-size` 量的是内容盒，阈值落在「主区宽 − 两侧 padding」，699px 主区剩 651px 保持宽、698px 剩 650px 翻转，用例改名 `board-699-light-boundary-wide` / `board-698-light-boundary-narrow`。

## 3. Network 与任务看板补取证生成器

- `scripts/network-workbench-preview.mjs`（`npm run preview:network`）：11 例全 PASS。6 个 fixture html 原本就与 `ui/network/network-workbench.css` 字节相同，生成器输出 "nothing rewritten"；它的价值是把「fixture 必须与组件 CSS 同源」固化成幂等重写 + 读回校验。
- `scripts/task-board-preview.mjs`（`npm run preview:board`）：19 例全 PASS、`failedChecks` 空、`clippedRows:0`、`overflowingText:0`；报告 `report.md` 改为整篇生成，替换掉原先手写且含陈旧 FAIL 叙述的版本。
- 两份都连跑两次 sha256 完全一致（真幂等）。

## 4. 历史分页索引（交接 P1「大历史日志每页流式扫描无索引」）

新增 `inbox.room-index.json` sidecar：按 Room 记录**每条记录的字节偏移**，保留最近 400 条（默认 8 页 / 最大 4 页），由 `ROOM_INDEX_TAIL_BYTES=4096` 的尾部 sha256 + 全量 digest 双重钉住。

关键设计是**索引只是缓存，绝不能改变结果**：

- 任何异常（缺失 / 空 / 截断 / 非 JSON / 版本不符 / 尺寸不符 / digest 不符 / 尾部半行 / 房间键错位）一律当作不存在，回退全量扫描，结果逐字节相同；
- `readRoomHistory` 内部改走 `queueInboxWrite`，日志与 sidecar 共用一条写队列，避免「读完偏移、读字节前」被 append/rewrite 插入；
- `rewriteInbox` 成功 rename 后直接 `unlink` 索引；
- 命中计划后仍要**在读到的字节上逐条复核** `offset/node/id` 与 `cursorOffset`，不符即回退。

`scripts/history-index.test.mjs`（5 例）用 `fs.createReadStream` 计量器统计字节与 `options.start`，**不用墙钟时间**。实测：文件 633780 B / 3000 行时，warm 首屏读 173 行 / 36532 B，删索引后同一游标读 3020 行 / 637876 B；第 2–7 页各 329 行 / 69632 B（未命中时同样是 3020 行 / 637876 B）；两路径 `samePage=true`、`sameCursor=true`。

已知边界：多进程同写同一 inbox 无跨进程锁，只靠 size+tail 签名与逐条复核兜底（正确性靠回退保证，性能会退化）；窗口 400 条/room，第 8 页起按设计回退全量扫描；>1GB 文件与跨平台路径未实测。

## 5. Team 只读 Owner 契约与 UX-6 矩阵（先文档，不改授权逻辑）

- `docs/ux/team-owner-readonly-contract.md`（257 行）：三条红线、`teamOverview` 的请求/响应/不返回字段契约、4 身份 × 4 动作权限矩阵（16 格里「允许」只有 1 格）、23 条 node:test 验收条件。**未写一行实现代码**，M6 与 0.4.5 草稿未动。
- 其中两条硬发现值得单列：`index.js:1592-1604` 的面板错误码映射把 `FORBIDDEN`/`TEAM_DISABLED`/`TEAM_STORAGE`/`NOT_READY` 全兜底成 `LAN_MESH_FAILED`，「你不是这个房的人」和「存储坏了」在 UI 上同形——实现投影前必须先补显式分支；absent / NOT_READY / 真的 0 个任务三者必须靠 `known` + `teamStatus:'absent'` + `taskCounts:null` 在字段层区分，否则会被抹平成健康态。
- `docs/ux/ux6-matrix-report.md`：15 项逐项 PASS/FAIL/NOT RUN 并标证据级别（L0 生产 / L1 双机 / L2 原型 / L3 自动化 / L4 文档陈述）。结论是原型 PASS 3 项、部分实测未达 PASS 3 项、门禁类 PASS 1 项（A14）、NOT RUN 8 项；**生产界面验证 PASS 0/15、真双机 PASS 0**。
- 报告指出的最重要一条不是缺证据，而是**判据要求了产品没实现的状态**：A10 的「离线」在 Network 组件里不存在（只有 local/stale），A12 的「计划未批准 / Review 未通过」在看板模型里不存在。这两项补生成器也补不出来，要先做需求侧定性。

## 6. 版本一致性成为门禁

新增 `scripts/version-consistency.test.mjs`（2 例）：①package.json / package-lock.json 两处 / client.js PLUGIN_VERSION 四处一致；②三个 preview npm script 各自指向存在的生成器文件。已验证能抓漂移：把 client.js 改回 0.4.20 → `AssertionError: client.js PLUGIN_VERSION '0.4.20' !== '0.4.21'`，exit 1。

## 7. 门禁

| 门禁 | 结果 |
| --- | --- |
| 完整测试（DSH_HOME 隔离） | **499/499**，0 fail / 0 skipped / 0 todo，duration_ms 102562.45，exit 0 |
| `node scripts/build-client.mjs --check` | `client UI blocks match source` |
| Composer 兼容 | PASS，实际宿主 `@deepseek-ai/dsh 0.2.2-rc.3`，4 个公开 client 入口 |
| panel | 283/283 |
| schema | 82/82 |
| `npm run preview:board` | exit 0，19 cases / 0 FAIL / 0 runtime errors |

完整测试从 0.4.20 的 491 升到 499：+3 已读回滚回归、+2 版本一致性、+5 历史索引（其中改造后重跑 1 例）。版本 0.4.21 写在四处（package.json:3、package-lock.json:3 与 :9、client.js:4）。

## 8. 未完成

- **P0 实机验收全部 NOT RUN**，未记 PASS：四页签、原生返回/侧栏、图片上传中切页、跨 Room 草稿、@精确 Agent、固定文档版本、技能提示、设为任务；Room 与 Inbox 计数与重启持久化的实机复核；真双机（发现/失联恢复/加入、同名消歧、归档/静音/@例外、历史与附件读取）。
  - 本机 `http://127.0.0.1:3080` 直接 fetch 恒返回 401（`dsh web authentication required`），真实宿主验收无法自动化，必须人工操作浏览器。
- A10「离线」、A12「计划未批准/Review 未通过」两条判据对应的组件状态不存在，需要先做需求侧定性；在定性前不得改判据措辞绕过。
- 草稿仍只存页面内存，整页重载会丢；未做本地持久化（也不允许偷偷把 File/正文写 localStorage）。
- Team Owner 只读投影只有契约文档，**没有实现**；M6 计划批准/DAG/Review/人工合并仍未交付，0.4.5 草稿与原保护工作区未动。

下一入口：docs/handoffs/dsh-ux-v0.4.21-handoff.md。
