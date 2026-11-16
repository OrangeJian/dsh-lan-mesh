# DSH 开发交接：v0.4.20 收尾基线

交接日期：2026-11-16（Asia/Shanghai）。这是当前开发入口，旧handoff文件只作历史参考。

## 工作区和禁止覆盖的成果

- 工作目录：C:/Users/jian/.codex/worktrees/ux-workbench/dsh-lan-mesh；分支codex/ux-workbench。
- 前一个已提交基线：3b80fac / v0.4.19。v0.4.20提交 `7eff5a7`；不要以旧文档SHA替代当前HEAD。
- 原工作区C:/Users/jian/.codex/worktrees/room-collaboration/dsh-lan-mesh中的未完成0.4.5任务成果引用和暂停M6草稿禁止覆盖、清理、合入或重置。
- 用户要求每批版本号明确、本地Git留档；GitHub推送继续暂停。不要自动merge/push或自动发布。日常可逆实施无需逐步询问。

## 本批实际交付（v0.4.20）

1. Room自动已读写盘一致性（上一批P0）：`markRoomRead`、`inbox({markRead:true})`保持同步返回，改为乐观翻转+节点级串行写队列+失败精确回滚；`markAllRead`走同一队列仍"先持久化再翻内存、失败reject可重试"；`close()`在最终快照前await队列。roomDetail未改async。
2. schema-check可移植性：删除写死的用户目录候选，改为环境变量→本包→`npm root -g`解析已安装宿主。注意`@deepseek-ai/dsh-tools`不导出`./lib/index.js`，须先解`package.json`再拼。
3. Inbox静态取证：新增`scripts/inbox-workbench-preview.mjs`（`npm run preview:inbox`），按`ui/inbox/inbox-workbench.css`重写fixture后CDP实测7例并重截图，含1440宽窗口内540px主区。此前fixture缺容器查询，导致"640窄窗详情"实为双栏。
4. 版本：package.json / package-lock.json根包 / client.js PLUGIN_VERSION 均为0.4.20。

## 构建与验证

- UI源文件在ui/，`node scripts/build-client.mjs`零依赖嵌入client.js；禁止只改生成块不回写源。改完跑`node scripts/build-client.mjs --check`。
- 当前最终完整测试491/491，无失败/跳过；panel283/283；schema82/82；构建一致。
- 全套测试请设置DSH_HOME到新的隔离目录，使用`node --test --test-concurrency=1 --test-timeout=120000 scripts/*.test.mjs`；不要让测试使用用户真实.dsh。
- Composer兼容门禁PASS：本机实际解析宿主`@deepseek-ai/dsh`为**0.2.2-rc.3**，与已提交矩阵一致。上一份handoff记录的rc.1/rc.3不符在本机已不复现；若换机复现，须先核对安装位置与实际版本，不能只改矩阵绕过断言。
- `scripts/schema-check.mjs`现在不需要外部注入DSH_TOOLS_MODULE；若解析失败，那里的错误文案仍指向该变量作为人工兜底。
- 完整测试与兼容检查顺序运行并记录实际SDK版本。真实DSH React/键盘/上传、多机仍未验收，不把mock或localhost算物理两机。
- `docs/ux/inbox-workbench-preview`已由生成器刷新（7例截图+JSON测量，均overflow:false、clippedRows:0、runtimeErrors空）。network-workbench-preview、task-board-preview仍是上一批资产，未重跑。

## 下一步优先级

P0 实机验收（仍未执行，不许记PASS）：
- 四页签、原生返回/侧栏、图片上传中切页、跨Room草稿、@精确Agent、固定文档版本、技能提示、设为任务。
- Room与Inbox计数、单条/批量失败重试、重启持久化：本批已有软件级回滚与关闭等待证据，仍需实机复核徽标与重载后的一致性。
- 真双机：发现/失联恢复/加入、同名设备/Agent消歧、归档/静音/@例外、历史与附件读取。旧版本已裁掉的数据不凭空恢复。

P1 UX-6剩余矩阵：
- 按docs/ux/ux0/implementation-plan.md的A01—A15逐项PASS/FAIL/NOT RUN；1920/1440/1280/1024，深浅、原生侧栏折叠、键盘焦点、长名字、断开/迟到响应。540px主区几何已有实测证据，可并入该项。
- 版本/服务版本一致与热重载样式；缺字段/旧宿主不猜状态；列表搜索范围要保持明确。
- 大历史日志当前每页流式扫描，尚无索引；评估性能后做索引/缓存，保持严格游标、来源身份、Room隔离与保留策略。
- 草稿仅页面内存，插件/整页重载会丢；若做重载恢复需另定文件/敏感内容保留和附件资源生命周期，不偷偷把File/正文写localStorage。
- network-workbench-preview与task-board-preview的取证没有生成器，若再改Network/任务看板样式，建议照inbox的生成器范式补，避免同类"证据落后于组件"。

P2 Team与M6前置：
- 先看docs/ux/ux5a-capability-audit.md。Team status工具依赖真实Agent身份，没有Owner面板读取路由；禁止伪造human/其他Agent身份直接复用。
- 为人类Owner只读Team投影提出字段/范围/脱敏/授权契约，审查后才能接入。execution succeeded仅待review，task accepted才验收，不能显示已合并。
- 暂停M6的计划批准/DAG/Review/人工合并仍未交付或验收，不能用禁用按钮/示例数据称完成。未经明确恢复授权，不动原草稿。

## 可并行工作分配

- Agent A：UX-6本机/键盘/容器布局和证据；只改UI/验收文档。
- Agent B：历史分页性能与索引，或service/store其余一致性；只改service/store及相关测试，先写失败回归。
- Agent C：Team只读Owner接口设计与真实M1/M6门槛审计；先文档，不改暂停草稿或授权逻辑。
- 主Agent：SDK核对、共享client/build/package/index集成、完整回归、版本和本地提交。不要让多Agent同时编辑这些共享入口。

每批交付记录：实际SHA/版本、改动范围、测试结果、截图是否模拟、未完成边界。不要清理其他工作区；不要把未执行验收记PASS。
