# 房间生命周期：具体设计方案（设计方案 / 待实施 / 待决项）

> 日期：2026-11-10　状态：**本文是设计/计划文档，不是实现报告**。
> 文中所有字段、枚举、状态机、计数器、端点、验证脚本均为 **PROPOSAL（本设计提出，待实施）**；
> 凡标「待负责人裁定」的条目未经确认不得进入实现；凡标「NOT」的条目明确不做。
> 本文不声称任何功能「已实现」「已验证」「已通过验收」。不做任何设备/浏览器验收结论。

---

## 0. 文档目的与来源

依据 `docs/handoffs/dsh-after-m3-prompt.md:54`：「先把已确认方向写成具体状态、权限、兼容与并发方案，再按该方案实施，记录局部裁定」。
本稿即该「具体方案」：**只写设计，不写实现代码，不改其它任何文件**。
已确认产品规则来自 `docs/superpowers/specs/2026-11-09-room-lifecycle-notes.md:5-12`（下称 notes）与
`docs/handoffs/dsh-after-m3-prompt.md:56-61`（下称 handoff）。二者是同一批负责人确认方向，本文只做具体化，不改写方向。

实施顺序（notes:12，**待实施**）：
归档/恢复 + 本地置顶/静音 → 本地历史删除/退出语义 → 负责人移交 + 无主接管。

工作流转（`docs/development-workflow.md:5`）：Codex 方案 → 负责人确认 → 冻结交接批次 → DSH 实施 →
提交变更/测试/偏差 → Codex 独立复验 → 负责人确认 → 更新 ROADMAP。
本文处于「方案」阶段；`docs/development-workflow.md:7` 要求未确认前不得开始实施、不得改协议。
`docs/development-workflow.md:11`：**禁止把 stub runtime smoke 称为真实跨设备 Agent 验收**；
localhost HTTP / stub / panel harness / 真实浏览器与多设备验收必须分开记录，本设计不伪造任何验收。

---

## 1. 状态标签表（全文统一口径）

| 标签 | 含义 | 本文中的例子 |
| --- | --- | --- |
| **已确认产品规则** | 负责人已在 notes / handoff 确认，本文只具体化、不改写 | Leader 可归档/恢复；历史参与资格独立记录；退出≠本地删除≠归档；pin/mute 本地偏好；离线≠无主；管理者不自动成 Team Leader |
| **本设计提出(待实施)** | PROPOSAL：字段名、类型、枚举、状态机、计数器、端点、测试脚本，均未实现 | `lifecycle`、`ownerGeneration`、`participants`、`muteAtException`、tie-break 规则 |
| **待负责人裁定** | 影响数据模型/协议/权限/核心架构，按 `docs/development-workflow.md:8` 必须记录建议与影响并等待确认 | 能力协商与 v1 权威合并、空缺判定阈值/法定人数、mute @ 例外默认值、归档是否禁言、回退策略 |
| **NOT** | 明确不做、禁止、红线 | 用 `retireRoom` tombstone 冒充归档；本地删除同步为全局删除；静音隐式停止已授权 Agent；静默多主写入；复用 `state.version` 当计数器；localhost stub 冒充实机验收 |

---

## 2. 已确认产品规则与逐条引用（file:line）

| # | 已确认产品规则（原文要点） | 来源 | 本文对应章节 |
| --- | --- | --- | --- |
| R1 | Leader 归档/恢复；归档默认隐藏，参与过的人类仍可在归档列表找到并查看；建议只读、停止新派发/自动唤醒；历史参与资格与当前成员分开记录 | notes:5、notes:8；handoff:56、handoff:57 | §5、§6、§7 |
| R1a | 不能借现有 `retireRoom` tombstone 冒充归档；归档须与「外部操作已终止」可区分，保留核对/取消能力 | notes:12；handoff:57 | §4、§5.3、§12 |
| R2 | 各节点保留自己的历史；退出不删他人副本；删除本地记录为单独明确操作，不被同步当作全局删除；退出/本地删除/归档是三种不同动作；删除前明确范围，自动化不触碰真实用户历史 | notes:6；handoff:58 | §7、§9 |
| R3 | 置顶/静音是本地偏好，重启保留；静音降低人类收件箱与未读噪音；@ 例外需要明确设置；不隐式停止已授权 Agent 执行 | notes:7；handoff:59 | §8、§12 |
| R4 | 可主动移交负责人；真正无负责人时允许人类接手；暂时离线≠无负责人；并发接手须唯一可解释裁决 + 审计 + 旧权威栅栏；禁止多主静默写入 | notes:9、notes:10（含管理者边界）；handoff:60、handoff:61 | §9、§10、§12 |
| R5 | 房间管理者不自动成为 Team 执行 Leader、不继承其它节点执行授权、不接管运行中任务 | notes:10；handoff:61 | §12 |

