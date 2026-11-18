# C0 隔离探针回执

2026-11-18。基于2c39807；仅新增开发探针和证据，不改变产品协议或运行时版本。

- scripts/c0-identity-probe.mjs：真实独立Node进程调用现有持久层，六项断言通过。重启/cwd变化保留身份；不同端口槽、不同DSH_HOME独立；自定义primaryPort仍沿用根槽。不是完整Host生命周期或物理双机测试。
- scripts/c0-sdk-inventory.mjs：核实本机DSH 0.2.2-rc.3三个公开包入口、版本及根声明哈希；声明存在不代表运行能力。原始输出在evidence/c0。
- scripts/c0-owner-route-probe.mjs：实际安装的HostConnectionService组件，非Owner在处理函数前403，伪造payload/header无效；进程内可信Owner200；路由释放后404。认证依赖使用拒绝式替身，没有获取或绕过真实凭据；这不是浏览器认证、撤权或Room/Team ACL验收。

## Runner核实结论

安装包公开dsh-agent声明包含create/resume、AgentHandle.dispose、Agent.cancel、whenIdle及followup。dispose属于创建者持有的能力；get只返回Agent，不能推导为有权释放。cancel是请求，whenIdle反映整体静止，不标识某条消息完成。create返回后可驱动，但未提供本插件executionId/generation的持久幂等保证。

因此下一批Runner契约必须分别处理取消请求/停止确认、拥有handle/仅能观察、提交消息/成果验收。当前不启用真实任务、Headless或M6，不把这些声明记为运行通过。

## 仍需完成

真实Host多实例及Session生命周期、Owner撤权、Runner启动ACK丢失/崩溃恢复/隔离、物理双机仍NOT RUN。hostInstanceId是否必要尚无足够证据；Registry/Binding尚未实施。原五份未跟踪冻结方案及0.4.5/M6保护工作未覆盖。

执行方式：node scripts/c0-identity-probe.mjs；node scripts/c0-sdk-inventory.mjs；node scripts/c0-owner-route-probe.mjs。全部失败时非零退出。输出含时间，重跑会变化，不是确定性快照门禁。
