# Codex M3 四项边界修正

基线：`89612b9`。按负责人要求直接修正复核发现的四项问题，没有推进 M4 或其他阶段，没有操作浏览器。

- 清单规范化从原始记录读取并校验 mentions/skillRefs，保留不可变 fingerprint，不再丢失精确引用。
- 丢回执对账只有完整遍历后才能把未找到的消息记为 absent；分页预算耗尽保留 unknown，不持久化错误的失败结论。
- 客户端按流计数读取清单响应，超过 1 MiB 取消读取；条目数量不得超过请求 limit 或协议最大值。
- 加入房间时传递实际加入会话；其他自动回填入口优先本机 human 成员，否则选择本机合法成员，由服务层再次精确授权。

新增 `scripts/attachment-sync-boundaries.test.mjs`，覆盖引用/fingerprint 保留、超限流取消和条目数拒绝、未读完分页的未知结果、Agent-only 成员身份回填。原始测试日志保留在本地 `.test-tmp/codex-m3-boundaries-*.log`，不提交测试缓存。

真实浏览器及多物理设备行为仍由负责人验收；自动化结果不替代该验收。

验证：`node --test --test-timeout=90000 scripts/*.test.mjs` 为 202/202 通过、0 失败/跳过/取消；`node scripts/panel-check.mjs` 为 167/167 通过；`git diff --check` 通过。最初受限环境的专项运行遇到临时目录 EPERM，正常本地环境的完整运行通过，未将权限失败当成业务通过。