跨领域约束引用：
- `docs/ui-contract.md:4`：「任何一方要改字段，先改本文件」——见 §13。
- `docs/ui-contract.md:8-17`：人身份固定 `sessionId='human'`、`key=${nodeId}/human`、`role='leader'|'member'`，人与 agent 走相同 `members` 合并语义（墓碑、并集、leader 早者胜）——见 §6、§7。
- `docs/ui-contract.md:17`：`members` 合并语义（墓碑/并集/leader 早者胜）——历史参与资格**不能**只靠它推导（R1）。
- `docs/ui-contract.md:97`：Task `status:'open'|'doing'|'blocked'|'done'`——归档不改 Task 状态机，见 §5.3。
- `docs/ui-contract.md:51`、`docs/ui-contract.md:200`：`nickname` 是「本地偏好」端点形态（对他人的昵称只存本机、身份卡 onBlur 写本机）——pin/mute 应沿用同一「本地偏好端点」范式，见 §8、§13。
- `docs/agent-team-v0.2-design.md:47`：Team 固定 Leader、Leader 故障暂停派发、不自动故障转移；
  `:51`：generation 是**权威版本栅栏**，只允许原 Leader 暂停/恢复，变更 Leader 需人工核对后建立新 generation；
  `:53`：Team 的 `leaderKey/generation` 不随 Room 状态合并自动变化。
  **注意：这是 Team，不是 Room**（`docs/agent-team-v0.2-design.md:47-53`），见 §10.5、§12。
- `docs/architecture/project-workspace.md:51`：离线 proposal、generation 恢复、维护者授权、备份策略必须在编码前明确；**hash chain 仅能检测篡改，不保证共享密钥成员不可伪造**——见 §10.6、§16。
- `docs/development-workflow.md:5` / `:11`：流程与 stub≠实机验收——见 §0、§15。

---

## 3. 现状核对（EXISTS today，只读结论，不构成实现）

对 `lib/rooms.mjs` 的核对结论（**均为现状，不是本文产物**）：

- `lib/rooms.mjs:19` `ROOM_STATE_VERSION = 1`；`lib/rooms.mjs:41-43` `emptyState()` 返回 `{version, rooms:{}}`；
  `lib/rooms.mjs:680` `mergeStates` 收敛时 `state.version = ROOM_STATE_VERSION` 只是重新赋为同一常量。
  → **`state.version` 是静态 schema 标签，不是并发计数器**（本设计提出，待实施：不得复用）。
- `lib/rooms.mjs:198-209` `normalizeState(raw)` → `normalizeRoom`（`lib/rooms.mjs:140-190`）：
  只白名单识别 `id/name/topic/leader/createdAt/updatedAt/deleted/members/left/tasks` 并**重建全新对象字面量**，
  任何未知字段被静默丢弃。→ 新增 lifecycle/ownership/participants 字段在 v1 节点上会被丢弃（见 §11）。
- `lib/rooms.mjs:140-155` / `:646-662`：`left` 是**离场墓碑**（departure tombstone），merge 时按并集 + `departed >= joinedAt` 过滤成员；
  `lib/rooms.mjs:332`、`:383`、`:393` 描述 rejoin 清除墓碑、墓碑不得早于其取消的 join、kick 与 leave 语义一致。
- `lib/rooms.mjs:564-570` `retireRoom(state, roomId, now)`：只写 `room.deleted = true` 并 bump `updatedAt`；
  `lib/rooms.mjs:603` `mergeStates` 对 `deleted` 用 `current.deleted || other.deleted` 的 **OR 合并、不可逆、全局复制**。
  → `deleted` 是「全局删除墓碑」，**不可恢复、会抹掉全部副本**，因此 **NOT：不能拿它当归档**。
- `lib/rooms.mjs:597-677`：name 按 `updatedAt` 大者胜、leader 按 `joinedAt` 早者胜、task 按 `updatedAt` 新者胜。
  这是「无版本栅栏的时间戳/并集合并」，**不足以承载可恢复归档与接管单胜者**（见 §10）。

现状结论：**今天没有任何归档、本地偏好、历史参与资格、接管、移交机制**。本文全部为新增设计，待实施。

---

## 4. 红线（NOT，作为设计不变量）

1. **NOT**：用 `retireRoom` 的 `deleted` tombstone 冒充归档（notes:12、handoff:57；`lib/rooms.mjs:564-570`/`:603` OR 合并不可逆）。
2. **NOT**：把「归档」实现成「外部操作已终止」；归档只是沟通层状态，不改写、不终止既有执行；核对/取消能力必须保留（handoff:57）。
3. **NOT**：本地历史删除被同步为全局删除；不在复制通道发全局删除墓碑（notes:6、handoff:58）。
4. **NOT**：pin/mute 隐式停止已授权 Agent 执行、或改写 Team 执行授权（notes:7；`docs/agent-team-v0.2-design.md:49`/`:51`）。
5. **NOT**：静默多主写入；任何所有权/生命周期变更必须经单调 generation 的 CAS + 确定性裁决（handoff:60）。
6. **NOT**：离线/漏心跳自动判定「无主」（handoff:60）。
7. **NOT**：复用 `state.version`（`lib/rooms.mjs:19`）或 Team 的 `leaderKey/generation`（`docs/agent-team-v0.2-design.md:51`/`:53`）充当 Room 计数器。
8. **NOT**：凭空补造历史参与资格、把当前 `members` 反推成历史资格（notes:8）。
9. **NOT**：复用 retireRoom tombstone 作为 archive；不把 localhost stub / panel harness 冒称真实多设备验收（`docs/development-workflow.md:11`）。
10. **NOT**：本文之外编辑 `ROADMAP.md`、`docs/ui-contract.md`、任何 `lib/`、`scripts/` 文件；本稿只创建一个新文档。

---

## 5. 状态与字段 PROPOSAL（全部「本设计提出(待实施)」）

### 5.1 复制态新增字段（写入 room 记录，随 anti-entropy 收敛）

