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

## Coordinator磁盘恢复补充

新增starting/running/uncertain三种状态的真实临时账本关闭、重新打开、recover及重复tick回归。三项均无重复wake，uncertain和started标记再次读取仍持久保留。Coordinator测试24/24通过。这是本插件账本恢复证据，不证明真实Host进程/工具副作用已经停止，也不等同Runner全生命周期通过。

## 真实 Session 组件跨进程补验

运行 node scripts/c0-runner-lifecycle-probe.mjs。安装的 DSH 组件在两个子进程共享一个临时 JSONL 目录。创建、idle 观测、按创建者句柄释放通过。显式追加无模型副作用的 title 事件并确认 flush 成功后，第二进程按原 Session ID 恢复并核对 cwd。空 Session 释放后第二进程无法恢复，返回 SessionPersistenceNotFoundError。

Runner 恢复不能把 create 成功或内存目录可见当成持久化证据。空 Session 缺失也不能证明 Worker 的所有外部副作用均未发生。保留现有 uncertain 和人工核对规则。运行中取消、唤醒崩溃窗口、工作树隔离、真实浏览器撤权和多机仍待验证。

维护任务取消补验：真实 DSH cancel 立即设置维护任务的 AbortSignal。任务刻意等待本地闸门时，whenIdle 仍未完成。释放闸门后任务以相同取消原因退出，whenIdle 才完成。Runner 应分别记录取消请求和宿主活动停止的证据。模型 turn 和子进程停机不在此次探针覆盖范围内。

Coordinator 进程退出补验：测试子进程通过实际 TeamStore 写入启动标记，在 wake 回调产生一条临时记录后以退出码 73 退出，跳过正常关闭和 wake 结果写入。父进程读回 starting；新进程执行 recover 和 tick 后，磁盘记录是 uncertain，临时唤醒记录仍仅一条。该测试覆盖 Coordinator 与账本的重启行为，wake 使用本地替身。真实 DSH 模型任务、外部进程和物理双机仍需验证。

Worktree 补验：探针创建独立临时仓库，将 Worker 工作树以 detached HEAD 固定在指定提交，然后以该目录创建并恢复 DSH Session。原工作树先写入未提交改动，探针进程在 Worker 工作树编辑同名文件。两个目录各自保留内容，HEAD 均保持基准提交。此项验证 Git 工作文件分离与 Session cwd 持久化。工具能否访问工作树之外的路径、可信仓库绑定和自动资源回收仍待验证。

工作区核对已提炼为 verifyRunnerWorkspace。它只在调用者已取得本机可信仓库绑定时使用，核对逻辑仓库 ID、两个目录的 Git 根和公共元数据目录、独立工作树及完整基准提交。探针验证了正确工作树通过，外来仓库、错误基准和直接使用原目录均拒绝。校验是时点观察，不能代替执行前重验，也不提供文件访问隔离。本批尚未接入任务派发。
