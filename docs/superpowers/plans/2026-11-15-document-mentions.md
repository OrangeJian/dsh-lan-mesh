# G2 输入框直接引用文档

复用既有documents/documentRead和contextSelection，不新增文件传输或改变Agent唤醒规则。@候选同时包含成员和共享Markdown文档，文档明确标注标题与版本；有文档匹配时给成员与文档各保留候选位置。按回车/Tab或点击选择。

文档列表不提供正文hash，选取时必须按候选headRevisionId读取精确修订，核对返回documentId/revisionId/contentHash后加入上下文。只在明确选取时更新所选版本，后续head变化不得静默替换。正文不写入聊天，文档选择不会生成member mention或@all。

本地引用标签可包含标题，但发送给Host的选择严格只含documentId/revisionId/contentHash。最多8份；去重、逐项移除；失败保留草稿，异步旧房间/旧文本结果不能覆盖当前输入，选取中不发送缺少文档的消息或任务。

实施：先在组件harness复现缺少候选→实现列表/精确读取/标签/键盘→覆盖失败、编辑及房间切换竞争和实际发送参数→独立候选全套回归。工作区M6草稿不集成。版本0.4.4用于该G2增量；真实三机验收仍是后续自动编排的独立门槛。
