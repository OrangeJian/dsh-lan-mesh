# Room Composer 与共享文档设计

## 意图

LAN Mesh 的 Room 不只是消息群聊，还要成为大需求和跨系统协作的工作面：人和多个 Agent 可以在同一项目中发送图片、附件、技能引用和精确的 `@`，并围绕同一份需求文档或设计文档持续澄清、修改和回溯。

选定的核心原则是：

- Room 保留自己的消息和文档语义，不伪装成 Agent Session。
- 优先复用 DSH 官方的编辑、附件和引用能力，但不依赖官方 Composer 的私有内部状态。
- 技能只作为已确认的结构化引用，不因为被选中而直接执行。
- 共享文档无冲突时自动提交，只有冲突时需要人确认。
- 提交、合并、冲突、驳回和解决记录都是只追加、可审计的，任何人不能改写历史。

## 目标

### Room Composer

- 使用接近 DSH 官方输入框的编辑与附件体验。
- 支持粘贴图片、选择多个文件、拖拽添加、预览、上传进度、失败重试与移除。
- 支持从本节点可见的技能目录选择技能，在草稿和消息中保留结构化技能引用。
- `@` 候选项显示 `Agent 名称 · 机器名称`；仍重名时再附加简短 Session ID。
- 发送结果继续进入 Room 消息协议，而不是官方 Session 的默认消息通道。

### 共享文档

- Room 可创建和维护 Markdown 需求文档、澄清文档和设计文档。
- 成员和被授权 Agent 都可基于已知版本提交 patch。
- 当基础版本仍是最新版本时直接提交；当已有并发修改时进行三方合并。
- 三方合并无冲突则自动创建新版本；有冲突则保留提案并进入人工确认。
- 支持查看版本、diff、作者、来源机器、提交说明、关联任务与冲突解决过程。
- 可导入或导出为仓库中的 Markdown，但 Git 不是 Room 文档的唯一后端。

## 非目标

- 本阶段不实现字符级实时协同或 CRDT。
- 不共享某个 Agent 的完整私有会话、隐式推理或本机未授权文件。
- 技能引用不代表技能已安装在所有节点，也不会自动运行。
- 不让两个节点同时改写同一份“最新正文”后靠时钟猜测谁获胜。
- 不用内联 base64 大文件继续扩充 Room 消息体。

## 考虑过的方案

### Composer

1. **完整复用官方 InputBar**：外观最一致，但它绑定 Session 输入机、发送队列和默认 sink，Room 需要伪造 Session，升级风险高。
2. **官方能力组件 + Room 适配层（已选）**：复用对外合同稳定的编辑、附件、引用与样式能力，由 Room 管理草稿和提交。
3. **全部自研**：自由度高，但会重复官方的粘贴、拖拽、上传、菜单和无障碍交互。

### 共享文档

1. **Room 原生版本化文档（已选）**：跨系统、不依赖同一 Git 仓库，并能直接组成 Agent 上下文包。
2. **Git-only Markdown**：审计强，但要求所有参与者共享仓库和凭据，不适合需求刚开始或横跨多系统的阶段。
3. **CRDT 实时文档**：同时编辑体验最好，但实现成本高，Agent 的大块语义修改也不适合仅靠字符合并。

## 整体架构

### 1. Room Composer 适配层

Room Composer 拥有独立的 `RoomDraft`：

```text
RoomDraft
├─ text
├─ mentions[]      // member key + 发送时显示名快照
├─ skillRefs[]     // 已确认技能名 + 来源节点
├─ attachmentIds[] // 浏览器草稿附件
└─ phase           // editing/uploading/sending/error
```

适配层只使用 DSH 对外发布的合同、插槽或组件；不直接依赖打包文件中的私有函数。如某个官方能力只支持 Session scope，则由 Room 实现同样的公开数据合同，不创建虚假 Session。

实施前先做一个限时兼容性 spike，记录当前 DSH 版本真正可公开复用的编辑器、附件插槽、上传服务和技能目录接口。无法脱离 Session 复用的部分由 Room 实现小型适配，不导入 bundle 中未导出的符号。

#### 技能引用

- 用户通过 `/` 菜单选择技能。
- 只有用户确认的技能名会进入 `skillRefs`，不从普通文本中猜测。
- 消息正文保留可读的 `/skill-name`，结构化字段保留 `{name, sourceNodeId, sourceNodeName}`。
- 接收 Agent 将它视为“可考虑使用”的能力提示。本机不存在该技能时，保留引用并明确标记不可用，不自动安装。

#### `@` 消歧

