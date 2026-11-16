# v0.4.20 读取一致性与取证修复

上一基线 3b80fac / v0.4.19；本批为 0.4.20，代码与文档提交 `7eff5a7`（如需核对以 `git log --oneline` 为准）。GitHub 仍暂停，只本地提交。

## 1. Room 自动已读的写盘失败回滚（交接 P0）

`markRoomRead` 与 `inbox({ markRead: true })` 保持同步返回：`roomDetail`、面板路由和数十处测试都在同一个表达式里取计数，把 `roomDetail` 改成 async 会波及大量同步调用者。因此改成「乐观翻转 + 节点级串行写队列 + 失败精确回滚」：

- 新增 `this.inboxReadQueue = { queue, pending }`（lib/service.mjs:425 起）。`#markReadQueued` 立刻置 `read: true` 并记账，把 rewrite 排到队列尾；成功则清账，失败只回滚本批仍未成功的记录并 log，不抛异常——同步调用者没有 promise 可 catch。
- 回滚写在队列链内部而不是旁边，等待队列的人看到的是回滚后的最终态。
- `markAllRead` 改为走同一队列的 `#enqueueInboxSave`，仍是「先持久化成功、再翻内存、失败 reject 可重试」，原有 `assert.rejects` 回归不受影响。
- `close()` 在最终 `#saveRooms` / `#saveInbox` 之前 `await this.inboxReadsSettled()`，否则收尾快照会抢在排队的 rewrite 前面，重启后把已读记录当未读重新加载。

三个新回归（scripts/inbox-read.test.mjs，用 `inbox.jsonl.tmp` 目录制造写盘失败）：Room 自动已读失败后徽标回到 1 且磁盘仍 read:false、成功后可重试到 0；`inbox({markRead:true})` 失败同理但不抛异常；8 条 burst 已读后立即 `close()`，重开仍全部 read。

## 2. schema-check 的可移植性（本批新发现）

`scripts/schema-check.mjs` 原来把 `file:///C:/Users/jian/AppData/Roaming/npm/node_modules/...dsh-tools/lib/index.js` 写死在候选列表里，本机宿主装在 `D:\softwareNew\nodejs\node_global`，所以只能靠外部注入 `DSH_TOOLS_MODULE` 才跑得通——这既不可移植，也容易让人误以为门禁失败是环境问题。现在改为发现而不是硬编码：环境变量优先，其次从本包、再从 `npm root -g` 解析已安装宿主，经宿主解析 `@deepseek-ai/dsh-tools`。注意 `@deepseek-ai/dsh-tools` 不导出 `./lib/index.js`（`ERR_PACKAGE_PATH_NOT_EXPORTED`），必须先解 `package.json` 再拼 `lib/index.js`。清空 `DSH_TOOLS_MODULE` 后直跑仍 82/82，exit 0。

## 3. Inbox 取证过期与 540px 主区几何（交接 line 31）

`docs/ux/inbox-workbench-preview` 的 5 个 fixture 曾被漏掉容器查询：组件早已从 `@media(max-width:850px)` 换成 `@container lm-inbox (max-width:850px)`，fixture 的 CSS 却停在旧版本，于是那张「640 窄窗详情」其实还是双栏——截图配着「窄窗已适配」的结论一起过期了。

新增 `scripts/inbox-workbench-preview.mjs`（`npm run preview:inbox`）：先按 ui/inbox/inbox-workbench.css 重写 fixture 样式，再用本机 Chromium（路径探测，无浏览器就只刷新 fixture 并明确退出，不编造测量值）以 CDP 逐例截图与测量。7 例：

| 用例 | 窗口 | 主区 | columns | 列表 | 详情 | 可见行 |
| --- | --- | --- | --- | --- | --- | --- |
| list-1440-light | 1440 | 1440 | grid | 显示 | 显示 | 8 |
| detail-1024-dark | 1024 | 1024 | grid | 显示 | 显示 | 6 |
| detail-640-light | 640 | 640 | flex | 隐藏 | 显示 | 0 |
| detail-1440-main540-light | 1440 | 540 | flex | 隐藏 | 显示 | 0 |
| confirm-1440-light | 1440 | 1440 | grid | 显示 | 显示 | 7 |
| empty-1024-light | 1024 | 1024 | grid | 显示 | 显示 | 0 |
| failed-1024-dark | 1024 | 1024 | grid | 显示 | 显示 | 6 |

宽窗口把主区压到 540px 时 columns 计算值由 grid 变 flex、列表 display:none、根节点 scrollWidth 等于 clientWidth、4 个按钮（106/78/78/204px）无溢出——即判断依据确实是容器宽度而非窗口宽度，交接要求核对的那条几何成立。全部 7 例 overflow/rootOverflow 为 false、clippedRows 为 0、runtimeErrors 为空。

## 4. 门禁

完整测试 491/491（0.4.19 为 488，新增 3 个回滚回归），DSH_HOME 隔离到临时目录，`node --test --test-concurrency=1 --test-timeout=120000 scripts/*.test.mjs`，exit 0。构建 `--check` 一致；Composer 兼容门禁 PASS，**实际宿主 @deepseek-ai/dsh 0.2.2-rc.3**（与已提交矩阵一致，交接里 rc.1/rc.3 不符的问题在本机已不复现）；panel 283/283；schema 82/82。

## 5. 未完成

真机 DSH React/键盘/图片上传/四页签、Room 与 Inbox 计数与重启持久化的实机复核仍是 NOT RUN；真双机发现/失联/同名消歧/归档静音同样 NOT RUN。本批所有截图仍是组件 + 模拟数据的静态取证，不等于实机验收。大历史日志仍每页流式扫描无索引，草稿仍只存页面内存。Team 人类 Owner 只读投影需先定契约，M6 与 0.4.5 草稿未动。

下一入口：docs/handoffs/dsh-ux-v0.4.20-handoff.md。
