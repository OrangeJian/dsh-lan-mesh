# 收件箱未读修复交接（2026-11-09）

本次修改由主控与 composer UX 修复统一提交、推送；最终 SHA 以主控交付记录为准。

## 最终行为

- Panel snapshot 使用独立 `humanInbox()` 投影，只展示未读且不是本机人类发出的消息。本机 `human` 与历史空 session 发言均排除，包括发给本机 Agent 的消息；远端 `human` 和本机 Agent 保留。
- 投影先过滤，直接返回内存历史中的全部匹配项（历史上限仍为 500）；列表、收件箱 unread 和 self.unread 使用相同判定，避免旧 100 条分页截断遮挡未读。
- 点击普通私信仅将对应消息标读；点击房间消息先等待对应消息持久标读，再打开房间。展开长文不会标读或跳转。全部标读等待持久化，再刷新。
- `markRead` Panel RPC 新增可选 `messageId`，缺省时全部标读。Agent `inbox()` 工具的内容、分页与计数语义保持原样。
- inbox 文件追加与 read flag 全量重写共用每文件串行队列，读取等待先前写入；关闭节点时也等待 inbox 持久化。避免并发 `.tmp` 覆盖和追加被重写吞掉。

## 验证

- `node --test scripts/inbox-read.test.mjs`：3/3 通过。
- `npm test`：120/120 通过。
- `node scripts/panel-check.mjs`：150/150 通过（包含另一 agent 的轮询/成员任务 UX 回归）。
- `node --check client.js`、`lib/service.mjs`、`lib/store.mjs` 通过。
- 本执行环境直接运行 schema-check 缺少框架 validator，需要设置 `DSH_TOOLS_MODULE`；另一 agent 已验证的框架路径及最终 schema 结果由主控汇总。

新增 service 回归使用真实临时 DSH_HOME、节点 start/close/restart，覆盖远端人类、本机 Agent、本机人类发给 Agent、旧空 session、110 条本机消息不会遮挡旧入站消息、单条普通房间消息读取、全部标读、附件保留、重启不复活，以及 26 条消息追加/重写并发。

Panel 回归覆盖远端人类身份、隐藏本机人类、私信点击只标该条、非 @ 房间消息先标读再跳转、返回后不复活、全部清空及计数为零。

## 边界与跨机器验收

- 既有 `roomDetail` 对当前会话关注项（@/任务）的读取机制保持兼容；普通消息不会因 snapshot 或房间轮询自动清除，明确点击才按 id 标读。
- 未改变既有 500 条内存历史保留上限；磁盘队列是同一 Node 进程内协调，未新增跨进程文件锁。
- 未进行两台真实设备实测。建议明天分别以人类和 Agent 发私信/房间消息，核对远端收件箱、点击后计数、重启后 read flags；本机人类自己的消息应始终不出现。