- Room 成员投影增加稳定的 `nodeName`，加入时写入并可由节点身份更新。
- 候选项主文字是 Agent 名称或 title，副文字是机器名称。
- 同机器仍重名时，附加短 Session ID。
- 发送时保留 `memberKey`，显示名只是快照；改名不会把旧消息的提及指向另一个人。

### 2. Room 附件存储与传输

现有单文件 base64 消息仅作为兼容读路径，新附件使用内容寻址的 `RoomBlobStore`：

```text
RoomAttachmentRef
├─ blobId          // sha256
├─ name
├─ mediaType
├─ size
├─ ownerNodeId
└─ imageMeta?     // width / height
```

`RoomAttachmentRef` 是不可变的内容引用。可变的 holder 状态通过独立、可重放的 holder declaration 维护，不改写消息内的引用。

- 字节通过独立的限流流式 HTTP 端点传输，不进入 Room JSON 快照。
- 传输继承 Mesh 身份验证和授权；接收后校验长度与 SHA-256。
- 消息确认前，blob 必须持久化到发送节点和 Room Leader；Leader 不可达时只能保存本地草稿，不宣称已发送。在线成员节点可按需拉取并成为新 holder。
- blob 先写临时文件，校验长度与 hash，再 `fsync + rename`。引用只在 blob 持久化后提交；崩溃留下的无引用 blob 由延迟回收任务清理。
- 节点离线时，已有消息和元数据仍可见；没有可达 holder 时明确显示“附件暂不可用”。
- 限制由配置定义，并在浏览器、Host 入口和节点传输三层同时校验。

### 3. Room 原生共享文档

#### 文档与修订

```text
SharedDocument
├─ documentId
├─ roomId
├─ title
├─ format = markdown
├─ headRevisionId
├─ contentHash
├─ createdBy / createdAt
└─ deletedAt?

DocumentRevision
├─ revisionId
├─ proposalId
├─ documentId
├─ parentRevisionId
├─ baseRevisionId
├─ authorKey / authorNodeName
├─ createdAt
├─ message
├─ patch
├─ resultHash
├─ source            // human / agent / import / conflict-resolution
├─ relatedTaskId?
└─ relatedMessageId?
```

正文可以通过最近快照加后续 patch 重建。快照是性能优化，修订日志才是审计真相。

#### 提交与冲突

Room 的逻辑 Leader 是文档最新版本的单一排序者，避免多节点靠墙钟决定最新正文。

1. 编辑者获取 `baseRevisionId` 和正文，产生 patch 及提交说明。
2. Leader 先验证成员身份、Room 权限、base hash 和 patch 边界。
3. `base === head` 时直接应用并追加 revision。
4. `base !== head` 时使用 base / current head / proposed result 进行确定性的行级 `diff3`。patch 使用唯一 canonical 格式，文档大小和 patch 大小都有配置上限。
5. 无冲突时自动追加 merge revision，记录原提案和自动合并关系。
6. 有冲突时不改变 head，创建 `conflicted proposal`，保存冲突块和两边内容。
7. 任何人类 Room 成员都可以选择或编辑冲突解决结果，以新的 resolution proposal 提交；Agent 不能冒充人类确认。
8. 只有 Room Leader 或 Leader 明确指定的文档维护者可以确认 resolution proposal 并更新 head。确认时创建新 revision，并把提案者、确认者、原冲突与最终 diff 写入审计链。

Leader 离线时，本地编辑可保存为 pending proposal，但不宣称已成为全局最新版本。M1 不自动选举新 Leader。

`proposalId` 由提案方在首次保存时生成，重试不变。Leader 以 proposalId 幂等去重，并在真正接收时重新基于当前 head 进行合并，不相信离线期间的预计结果。

revision、audit event、head 更新、proposal 幂等记录和同步 outbox 必须在 Leader 上的同一持久事务中提交。不允许出现“正文已更新，但审计记录或同步意图缺失”的可见状态。

### 4. 不可改写的审计记录

每个文档另有只追加事件流，不只记录成功 revision：

- proposal submitted
- proposal accepted
- proposal auto-merged
- conflict detected
- conflict resolved
- proposal rejected / withdrawn
- document imported / exported / renamed / archived

每个事件包含 `eventId`、Leader generation、文档顺序号、前一事件 hash、事件内容 hash、actor key、来源 node、时间、base/head revision、patch 或其永久修订引用。审计顺序只以 Leader generation + seq 为准，不以各节点时间为准。同一 generation + seq 出现不同 hash 时必须停止同步并报警，不自行选择一份。任何“删除”都是新的 tombstone 事件，不物理抹除旧记录。

只要文档未进入经配置的整体保留期清理，用于重建任意 revision 的快照和修订对象就不得垃圾回收。hash 不能代替可恢复的实际 patch。

日志在 Leader 上持久写入后才确认提交，并通过 Room 反熵同步到成员节点。对端按 `eventId + seq + hash` 去重和校验。

