# DSH 开发交接：v0.4.19 收尾基线

交接日期：2026-11-16（Asia/Shanghai）。这是当前开发入口，旧handoff文件只作历史参考。

## 工作区和禁止覆盖的成果

- 工作目录：C:/Users/jian/.codex/worktrees/ux-workbench/dsh-lan-mesh；分支codex/ux-workbench。
- 前一个已提交基线：1a2013c / v0.4.18。v0.4.19最终提交请读取git log；不要以旧文档SHA替代当前HEAD。
- 原工作区C:/Users/jian/.codex/worktrees/room-collaboration/dsh-lan-mesh中的未完成0.4.5任务成果引用和暂停M6草稿禁止覆盖、清理、合入或重置。原保护13份文件本次指纹一致。
- 用户要求每批版本号明确、本地Git留档；GitHub推送继续暂停。不要自动merge/push或自动发布。
- 用户已批准UX-0方案并要求持续推进、可多Agent并行。日常可逆实施无需逐步询问；新授权/协议/不可逆操作必须先形成可审查结果。

## 本批实际交付

1. 历史：0.4.15去除Room额外20条截断；0.4.16保存不再裁掉内存500条之外的磁盘历史；0.4.17仅本机Owner、人类资格校验、读后复核的Room历史分页，显式加载旧页、严格Room/来源游标、保留阅读锚点。
2. Room：0.4.18四页签、成员设备身份、发送上下文摘要、归档隐藏新增操作，保留返回原生对话。
3. v0.4.19 Inbox：紧凑两行列表/全文详情；选择不读、单条显式标读、批量确认、来源Room导航；只未读且排除本机人类发送，保留本机Agent回复；当前返回范围搜索/结构化分类/失效筛选回退。
4. 网络：拓扑/完整列表、节点详情、1/3/10/30规模、容器窄窗静态排列；连线仅本机观测，远端执行/权限未知；本机状态缺字段不当作0运行。
5. Room任务：状态分组、精确负责人筛选、同名项目ID、未知/删除处理；只读进入Room，未新增Team/M6界面。
6. 修复TaskItem仅比sessionId导致跨设备human误显示按钮；现在按nodeId+sessionId，服务端仍最终判定。
7. 显式markAllRead先写持久checkpoint，成功后才更改内存read；写盘失败保持未读和计数，可重试。可选fromNodeId精确限定单条，原无参数批量语义保持。Owner路由拒绝显式空messageId。
8. 缺消息ID/来源的历史提醒只可查看，不能发起单条标读；Inbox按实际容器宽度切单栏。

## 构建与验证

- UI源文件在ui/，scripts/build-client.mjs零依赖嵌入client.js；禁止只改生成块不回写源。运行node scripts/build-client.mjs，再node scripts/build-client.mjs --check。
- 当前最终完整测试488/488，无失败/跳过；panel283/283；schema82/82。日志在忽略目录.test-tmp/handoff-full.log、final-panel.log、handoff-schema.log。
- 全套测试请设置DSH_HOME到新的隔离目录，使用node --test --test-concurrency=1 --test-timeout=120000 scripts/*.test.mjs；不要让测试使用用户真实.dsh。
- Composer兼容门禁当前FAIL：本机实际解析DSH为0.2.2-rc.1，已提交兼容矩阵为rc.3。此前rc.3成功记录是历史环境证据，不能用于当前宿主。必须核对安装位置/实际版本，重新检查四个public client exports/inject/types后再决定升级宿主或更新矩阵，不能只改版本绕过断言。
- 完整测试与兼容检查请顺序运行；记录实际SDK版本。真实DSH React/键盘/上传、多机仍未验收，不把mock或localhost算物理两机。
- docs/ux/inbox-workbench-preview、network-workbench-preview、task-board-preview是实际组件+模拟数据静态取证，不触发真实消息/任务；含14张截图和JSON测量。最新Inbox容器查询/缺身份修复有代码与单元证据，需再核对宽窗口540px主区几何。

## 下一步优先级

P0 收尾验收与读取一致性：
- 先核对上述DSH rc.1/rc.3门禁，不伪报兼容。
- markRoomRead仍是同步翻转内存后后台保存；显式Inbox标读已修，但Room自动阅读遇写盘失败时仍需独立回归并修。保持现有同步调用契约或显式设计异步边界，不能直接把roomDetail改async而遗漏众多同步调用者。
- 实机：四页签、原生返回/侧栏、图片上传中切页、跨Room草稿、@精确Agent、固定文档版本、技能提示、设为任务；当前Room与Inbox计数、单条/批量失败重试、重启持久化。
- 真双机：发现/失联恢复/加入、同名设备/Agent消歧、归档/静音/@例外、历史与附件读取。旧版本已裁掉的数据不凭空恢复，需有可信副本或备份再设计恢复。

P1 UX-6剩余矩阵：
- 按docs/ux/ux0/implementation-plan.md的A01—A15逐项PASS/FAIL/NOT RUN；1920/1440/1280/1024，深浅、原生侧栏折叠、键盘焦点、长名字、断开/迟到响应。
- 版本/服务版本一致与热重载样式；缺字段/旧宿主不猜状态；列表搜索范围要保持明确。
- 大历史日志当前每页流式扫描，尚无索引；评估性能后做索引/缓存，保持严格游标、来源身份、Room隔离与保留策略。
- 草稿仅页面内存，插件/整页重载会丢；若做重载恢复需另定文件/敏感内容保留和附件资源生命周期，不偷偷把File/正文写localStorage。

P2 Team与M6前置：
- 先看docs/ux/ux5a-capability-audit.md。Team status工具依赖真实Agent身份，没有Owner面板读取路由；禁止伪造human/其他Agent身份直接复用。
- 为人类Owner只读Team投影提出字段/范围/脱敏/授权契约，审查后才能接入。execution succeeded仅待review，task accepted才验收，不能显示已合并。
- 暂停M6的计划批准/DAG/Review/人工合并仍未交付或验收，不能用禁用按钮/示例数据称完成。未经明确恢复授权，不动原草稿。

## 可并行工作分配

- Agent A：UX-6本机/键盘/容器布局和证据；只改UI/验收文档。
- Agent B：Room自动已读失败与历史持久化一致性；只改service/store及相关测试，先写失败回归。
- Agent C：Team只读Owner接口设计与真实M1/M6门槛审计；先文档，不改暂停草稿或授权逻辑。
- 主Agent：SDK核对、共享client/build/package/index集成、完整回归、版本和本地提交。不要让多Agent同时编辑这些共享入口。

每批交付记录：实际SHA/版本、改动范围、测试结果、截图是否模拟、未完成边界。不要清理其他工作区；不要把未执行验收记PASS。