| 字段 | PROPOSAL 类型 | 默认（旧状态缺字段时） | 说明 |
| --- | --- | --- | --- |
| `lifecycle` | enum `'active' \| 'archived'` | `'active'` | 与 `deleted` **完全独立**；可恢复；归档态只读 |
| `lifecycleGeneration` | `number`（非负整数，单调递增） | `0` | 每次 active↔archived 转换 +1；收敛与旧权威栅栏用；**不使用墙钟排序** |
| `lifecycleUpdatedAt` | `string`(ISO) | `createdAt` | 仅供人类阅读/审计展示，**不参与裁决** |
| `lifecycleActor` | `string`(memberKey) \| `null` | `null` | 谁执行了最近一次转换（审计） |
| `participants` | `Record<memberKey, ParticipantRecord>` | `{}`（见 §11 限制） | **历史参与资格**，与 `members` 分离；不可由 `members` 推导 |
| `ParticipantRecord` | `{ firstJoinedAt:string, lastLeftAt:string\|null, isHuman:boolean, nodeId:string, sessionId:string }` | — | `isHuman` 由来源判定（面板 `via:'panel'`）在加入时写入，见 `docs/ui-contract.md:153-165` |
| `ownership` | `OwnershipRecord`（见 §5.2） | 见 §11 | 负责人/无主状态 |
| `lifecycleAudit` | `LifecycleEvent[]`（append-only） | `[]` | 归档/恢复/移交/空缺声明/接管事件 |

`LifecycleEvent`（PROPOSAL）：
`{ eventId:string, kind:'archive'|'restore'|'handoff-init'|'handoff-accept'|'handoff-cancel'|'vacancy-declare'|'takeover-claim'|'takeover-resolve', actorKey:string, atGeneration:number, at:string, detail:string }`。
审计为追加日志；`docs/architecture/project-workspace.md:51` 提醒 hash chain 仅能检测篡改，不保证成员不可伪造——见 §10.6、§16 待决项。

### 5.2 `OwnershipRecord`（PROPOSAL）

```ts
{
  status: 'claimed' | 'handoff-pending' | 'unowned',  // 默认见 §11
  owner: Member | null,            // status==='claimed' 时非 null
  ownerGeneration: number,         // 非负整数，单调；CAS 版本号
  handoff: { fromKey, toKey, atGeneration, claimId } | null,  // handoff-pending 时
  vacancy: { declaredByKey, evidence:string, atGeneration, declaredAt } | null, // unowned 进入依据
  lease: { ownerKey, renewedAt, leaseMs } | null      // 仅用于「在线性证据」，不自动判无主，见 §10.3
}
```

### 5.3 本地态新增（**不进入复制通道**，本设计提出，待实施）

存于每节点独立的本地偏好/本地账本文件（**不是** `rooms` 复制态）：

```ts
localPrefs[roomId]: {
  pinned: boolean,            // 默认 false
  muted: boolean,             // 默认 false
  muteAtException: boolean    // 默认待裁定，见 §8/§16；@ 例外显式开关
}
localSuppressedRooms: Set<roomId>   // 本地删除后抑制对端回灌，见 §7.3（NOT 全局删除）
localHistory: 本节点自留的房间消息/任务副本（概念上即每节点已有的整份 state 副本 + 收件箱）
```

- `lifecycle` 不改 `docs/ui-contract.md:97` 的 Task `status` 枚举；归档只影响「是否允许新派发/自动唤醒/新发言」（§5.4），不把 running/uncertain 执行改写成终止。
- 归档态 `roomAssign`/自动唤醒被拒；**既有** Task 的核对（`roomStatus` 查看/协调）与**取消**（cancel 属协调，不属新执行）保留，符合 handoff:57。

### 5.4 归档态行为矩阵（PROPOSAL）

| 能力 | active | archived | 依据 |
| --- | --- | --- | --- |
| 新 `roomAssign` 派活 | 允许（仅 Leader） | **拒绝** | handoff:57 停止新派发 |
| 自动唤醒 `#wakeSession` | 允许 | **拒绝** | handoff:57；`docs/ui-contract.md:18` 人本就不会被打扰 |
| 新 `roomSay` 发言 | 允许 | **待负责人裁定**（建议拒绝，见 §16） | 「只读」建议 notes:5/handoff:57 |
| 查看房间/消息/任务 | 允许 | 允许（只读） | R1 历史参与人类可查看 |
| 既有任务 `roomStatus` 核对 | 允许 | 允许 | handoff:57 保留核对 |
| 既有执行 reconcile / cancel | 允许 | 允许 | handoff:57 保留取消；与 Team 分离 §12 |
| 归档列表可见 | 隐藏 | 历史参与人类可见 | R1 |
| 恢复 `restore` | — | 仅 Leader（§9） | notes:5 |

---

## 6. 归档/恢复状态机（PROPOSAL）

```
            Leader archive()                         Leader restore()
 active ─────────────────────────► archived ─────────────────────────► active
   lifecycleGeneration += 1            lifecycleGeneration += 1
   lifecycle='archived'               lifecycle='active'
   lifecycleActor=caller              lifecycleActor=caller
   + lifecycleAudit(event)            + lifecycleAudit(event)
```

