# 共享文档（M4）与上下文包（M5）冻结接口

状态：**已冻结**，2026-11-11 由 Leader 发布，作为并行实施的唯一契约来源。
依据 `docs/superpowers/specs/2026-11-08-room-composer-shared-docs-design.md` 与两份 plan，
按当前代码实际接线调整，不照抄 plan 里的旧行号。

实施者可以自由决定模块内部结构；**对外形状、错误码、限额、权限来源不能自行更改**。
需要变更时提给 Leader，由 Leader 改本文件并同步 `docs/rooms-contract.md` / `docs/ui-contract.md`。

---

## 0. 并行分工与文件所有权

| 角色 | 独占写入 | 禁止写 |
| --- | --- | --- |
| Leader | `lib/service.mjs`、`index.js`、`lib/transport.mjs`、`lib/team-coordinator.mjs`、`package.json`、`package-lock.json`、`ROADMAP.md`、`docs/shared-doc-interfaces.md`、`docs/rooms-contract.md`、`docs/ui-contract.md`、`docs/usage.md`、正式回执 | — |
| A 状态 | `lib/shared-doc-state.mjs`、`scripts/shared-doc-state.test.mjs` | 其他一切 |
| B 合并/协议 | `lib/shared-doc-merge.mjs`、`scripts/shared-doc-merge.test.mjs`、`lib/shared-doc-protocol.mjs`、`scripts/shared-doc-protocol.test.mjs` | 其他一切 |
| C 界面 | `client.js`、`scripts/panel-check.mjs` | 其他一切 |
| A 后续 | `lib/shared-doc-store.mjs`、`scripts/shared-doc-store.test.mjs` | 其他一切 |
| B/A 后续 | `lib/room-context.mjs`、`scripts/room-context.test.mjs`、`lib/shared-doc-import.mjs`、`scripts/shared-doc-import.test.mjs` | 其他一切 |
| Leader 后续 | `lib/shared-doc-coordinator.mjs`、`lib/shared-doc-tools.mjs`、`scripts/shared-doc-coordinator.test.mjs`、`scripts/shared-docs-smoke.mjs`、`scripts/schema-check.mjs` | — |

**Git 只由 Leader 执行。成员不得 `git add` / `git commit` / `git push`。**
`client.js` 任一时刻只允许 C 写。Leader 需要改 UI 时先要求 C 交付。

---

## 1. 标识符

| 名称 | 形状 | 说明 |
| --- | --- | --- |
| `documentId` | `doc-` + 12 个 `[a-z0-9]` | 正则 `^doc-[a-z0-9]{12}$` |
| `revisionId` | `rev-` + 12 个 `[a-z0-9]` | `^rev-[a-z0-9]{12}$` |
| `proposalId` | `prop-` + 12 个 `[a-z0-9]` | `^prop-[a-z0-9]{12}$`，**提案方首次保存时生成，重试必须复用** |
| `eventId` | `evt-` + 12 个 `[a-z0-9]` | `^evt-[a-z0-9]{12}$` |
| `contentHash` | 64 个小写 hex | `sha256` of UTF-8 归一后的正文 |
| `actorKey` | `${nodeId}/${sessionId}` | 与 `lib/rooms.mjs` 的 `memberKey` 同形，≤129 字符 |
| `roomId` | `^room-[a-z0-9][a-z0-9-]{3,59}$` | 复用 `lib/rooms.mjs` |

正文归一：`\r\n` → `\n`，去掉首尾空白后不再改动内部；
`contentHash` 永远对**归一后**的字节算。

## 2. 限额（全部导出常量，测试引用它们而不是字面量）

