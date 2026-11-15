# G0-B 固定源码研究（增量记录）

只读克隆至.test-tmp/references，不安装依赖、不运行外部项目、不复制代码。以下只声明实际读过的机制，不代表整个项目已审计。

| 项目 | 固定SHA | 核查路径及机制 | 本项目取舍 |
|---|---|---|---|
| LinYanZhi/dsh-mesh | 8e105334218613930e4b1473e6d23c7d1ba08616 | packages/dsh-mesh-host/lib/index.js：进程内插件用loopback HTTP桥接外置服务；peer-client.js：Bearer令牌与TLS指纹检查；core/acl.js：显式ACL更新，不自动扩展既有allow | 已有进程内Runtime适配，不新增独立桥；ACL升级不静默扩权的原则纳入后续授权迁移设计，不移植MCP传输 |
| fiultyy/maestro-preset | 89edd6d1681d4d9c69f0a87e0258099253b7bd44 | plugins/host-callback-bridge/core/dedup.js：from+msgid/body双摘要，Map内时间窗口去重；http-intake.js与file-router.js共享去重内核 | 可参考跨入口一致幂等，但窗口Map不是跨重启执行账本，不替换team-store的长期execution ID与uncertain语义 |
| NanmiCoder/dsh-agent-teams | 4354b0f6a793b75c1904c0ee85eef4043a37c733（ls-remote） | 克隆尚未完成，未核查源码和许可 | 不下采用结论，待补 |
| stablyai/orca | 8728a3260052cb71b4d005dde2dbc7657a21a682（ls-remote） | 克隆尚未完成，未核查源码和许可 | 不下采用结论，待补 |

已读前两项目根LICENSE均为MIT，归属分别为LinYanZhi及dsh-mesh contributors、maestro preset maintainers；若后续复制任何代码须保留版权及许可，此次未复制。根许可不自动代替全部依赖许可证审核，也没有验证发布包与源码完全一致。

下一步：补齐另两项目固定源码研究；以现有Coordinator为唯一执行核心，禁止因参考项目有相近功能另建一套状态机。