- **可恢复**是硬约束：`lifecycle` 是独立枚举，`restore` 必须存在；与 `deleted`（OR 合并不可逆）路径完全隔离。
- 收敛裁决（PROPOSAL，**不使用墙钟**）：
  1. `lifecycleGeneration` 大者胜（单调计数器 = 栅栏）；
  2. 同 generation 冲突：`'archived'` 优先于 `'active'`（保守：宁可只读也不误放行新派发），
     `lifecycleActor` 按 memberKey 字典序小者胜——确定性、可解释、无静默多主；
  3. 事件日志按 `(lifecycleGeneration, eventId)` 并集去重，不按时间排序（借鉴 `docs/agent-team-v0.2-design.md:51` 不用墙钟排序的思想，但**这是 Room 自有计数器，不是 Team 的 generation**）。
- 归档**不**触发任何执行终止、不写 `deleted`、不改 `members` 的墓碑/并集合并语义（`docs/ui-contract.md:17`）。

## 7. 历史参与资格（R1）与三类动作的区分（R2）

### 7.1 `participants`（PROPOSAL）
- 在 `roomJoin` 成功时 upsert：`firstJoinedAt = min(现有, joinedAt)`；`isHuman` 由调用来源判定写入
  （面板 `via:'panel'` → true；Agent 工具路径 → false，范式见 `docs/ui-contract.md:153-165`）。
- `roomLeave` 只写 `lastLeftAt`，**不删除** `participants` 记录；离场只影响 `members`（`lib/rooms.mjs:145-167`/`:646-662`）。
- 归档列表可见性判定：**`participants[k].isHuman === true` 且该人类是「曾经参与」**，`k = ${nodeId}/human`（`docs/ui-contract.md:8-17`）。
  **NOT**：用当前 `members` 推导（notes:8）；**NOT**：给 Agent 会话归档查看权（R1 限定「人类」）。
- 合并：`participants` 按 memberKey 并集，`firstJoinedAt` 取最早、`lastLeftAt` 取最新、`isHuman` 取 OR；
  与 `members` 的离场墓碑逻辑互不覆盖。

### 7.2 三种动作（R2，明确互不替代）

| 动作 | 作用范围 | 是否复制 | 是否删他人副本 | 是否可恢复 | 权限 |
| --- | --- | --- | --- | --- | --- |
| 退出 `roomLeave` | 本成员从当前 `members` 移除 | 是（离场墓碑 `left`，`lib/rooms.mjs:145-167`） | 否 | 可 rejoin（`:332`） | 成员本人/Leader kick |
| 删除本地记录 `deleteLocalHistory` | **仅本节点**房间/消息/副本 | **NOT：不同步为全局删除** | 否 | 取决于本节点是否有备份（待裁定） | 本节点人类，显式二次确认 |
| 归档 `archiveRoom` | 全房间的 `lifecycle` | 是（复制态枚举） | 否 | **可 restore** | 仅 Leader |

### 7.3 本地删除的抑制与范围（PROPOSAL）
- 删除前必须显式确认范围文案：只列「本节点、本房间、本地副本、不可撤销/可撤销策略」，列出会被删的对象数量；
  **自动化/测试夹具不得调用真实用户历史删除**（handoff:58）。
- 由于 anti-entropy 会回灌整份 state（`lib/rooms.mjs:684-689` 全量复制），纯本地删除会被对端重新加回。
  PROPOSAL：删除后写 `localSuppressedRooms`（本地-only），merge 时跳过该 roomId 的对端回灌。
  这是**本地抑制标记**，**NOT** 全局删除墓碑、**NOT** `deleted`、**NOT** 同步给对端。
  抑制的持久化时长 / 是否允许「重新订阅」→ **待负责人裁定**（§16）。

---

## 8. 本地偏好 pin / mute（R3，PROPOSAL）

- 沿用 `docs/ui-contract.md:51`/`:200` 的「本地偏好端点」范式：`nickname` 对他人的昵称只存本机；
  pin/mute 同理为**每节点、每人类、本地-only**，`localPrefs[roomId]`，重启后从本地文件加载 → 满足「重启保留」。
- `pinned`：只影响本节点左栏排序/置顶展示，不复制、不改房间（`docs/ui-contract.md:193` 左栏「我的房间」排序）。
- `muted`：**只**降低人类侧 `snapshot.attention`（`docs/ui-contract.md:65`）与 `snapshot.rooms.unread`（`:63`）的噪音与角标；
  不删除消息、不改 `read`、不改 `mentions`（`:104-105`）。
- `muteAtException`：**显式设置项**（notes:7）。为 true 时，`@` 命中该人类的消息仍进入 `attention`/`unread`；
  为 false 时静音完全抑制。**默认值待负责人裁定**（§16），但无论取值如何，设置必须可见可改、不得隐式生效。
- **NOT**：pin/mute 写入 Team 执行授权、停止已授权 Agent、或改写运行中执行（notes:7；`docs/agent-team-v0.2-design.md:49`/`:51`）。
  mute 只作用于「人类收件箱渲染层」，执行层完全不感知该字段。

---

## 9. 权限矩阵（PROPOSAL，纵向为角色，横向为动作）

> 「Leader」= 房间 `ownership.owner` 且 `role='leader'`（`docs/ui-contract.md:12-15`）；
> 「人类成员」= `key=${nodeId}/human` 且 `isMember`；「Agent 成员」= agent 会话成员；「非成员」= 未加入。

