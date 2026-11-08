# dsh-lan-mesh 路线图

核对日期：2026-11-08。状态依据当前 `codex/room-collaboration`，业务基线 `4a6cddf`，本批次提交 `43e572c`（未合并、未发布）。业务开发按交接批次推进，协议/数据模型/权限/核心架构变更仍需负责人确认。

| 里程碑 | 优先级/状态 | 目标、任务与依赖 | 代码/测试依据 | 验收及下一步 |
|---|---|---|---|---|
| M1 真实跨设备验收 | P0，代码已实现，**设备验收未完成（全部场景未验收）** | 可靠派发、ACK、租约、不确定结果、恢复；需 A/B/C 设备与授权 | `lib/team-*.mjs`、`scripts/team-*.test.mjs`、`scripts/team-smoke.mjs`、`docs/handoffs/m1-three-device-acceptance.md` | smoke 使用真实 HTTP、stub runtime、127.0.0.1，不能证明真实模型跨设备执行；准备清单已就绪但**尚未执行任何真实设备运行**，12 项场景全部「未验收」；须由负责人提供 A/B/C 设备后按清单取证 |
| M2 Composer | P0，**本批次完成（待 Codex 独立验收）** | 机器标识、精确 mentions、技能引用选择器、人类成员拉入会话均已实现；技能引用只是提示，不安装不执行 | `client.js`、`lib/room-message.mjs`、`scripts/room-message.test.mjs`、`index.js`（`roomSkills` 端点）、`lib/service.mjs`（`addRoomMember`）、`scripts/room-invite.test.mjs`、`docs/ui-contract.md`；提交 `43e572c` | 本批次：`npm test` 116/116、`panel-check` 136/136、`schema-check` 66/66、`room-invite` 10/10、`check:composer-compat` PASS、`twin-transport-check` ok；**仍缺真实浏览器截图与手工操作记录**，交回 Codex 前须补齐 |
| M3 附件 | P1，设计阶段 | 多图片/文件、独立 Blob 存储、校验、重试、授权；依赖 M2 消息引用 | `docs/superpowers/plans/2026-11-08-room-attachments.md` | 当前仅旧单文件 base64 路径；新 BlobStore/协议/UI 未实现（本批次明确不做） |
| M4 共享 Markdown | P1，设计阶段 | 版本、patch、审计、历史恢复；再做自动合并与冲突确认；依赖项目身份与权限 | `docs/superpowers/plans/2026-11-08-shared-documents-core.md` | 无业务实现；恢复必须新建修订，不能改写历史；任何人类可提方案，Leader/维护者确认冲突（本批次明确不做） |
| M5 Project Context | P1，设计阶段 | 有界、授权、版本固定的 Context Pack；依赖 M4/M3 | `docs/superpowers/plans/2026-11-08-shared-documents-ui-context.md` | 未实现正式上下文包；显式决策与未决问题，不复制整个聊天历史（本批次明确不做） |
| M6 自动编排 | P2，未开始 | 能力描述、任务依赖、分解/调度/验收；依赖 M1 实机验收及 M5 | `docs/agent-team-v0.2-design.md` 为方向，不是已实现证明 | 另行设计批准后交 DSH；不自动重跑 uncertain 执行（本批次明确不做） |

开发协作遵循 `docs/development-workflow.md`。架构和差距见 `docs/architecture/project-workspace.md`。交接候选稿见 `docs/handoffs/dsh-development-handoff.md`。每次交付须更新本表，附提交、实际测试与设备验收证据。
