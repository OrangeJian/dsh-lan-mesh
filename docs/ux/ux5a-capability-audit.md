# UX-5a 已提交能力审计与实施入口

本审计只读取当前ux-workbench代码，不读取原room-collaboration工作区或暂停的0.4.5/M6草稿。当前UI升级可直接推进Room任务展示，不应把Team工具存在等同于M6界面或验收已经交付。

## Room任务现有契约

来源：snapshot.rooms中的Room.tasks；BoardPane目前汇总非空任务的Room并按状态字母排序，点击整行进入Room。Room内TaskItem显示状态、标题、assignee和detail；已有roomAssign/roomStatus路径。

| 字段 | 含义和展示 |
|---|---|
| Room.id/name | 项目身份和标签；同名项目不得合并 |
| task.id | 与Room.id共同组成任务行身份，不能仅按标题去重 |
| title/detail | 原文与换行，detail不得推断成执行证据 |
| assignee / assigner | nodeId、sessionId、key及显示名；名字不作为权限身份 |
| status | open、doing、blocked、done；仅Room任务状态，不代表Team验收 |
| createdAt / updatedAt | 已公开时间字段；无效时间标未知，稳定排序用ID作兜底 |
| deleted | 被删除记录不能混入活动任务；投影应明确排除 |

权限：后端setTaskStatus检查当前Room成员身份，且必须是精确key匹配的负责人或Room Leader。assignTask要求Leader并检查可写；归档禁止新增任务，但既有状态核对按既有后端规则继续。全局Board建议保持只读跳转，具体操作仍在Room，不复制一套权限控制。

发现显示层差距：TaskItem的mine当前只比较assignee.sessionId与props.sessionId，没比较nodeId，跨机器同名human/session可能错误显示状态按钮；服务端仍按精确key拒绝，未发现授权绕过。UX-5a应补精确nodeId+sessionId判断与设备标签。

## Team已提交工具与UI边界

lib/team-tools.mjs暴露create、dispatch、status、report、reconcile，注册受teamEnabled控制；执行要求工具上下文中真实本机会话exec.agent.id。service.teamStatus先调用#teamCaller，再核对Room成员，返回team、tasks、executions、localExecutions、pendingDelivery。localExecutions还绑定当前worker actorKey，不能冒充别的节点会话读取。

现有Owner面板switch未见teamStatus只读路由。UI不能直接调用工具对象、伪造sessionId为human或复用其他Agent会话。若要挂Team面板，需要先明确Owner人类读取范围和脱敏只读契约；这不必改Peer协议，但属于独立接口工作，不能把工具身份换成面板身份就上线。

状态语义：Team succeeded结果使task进入review（lib/team-state.mjs），不等于accepted，也不表示已经合并代码。uncertain需要显式人工确认旧执行停止和原因，不能由刷新/重试自动调用reconcile。工件type/value只代表声明，不应直接提供本机路径下载或算作已审查成果。

暂停M6隔离：本批不得接入未提交teamPlan、DAG批准、自动接管、Review/合并入口，不读取或搬入暂停草稿。没有真实契约的能力说明为尚未交付，不以禁用按钮或模拟数字记完成。

## 不新增协议即可立即实施

1. 纯TaskBoard投影：稳定Room+Task身份，排除deleted，分组为待开始/进行中/受阻/已完成；状态未知单独列示，不默认为open。
2. 项目、状态、精确负责人筛选及标题/detail搜索，显示本次snapshot范围。筛选计数基于当前公开数据，不承诺跨所有节点全量搜索。
3. 每行明确Room、负责人显示名、来源nodeId、更新时间；同名负责人用设备名与节点ID消歧。点击进入对应Room任务页（路由支持前先仅进入Room，不声称精确定位）。
4. 空/读取失败/陈旧状态沿用现有壳；刷新不自动变更任务状态。长detail折叠但保持原文。
5. TaskItem权限显示改为精确身份，保留后端最终判定；失败保留任务和原状态，刷新权威snapshot后更新。

## 测试矩阵

| 场景 | 验收 |
|---|---|
| 三个同名项目/任务 | 行身份不碰撞、点击进入精确Room |
| 两台机器human或同名session | 负责人过滤与按钮权限按nodeId+sessionId |
| deleted/未知状态/缺时间 | 不混入活动任务、不伪装open或有效时间 |
| 搜索/筛选最后一条消失 | 不悬空筛选，不误报全部已完成 |
| 状态保存失败/迟到回应 | 不乐观伪造状态，不覆盖较新权威快照 |
| 归档Room | 禁止新派发，已有记录与核对行为不变 |
| Team开关关闭/工具不可用 | 不用0或绿色表现未知，不渲染假Team数据 |
| succeeded/review/uncertain | 不显示已验收/已合并，不自动重派或reconcile |

建议顺序：先做纯Room TaskBoard和TaskItem身份修正，完成单元+panel与原Room回归；再独立设计Team只读Owner投影。无需等待用户再次确认常规Room展示；遇到身份读取范围或新授权决策才提明确问题。
