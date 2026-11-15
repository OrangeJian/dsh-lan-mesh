# UX-1e 完整Composer草稿保护

基线6124d4b/0.4.10，版本0.4.11。按已确认的导航不丢草稿要求，缓存范围为同一页面/插件实例生命周期内的nodeId+sessionId+roomId；不把正文或File写入localStorage，不承诺整页重载/插件重载恢复。

保留文字/光标、精确mentions、Skill来源、固定文档版本、快速任务和任务表单；附件原File、预览URL、上传控制器/状态与重试messageId保持同一对象。Room组件仍真正卸载，停止原轮询；仅上传资源缓存，不将隐藏Room维持在线阅读。离开视图不dispose附件，空草稿退出释放；明确退出Room与页面/插件退出清理资源。旧挂载的迟到回调不得覆盖重新进入后编辑的草稿。

实现：纯内存store+显式React字段适配；createAttachmentDraft仅增加更新limits能力，权限/协议/后端限额校验不变。重新进入仍读最新Room权限，缓存不是授权。发送失败保持原messageId用于同内容重试，内容改变生成新ID；成功按原行为清理已发送输入，不更改既有文档引用复用语义。

步骤：RED store/资源/迟到写入测试→Room字段/附件接线→同房间恢复、异房间隔离、文档/技能/图片与失败重试实际Host harness→完整回归/只读审查→本地提交。不推送、不触碰原0.4.5/M6。

Ruling：空附件资源在解绑时dispose并置空，轻量元数据记录保留至页面结束，以兼容React Effect重放；不在解绑时删除整个记录，避免重新挂载复用已dispose的上传控制器。附件limits更新单独Effect，不通过卸载资源实现。旧文档测试的fresh场景显式清空其fixture草稿，持久化行为由新增真实Host流程独立检验。