| 动作 | Leader | 人类成员 | Agent 成员 | 非成员 | 本地自动化 |
| --- | --- | --- | --- | --- | --- |
| `archiveRoom` 归档 | ✅ 仅 Leader | ❌ | ❌ | ❌ | ❌ |
| `restoreRoom` 恢复 | ✅ 仅 Leader | ❌（**待裁定**是否允许历史参与人类恢复，§16） | ❌ | ❌ | ❌ |
| `roomAssign` 派活（active 时） | ✅ 仅 Leader | ❌ | ❌ | ❌ | ❌ |
| `pin` / `mute` / 设 @ 例外 | ✅ 本节点自己的偏好 | ✅ 本节点自己的偏好 | ❌（无人类偏好） | ✅ 本地可设但无房间上下文 | ❌ 不得触碰真实历史 |
| `deleteLocalHistory` 删本地记录 | ✅ 本节点，显式确认 | ✅ 本节点，显式确认 | ❌ | ❌ | ❌ **禁止触碰真实用户历史** |
| `roomLeave` 退出 | ✅ | ✅ | ✅ | — | — |
| `handoff` 主动移交 | ✅ 当前 owner 发起 | ❌ | ❌ | ❌ | ❌ |
| `declareVacancy` 声明无主 | ✅ 或法定人数人类（待裁定） | 参与确认（待裁定） | ❌ | ❌ | ❌ 自动禁止 |
| `takeover` 接手 | ✅（无主时） | ✅ **人类**且 `status==='unowned'` | ❌ R4 限「人类」 | ❌ | ❌ |
| 查看归档列表 | ✅ | ✅ 若 `participants[k].isHuman` | ❌ | ❌ | — |

所有变更写入 `lifecycleAudit`；权限判定按**调用来源**而非 payload 里的 `sessionId`（`docs/ui-contract.md:153-165` 的范式）。

---

## 10. 并发 / 接管方案（PROPOSAL，唯一可解释裁决 + 旧权威栅栏）

> R4（notes:9、handoff:60）：真正无主时允许人类接手；离线≠无主；并发接手须唯一可解释裁决、审计、旧权威栅栏、禁止多主静默写入。
> 参照 `docs/agent-team-v0.2-design.md:47`/`:51`/`:53` 的「固定 Leader + generation 权威栅栏 + 人工核对」**思想**，但**明确：这是 Room 自有机制，不复用 Team 的 `leaderKey/generation`**。

### 10.1 计数器与 CAS（PROPOSAL）
- `ownership.ownerGeneration`：单调递增整数。任何所有权变更都是一次 **CAS**：
  `if (incoming.baseOwnerGeneration !== current.ownerGeneration) → 拒绝（旧权威栅栏）`。
- 旧 generation 的迟到事件**保留进 `lifecycleAudit` 但不得改变当前 `ownership`**（对齐 `docs/agent-team-v0.2-design.md:51` 旧 generation 事件保留审计、不改当前任务）。
- **NOT**：用 `state.version`（`lib/rooms.mjs:19`/`:680`）或时间戳 `updatedAt`（`:597`）当栅栏。

### 10.2 所有权状态机（PROPOSAL）

```
        owner handoff(to)                to accepts / owner cancels
 claimed ───────────────► handoff-pending ──────────────────────► claimed
   │ ownerGeneration += 1                    ownerGeneration += 1
   │                                                            
   │ declareVacancy(证据, 人工确认; 非离线自动)                    
   ▼                                                            
 unowned  ──────── winning takeover claim ────────► claimed     
   ownerGeneration += 1                         ownerGeneration += 1
```
- `claimed → unowned` **只能**由显式「空缺声明」触发（带 `evidence` 与人类确认），**NOT** 由漏心跳/离线自动触发。

### 10.3 「离线≠无主」的具体化（PROPOSAL）
- `lease`（`ownership.lease`）只记录 owner 最近续租时间，是**在线性证据**，**不是**自动判无主的开关。
- 触发 `declareVacancy` 需同时满足（**阈值/法定人数待负责人裁定**，§16）：
  1. 超过 `vacancyGraceMs`（长于任何正常离线窗口）未见 owner 续租；
  2. 有明确证据串（owner 显式释放 / 人工核对记录 / 法定人数人类确认），写入 `vacancy.evidence`；
  3. **至少一名人类显式确认**，不得由自动化代替。
- 备份 / generation 恢复 / 维护者授权策略属于 `docs/architecture/project-workspace.md:51` 的未决项，见 §16。

### 10.4 并发接手的唯一可解释裁决（PROPOSAL，核心）

`takeover` 提交一个不可变 `TakeoverClaim`：
```ts
{ kind:'takeover', roomId, claimantKey:string, isHuman:true,
  baseOwnerGeneration:number, proposedOwnerGeneration:number /* = base+1 */,
  claimId:string /* 稳定 nonce */, issuedAt:string }
```
前提：`ownership.status==='unowned'` 且 `claim.baseOwnerGeneration===current.ownerGeneration` 且 `claimantKey` 对应人类。

**裁决规则（确定性总序，唯一胜者，可解释）**：
对同一 `baseOwnerGeneration` 下的全部合法 claim，按元组
`(proposedOwnerGeneration ASC, claimantKey ASC, claimId ASC)` 字典升序排序，**第一个为唯一胜者**；
其余 claim 记为 `takeover-resolve` 落审计、明确失败（不静默丢弃、不产生第二个 owner）。
- 为什么用 `claimantKey`（`${nodeId}/${sessionId}`，`docs/ui-contract.md:8-17`）而非墙钟：全节点可对同一组 claim 算出同一结果，
  可解释（「节点 X 的 Y 会话胜出」），无静默多主；`claimId` 只用于同一 claimant 去重/兜底打破平局。