```js
export const DOC_STATE_VERSION = 1;
export const MAX_DOCUMENTS_PER_ROOM = 100;
export const MAX_DOC_TITLE = 200;          // 单行，禁止控制字符
export const MAX_DOC_MESSAGE = 2_000;      // 提交说明
export const MAX_DOC_CONTENT_BYTES = 256 * 1024;
export const MAX_DOC_PATCH_BYTES = 128 * 1024;
export const MAX_MAINTAINERS_PER_DOC = 16;
export const MAX_PROPOSALS_PER_DOC = 200;  // 未决提案上限，超出拒绝新提案
export const MAX_HISTORY_PAGE = 50;
export const MAX_CONTEXT_DOCUMENTS = 8;
export const MAX_CONTEXT_MESSAGES = 20;
export const MAX_CONTEXT_BYTES = 64 * 1024;
```

越限一律抛 `TransportError`（见 §7），**不静默截断正文**。
Context Pack 是有界包，超量时**截断并标记 `truncated: true`**，这是唯一允许截断的地方。

## 3. 状态模型（`lib/shared-doc-state.mjs`，A 负责）

```js
export function emptyDocumentState()
// → { version: DOC_STATE_VERSION, documents: {}, revisions: {}, proposals: {}, events: {}, maintainers: {} }

export function applyDocumentCommand(state, command)
// 纯函数：返回新 state，绝不修改入参；未知命令抛错；重复命令安全（幂等）返回同一 state。
```

`documents[documentId]`：

```js
{
  documentId, roomId, title, format: 'markdown',
  headRevisionId, contentHash,
  createdBy, createdAt,
  deletedAt: null | ISO,
  generation, seq,            // head 的排序键，见 §4
  conflictCount,              // 未解决的 conflicted proposal 数
}
```

`revisions[revisionId]`（**不可改写**，append-only）：

```js
{
  revisionId, proposalId, documentId,
  parentRevisionId: null | revisionId,
  baseRevisionId: null | revisionId,
  authorKey, authorNodeName, createdAt, message,
  patch,                       // canonical patch，见 §5
  resultHash,                  // = contentHash of 应用后正文
  source: 'human' | 'agent' | 'import' | 'conflict-resolution',
  relatedTaskId: null | string,
  relatedMessageId: null | string,
  generation, seq,
}
```

`proposals[proposalId]`：

```js
{
  proposalId, documentId,
  baseRevisionId,
  authorKey, authorNodeName, createdAt, message,
  status: 'pending' | 'conflicted' | 'accepted' | 'auto-merged' | 'rejected' | 'withdrawn',
  patch,
  resultHash,
  conflict: null | { hunks: ConflictHunk[], baseContentHash, currentContentHash },
  resolvedBy: null | actorKey,
  resolvedAt: null | ISO,
}
```

`events[documentId]`：**数组，只追加**。

```js
{
  eventId, documentId, generation, seq,
  prevHash,        // 前一事件的内容 hash，首事件为 ''
  hash,            // 本事件内容 hash
  type: 'proposal-submitted' | 'proposal-accepted' | 'proposal-auto-merged'
      | 'conflict-detected' | 'conflict-resolved' | 'proposal-rejected'
      | 'proposal-withdrawn' | 'document-imported' | 'document-exported'
      | 'document-renamed' | 'document-archived' | 'maintainer-granted',
  actorKey, nodeId, at,
  baseRevisionId: null | revisionId,
  headRevisionId: null | revisionId,
  proposalId: null | string,
  revisionId: null | string,
  detail: object,  // 自由字段，只允许标量/数组/普通对象，≤2000 字节 JSON
}
```

`maintainers[documentId]`：`{ [actorKey]: { actorKey, nodeId, sessionId, name, grantedBy, grantedAt } }`

**命令集**（`command.type`）：

| type | 必填 | 作用 |
| --- | --- | --- |
| `document/create` | `document, revision, event` | 建文档 + 首修订 |
| `document/rename` | `documentId, title, event` | 改标题（不动 head） |
| `document/archive` | `documentId, at, event` | 写 `deletedAt`，不物理删除 |
| `revision/append` | `revision, document, event` | 追加修订并推进 head |
| `proposal/put` | `proposal` | 建或更新提案（同 `proposalId` 只能同内容重试） |
| `proposal/status` | `proposalId, status, resolvedBy?, resolvedAt?, event` | 改提案状态 |
| `event/append` | `documentId, event` | 只追加审计事件 |
| `maintainer/grant` | `documentId, holder, event` | 授予文档维护权 |

