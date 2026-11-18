# v0.4.23 Coordinator关闭边界修复

## 触发与行为

原实现仅handle拒绝closed，create/dispatch仍能在close后写入任务。异步authorize等待期间close也无法阻止随后写盘。新增两项回归，旧代码均报Missing expected rejection；修复在授权前后及上下文准备后重新校验closed，返回CLOSED且不新增任务或发送请求。

该修复限制新准入，不声称能中断已经运行的Worker。既有uncertain恢复与人工核对要求保留。后续Runner/Registry及真实Host验证仍未完成；没有启用M6。

## 验证

Coordinator26/26，版本一致2/2，构建一致，保护基线13/13。完整测试结果待本批运行结束后补记。受限环境附件网络测试失败，不计PASS；另在允许本机服务的环境复核。

仅本地提交，不推送；原五份未跟踪架构基线未修改。

最终复核：允许本机服务环境完整505/505，0失败/跳过/取消；panel283/283、schema82/82、Composer DSH0.2.2-rc.3通过。完整日志.test-tmp/v423-approved-full.log。受限环境运行已终止，未当通过证据。