- 胜者写入 `owner=claimant`、`status='claimed'`、`ownerGeneration=proposedOwnerGeneration`；
  所有写操作经 §10.1 的 CAS，旧 generation 写入被栅栏拒绝。
- **NOT**：两个节点各自把 `owner` 写成自己并靠 `updatedAt` 大者胜（`:597`/`:609`）——那正是「静默多主写入」。

### 10.5 与 Team 的隔离（R5）
- `ownerGeneration` / `lifecycleGeneration` 是 **Room 字段**，与 `docs/agent-team-v0.2-design.md:51`/`:53` 的
  Team `leaderKey/generation` **完全独立、不互相写入、不随对方合并变化**。
- 房间管理者变更、归档/恢复、接管**不**改 Team 执行 Leader、不继承其它节点执行授权、不接管运行中任务（notes:10、handoff:61）；
  执行授权只在 Worker 本机显式授权（`docs/agent-team-v0.2-design.md:49`），不由 Room 能力推导。
- 发现 Room Leader 变更/接管时，按 `docs/agent-team-v0.2-design.md:53` **暂停 Team、人工核对后恢复**——由 Team 侧处理，本设计不越界实现。

### 10.6 审计与篡改边界
- 所有转换写 `lifecycleAudit`（append-only，`(generation, eventId)` 去重）。
- 遵守 `docs/architecture/project-workspace.md:51`：hash chain 仅能检测篡改，**不保证共享密钥成员不可伪造**；
  因此「谁能声明无主 / 法定人数 / 密码学身份」列为 §16 待决项，不得靠 hash chain 假授权。

---

## 11. 兼容 / 升级路径（PROPOSAL）

### 11.1 关键风险（现状推导，非实现）
`lib/rooms.mjs:198-209`/`:140-190` 的 `normalizeState`/`normalizeRoom` 会**丢弃未知字段并重建对象**。
→ 混合版本集群里，v1 节点把它的（已丢字段的）状态回灌给 v2 节点时，v2 若按「缺字段→默认」会把
`archived` 重新读成 `active`、`unowned` 读成 `claimed`、归档列表丢失。
**这是必须在实现前裁定的兼容性风险**（§16）。

### 11.2 PROPOSAL 方案
- 新增能力协商位（范式参照 `docs/agent-team-v0.2-design.md:57` 的 `teamProtocolVersion=1` 显式协商）：
  提出 `roomLifecycleVersion=1`（PROPOSAL 名）。仅与声明支持该版本的对端同步 lifecycle/ownership/participants 字段。
- **默认读取规则**：缺字段一律取安全默认——
  `lifecycle='active'`、`lifecycleGeneration=0`、`participants={}`、
  `ownership.status = (leader 存在 ? 'claimed' : 'unowned')`（`docs/ui-contract.md:12-15` 的 leader 判定）、
  `ownerGeneration=0`、`lifecycleAudit=[]`、`localPrefs` 取全 false。
- **NOT**：凭空补造历史参与资格。旧持久化状态无法完整还原「曾参与过的人类」；
  PROPOSAL：尽力从现有 `members` + `left` 墓碑（`lib/rooms.mjs:145-167`）做 best-effort 重建，
  并**显式标注「重建、非权威」**，归档可见性可能不完整——**此限制须写入待决项，不谎称完整**。
- 规则：**待负责人裁定**——v2 是否接受 v1 对端对房间 lifecycle/ownership 的权威合并（建议：v2 以自身更高 generation 为准，
  拒绝 v1 把已归档/无主状态回退为默认，并在重连时重新断言；但协议影响大，须确认）。
- 旧节点继续普通 Room 协作，不接收新字段（`docs/agent-team-v0.2-design.md:57` 的旧节点兼容思路）；`deleted`（`:564-570`）行为保持不变。
- 磁盘旧状态：v2 读取时经同一 `normalizeState` 扩展版套用上述默认值；**不就地改写历史文件**、不擅自迁移账本。

---

## 12. 管理者不继承执行权威（R5，设计不变量）

- 房间 Leader / 接管胜者 / 归档执行者，只获得**房间沟通层**权限（§9），**NOT** Team 执行 Leader、
  **NOT** 其它节点执行授权、**NOT** 运行中任务接管（notes:10、handoff:61）。
- 执行授权只由 Worker 本机显式授予 `roomId/leaderKey/目标会话/工作范围`（`docs/agent-team-v0.2-design.md:49`），
  不由 Room 能力声明或 leader 身份推导（`:57`）。
- 归档/恢复/接管不改任何执行状态；既有执行保持其自身 `queued/acknowledged/running/…/uncertain`（`:43`），
  reconcile/cancel 仍可用（handoff:57），**绝不**把归档当作「外部操作已终止」。

---

## 13. 冻结 UI 契约约束（PROPOSAL，不实际编辑）

`docs/ui-contract.md:4`：「任何一方要改字段，先改本文件」。
→ **本设计提出的任何新端点/字段，实施前必须先在 `docs/ui-contract.md` 落契约，再写代码**；
本文**不编辑**该文件，以下仅为「若实施需改哪些节」的 PROPOSAL 清单（待负责人裁定后由契约维护方处理）：