同 `proposalId` 出现**不同内容**（`resultHash` 或 `baseRevisionId` 不同）必须拒绝：
`DOC_PROPOSAL_ID_REUSED`。

## 4. 排序权威

`(generation, seq)` 是唯一排序依据，**不使用墙钟**。
同一 `generation + seq` 出现不同 `hash` → 抛 `CONFLICTING_CHECKPOINT`，
调用方（协调器）必须暂停该文档的同步并向用户报错，**绝不自行挑一份**。

## 5. 合并（`lib/shared-doc-merge.mjs`，B 负责）

```js
export function mergeMarkdown({ base, current, proposed }) // 三个字符串
// → { status: 'clean', content: string, hunks: CleanHunk[] }
// | { status: 'conflict', hunks: ConflictHunk[] }
```

```js
ConflictHunk = {
  baseStart, baseCount,       // 0-based 行号 / 行数
  currentLines: string[],
  proposedLines: string[],
}
CleanHunk = { baseStart, baseCount, lines: string[] }
```

规则：

- 行级三方合并，**确定性**：同输入必须字节级同样输出（测试要跑两次比对）。
- 归一：输入先做 `\r\n` → `\n`；行以 `\n` 切分，末行无换行时不补。
- `base === current` → clean，返回 `proposed`。
- `base === proposed` → clean，返回 `current`（等于空操作）。
- 两侧都改同一行（或重叠行区间）且结果不同 → `conflict`。
- 两侧改动不相交 → clean，合并结果按 base 顺序排列。
- 纯插入/删除造成行号漂移必须正确对齐（这是 `diff` 库的 `structuredPatch` 存在的理由）。
- **绝不**把 `<<<<<<<` 冲突标记当成功结果返回。冲突就是 `conflict`。
- 结果 `content` 超过 `MAX_DOC_CONTENT_BYTES` → 抛 `DOC_CONTENT_TOO_LARGE`。

辅助函数（供协调器与界面复用）：

```js
export function hashContent(content)                    // sha256 hex of normalized UTF-8
export function normalizeContent(content)               // \r\n → \n
export function diffLines(base, next)                   // → CleanHunk[]（统一 patch 形状）
export function applyPatch(base, patch)                 // → string（patch 不匹配时抛 DOC_PATCH_MISMATCH）
export function patchFromContent(base, content)         // → canonical patch（JSON 可序列化）
```

`patch` 的 canonical 形状 = `CleanHunk[]`，且**必须可 JSON 往返**。
依赖 `diff@^9.0.0`（已安装，Leader 负责的 `package.json` 已改）。

## 6. 协议（`lib/shared-doc-protocol.mjs`，B 负责；`lib/transport.mjs` 由 Leader 改）

能力声明：`describe()` 增加 `sharedDocs: 1`（Leader 在 `lib/service.mjs` 里加）。

传输沿用现有 Mesh v2 签名信封，新增两种 envelope：

```js
{ kind: 'shared-doc', sharedDocsVersion: 1, documentId, op: 'submit' | 'status' | 'sync', payload: {...} }
```

- `op: 'submit'`：提案正文（`patch` 或整篇）+ `proposalId` + `baseRevisionId` + `resultHash` + actor。
- `op: 'status'`：head 指针与 `(generation, seq, hash)` 检查点，用于反熵。
- `op: 'sync'`：拉取缺失的 revision / event。

校验（全部抛 `TransportError`）：

- 签名必须通过（复用 `signEnvelope`/`verifyEnvelope`，签名输入包含新字段）。
- 对端未声明 `sharedDocs: 1` → `DOC_PEER_UNSUPPORTED`，**精确投递失败，不降级广播**。
- body 超 `MAX_BODY_BYTES` → `DOC_BODY_TOO_LARGE`。
- 同一 `eventId` 重复 → 幂等忽略，返回 accepted。
- `generation + seq` 相同但 `hash` 不同 → `CONFLICTING_CHECKPOINT`。
- 缺少中间 seq（gap）→ 返回 `gaps`，不应用，等对方补发。

