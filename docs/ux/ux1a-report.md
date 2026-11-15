# UX-1a：头部、身份版本与返回对话

版本 0.4.6；分支 codex/ux-workbench，从稳定 dfd8013 / 0.4.4 创建。0.4.5 是原工作区未完成的任务成果引用，因此本分支跳过该运行版本，未包含 0.4.5 或 M6 业务代码。

已交付：左上“返回对话”，沿用既有 leavePanel；主内容区有独立备用入口，原生侧栏收起也可退出工作台。Room 内部返回仍为项目导航，不与原生返回混淆。品牌、版本和节点身份分层；版本详情可展开，界面/服务版本不一致有提示。新增纯身份 ViewModel、头部组件及作用域 CSS，用零依赖生成脚本嵌入宿主现有 ModuleLoader，不引入运行时相对导入或新的宿主依赖。

构建：npm run build:client；一致性：npm run check:client-build。源片段位于 ui/；发布仍读取已提交 client.js，不要求用户安装开发工具或现场构建。CRLF/LF 统一后比较，避免 Windows checkout 误报过期。

验证记录：panel 215/215、schema 82/82、DSH 0.2.2-rc.3 Composer 兼容 PASS。实际头部组件在示例宿主表面渲染的桌面/窄窗/深色截图见 ux1a-preview/；它们不是已加载到真实 DSH 的截图。真实宿主操作和两节点验证仍 NOT RUN。

完整测试最终日志 .test-tmp/ux1-shell-final-full.log；独立只读审查未发现阻塞或重要问题。原工作区 13 个受保护文件内容指纹全部未变，记录 .test-tmp/ux1-source-protection.json。

本批只完成 UX-1a。UX-1b 仍需项目树、行尾操作、集中发现入口和管理区；UX-1c 仍需壳级失败/断线及真实布局回归。完整网络总览、Room 阅读改版、Inbox 紧凑列表尚未实施。未改变任何 Mesh/Room/Team 协议或执行门禁。仅本地提交，不推送 GitHub。

最终完整回归：404/404，通过且无跳过；界面215/215、Schema82/82、Composer兼容PASS。构建源与发布入口一致。