| 契约节 | 需改动（PROPOSAL） | 对应本文 |
| --- | --- | --- |
| §2 端点全集（`:31-59`） | 新增：`roomArchive`、`roomRestore`、`roomArchivedList`、`roomPin`、`roomMute`、`roomSetMuteAtException`、`roomDeleteLocalHistory`、`roomHandoff`、`roomDeclareVacancy`、`roomTakeover`、`localPrefs` | §5-§10 |
| §2 `snapshot`（`:33`、`:61-65`） | `rooms` 增 `archived` 计数；`attention`/`unread` 受 `muted`+`muteAtException` 影响 | §8 |
| §3 `RoomRow`/`RoomView`（`:69-79`） | 增 `lifecycle`、`archivedAt`、`ownership.status`、历史参与摘要 | §5 |
| §3 `Task`（`:94-99`） | 仅补「归档态只读/不可新派发」说明，**不改** `status` 枚举（`:97`） | §5.3 |
| §3 `Member`（`:81-85`） | 补 `isHuman` 来源标注（用于 `participants`） | §7.1 |
| §4 布局（`:174-200`） | 左栏增「已归档」入口、pin/mute 控件、接管/移交/空缺确认界面 | §7-§10 |
| §4 本地偏好范式（`:51`、`:200`） | `nickname` 的本地-only 形态作为 pin/mute 端点范本 | §8 |
| §M3 附件等 | 不受本设计影响，保持不变 | — |

---

## 14. 验收 / 测试计划（PROPOSAL，`scripts/lifecycle-smoke.mjs` 草图）

> **待实施**。以下为脚本结构与断言清单的草图，不是已运行脚本、不代表任何测试结果。
> 必须区分 `docs/development-workflow.md:11`：localhost / stub / harness ≠ 真实多设备/浏览器验收。

```
// scripts/lifecycle-smoke.mjs —— PROPOSAL 草图，待实施
// 用两个内存 state + mergeStates 模拟两节点，注入确定性 claim，断言：
//  A) 重启持久化：localPrefs 写盘→重载→pinned/muted/muteAtException 原值恢复
//  B) 本地-only 偏好：节点2 不因节点1 的 pin/mute 改变；复制态不含 prefs 字段
//  C) @ 例外：muted=true 时普通消息不进 attention；muteAtException=true 时 @ 命中仍进
//  D) 无全局删除：deleteLocalHistory 只改本节点；对端 rooms 仍完整；对端无 deleted=true
//  E) 接管单胜者：两个合法 claim(baseGen 相同) → 按 §10.4 元组仅 1 个胜者；
//     旧 generation 写入被栅栏拒绝；lifecycleAudit 记录两条 takeover-resolve
//  F) 归档只读：archived 拒绝 roomAssign/自动唤醒；restore 后恢复；deleted 始终 false
//  G) Team 授权不继承：takeover 后 Team leaderKey/generation/执行授权不变；运行中任务不被接管
//  H) 兼容：缺字段 v1 状态读出 §11.2 默认；v1 回灌不得把 archived 回退为 active
//  I) 归档可见性：participants[k].isHuman=true 的人类可见；Agent 会话不可见；members 离场不删资格
//  J) 三类动作互不等价：leave / deleteLocalHistory / archive 的复制范围与可恢复性分别断言
```

必须验证的项（对应 R1-R5）：重启持久化、本地-only 偏好、@ 例外、无全局删除、接管单胜者、
归档只读、Team 授权不继承。
另按 `docs/handoffs/dsh-after-m3-prompt.md:73-76`：覆盖权限、并发、丢 ACK、重启、损坏记录、写入失败、旧版本兼容，
记录实际命令/退出码/结果；环境阻断（Windows EPERM）与业务失败分开记录。
真实浏览器 / 多设备验收由负责人另行执行，**本设计不声称、不伪造**（`:76`）。

---

## 15. 升级 / 回退方法（PROPOSAL）

- **升级**：能力位 `roomLifecycleVersion=1` 默认关闭（opt-in，对齐 `docs/agent-team-v0.2-design.md:57` 显式协商）；
  v2 读旧盘套 §11.2 默认；灰度先单节点，再双节点，记录 base/head SHA、文件清单、测试与偏差
  （`docs/development-workflow.md:9-10`，`docs/handoffs/dsh-after-m3-prompt.md:78`）。
- **回退**：关能力位 + 用升级前快照恢复本地文件；旧节点本就忽略新字段，回退后按 §11.2 默认读。
- **风险 / 待裁定**：v2 期间产生的 `archived`/`unowned`/`ownerGeneration` 状态，v1 不理解；
  回退后这些语义**不自动保留**，须人工核对并明确「已归档房间是否回到 active」的对账结论——
  **不得静默回退**，否则等同把归档/接管结果抹掉。**回退策略待负责人裁定**（§16）。
- **NOT**：`reset`/`clean`/`force push`/改写历史/自行合并（`docs/handoffs/dsh-after-m3-prompt.md:77`）。

---

## 16. 复核入口 / 待负责人裁定 / 剩余开放问题

> 以下均 **待负责人裁定**，按 `docs/development-workflow.md:8` 涉及数据模型/协议/权限/核心架构，须先确认再实施。
> 复核入口：本文件 + `docs/ui-contract.md:4` 契约变更清单 + `scripts/lifecycle-smoke.mjs`（待实施）+ 实机验收记录（由负责人）。

1. **能力协商与 v1 权威合并**（§11）：是否采用 `roomLifecycleVersion=1`？v2 是否接受 v1 对端回灌并可能把
   `archived`/`unowned` 回退为默认？建议「v2 以更高 generation 为准、拒绝回退、重连重断言」，待确认。