## 7. 错误码

`TransportError` 的 `code` 字段，全部对上 `index.js` 的 catch 映射：

| code | 含义 |
| --- | --- |
| `DOC_NOT_FOUND` | 文档不存在或已归档不可读 |
| `DOC_TITLE_INVALID` | 标题空/超长/含控制字符 |
| `DOC_CONTENT_TOO_LARGE` | 正文超限 |
| `DOC_PATCH_TOO_LARGE` | patch 超限 |
| `DOC_PATCH_MISMATCH` | patch 无法应用到指定 base |
| `DOC_LIMIT_REACHED` | 文档数或未决提案数超限 |
| `DOC_BASE_NOT_FOUND` | `baseRevisionId` 不在历史中 |
| `DOC_PROPOSAL_ID_REUSED` | 同 proposalId 不同内容 |
| `DOC_CONFLICT_PENDING` | 文档有未解决冲突，暂不接受普通提案 |
| `NOT_DOCUMENT_MAINTAINER` | 非 Leader/维护者尝试确认 |
| `AGENT_CANNOT_CONFIRM` | Agent 尝试确认冲突解决方案 |
| `CONFLICTING_CHECKPOINT` | 同 generation+seq 不同 hash |
| `DOC_PEER_UNSUPPORTED` | 对端不支持 shared docs |
| `DOC_BODY_TOO_LARGE` | 协议消息超限 |
| `DOC_STORE_UNAVAILABLE` | 存储不可用 |
| `DOC_STORE_CORRUPT` | 存储损坏 |
| `DOC_IMPORT_PATH_DENIED` | 导入路径未获授权 |
| `DOC_EXPORT_TARGET_EXISTS` | 导出目标已存在且未授权覆盖 |

## 8. 权限（**关键**）

权限**只能**来自调用表面，不能来自 payload 字符串。这条和上一批 `roomInvite` 的
`via: 'panel'` 修复是同一个原则：

- 面板端点（owner-only connection 路由）→ 人类身份 `nodeId/human`，可提案、可确认。
- Agent 工具执行 → `exec.agent.id` 绑定的 actor key，**可提案，不可确认**。
- 文档维护者 = `state.maintainers[documentId]` 里登记的 actor key，或该 room 的 Leader。

协调器签名：

```js
createDocument({ roomId, title, content, message, via, actorKey, sessionId, relatedTaskId, relatedMessageId })
submitDocumentProposal({ documentId, baseRevisionId, content, message, proposalId, via, actorKey })
resolveDocumentConflict({ documentId, proposalId, content, message, via, actorKey })
confirmDocumentResolution({ documentId, proposalId, via, actorKey })
```

`via: 'panel' | 'tool'`。`via === 'panel'` 时 actor 强制为 `nodeId/human`，
**忽略 payload 里的任何 actor 声明**；`via === 'tool'` 时 actor 由 Leader 从
`exec.agent.id` 派生后传入，工具**无法**自报 human。

## 9. 服务方法（`lib/service.mjs`，Leader 负责接线）

```js
listDocuments({ roomId })
createDocument({...})                  // 见 §8
getDocument({ documentId, revisionId })        // → { document, revision, content }
submitDocumentProposal({...})
resolveDocumentConflict({...})
confirmDocumentResolution({...})
listDocumentHistory({ documentId, cursor, limit })  // → { revisions, events, nextCursor }
renameDocument({ documentId, title, via, actorKey })
archiveDocument({ documentId, via, actorKey })
grantDocumentMaintainer({ documentId, holderKey, via, actorKey })
importDocument({ roomId, path, title, via, actorKey })
exportDocument({ documentId, path, via, actorKey })
buildRoomContextPacket({ roomId, taskId, messageId, documentIds }, limits)
```

## 10. 面板端点（Leader 在 `index.js` 加；C 按这些名字调 `call()`）

请求/响应沿用现有信封：`call('<method>', payload)` → `{ ok: true, value } | { ok: false, error: { code, message } }`。