### 5. Agent 上下文包

共享上下文不等于拷贝所有聊天。当 Agent 被 `@`、接收任务或主动请求项目上下文时，Host 组装有界的 `RoomContextPacket`：

```text
RoomContextPacket
├─ room + task
├─ selectedDocumentVersions[]
├─ confirmedDecisions[]
├─ openQuestions[]
├─ referencedMessages[]
├─ attachmentRefs[]
└─ skillRefs[]
```

- 每份文档引用必须带 revision ID 和 content hash。
- M1 中的 confirmed decisions 和 open questions 只来自用户或授权 Agent 显式标记的文档块/字段，不由模型从自由文本中静默猜测。
- 默认只选择与任务或提及直接关联的资料，并设定大小上限。
- Agent 需要更多内容时通过工具按文档或版本继续读取，而不是让一个无上限群聊历史进入 prompt。
- 每次向 Agent 交付上下文时记录所用版本，以便事后解释 Agent 为什么基于某个旧需求做出决定。

## 权限与安全

- 查看 Room 不自动授予查看本机文件系统的权限。
- 附件只有在用户选择或 Agent 获得明确路径授权后才能进入 BlobStore。
- 文档修改权与 Room 成员身份绑定；Agent 仍受已有 Team authorization 和路径 grant 限制。
- 任何人类 Room 成员可提出冲突解决方案；只有 Room Leader 或其显式指定的文档维护者可确认方案并改变文档 head。
- 节点名、Agent 名和提交说明都是不可信文本，显示时转义，不参与权限判定。
- 文档与附件传输继承已有 Mesh 信任边界；开放集群模式必须继续显示安全警告。

## UI 与交互

### Room Composer

- 上方是文本编辑区，支持多行、粘贴图片、`@` 和 `/`。
- 附件轨道展示缩略图、文件卡、上传进度、重试与删除。
- 工具栏包含附件、技能、快速任务和发送；技能按钮打开与 `/` 相同的菜单。
- `@` 菜单在主名下显示机器名；在线状态和人/Agent 类型仍可见。

### 共享文档

- Room 增加“文档”视图，列出标题、最新版本、最近作者、未解决冲突和关联任务。
- 文档详情包含阅读/编辑、diff、历史和冲突四个区域。
- 普通保存显示新 revision 和提交说明，不额外要求审批。
- 冲突时展示 base / current / proposed 三方差异，只有解决冲突才能更新 head。
- 历史视图可按 revision 和 audit event 查看，可复制某个版本为新提案，但不直接删除或改写旧版本。

## 兼容与迁移

- 旧 Room 消息没有 mentions / skillRefs / attachments 时按纯文本读取。
- 旧单文件 base64 附件保留阅读支持，新发送不再产生该格式。
- 不支持新消息协议的节点仍能看到正文，但明确标记不能预览新附件或文档引用。
- 文档协议独立版本化，不因旧节点存在而降级为无审计的覆盖写入。

## 分阶段交付

1. **Composer 身份与引用**：`@` 机器消歧、结构化 mentions、技能目录和 skillRefs。
2. **Room 附件**：多附件草稿、图片预览、BlobStore、流式节点传输和旧格式兼容。
3. **共享文档核心**：创建/读取/patch、Leader 排序、三方合并、冲突提案和审计链。
4. **文档 UI 与 Agent 上下文**：编辑/diff/历史/冲突视图，文档工具和有界上下文包。
5. **Git 互操作**：手动导入/导出 Markdown，后续再考虑双向绑定。

## 验收标准

- 两个同名 Agent 分属两台机器时，`@` 候选项能明确区分，发送后仍指向正确 member key。
- 用户可粘贴多张图片、选择多个附件，对端可验证 hash 后预览或下载。
- 选择技能不会触发执行；消息同时保留可读 token 和结构化 skillRefs。
- 两个节点修改文档的不同段落时自动合并，不弹出人工确认。
- 两个节点修改同一文本区域时，head 不被覆盖，且冲突提案可由人解决。
- 普通人类成员可提交冲突解决方案，但无法绕过 Leader/文档维护者的确认直接改写 head。
- 成功提交、自动合并、冲突与解决都可从审计日志恢复出作者、来源机器、基础版本、diff 和结果 hash。
- 重启、消息重放和网络重试不会产生重复 revision，也不会跳过冲突检测。

## 后续但不在本设计内

- Room Leader 故障转移和文档排序权的安全迁移。
- 字符级实时协同 / CRDT。
- 与 Git 文件的自动双向同步。
- 跨 Room 的文档共享、模板库和全局搜索。
- 附件副本策略、配额和垃圾回收的管理界面。