2. **空缺判定阈值 / 法定人数 / 证据格式**（§10.3）：`vacancyGraceMs`、`lease` 续租、是否需多人确认、
   谁可 `declareVacancy`——直接关系「离线≠无主」与防误判。
3. **接管 tie-break 规则确认**（§10.4）：`(proposedOwnerGeneration, claimantKey, claimId)` 升序取首是否认可；
   是否改为其它可解释总序（如显式优先级）。
4. **`muteAtException` 默认值**（§8）：默认 false（静音完全抑制）还是 true（@ 默认例外）。
5. **归档是否禁止新发言**（§5.4 表）：notes:5/handoff:57 只明确「停止新派发/自动唤醒」与「只读建议」，
   `roomSay` 是否在归档态拒绝，待裁定。
6. **非 Leader 历史参与人类能否 `restore`**（§9）：R1 字面「Leader 可归档与恢复」，本设计裁定仅 Leader；
   是否放宽给历史参与人类，待确认。
7. **本地删除抑制的生命周期**（§7.3）：`localSuppressedRooms` 持久化时长、能否重新订阅、
   删除是否可撤销/需不需要本地备份（备份亦见 `docs/architecture/project-workspace.md:51` 未决项）。
8. **旧状态历史参与资格重建**（§11.2）：best-effort 重建 + 「非权威」标注是否被接受；
   不重建则旧房间归档可见性不完整，须明确写入限制、不得谎称完整。
9. **`lifecycleAudit` 完整性模型**（§10.6）：是否引入 hash chain（仅检测篡改、不防成员伪造，
   `docs/architecture/project-workspace.md:51`）、generation 恢复、维护者授权、备份策略——均为该文列出的编码前必须明确项。
10. **UI 契约变更归属**（§13）：`docs/ui-contract.md:4` 冻结，谁负责先改契约、按何顺序冻结交接批次
    （`docs/development-workflow.md:5`）。
11. **真实验收资源**：真实浏览器 / 多设备验收由负责人执行，何时可用、如何记录
    （`docs/handoffs/dsh-after-m3-prompt.md:76`、`docs/development-workflow.md:11`）。
12. **与 Team 暂停/恢复联动**（§10.5）：Room Leader 变更触发 Team 暂停（`docs/agent-team-v0.2-design.md:53`）
    的触发点与人工核对流程由谁实现，待确认（本设计不越界实现 Team 侧）。

---

## 17. 本地裁定记录（含理由，均待负责人复核）

> 依 `docs/handoffs/dsh-after-m3-prompt.md:20`/`:54`「设计冲突先依据已确认规则裁定、记录局部裁定」。
> 以下为本文在规则范围内的**本地裁定**，非负责人确认，实施前须复核。

| 裁定 | 理由 |
| --- | --- |
| 归档用独立 `lifecycle` 枚举 + 自有 `lifecycleGeneration`，**不碰** `deleted` | `lib/rooms.mjs:564-570`/`:603` 的 `deleted` 是 OR 合并、不可逆、全局复制，无法「恢复」也无法「隐藏但可查」，与 R1 直接冲突（notes:12/handoff:57） |
| 接管用 Room 自有 `ownerGeneration` CAS，**不复用** `state.version` 或 Team `generation` | `lib/rooms.mjs:19`/`:680` 的 version 是静态 schema 标签；`docs/agent-team-v0.2-design.md:51`/`:53` 明确 Team generation 不随 Room 合并变化、变更需人工核对；R5 要求两者隔离 |
| 收敛裁决用「generation 大者胜 + 同代 archived 保守优先 + memberKey 字典序」，**不用墙钟** | R4「唯一可解释裁决、禁止多主静默写入」；`lib/rooms.mjs:597` 的 `updatedAt` 大者胜会制造不可解释的并发赢家；借鉴 `docs/agent-team-v0.2-design.md:51` 不用墙钟排序的思想 |
| 历史参与资格用独立 `participants`，`isHuman` 由来源判定写入 | notes:8 明确不能只靠 `members`；`docs/ui-contract.md:153-165` 已确立「按来源判权限」范式，可复用判人类 |
| pin/mute 存本地-only `localPrefs`，沿用 `nickname` 端点范式 | notes:7 要求本地偏好 + 重启保留；`docs/ui-contract.md:51`/`:200` 已有本地-only 偏好先例，契约改动最小 |
| 本地删除用 `localSuppressedRooms` 本地抑制，**不发全局墓碑** | R2「本地删除不能同步清除他人副本」+ `lib/rooms.mjs:684-689` 全量回灌会撤销纯本地删除，需要本地-only 抑制；NOT 全局 delete |
| `declareVacancy` 必须人类显式确认 + 证据，绝不自动判离线为无主 | R4「暂时离线不等于无负责人」（handoff:60）；自动化不得触碰真实用户历史（handoff:58） |
| 归档态保留 `roomStatus` 核对 / reconcile / cancel，只禁「新派发/自动唤醒」 | handoff:57「保留原有执行的核对/取消能力，不能把归档当作已终止外部操作」；cancel 属协调不属新执行 |
| 旧状态缺字段一律取安全默认，`participants` 不凭空补造 | `lib/rooms.mjs:198-209` 会丢未知字段；notes:8 禁止靠 `members` 推导历史资格，宁可标注「不完整」也不伪造 |

---

> 复核入口：§16 待决项清单 + §13 契约变更清单 + §14 测试草图 + §15 升级/回退。
> 本文状态：**设计方案 / 待实施 / 待决项**；无实现、无验证、无验收结论。