| method | payload | value |
| --- | --- | --- |
| `documents` | `{ roomId }` | `{ status, reason?, documents: DocumentRow[] }` |
| `documentRead` | `{ documentId, revisionId? }` | `{ status, reason?, document: DocumentView, revision: HistoryRow }` |
| `documentCreate` | `{ roomId, title, content, message }` | `{ status, reason?, document: DocumentRow }` |
| `documentPropose` | `{ documentId, baseRevisionId, content, message, proposalId? }` | `{ status: 'clean'\|'conflict'\|'pending', reason?, revision?: HistoryRow, proposal?: ProposalRow }` |
| `documentResolve` | `{ documentId, proposalId, content, message }` | `{ status, reason?, proposal: ProposalRow }` |
| `documentConfirm` | `{ documentId, proposalId }` | `{ status, reason?, document: DocumentRow, revision: HistoryRow }` |
| `documentHistory` | `{ documentId, cursor?, limit? }` | `{ status, reason?, revisions: HistoryRow[], events: object[], nextCursor: string\|'' }` |
| `documentRename` | `{ documentId, title }` | `{ status, reason?, document: DocumentRow }` |
| `documentArchive` | `{ documentId }` | `{ status, reason?, document: DocumentRow }` |
| `documentImport` | `{ roomId, path, title }` | `{ status, reason?, document: DocumentRow, audit: object }` |
| `documentExport` | `{ documentId, path }` | `{ status, reason?, path, bytes }` |

所有端点都是 **panel 入口**：Leader 在服务端强制 `via: 'panel'`，不接受 payload 里
声明的 actor。C 调用时**不要**发 `sessionId` 或任何身份字段。

## 11. 面板 DTO（C 消费，Leader 产出）

```js
DocumentRow  = { documentId, roomId, title, headRevisionId, authorName, updatedAt,
                 conflictCount, relatedTaskId }
DocumentView = { documentId, roomId, title, headRevisionId, contentHash, content,
                 canConfirm, isMaintainer }
ProposalRow  = { proposalId, documentId, status, authorName, createdAt, message,
                 resultHash, conflict: null | { hunks } }
HistoryRow   = { revisionId, parentRevisionId, authorName, createdAt, message,
                 source, relatedTaskId, eventTypes }
PanelSection = { status: 'ready' | 'unavailable' | 'error', reason? }
```

所有 `authorName` 是**不可信文本**，界面渲染时必须转义（React 默认转义即可），
且**绝不参与权限判断**。

Context Pack：

```js
RoomContextPacket = {
  roomId, taskId, generatedAt,
  selectedDocumentVersions: [{ documentId, revisionId, contentHash, title, content, truncated }],
  confirmedDecisions: [{ documentId, revisionId, block, text }],   // 只来自显式标记
  openQuestions: [{ documentId, revisionId, block, text }],
  referencedMessages: [{ id, from, text, at }],
  attachmentRefs: [{ id, name, size, mediaType, available }],
  skillRefs: [{ name, sourceNodeId, sourceNodeName }],
  truncated: boolean,
  limits: { ...MAX_CONTEXT_* },
}
```

## 12. 验收命令

Leader 在合入点跑完整套件；实施者只跑自己模块的测试。

```bash
node --test --test-timeout=120000 scripts/*.test.mjs   # 全量
node --test scripts/shared-doc-state.test.mjs          # A
node --test scripts/shared-doc-merge.test.mjs          # B
node --test scripts/shared-doc-protocol.test.mjs       # B
node --test scripts/shared-doc-store.test.mjs          # A
node --test scripts/room-context.test.mjs              # A/B
node --test scripts/shared-doc-import.test.mjs         # A/B
node scripts/panel-check.mjs                           # C
node scripts/schema-check.mjs                          # Leader（需 DSH_TOOLS_MODULE）
node scripts/shared-docs-smoke.mjs                     # Leader
```

报告必须给**实际退出码**和首次失败记录，不得用源码字符串断言凑数字。
