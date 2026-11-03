window.__ModuleLoader__.load({
  id: 'dsh-lan-mesh',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Room messages render as Markdown exactly like a conversation does, using
    // the shell's own renderer. It is a seed module, but a degraded boot could
    // still lack it — falling back to plain text keeps the panel readable.
    let MarkdownText;
    try {
      MarkdownText = require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText;
    } catch (error) {
      MarkdownText = undefined;
    }

    // The document's language decides the copy, but it must be read per render,
    // not once at module load: the locale service sets `lang` right after boot,
    // and a frozen choice leaves a Chinese user staring at English labels.
    const prefersChinese = () => {
      const lang =
        (typeof document !== 'undefined' && document.documentElement.lang) ||
        (typeof navigator !== 'undefined' && navigator.language) ||
        '';
      return /^zh/i.test(lang);
    };
    const COPY_ZH = {
          title: '局域网协作',
          self: '本节点',
          peers: '在线节点',
          noPeers: '还没有发现其他节点。确认对方机器上的 DSH 也开着，并且两台机器在同一网段。',
          inbox: '收件箱',
          noMessages: '还没有收到消息。',
          target: '发送到',
          targetHint: '节点名称、nodeId，或 * 表示全体',
          message: '消息内容',
          messageHint: '要请对方处理的事情',
          send: '发送',
          sending: '发送中…',
          sent: '已发送',
          markRead: '全部标为已读',
          refresh: '刷新',
          unread: '未读',
          port: '端口',
          secured: '需要口令',
          open: '开放',
          from: '来自',
          error: '出错了',
          empty: '请输入目标和内容',
          // identity + rail
          identity: '本机身份',
          you: '你的会话',
          noSession: '未选择会话',
          myRooms: '我的房间',
          noMineRooms: '还没有加入任何房间。',
          joinable: '可加入的项目',
          noLeader: '还没有 leader',
          join: '加入',
          joining: '加入中…',
          joined: '已加入',
          alreadyMember: '你已经在这个房间里了',
          createRoom: '新建房间',
          roomName: '房间名',
          roomNameHint: '比如 网站改版',
          roomTopic: '项目目标',
          roomTopicHint: '一句话说明这个项目要做什么',
          create: '创建',
          creating: '创建中…',
          created: '已创建',
          noRoomSelected: '从左边选一个房间，或者新建一个项目。',
          needRoomName: '请输入房间名',
          // room pane
          memberCount: '成员',
          roleLeader: 'leader',
          rename: '改名',
          renameHint: '新的房间名',
          renaming: '保存中…',
          renamed: '已改名',
          leave: '退出房间',
          leaving: '退出中…',
          openSession: '打开会话',
          noChat: '房间里还没有消息。',
          sayHint: '说点什么，@名字 可以标注对象',
          sayAction: '发送',
          saying: '发送中…',
          mentions: '提及',
          needMessage: '请输入消息内容',
          loading: '加载中…',
          detailUnavailable: '房间详情暂时取不到。',
          deliverFailed: '远端投递失败',
          // tasks
          tasksLabel: '任务',
          noTasks: '还没有任务。leader 可以把工作拆成任务派给成员。',
          expand: '展开',
          collapse: '收起',
          assign: '派活',
          assignee: '指派给',
          taskTitleHint: '一句话说清要做什么',
          taskDetailHint: '可选：验收标准、相关文件',
          assignAction: '分配',
          assigning: '分配中…',
          assigned: '任务已分配',
          needTaskTitle: '请输入任务标题',
          invite: '拉进房',
          inviteHint: '把本节点的一个会话拉进这个房间',
          inviteAction: '拉进来',
          inviteNone: '本节点没有可拉进来的会话',
          invited: '已拉进房',
          // agents
          agents: 'Agent',
          agentsLocal: '本节点的 agent',
          agentsRemote: '其他机器上的 agent',
          agentsEmpty: '这个节点上还没有会话。',
          agentsRemoteEmpty: '局域网里其他节点没有可见的 agent。',
          agentsLive: '运行中',
          agentsStored: '已存盘',
          agentsDialled: '已联络',
          agentsImport: '引入',
          agentsDial: '联络',
          agentsCreate: '在指定 workspace 新建',
          agentsCwdHint: '绝对目录路径，比如 C:\\work\\my-project',
          agentsCreateAction: '新建',
          agentsCreating: '新建中…',
          agentsImported: '已引入',
          agentsCreated: '已新建',
          agentsDialed: '已联络',
          agentsNeedCwd: '请输入绝对目录路径',
          agentsNeedText: '先在「消息」框里写上第一句指令',
          agentsWorkspace: '工作区',
          agentsWorkspaceHint: '选一个已有的工作区',
          agentsTitle: '会话标题',
          agentsTitleHint: '比如 前端联调',
          agentsNeedWorkspace: '请先选一个工作区',
          agentsNeedTitle: '请给这个会话起个标题',
          // attention + nicknames
          attention: '待你处理',
          noAttention: '没有需要你处理的事。',
          nickname: '称呼',
          nicknameHint: '你叫它什么',
          nicknameSelf: '你的称呼',
          nicknameSelfHint: '房间里别人看到的名字',
          nicknameSaved: '已保存',
          // p2p
          session: '会话',
          sessionHint: '这个面板以哪个会话的身份操作',
          selfOption: '我 (本人)',
          noSessions: '宿主还没有可用的 agent 会话。房间功能需要一个会话身份，请先在 DSH 里开一个会话。',
    };

    const COPY_EN = {
          title: 'LAN Mesh',
          self: 'This node',
          peers: 'Peers online',
          noPeers: 'No other node has answered yet. Make sure DSH is running on the other machine and both are on the same subnet.',
          inbox: 'Inbox',
          noMessages: 'Nothing received yet.',
          target: 'Send to',
          targetHint: 'node name, node id, or * for everyone',
          message: 'Message',
          messageHint: 'What the other agent should do',
          send: 'Send',
          sending: 'Sending…',
          sent: 'Sent',
          markRead: 'Mark all read',
          refresh: 'Refresh',
          unread: 'unread',
          port: 'port',
          secured: 'secret required',
          open: 'open',
          from: 'from',
          error: 'Failed',
          empty: 'Fill in a target and a message',
          identity: 'This node',
          you: 'Your session',
          noSession: 'no session picked',
          selfOption: 'Me (this human)',
          myRooms: 'My rooms',
          noMineRooms: 'Not in a room yet.',
          joinable: 'Rooms you can join',
          noLeader: 'no leader yet',
          join: 'Join',
          joining: 'Joining…',
          joined: 'Joined',
          alreadyMember: 'You are already a member of this room',
          createRoom: 'New room',
          roomName: 'Room name',
          roomNameHint: 'e.g. website redesign',
          roomTopic: 'Goal',
          roomTopicHint: 'One line on what this project is for',
          create: 'Create',
          creating: 'Creating…',
          created: 'Created',
          noRoomSelected: 'Pick a room on the left, or start a new project.',
          needRoomName: 'Enter a room name',
          memberCount: 'members',
          roleLeader: 'leader',
          rename: 'Rename',
          renameHint: 'New room name',
          renaming: 'Saving…',
          renamed: 'Renamed',
          leave: 'Leave room',
          leaving: 'Leaving…',
          openSession: 'Open session',
          noChat: 'Nothing said in this room yet.',
          sayHint: 'Say something; @name marks who it is for',
          sayAction: 'Send',
          saying: 'Sending…',
          mentions: 'Mention',
          needMessage: 'Enter a message',
          loading: 'Loading…',
          detailUnavailable: 'The room detail is unavailable right now.',
          deliverFailed: 'Remote delivery failed',
          tasksLabel: 'Tasks',
          noTasks: 'No tasks yet. The leader can split the work into tasks for members.',
          expand: 'Expand',
          collapse: 'Collapse',
          assign: 'Assign a task',
          assignee: 'Assign to',
          taskTitleHint: 'One line saying what has to be done',
          taskDetailHint: 'Optional: acceptance criteria, files',
          assignAction: 'Assign',
          assigning: 'Assigning…',
          assigned: 'Task assigned',
          needTaskTitle: 'Enter a task title',
          invite: 'Invite into room',
          inviteHint: 'Pull a session from this node into the room',
          inviteAction: 'Invite',
          inviteNone: 'No session on this node to invite',
          invited: 'Invited',
          agents: 'Agents',
          agentsLocal: 'Agents on this node',
          agentsRemote: 'Agents on other machines',
          agentsEmpty: 'No session on this node yet.',
          agentsRemoteEmpty: 'No other node on the LAN is advertising agents.',
          agentsLive: 'running',
          agentsStored: 'stored',
          agentsDialled: 'dialled',
          agentsImport: 'Bring in',
          agentsDial: 'Dial',
          agentsCreate: 'New agent in a workspace',
          agentsCwdHint: 'Absolute directory, e.g. C:\\work\\my-project',
          agentsCreateAction: 'Create',
          agentsCreating: 'Creating…',
          agentsImported: 'Brought in',
          agentsCreated: 'Created',
          agentsDialed: 'Dialled',
          agentsNeedCwd: 'Enter an absolute directory',
          agentsNeedText: 'Write the first instruction in the Message box first',
          agentsWorkspace: 'Workspace',
          agentsWorkspaceHint: 'Pick an existing workspace',
          agentsTitle: 'Session title',
          agentsTitleHint: 'e.g. frontend pairing',
          agentsNeedWorkspace: 'Pick a workspace first',
          agentsNeedTitle: 'Give this session a title',
          attention: 'Needs you',
          noAttention: 'Nothing is waiting on you.',
          nickname: 'Nickname',
          nicknameHint: 'What you call it',
          nicknameSelf: 'Your name',
          nicknameSelfHint: 'What the room shows for you',
          nicknameSaved: 'Saved',
          session: 'Session',
          sessionHint: 'Which session this panel acts as',
          noSessions: 'The host has no agent session yet. Rooms need a session identity — open a session in DSH first.',
    };

    /**
     * Resolves against the live document language on every read, so a panel that
     * mounted before the locale service set `lang` still switches to Chinese.
     */
    const pick = (zhTable, enTable) =>
      new Proxy({}, { get: (_target, key) => (prefersChinese() ? zhTable : enTable)[key] });
    const COPY = pick(COPY_ZH, COPY_EN);

    /** Task statuses in progression order; the wire values come from lib/rooms.mjs. */
    const STATUS_ORDER = ['open', 'doing', 'blocked', 'done'];
    /** Human words for each status. */
    const STATUS_LABELS = pick(
      { open: '待开始', doing: '进行中', blocked: '受阻', done: '已完成' },
      { open: 'open', doing: 'doing', blocked: 'blocked', done: 'done' },
    );
    /** Theme-token backed colour per status. */
    const STATUS_CLASS = {
      open: 'lm-status lm-statusOpen',
      doing: 'lm-status lm-statusDoing',
      blocked: 'lm-status lm-statusBlocked',
      done: 'lm-status lm-statusDone',
    };

    const STYLE_ID = 'dsh-lan-mesh-styles';
    /** localStorage key holding the session the panel acts as. */
    const SESSION_KEY = 'dsh-lan-mesh.session';
    /** The session id the backend reserves for "me, the human". */
    const HUMAN_SESSION_ID = 'human';
    const CSS = `
.lm-root{display:flex;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;background:var(--dsw-alias-bg-base)}
.lm-rail{width:300px;flex:0 0 300px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:12px;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill)}
.lm-ident{display:flex;flex-direction:column;gap:2px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-identName{font-weight:600}
.lm-identMeta{color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}
.lm-railTitle{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}
.lm-railList{display:flex;flex-direction:column;gap:2px}
.lm-railFoot{margin-top:auto;display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.lm-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}
.lm-roomPane{display:flex;flex-direction:column;flex:1;min-height:0}
.lm-roomHead{display:flex;flex-direction:column;gap:6px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-roomTitleRow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.lm-roomTitle{font-size:15px;font-weight:600}
.lm-roomTopicText{color:var(--dsw-alias-label-secondary);font-size:12px}
.lm-roomHeadBtns{display:flex;gap:6px;margin-left:auto}
.lm-memberRow{display:flex;flex-wrap:wrap;gap:6px}
.lm-memberChip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;font-size:12px;background:var(--dsw-alias-bg-layer-1)}
.lm-memberChipSelf{border-color:var(--dsw-alias-brand-primary)}
.lm-inviteRow{display:flex;align-items:center;gap:6px;padding-top:8px;font-size:12px}
.lm-leaderTag{color:var(--dsw-alias-brand-primary);font-size:10px;font-weight:600}
.lm-mdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success)}
.lm-mdotIdle{background:var(--dsw-alias-state-idle-primary)}
.lm-openSession{padding:0 6px;font-size:10px;border-radius:6px;line-height:16px}
.lm-nickBtn{padding:0 4px;font-size:10px;border-radius:6px;line-height:14px;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}
.lm-nickBtn:hover{color:var(--dsw-alias-brand-primary)}
.lm-nickEdit{padding:6px 0 0}
.lm-nickRow{display:flex;align-items:center;gap:6px;margin-top:2px}
.lm-inputSmall{padding:2px 6px;font-size:11px}
.lm-attention{display:flex;flex-direction:column;gap:4px;max-height:32%;overflow:auto}
.lm-attentionRow{display:flex;flex-direction:column;gap:1px;text-align:left;width:100%;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-warn-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer}
.lm-attentionRow:hover{background:var(--dsw-alias-bg-layer-2)}
.lm-attentionFrom{font-weight:600;color:var(--dsw-alias-label-secondary)}
.lm-attentionText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-tasksWrap{border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px 16px;max-height:42%;overflow:auto;flex:0 0 auto}
.lm-sectionHead{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:0;background:none;font:inherit;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);cursor:pointer}
.lm-taskList{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.lm-chat{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;padding:14px 18px;overflow:auto}
.lm-bubbleRow{display:flex;flex-direction:column;gap:3px;max-width:78%;align-self:flex-start;align-items:flex-start}
.lm-bubbleRowMine{align-self:flex-end;align-items:flex-end}
.lm-bubbleMeta{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 2px}
.lm-bubbleWho{font-weight:700;color:var(--dsw-alias-label-primary)}
.lm-bubbleWhen{font-weight:400;color:var(--dsw-alias-label-secondary)}
.lm-bubble{padding:8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);word-break:break-word;font-size:13px;line-height:1.6;max-width:100%;overflow-x:auto}
.lm-bubbleMine{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-brand-primary)}
.lm-bubblePlain{white-space:pre-wrap}
.lm-composer{display:flex;flex-direction:column;gap:6px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.lm-composerRow{display:flex;gap:8px;align-items:flex-end}
.lm-mentions{display:flex;gap:5px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-mention{font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px;cursor:pointer}
.lm-mention:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.lm-mentionMenu{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow-y:auto;padding:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:6px}
.lm-mentionItem{display:flex;align-items:center;gap:6px;font:inherit;font-size:12px;text-align:left;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid transparent;border-radius:6px;padding:4px 7px;cursor:pointer}
.lm-mentionItem:hover{background:var(--dsw-alias-bg-layer-1)}
.lm-mentionItemActive{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}
.lm-mentionName{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-roomRow{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid transparent;border-radius:8px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}
.lm-roomRow:hover{background:var(--dsw-alias-bg-layer-2)}
.lm-roomRowActive{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.lm-roomRowName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-roomRowMeta{color:var(--dsw-alias-label-secondary);font-size:11px}
.lm-roomUnread{min-width:16px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:10px;font-weight:600;line-height:16px;text-align:center}
.lm-joinRow{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.lm-joinInfo{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
.lm-joinMeta{color:var(--dsw-alias-label-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-emptyPane{display:flex;flex-direction:column;gap:12px;flex:1;min-height:0;padding:16px 20px;overflow:auto}
.lm-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.lm-title{font-size:16px;font-weight:600}
.lm-formTitle{font-weight:600;margin-top:6px}
.lm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.lm-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.lm-cardTitle{font-weight:600}
.lm-btn{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:4px 10px;cursor:pointer}
.lm-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.lm-btn:disabled{opacity:.5;cursor:default}
.lm-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.lm-btnSmall{padding:2px 7px;font-size:11px;border-radius:6px}
.lm-peers{display:flex;flex-direction:column;gap:6px}
.lm-peer{display:flex;align-items:baseline;gap:8px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.lm-peerName{font-weight:600}
.lm-peerMeta{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success)}
.lm-dotIdle{background:var(--dsw-alias-label-secondary)}
.lm-muted{color:var(--dsw-alias-label-secondary)}
.lm-input,.lm-textarea,.lm-select{font:inherit;width:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:7px 9px}
.lm-select{padding:5px 8px;cursor:pointer}
.lm-textarea{min-height:84px;resize:vertical;font-family:inherit}
.lm-textareaShort{min-height:52px}
.lm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}
.lm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lm-msgs{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto}
.lm-msg{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px}
.lm-msgUnread{border-color:var(--dsw-alias-brand-primary)}
.lm-msgHead{display:flex;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.lm-msgText{white-space:pre-wrap;word-break:break-word}
.lm-error{color:var(--dsw-alias-state-error)}
.lm-ok{color:var(--dsw-alias-state-success)}
.lm-icon{display:block}
.lm-session{display:flex;align-items:center;gap:6px;font-size:12px}
.lm-session .lm-select{width:auto;max-width:190px}
.lm-note{font-size:12px;margin:6px 0}
.lm-badge{font-size:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);white-space:nowrap}
.lm-badgeLeader{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.lm-task{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base)}
.lm-taskHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lm-taskTitle{font-weight:600}
.lm-taskAssignee{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-taskDetail{margin-top:5px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.lm-status{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid currentColor;white-space:nowrap}
.lm-statusOpen{color:var(--dsw-alias-state-idle-primary)}
.lm-statusDoing{color:var(--dsw-alias-brand-primary)}
.lm-statusBlocked{color:var(--dsw-alias-state-warn)}
.lm-statusDone{color:var(--dsw-alias-state-success)}
.lm-statusBtns{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
`;

    /**
     * The session the panel acted as last time, if the browser still remembers it.
     * @returns {string}
     */
    function readStoredSession() {
      try {
        const value = window.localStorage.getItem(SESSION_KEY);
        return typeof value === 'string' ? value : '';
      } catch (error) {
        return '';
      }
    }

    /**
     * Remember the selected session across reloads. Storage may be unavailable
     * in a locked-down frame; losing the choice is not worth a crash.
     * @param {string} id - session id.
     * @returns {void}
     */
    function storeSession(id) {
      try {
        window.localStorage.setItem(SESSION_KEY, id);
      } catch (error) {
        void error;
      }
    }

    /**
     * Shorten an id for a select option, where width is scarce.
     * @param {string} value - id.
     * @returns {string}
     */
    function shortId(value) {
      const text = String(value ?? '');
      return text.length > 14 ? `${text.slice(0, 11)}…` : text;
    }

    /**
     * What to call a session on screen: its own title first, then the name it
     * was given, and only then a shortened id.
     *
     * Session ids are unreadable at a glance, so they are a last resort — a row
     * with a title never shows one.
     * @param {object} row - session, agent row or room member.
     * @returns {string}
     */
    function labelOf(row) {
      const title = typeof row?.title === 'string' ? row.title.trim() : '';
      if (title !== '') return title;
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (name !== '') return name;
      return shortId(row?.id ?? row?.sessionId ?? '');
    }

    /**
     * Turn anything thrown by a failed RPC into the text shown in the panel.
     * @param {unknown} error - thrown value.
     * @returns {string}
     */
    function errorText(error) {
      return String(error?.message ?? error);
    }

    /**
     * A room message's timestamp, whichever field the service filled in.
     * @param {object} message - room message record.
     * @returns {string}
     */
    function messageStamp(message) {
      const value = message?.at ?? message?.receivedAt ?? message?.sentAt ?? '';
      return String(value).replace('T', ' ').slice(0, 19);
    }

    /**
     * A room message's sender, falling back to the node id.
     * @param {object} message - room message record.
     * @returns {string}
     */
    function senderOf(message) {
      // The title is what tells two sessions on the same machine apart; the node
      // name is shared by both and reads as "my own machine answered me".
      return message?.from?.title || message?.from?.name || message?.from?.nodeId || '?';
    }

    /**
     * The `@token` the caret sits in, if any.
     *
     * A completion list that opened on every `@` in the text would fight the
     * user typing an email address or a quoted name, so only the token touched
     * by the caret counts.
     * @param {string} text - composer contents.
     * @param {number} caret - caret offset in `text`.
     * @returns {{ start: number, length: number, query: string } | undefined}
     */
    function mentionAt(text, caret) {
      const body = typeof text === 'string' ? text : '';
      const at = typeof caret === 'number' && caret >= 0 && caret <= body.length ? caret : body.length;
      const start = body.lastIndexOf('@', at - 1);
      if (start === -1) return undefined;
      // `@` must begin the message or follow a space, so an address never opens it.
      if (start > 0 && !/\s/.test(body[start - 1])) return undefined;
      const query = body.slice(start + 1, at);
      // A newline ends the token: the mention is one line, like the list.
      if (/[\r\n]/.test(query)) return undefined;
      // A trailing space ends it too, so an accepted mention does not reopen
      // the menu on the name it just wrote.
      if (/\s$/.test(query)) return undefined;
      return { start, length: query.length + 1, query };
    }

    /**
     * Room members whose title or name contains the typed prefix.
     * @param {object[]} members - room members.
     * @param {string} query - text after `@`.
     * @param {(member: object) => string} [label] - how a row is displayed.
     * @returns {object[]} matches, best first.
     */
    function matchMention(members, query, label = labelOf) {
      const needle = String(query ?? '').trim().toLowerCase();
      const rows = Array.isArray(members) ? members : [];
      return rows
        .map((member) => ({ member, label: label(member) }))
        .filter((row) => row.label !== '')
        .filter((row) => needle === '' || row.label.toLowerCase().includes(needle))
        .sort((a, b) => {
          const aStarts = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
          const bStarts = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return a.label.localeCompare(b.label);
        })
        .map((row) => row.member);
    }

    /**
     * A labelling function for the mention picker.
     *
     * Two sessions can carry the same title ("新会话"), so when a plain label
     * appears more than once the label gets a short session id appended. Only
     * the colliding rows grow a suffix, and only inside the picker.
     * @param {object[]} members - room members.
     * @returns {(member: object) => string} label per member.
     */
    function mentionLabels(members) {
      const rows = Array.isArray(members) ? members : [];
      const seen = new Map();
      for (const member of rows) {
        const label = labelOf(member);
        if (label === '') continue;
        seen.set(label, (seen.get(label) ?? 0) + 1);
      }
      return (member) => {
        const label = labelOf(member);
        if (label === '' || (seen.get(label) ?? 0) < 2) return label;
        return `${label} · ${shortId(member.sessionId ?? '')}`;
      };
    }

    /**
     * Run `fn` on an interval, tolerating environments without timers.
     *
     * The panel can be rendered by a harness that has no `setInterval` at all
     * (the render check runs it that way), and a missing timer must degrade to
     * "no polling", never to a throw during mount.
     * @param {number} ms - period.
     * @param {() => void} fn - tick.
     * @returns {() => void} stop function.
     */
    function every(ms, fn) {
      try {
        if (typeof setInterval !== 'function') return () => {};
        const timer = setInterval(() => {
          try {
            fn();
          } catch (error) {
            void error;
          }
        }, ms);
        return () => {
          try {
            if (typeof clearInterval === 'function') clearInterval(timer);
          } catch (error) {
            void error;
          }
        };
      } catch (error) {
        void error;
        return () => {};
      }
    }

    /**
     * Insert the panel stylesheet once and keep it for the life of the page.
     * @returns {void}
     */
    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /**
     * The sidebar icon: three nodes wired together.
     * @param {{ size?: number, active?: boolean }} props - owner-supplied size.
     * @returns {object} icon element.
     */
    function MeshIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16;
      return h(
        'svg',
        {
          className: 'lm-icon',
          'aria-hidden': true,
          focusable: false,
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('circle', { cx: 5, cy: 12, r: 2.4 }),
        h('circle', { cx: 19, cy: 6.5, r: 2.4 }),
        h('circle', { cx: 19, cy: 17.5, r: 2.4 }),
        h('path', { d: 'M7.3 11 16.7 7.4' }),
        h('path', { d: 'M7.3 13 16.6 16.6' }),
      );
    }

    /**
     * Pick which agent session the panel speaks as.
     * @param {{ sessions: object[], value: string, onChange: (id: string) => void }} props - sessions and choice.
     * @returns {object | null} select element, or null when the host has no session.
     */
    function SessionSelect(props) {
      const sessions = Array.isArray(props.sessions) ? props.sessions : [];
      return h(
        'label',
        { className: 'lm-session', title: COPY.sessionHint },
        h('span', { className: 'lm-muted' }, COPY.session),
        h(
          'select',
          {
            className: 'lm-select',
            value: props.value,
            onChange: (event) => props.onChange(event.target.value),
          },
          h('option', { value: HUMAN_SESSION_ID }, COPY.selfOption),
          ...sessions.map((session) =>
            h(
              'option',
              { key: session.id, value: session.id, title: session.id },
              `${labelOf(session)}${Array.isArray(session.rooms) && session.rooms.length > 0 ? ` · ${session.rooms.length}` : ''}`,
            ),
          ),
        ),
      );
    }

    /**
     * One task: status chip, who owns it, and the buttons that move it.
     * @param {object} props - task plus room/session context.
     * @returns {object} task element.
     */
    function TaskItem(props) {
      const task = props.task;
      const status = STATUS_ORDER.includes(task.status) ? task.status : 'open';
      // The service lets the leader move any task and an assignee move their own.
      const mine = task.assignee?.sessionId === props.sessionId;
      const canMove = mine || props.isLeader === true;
      const busy = props.busy === task.id;
      return h(
        'div',
        { className: 'lm-task' },
        h(
          'div',
          { className: 'lm-taskHead' },
          h('span', { className: STATUS_CLASS[status] ?? 'lm-status' }, STATUS_LABELS[status] ?? status),
          h('span', { className: 'lm-taskTitle' }, task.title),
          h(
            'span',
            { className: 'lm-taskAssignee' },
            `${COPY.assignee}: ${labelOf(task.assignee) || '?'}`,
          ),
        ),
        task.detail ? h('div', { className: 'lm-taskDetail' }, task.detail) : null,
        canMove
          ? h(
              'div',
              { className: 'lm-statusBtns' },
              ...STATUS_ORDER.filter((value) => value !== status).map((value) =>
                h(
                  'button',
                  {
                    key: value,
                    type: 'button',
                    className: 'lm-btn lm-btnSmall',
                    disabled: busy,
                    onClick: () => props.onStatus(task, value),
                  },
                  STATUS_LABELS[value] ?? value,
                ),
              ),
            )
          : null,
      );
    }

    /**
     * One member: online dot, name, leader mark, and — only for an agent that
     * lives on this very node — the button that jumps to its session.
     * @param {object} props - member, self session, local node id and jump hook.
     * @returns {object} chip element.
     */
    function MemberChip(props) {
      const member = props.member;
      // A remote member has no session on this host, and the human member is not
      // a session at all: neither can be opened from here.
      const openable =
        member.nodeId === props.nodeId && member.sessionId !== 'human' && props.onOpenSession !== undefined;
      return h(
        'span',
        {
          className:
            member.sessionId === props.sessionId ? 'lm-memberChip lm-memberChipSelf' : 'lm-memberChip',
          title: `${member.nodeId}/${member.sessionId}`,
        },
        h('span', { className: member.live === true ? 'lm-mdot' : 'lm-mdot lm-mdotIdle' }),
        h('span', null, labelOf(member)),
        member.role === 'leader' ? h('span', { className: 'lm-leaderTag' }, COPY.roleLeader) : null,
        props.onRename === undefined
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnSmall lm-nickBtn',
                title: COPY.nickname,
                onClick: () => props.onRename(member),
              },
              '✎',
            ),
        openable
          ? h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnSmall lm-openSession',
                onClick: () => props.onOpenSession(member.sessionId),
              },
              COPY.openSession,
            )
          : null,
      );
    }

    /**
     * Copy the Markdown renderer needs for its chrome (code fences, previews,
     * footnotes). The shell's primitives module carries no locale seat of its
     * own, so the panel supplies its own words rather than borrowing another
     * plugin's. Every key is filled: a missing string renders as "undefined"
     * in the middle of a bubble.
     * @returns {object} MarkdownLabels.
     */
    function markdownLabels() {
      const zh = prefersChinese();
      return {
        code: {
          copyLabel: zh ? '复制' : 'Copy',
          copiedLabel: zh ? '已复制' : 'Copied',
          toolbarLabels: {
            codeLabel: zh ? '代码' : 'Code',
            wrapLabel: zh ? '换行' : 'Wrap',
            unwrapLabel: zh ? '不换行' : 'No wrap',
          },
        },
        copy: zh ? '复制' : 'Copy',
        copied: zh ? '已复制' : 'Copied',
        noResults: zh ? '没有结果' : 'No results',
        expand: (count) => (zh ? `展开 ${count} 条` : `Show ${count} more`),
        expandAria: (count) => (zh ? `展开剩下的 ${count} 条` : `Show ${count} more`),
        collapse: zh ? '收起' : 'Show less',
        collapseAria: zh ? '收起' : 'Show less',
        pathsSummary: (count) => (zh ? `${count} 个路径` : `${count} paths`),
        matchesSummary: (count, files) => (zh ? `${files} 个文件里 ${count} 处` : `${count} in ${files} files`),
        open: zh ? '打开' : 'Open',
        loading: zh ? '加载中…' : 'Loading…',
        failed: zh ? '加载失败' : 'Failed to load',
        footnotes: zh ? '脚注' : 'Footnotes',
      };
    }

     /**
      * One message in the room conversation, as a bubble. Own messages sit right.
      *
      * The body renders as Markdown through the shell's own renderer, so a room
      * message that carries a list, a table or a code fence reads exactly like
      * the same text in a conversation.
      * @param {object} props - message plus ownership flag.
      * @returns {object} bubble element.
      */
     function ChatBubble(props) {
       const message = props.message;
       const sender = senderOf(message);
       const body =
         MarkdownText === undefined
           ? h('div', { className: 'lm-bubblePlain' }, String(message.text ?? ''))
           : h(MarkdownText, { text: String(message.text ?? ''), labels: markdownLabels() });
       return h(
         'div',
         { className: props.mine ? 'lm-bubbleRow lm-bubbleRowMine' : 'lm-bubbleRow' },
         h(
           'div',
           { className: 'lm-bubbleMeta' },
           h('strong', { className: 'lm-bubbleWho' }, sender),
           h('span', { className: 'lm-bubbleWhen' }, ` · ${messageStamp(message)}`),
         ),
         h('div', { className: props.mine ? 'lm-bubble lm-bubbleMine' : 'lm-bubble' }, body),
       );
     }

    /**
     * The right-hand pane for one room: header, members, tasks, conversation.
     *
     * The room detail is polled here rather than in the panel so that switching
     * rooms tears the whole subscription down with the component.
     * @param {object} props - room row, session, rpc caller, change/exit hooks.
     * @returns {object} pane element.
     */
    function RoomPane(props) {
      const roomId = String(props.room?.id ?? '');
      const sessionId = props.sessionId;
      const call = props.call;
      const localAgents = Array.isArray(props.localAgents) ? props.localAgents : [];

      const [detail, setDetail] = React.useState({ status: 'loading', room: null, messages: [], viewer: null, error: '' });
      const [tasksOpen, setTasksOpen] = React.useState(true);
      const [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [noticeBad, setNoticeBad] = React.useState(false);
      const [renaming, setRenaming] = React.useState(false);
      const [nameDraft, setNameDraft] = React.useState('');
      const [assignee, setAssignee] = React.useState('');
      const [taskTitle, setTaskTitle] = React.useState('');
      const [taskDetail, setTaskDetail] = React.useState('');
      /** Caret position, so `@` completion knows which token is being typed. */
      const [caret, setCaret] = React.useState(0);
      /** Set by Escape, so the list can be dismissed without changing the text. */
      const [mentionOff, setMentionOff] = React.useState(false);
      /** Highlighted row of the `@` completion list. */
      const [mentionPick, setMentionPick] = React.useState(0);
      /** Member being renamed locally, plus the draft for the nickname. */
      const [nickMember, setNickMember] = React.useState(null);
      const [nickDraft, setNickDraft] = React.useState('');
      /** Local session the leader wants to pull into this room. */
      const [inviteSession, setInviteSession] = React.useState('');

      const flash = React.useCallback((text, bad) => {
        setNotice(text);
        setNoticeBad(bad === true);
      }, []);

      const load = React.useCallback(async () => {
        try {
          const value = await call('roomDetail', { room: roomId, sessionId });
          setDetail({
            status: 'ready',
            room: value?.room ?? null,
            messages: Array.isArray(value?.messages) ? value.messages : [],
            viewer: value?.viewer ?? null,
            error: '',
          });
        } catch (error) {
          // A transient failure keeps the last good transcript on screen.
          setDetail((current) => ({ ...current, status: 'error', error: errorText(error) }));
        }
      }, [call, roomId, sessionId]);

      React.useEffect(() => {
        let live = true;
        const tick = () => {
          if (live) load();
        };
        tick();
        const stop = every(2000, tick);
        return () => {
          live = false;
          stop();
        };
      }, [load]);

      const view = detail.room ?? props.room ?? {};
      const viewer = detail.viewer ?? { isMember: true, isLeader: props.room?.isLeader === true, role: '' };
      const isLeader = viewer.isLeader === true;
      const members = Array.isArray(view.members) ? view.members : [];
      const tasks = Array.isArray(view.tasks) ? view.tasks : [];
      // Only the conversation belongs in the chat: `room-task` rows are the
      // assignment notices and they are already shown in the task list.
      const messages = (Array.isArray(detail.messages) ? detail.messages : []).filter(
        (message) => message?.kind === 'room-message',
      );
      const self = props.self ?? {};
      const selfMember = members.find((member) => member.sessionId === sessionId);
      const selfName = selfMember?.name || self.name || '';
      const selfLabel = selfMember === undefined ? '' : labelOf(selfMember);
      // Ownership: a bubble sits right when *this* person wrote it. Room
      // messages carry the sending session since the panel started stamping
      // `from.sessionId`, so the human member's own words come back marked
      // `human` even though the panel may be acting as an agent session.
      // Older rows fall back to the title, the name, then to "this node has
      // only one member".
      const mineOf = (message) => {
        if (message?.from?.nodeId !== self.nodeId) return false;
        const fromSession = typeof message.from?.sessionId === 'string' ? message.from.sessionId : '';
        if (fromSession !== '') return fromSession === sessionId || fromSession === 'human';
        const from = message.from?.title || message.from?.name || '';
        if (from !== '' && (from === selfLabel || from === selfName)) return true;
        return members.filter((member) => member.nodeId === self.nodeId).length <= 1;
      };
      const assigneeValue = assignee !== '' ? assignee : members[0]?.key ?? '';

      const insertMention = (name) => {
        setDraft((current) => (current === '' || current.endsWith(' ') ? `${current}@${name} ` : `${current} @${name} `));
      };

      // `@` completion: the token being typed is whatever follows the last `@`
      // before the caret, so typing anywhere else never opens the list.
      const mention = mentionOff ? undefined : mentionAt(draft, caret);
      // Rows show a disambiguated label; the sent text keeps the plain title,
      // because `@` is an annotation, not an address.
      const mentionLabel = mentionLabels(members);
      const matches = mention === undefined ? [] : matchMention(members, mention.query, mentionLabel);
      React.useEffect(() => {
        setMentionPick(0);
      }, [mention?.query]);
      const applyMention = (member) => {
        if (mention === undefined) return;
        const insert = `${labelOf(member)} `;
        const next = `${draft.slice(0, mention.start)}@${insert}${draft.slice(mention.start + mention.length)}`;
        setDraft(next);
        setCaret(mention.start + insert.length + 1);
        setMentionOff(false);
      };

      const doSay = async () => {
        const text = draft.trim();
        if (text === '') {
          flash(COPY.needMessage, true);
          return;
        }
        setBusy('say');
        try {
          const value = await call('roomSay', { room: roomId, sessionId, text });
          const delivered = Array.isArray(value?.delivered) ? value.delivered : [];
          const failed = delivered.filter((row) => row.ok !== true);
          if (failed.length > 0) flash(`${COPY.deliverFailed}: ${failed[0].name ?? ''} ${failed[0].error ?? ''}`, true);
          else flash('', false);
          setDraft('');
          await load();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const doRename = async () => {
        const name = nameDraft.trim();
        if (name === '') {
          flash(COPY.needRoomName, true);
          return;
        }
        setBusy('rename');
        try {
          await call('roomRename', { room: roomId, sessionId, name });
          setNameDraft('');
          setRenaming(false);
          flash(COPY.renamed, false);
          await load();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const doLeave = async () => {
        setBusy('leave');
        try {
          await call('roomLeave', { room: roomId, sessionId });
          props.onChanged?.();
          props.onExited?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const doAssign = async () => {
        if (taskTitle.trim() === '') {
          flash(COPY.needTaskTitle, true);
          return;
        }
        setBusy('assign');
        try {
          const value = await call('roomAssign', {
            room: roomId,
            sessionId,
            assignee: assigneeValue,
            title: taskTitle.trim(),
            detail: taskDetail,
          });
          const delivered = Array.isArray(value?.delivered) ? value.delivered : [];
          const failed = delivered.filter((row) => row.ok !== true);
          if (failed.length > 0) flash(`${COPY.deliverFailed}: ${failed[0].name ?? ''} ${failed[0].error ?? ''}`, true);
          else flash(COPY.assigned, false);
          setTaskTitle('');
          setTaskDetail('');
          await load();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      /** The leader pulls one local agent session into this room. */
      const doInvite = async () => {
        if (inviteSession === '') {
          flash(COPY.inviteNone, true);
          return;
        }
        setBusy('invite');
        try {
          await call('roomInvite', { room: roomId, sessionId, memberSessionId: inviteSession });
          setInviteSession('');
          flash(COPY.invited, false);
          await load();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      /**
       * Save a local nickname for one room member.
       *
       * A nickname is this screen's own word for that session: it never leaves
       * the node, so two people can name the same agent differently.
       * @param {object} member - room member row.
       * @param {string} name - new nickname; empty clears it.
       */
      const saveMemberNickname = async (member, name) => {
        setBusy('nick');
        try {
          await call('nickname', {
            member: member.key ?? `${member.nodeId}/${member.sessionId}`,
            name: name.trim(),
          });
          flash(COPY.nicknameSaved, false);
          await load();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const submitNickname = async () => {
        if (nickMember === null) return;
        const target = nickMember;
        setNickMember(null);
        await saveMemberNickname(target, nickDraft);
        setNickDraft('');
      };

      const doStatus = async (task, status) => {
        setBusy(task.id);
        try {
          await call('roomStatus', { room: roomId, sessionId, task: task.id, status, note: '' });
          await load();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      return h(
        'div',
        { className: 'lm-roomPane' },

        h(
          'div',
          { className: 'lm-roomHead' },
          h(
            'div',
            { className: 'lm-roomTitleRow' },
            h('span', { className: 'lm-roomTitle' }, view.name || roomId),
            view.memberCount !== undefined || members.length > 0
              ? h('span', { className: 'lm-badge' }, `${members.length || view.memberCount} ${COPY.memberCount}`)
              : null,
            h(
              'div',
              { className: 'lm-roomHeadBtns' },
              // Renaming is leader-only on the service, so the button only exists there.
              isLeader && !renaming
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnSmall lm-renameBtn',
                      onClick: () => {
                        setNameDraft(view.name || '');
                        setRenaming(true);
                      },
                    },
                    COPY.rename,
                  )
                : null,
              // The leader created the room and the service refuses to let it go.
              viewer.isMember === true && isLeader !== true
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnSmall lm-leaveBtn',
                      disabled: busy === 'leave',
                      onClick: doLeave,
                    },
                    busy === 'leave' ? COPY.leaving : COPY.leave,
                  )
                : null,
            ),
          ),
          view.topic ? h('span', { className: 'lm-roomTopicText' }, view.topic) : null,
          renaming
            ? h(
                'div',
                { className: 'lm-row' },
                h('input', {
                  className: 'lm-input',
                  style: { flex: '1 1 180px' },
                  value: nameDraft,
                  placeholder: COPY.renameHint,
                  onChange: (event) => setNameDraft(event.target.value),
                }),
                h(
                  'button',
                  { type: 'button', className: 'lm-btn lm-btnPrimary lm-btnSmall', disabled: busy === 'rename', onClick: doRename },
                  busy === 'rename' ? COPY.renaming : COPY.rename,
                ),
                h(
                  'button',
                  { type: 'button', className: 'lm-btn lm-btnSmall', onClick: () => setRenaming(false) },
                  COPY.collapse,
                ),
              )
            : null,
          h(
            'div',
            { className: 'lm-memberRow' },
            ...members.map((member) =>
              h(MemberChip, {
                key: member.key ?? `${member.nodeId}/${member.sessionId}`,
                member,
                sessionId,
                nodeId: self.nodeId,
                onOpenSession: props.onOpenSession,
                onRename: (member) => {
                  setNickMember(member);
                  setNickDraft(labelOf(member));
                },
              }),
            ),
          ),
          // The leader can pull a local session in without waiting for it to
          // discover the room on its own. Only this node's own sessions are
          // offered, since a peer's membership belongs to the peer.
          isLeader
            ? h(
                'div',
                { className: 'lm-inviteRow' },
                h('span', { className: 'lm-muted' }, COPY.inviteHint),
                h(
                  'select',
                  {
                    className: 'lm-select',
                    value: inviteSession,
                    onChange: (event) => setInviteSession(event.target.value),
                  },
                  h('option', { value: '' }, COPY.inviteNone),
                  ...localAgents.map((row) =>
                    h('option', { key: row.id, value: row.id }, labelOf(row)),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lm-btn lm-btnSmall lm-btnPrimary lm-inviteBtn',
                    disabled: busy === 'invite' || inviteSession === '',
                    onClick: doInvite,
                  },
                  busy === 'invite' ? COPY.assigning : COPY.inviteAction,
                ),
              )
            : null,
          nickMember === null
            ? null
            : h(
                'div',
                { className: 'lm-row lm-nickEdit' },
                h('input', {
                  className: 'lm-input lm-nickInput',
                  style: { flex: '1 1 160px' },
                  value: nickDraft,
                  placeholder: COPY.nicknameHint,
                  onChange: (event) => setNickDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    submitNickname();
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lm-btn lm-btnPrimary lm-btnSmall lm-nickSave',
                    disabled: busy === 'nick',
                    onClick: submitNickname,
                  },
                  COPY.nicknameSaved,
                ),
                h('button', { type: 'button', className: 'lm-btn lm-btnSmall', onClick: () => setNickMember(null) }, COPY.collapse),
              ),
          detail.status === 'error'
            ? h('div', { className: 'lm-error lm-note' }, `${COPY.detailUnavailable} ${detail.error}`)
            : null,
          notice === '' ? null : h('div', { className: noticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, notice),
        ),

        h(
          'div',
          { className: 'lm-tasksWrap' },
          h(
            'button',
            { type: 'button', className: 'lm-sectionHead lm-tasksToggle', onClick: () => setTasksOpen((open) => open !== true) },
            h('span', null, `${COPY.tasksLabel} (${tasks.length})`),
            h('span', { style: { marginLeft: 'auto' } }, tasksOpen ? COPY.collapse : COPY.expand),
          ),
          tasksOpen
            ? h(
                'div',
                { className: 'lm-taskList' },
                tasks.length === 0
                  ? h('div', { className: 'lm-muted' }, COPY.noTasks)
                  : tasks.map((task) =>
                      h(TaskItem, {
                        key: task.id,
                        task,
                        sessionId,
                        isLeader,
                        busy,
                        onStatus: doStatus,
                      }),
                    ),
                isLeader && members.length > 0
                  ? h(
                      'div',
                      { className: 'lm-task' },
                      h('div', { className: 'lm-formTitle' }, COPY.assign),
                      h(
                        'div',
                        { className: 'lm-row', style: { marginTop: '6px' } },
                        h(
                          'select',
                          {
                            className: 'lm-select',
                            style: { width: 'auto', flex: '0 0 auto' },
                            value: assigneeValue,
                            onChange: (event) => setAssignee(event.target.value),
                          },
                          ...members.map((member) =>
                            h(
                              'option',
                              { key: member.key ?? `${member.nodeId}/${member.sessionId}`, value: member.key ?? `${member.nodeId}/${member.sessionId}` },
                              member.name || member.sessionId,
                            ),
                          ),
                        ),
                        h('input', {
                          className: 'lm-input',
                          style: { flex: '1 1 120px' },
                          value: taskTitle,
                          placeholder: COPY.taskTitleHint,
                          onChange: (event) => setTaskTitle(event.target.value),
                        }),
                      ),
                      h('input', {
                        className: 'lm-input',
                        style: { marginTop: '6px' },
                        value: taskDetail,
                        placeholder: COPY.taskDetailHint,
                        onChange: (event) => setTaskDetail(event.target.value),
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'lm-btn lm-btnSmall lm-btnPrimary lm-assignBtn',
                          style: { marginTop: '6px' },
                          disabled: busy === 'assign',
                          onClick: doAssign,
                        },
                        busy === 'assign' ? COPY.assigning : COPY.assignAction,
                      ),
                    )
                  : null,
              )
            : null,
        ),

        h(
          'div',
          { className: 'lm-chat' },
          messages.length === 0
            ? h('div', { className: 'lm-muted' }, detail.status === 'loading' ? COPY.loading : COPY.noChat)
            : messages.map((message) =>
                h(ChatBubble, {
                  key: message.id ?? `${messageStamp(message)}-${senderOf(message)}`,
                  message,
                  mine: mineOf(message),
                }),
              ),
        ),

        h(
          'div',
          { className: 'lm-composer' },
          members.length === 0
            ? null
            : h(
                'div',
                { className: 'lm-mentions' },
                h('span', null, COPY.mentions),
                ...members.map((member) =>
                  h(
                    'button',
                    {
                      key: member.key ?? `${member.nodeId}/${member.sessionId}`,
                      type: 'button',
                      className: 'lm-mention',
                      title: member.sessionId,
                      onClick: () => insertMention(labelOf(member)),
                    },
                    `@${labelOf(member)}`,
                  ),
                ),
              ),
          matches.length === 0
            ? null
            : h(
                'div',
                { className: 'lm-mentionMenu' },
                ...matches.slice(0, 8).map((member, index) =>
                  h(
                    'button',
                    {
                      key: member.key ?? `${member.nodeId}/${member.sessionId}`,
                      type: 'button',
                      className:
                        index === mentionPick
                          ? 'lm-mentionItem lm-mentionItemActive'
                          : 'lm-mentionItem',
                      // The caret must stay in the textarea while a row is
                      // clicked, or the selection would be lost on blur.
                      onMouseDown: (event) => {
                        event.preventDefault?.();
                        applyMention(member);
                      },
                    },
                    h('span', { className: member.live === true ? 'lm-mdot' : 'lm-mdot lm-mdotIdle' }),
                    h('span', { className: 'lm-mentionName' }, mentionLabel(member)),
                    member.role === 'leader' ? h('span', { className: 'lm-leaderTag' }, COPY.roleLeader) : null,
                  ),
                ),
              ),
          h(
            'div',
            { className: 'lm-composerRow' },
            h('textarea', {
              className: 'lm-textarea lm-textareaShort',
              style: { flex: '1 1 auto' },
              value: draft,
              placeholder: COPY.sayHint,
              onChange: (event) => {
                setDraft(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
                if (mentionOff) setMentionOff(false);
              },
              onKeyUp: (event) => setCaret(event.target.selectionStart ?? 0),
              onClick: (event) => setCaret(event.target.selectionStart ?? 0),
              onKeyDown: (event) => {
                if (matches.length > 0) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setMentionPick((current) => (current + 1) % Math.min(matches.length, 8));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    const size = Math.min(matches.length, 8);
                    setMentionPick((current) => (current + size - 1) % size);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    // Enter picks a name instead of sending: the list is only
                    // open while an `@` token is being typed.
                    event.preventDefault();
                    applyMention(matches[mentionPick] ?? matches[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMentionOff(true);
                    return;
                  }
                }
                // Enter sends, Shift+Enter breaks the line: a chat box that needs
                // a button click to send is the wrong shape for this panel.
                if (event.key === 'Enter' && event.shiftKey === false && event.isComposing !== true) {
                  event.preventDefault();
                  doSay();
                }
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnPrimary lm-sayBtn',
                disabled: busy === 'say' || viewer.isMember !== true,
                onClick: doSay,
              },
              busy === 'say' ? COPY.saying : COPY.sayAction,
            ),
          ),
        ),
      );
    }

    /**
     * One agent row: a session on this node, or an agent on another machine.
     * @param {{ row: object, busy: boolean, action: string, onAct: (row: object) => void }} props - row and handler.
     * @returns {object} row element.
     */
    function AgentRow(props) {
      const row = props.row;
      const local = row.nodeName === undefined || props.local === true;
      const tag =
        row.dialled === true ? COPY.agentsDialled : row.live === true ? COPY.agentsLive : COPY.agentsStored;
      // A remote row is useless without knowing which machine answers for it.
      const where = local ? row.workspace : `${row.nodeName || row.nodeId} · ${row.workspace || ''}`;
      return h(
        'div',
        { className: 'lm-peer', title: local ? row.id : `${row.nodeId}/${row.id}` },
        h('span', { className: row.live === true ? 'lm-dot' : 'lm-dot lm-dotIdle' }),
        h(
          'span',
          { className: 'lm-peerName' },
          labelOf(row),
          where ? h('span', { className: 'lm-muted' }, ` · ${where}`) : null,
        ),
        h('span', { className: 'lm-peerMeta' }, tag),
        props.action === ''
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnSmall',
                disabled: props.busy,
                onClick: () => props.onAct(row),
              },
              props.busy ? `${props.action}…` : props.action,
            ),
      );
    }

    /**
     * The left rail: who this panel is, the rooms it belongs to, the rooms it
     * could join, and the entry point for a new project.
     * @param {object} props - identity, rooms, unread counts and handlers.
     * @returns {object} rail element.
     */
    function Rail(props) {
      const rooms = Array.isArray(props.rooms) ? props.rooms : [];
      const joinable = Array.isArray(props.joinable) ? props.joinable : [];
      const attention = Array.isArray(props.attention) ? props.attention : [];
      const sessionRows = Array.isArray(props.sessions) ? props.sessions : [];
      // The rail names the acting session the same way every other row does:
      // by title, never by the id behind it. The human identity has no session
      // row, so it falls back to the self name the user set (or "me").
      const selfSession = sessionRows.find((session) => session.id === props.sessionId);
      const selfLabel =
        props.sessionId === HUMAN_SESSION_ID
          ? props.self?.selfName || props.self?.name || COPY.selfOption
          : selfSession === undefined
            ? props.sessionId
            : labelOf(selfSession);
      return h(
        'div',
        { className: 'lm-rail' },
        h(
          'div',
          { className: 'lm-ident' },
          h('span', { className: 'lm-muted' }, COPY.identity),
          h('span', { className: 'lm-identName' }, props.self?.name || COPY.self),
          h('span', { className: 'lm-identMeta' }, `${COPY.you}: ${selfLabel || COPY.noSession}`),
          props.self === undefined
            ? null
            : h(
                'span',
                { className: 'lm-identMeta' },
                `${props.self.nodeId} · ${COPY.port} ${props.self.port} · ${props.self.secured ? COPY.secured : COPY.open}`,
              ),
          h(SessionSelect, { sessions: props.sessions, value: props.sessionId, onChange: props.onSession }),
          h(
            'div',
            { className: 'lm-nickRow' },
            h('span', { className: 'lm-label' }, COPY.nicknameSelf),
            h('input', {
              className: 'lm-input lm-inputSmall',
              value: props.selfNickname,
              placeholder: COPY.nicknameSelfHint,
              onChange: (event) => props.onSelfNickname(event.target.value),
              onBlur: props.onSelfNicknameSave,
            }),
          ),
        ),

        props.railNotice === ''
          ? null
          : h('div', { className: props.railNoticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, props.railNotice),

        // What is waiting on the person goes first and only ever lists unread
        // mentions and tasks: the room transcripts can hold everything else.
        h('div', { className: 'lm-railTitle' }, `${COPY.attention} (${attention.length})`),
        attention.length === 0
          ? h('div', { className: 'lm-muted' }, COPY.noAttention)
          : h(
              'div',
              { className: 'lm-attention' },
              ...attention.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    className: 'lm-attentionRow',
                    onClick: () => {
                      if (typeof item.room === 'string' && item.room !== '') props.onSelect(item.room);
                    },
                  },
                  h('span', { className: 'lm-attentionFrom' }, senderOf(item)),
                  h('span', { className: 'lm-attentionText' }, String(item.text ?? '').slice(0, 140)),
                ),
              ),
            ),

        h(
          'div',
          { className: 'lm-railTitle' },
          h('span', null, `${COPY.myRooms} (${rooms.length})`),
          h('button', { type: 'button', className: 'lm-btn lm-btnSmall', style: { marginLeft: 'auto' }, onClick: props.onRefresh }, COPY.refresh),
        ),
        rooms.length === 0
          ? h('div', { className: 'lm-muted' }, COPY.noMineRooms)
          : h(
              'div',
              { className: 'lm-railList' },
              ...rooms.map((room) =>
                h(
                  'button',
                  {
                    key: room.id,
                    type: 'button',
                    className: props.activeId === room.id ? 'lm-roomRow lm-roomRowActive' : 'lm-roomRow',
                    onClick: () => props.onSelect(room.id),
                  },
                  h('span', { className: 'lm-roomRowName' }, room.name || room.id),
                  room.isLeader === true
                    ? h('span', { className: 'lm-badge lm-badgeLeader' }, COPY.roleLeader)
                    : null,
                  h('span', { className: 'lm-roomRowMeta' }, String(Array.isArray(room.tasks) ? room.tasks.length : 0)),
                  (props.unread?.[room.id] ?? 0) > 0
                    ? h('span', { className: 'lm-roomUnread' }, String(props.unread[room.id]))
                    : null,
                ),
              ),
            ),

        joinable.length === 0
          ? null
          : h(
              'div',
              null,
              h('div', { className: 'lm-railTitle' }, `${COPY.joinable} (${joinable.length})`),
              h(
                'div',
                { className: 'lm-railList' },
                ...joinable.map((room) =>
                  h(
                    'div',
                    { key: room.id, className: 'lm-joinRow' },
                    h(
                      'div',
                      { className: 'lm-joinInfo' },
                      h('span', { className: 'lm-roomRowName' }, room.name || room.id),
                      h(
                        'span',
                        { className: 'lm-joinMeta' },
                        room.topic || `${COPY.roleLeader}: ${room.leader?.name || room.leader?.nodeId || COPY.noLeader}`,
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'lm-btn lm-btnSmall lm-btnPrimary lm-joinBtn',
                        disabled: props.joinBusy === room.id,
                        onClick: () => props.onJoin(room.id),
                      },
                      props.joinBusy === room.id ? COPY.joining : COPY.join,
                    ),
                  ),
                ),
              ),
            ),

        h(
          'div',
          { className: 'lm-railFoot' },
          props.createOpen
            ? h(
                'div',
                null,
                h(
                  'div',
                  { className: 'lm-field' },
                  h('span', { className: 'lm-label' }, COPY.roomName),
                  h('input', {
                    className: 'lm-input',
                    value: props.newName,
                    placeholder: COPY.roomNameHint,
                    onChange: (event) => props.onNewName(event.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: 'lm-field' },
                  h('span', { className: 'lm-label' }, COPY.roomTopic),
                  h('input', {
                    className: 'lm-input',
                    value: props.newTopic,
                    placeholder: COPY.roomTopicHint,
                    onChange: (event) => props.onNewTopic(event.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: 'lm-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnPrimary lm-createBtn',
                      disabled: props.createBusy,
                      onClick: props.onCreate,
                    },
                    props.createBusy ? COPY.creating : COPY.create,
                  ),
                  h('button', { type: 'button', className: 'lm-btn', onClick: () => props.onCreateOpen(false) }, COPY.collapse),
                ),
              )
            : null,
          h(
            'button',
            { type: 'button', className: 'lm-btn lm-newRoomEntry', onClick: () => props.onCreateOpen(true) },
            COPY.createRoom,
          ),
        ),
      );
    }

    /**
     * The right pane when no room is picked: this node, its peers, agents and the
     * point-to-point channel, which are all useful before a project exists.
     * @param {object} props - snapshot data, agents, send state and handlers.
     * @returns {object} pane element.
     */
    function EmptyPane(props) {
      const peers = Array.isArray(props.peers) ? props.peers : [];
      const inbox = Array.isArray(props.messages) ? props.messages : [];
      const agents = props.agents ?? { local: [], remote: [] };
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      return h(
        'div',
        { className: 'lm-emptyPane' },
        h(
          'div',
          { className: 'lm-head' },
          h('span', { className: 'lm-title' }, COPY.title),
          h('span', { className: 'lm-muted' }, COPY.noRoomSelected),
          h('button', { type: 'button', className: 'lm-btn', style: { marginLeft: 'auto' }, onClick: props.onRefresh }, COPY.refresh),
        ),

        h(
          'div',
          { className: 'lm-card' },
          h(
            'div',
            { className: 'lm-cardHead' },
            h('span', { className: 'lm-cardTitle' }, COPY.peers),
            h('span', { className: 'lm-muted' }, String(peers.length)),
          ),
          peers.length === 0
            ? h('div', { className: 'lm-muted' }, COPY.noPeers)
            : h(
                'div',
                { className: 'lm-peers' },
                ...peers.map((peer) =>
                  h(
                    'div',
                    { className: 'lm-peer', key: peer.nodeId },
                    h('span', { className: 'lm-dot' }),
                    h('span', { className: 'lm-peerName' }, peer.name),
                    h('span', { className: 'lm-muted' }, peer.address),
                    h('span', { className: 'lm-peerMeta' }, `${peer.ageSeconds}s · ${peer.port}`),
                  ),
                ),
              ),
        ),

        h(
          'div',
          { className: 'lm-card' },
          h(
            'div',
            { className: 'lm-cardHead' },
            h('span', { className: 'lm-cardTitle' }, COPY.agents),
            h('span', { className: 'lm-muted' }, `${agents.local.length} / ${agents.remote.length}`),
          ),
          h('div', { className: 'lm-railTitle' }, `${COPY.agentsLocal} (${agents.local.length})`),
          agents.local.length === 0
            ? h('div', { className: 'lm-muted' }, COPY.agentsEmpty)
            : h(
                'div',
                { className: 'lm-peers' },
                ...agents.local.map((row) =>
                  h(AgentRow, {
                    key: row.id,
                    row,
                    local: true,
                    busy: props.agentBusy === `import:${row.id}`,
                    action: row.live === true ? '' : COPY.agentsImport,
                    onAct: props.onImport,
                  }),
                ),
              ),
          h(
            'div',
            { className: 'lm-field', style: { marginTop: '10px' } },
            h('span', { className: 'lm-label' }, COPY.agentsWorkspace),
            h(
              'select',
              {
                className: 'lm-select',
                value: props.newCwd,
                onChange: (event) => props.onNewCwd(event.target.value),
              },
              h('option', { value: '' }, COPY.agentsWorkspaceHint),
              ...workspaces.map((workspace) =>
                h(
                  'option',
                  { key: workspace.path, value: workspace.path, title: workspace.path },
                  workspace.title || workspace.path,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lm-field' },
            h('span', { className: 'lm-label' }, COPY.agentsTitle),
            h('input', {
              className: 'lm-input',
              value: props.newTitle,
              placeholder: COPY.agentsTitleHint,
              onChange: (event) => props.onNewTitle(event.target.value),
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lm-btn',
              disabled: props.agentBusy === 'create',
              onClick: props.onCreateAgent,
            },
            props.agentBusy === 'create' ? COPY.agentsCreating : COPY.agentsCreateAction,
          ),
          h('div', { className: 'lm-railTitle', style: { marginTop: '12px' } }, `${COPY.agentsRemote} (${agents.remote.length})`),
          agents.remote.length === 0
            ? h('div', { className: 'lm-muted' }, COPY.agentsRemoteEmpty)
            : h(
                'div',
                { className: 'lm-peers' },
                ...agents.remote.map((row) =>
                  h(AgentRow, {
                    key: `${row.nodeId}/${row.id}`,
                    row,
                    local: false,
                    busy: props.agentBusy === `dial:${row.id}`,
                    action: COPY.agentsDial,
                    onAct: props.onDial,
                  }),
                ),
              ),
          props.agentNotice === ''
            ? null
            : h('div', { className: props.agentNoticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, props.agentNotice),
        ),

        h(
          'div',
          { className: 'lm-card' },
          h(
            'div',
            { className: 'lm-field' },
            h('span', { className: 'lm-label' }, COPY.target),
            h('input', {
              className: 'lm-input',
              value: props.target,
              placeholder: COPY.targetHint,
              onChange: (event) => props.onTarget(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'lm-field' },
            h('span', { className: 'lm-label' }, COPY.message),
            h('textarea', {
              className: 'lm-textarea',
              value: props.text,
              placeholder: COPY.messageHint,
              onChange: (event) => props.onText(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'lm-row' },
            h(
              'button',
              { type: 'button', className: 'lm-btn lm-btnPrimary', disabled: props.busy, onClick: props.onSend },
              props.busy ? COPY.sending : COPY.send,
            ),
            props.sendNotice === ''
              ? null
              : h(
                  'span',
                  {
                    className:
                      props.sendNotice === COPY.sent || props.sendNotice === COPY.empty ? 'lm-muted' : 'lm-error',
                  },
                  props.sendNotice,
                ),
          ),
        ),

        h(
          'div',
          { className: 'lm-card' },
          h(
            'div',
            { className: 'lm-cardHead' },
            h('span', { className: 'lm-cardTitle' }, COPY.inbox),
            h('span', { className: 'lm-muted' }, `${props.unread} ${COPY.unread}`),
            h(
              'button',
              { type: 'button', className: 'lm-btn', style: { marginLeft: 'auto' }, onClick: props.onMarkRead },
              COPY.markRead,
            ),
          ),
          inbox.length === 0
            ? h('div', { className: 'lm-muted' }, COPY.noMessages)
            : h(
                'div',
                { className: 'lm-msgs' },
                ...inbox
                  .slice()
                  .reverse()
                  .map((message) =>
                    h(
                      'div',
                      {
                        className: message.read === true ? 'lm-msg' : 'lm-msg lm-msgUnread',
                        key: message.id,
                      },
                      h(
                        'div',
                        { className: 'lm-msgHead' },
                        h('span', null, `${COPY.from} ${message.from?.name || message.from?.nodeId || '?'}`),
                        h('span', null, String(message.receivedAt).replace('T', ' ').slice(0, 19)),
                        message.topic ? h('span', null, message.topic) : null,
                      ),
                      h('div', { className: 'lm-msgText' }, message.text),
                    ),
                  ),
              ),
        ),
      );
    }

    /** Exact Host route the panel posts to; the Host mounts it under `/api`. */
    const ROUTE_PATH = 'api/lan-mesh';

    /**
     * Generate a correlation id.
     *
     * `randomUUID` is only exposed in secure contexts, and a LAN deployment is
     * often plain HTTP, so fall back to the same construction the Host uses.
     * @returns {string} an RFC 4122 version 4 uuid.
     */
    function rpcId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const view = new DataView(bytes.buffer);
      view.setUint8(6, (view.getUint8(6) & 15) | 64);
      view.setUint8(8, (view.getUint8(8) & 63) | 128);
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    /**
     * Call one Host endpoint over the page's authenticated connection.
     *
     * The route only admits the owner principal, so the browser's own cookie is
     * the credential: a plain same-origin POST is all this needs.
     *
     * @param {string} endpoint - endpoint name, e.g. `snapshot`.
     * @param {object} payload - endpoint arguments.
     * @returns {Promise<object>} the endpoint value; throws on failure.
     */
    async function panelCall(endpoint, payload) {
      const id = rpcId();
      const response = await fetch(ROUTE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          type: 'client-request',
          rpcId: id,
          method: endpoint,
          payload: { method: endpoint, payload: payload ?? {} },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body === null || typeof body !== 'object' || body.type !== 'server-response') {
        throw new Error('unexpected response');
      }
      if (body.rpcId !== id) throw new Error('response mismatch');
      const result = body.result;
      if (result && result.ok === true) return result.value;
      throw new Error(result?.error?.message ?? 'request failed');
    }

    /**
     * The panel body: a persistent room rail on the left, the selected room (or
     * the node view when nothing is selected) on the right.
     * @param {object} props - slot props; carries the client services the panel needs.
     * @returns {object} panel element.
     */
    function MeshPanel(props) {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: '' });
      const [sessions, setSessions] = React.useState([]);
      const [sessionId, setSessionId] = React.useState(() => readStoredSession());
      const [selectedRoom, setSelectedRoom] = React.useState('');
      const [createOpen, setCreateOpen] = React.useState(false);
      const [newName, setNewName] = React.useState('');
      const [newTopic, setNewTopic] = React.useState('');
      const [joinBusy, setJoinBusy] = React.useState('');
      const [railNotice, setRailNotice] = React.useState('');
      const [railNoticeBad, setRailNoticeBad] = React.useState(false);
      const [agents, setAgents] = React.useState({ local: [], remote: [] });
      const [agentBusy, setAgentBusy] = React.useState('');
      const [agentNotice, setAgentNotice] = React.useState('');
      const [agentNoticeBad, setAgentNoticeBad] = React.useState(false);
      const [newCwd, setNewCwd] = React.useState('');
      const [newTitle, setNewTitle] = React.useState('');
      const [workspaces, setWorkspaces] = React.useState([]);
      const [selfNickname, setSelfNickname] = React.useState('');
      const [target, setTarget] = React.useState('');
      const [text, setText] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [sendNotice, setSendNotice] = React.useState('');

      const call = React.useCallback(async (endpoint, payload) => panelCall(endpoint, payload), []);

      const refresh = React.useCallback(async () => {
        try {
          const value = await call('snapshot', sessionId === '' ? {} : { sessionId });
          setState({ status: 'ready', data: value, error: '' });
        } catch (error) {
          setState((current) => ({ status: 'error', data: current.data, error: errorText(error) }));
        }
      }, [call, sessionId]);

      const loadSessions = React.useCallback(async () => {
        try {
          const value = await call('sessions');
          const list = Array.isArray(value?.sessions)
            ? value.sessions.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string')
            : [];
          setSessions(list);
          // Keep the remembered session when it still exists; otherwise fall
          // back to the human identity. Rooms are built around "me" by default,
          // not around whichever agent session happens to be listed first.
          setSessionId((current) => {
            if (current !== '' && (current === HUMAN_SESSION_ID || list.some((row) => row.id === current))) return current;
            return HUMAN_SESSION_ID;
          });
        } catch (error) {
          setSessions([]);
          setRailNotice(`${COPY.error}: ${errorText(error)}`);
          setRailNoticeBad(true);
        }
      }, [call]);

      const flashRail = React.useCallback((message, bad) => {
        setRailNotice(message);
        setRailNoticeBad(bad === true);
      }, []);

      const flashAgent = React.useCallback((message, bad) => {
        setAgentNotice(message);
        setAgentNoticeBad(bad === true);
      }, []);

      /**
       * Load the agent catalogue.
       *
       * Kept out of the snapshot poll on purpose: the host asks every peer for
       * its listing, which is one round trip per node.
       */
      const loadAgents = React.useCallback(async () => {
        try {
          const value = await call('agents');
          setAgents({
            local: Array.isArray(value?.agents) ? value.agents : [],
            remote: Array.isArray(value?.remote) ? value.remote : [],
          });
        } catch (error) {
          setAgents({ local: [], remote: [] });
          flashAgent(`${COPY.error}: ${errorText(error)}`, true);
        }
      }, [call, flashAgent]);

      /**
       * Load the workspaces this host already knows about.
       *
       * A new agent is just a new session, and a session belongs to a workspace
       * that exists on disk — picking one is more reliable than retyping a path.
       */
      const loadWorkspaces = React.useCallback(async () => {
        try {
          const value = await call('workspaces');
          const list = Array.isArray(value?.workspaces) ? value.workspaces : [];
          setWorkspaces(list.filter((row) => row !== null && typeof row === 'object' && typeof row.path === 'string'));
        } catch (error) {
          setWorkspaces([]);
          flashAgent(`${COPY.error}: ${errorText(error)}`, true);
        }
      }, [call, flashAgent]);

      React.useEffect(() => {
        installStyles();
      }, []);

      // Keep the nickname input in step with what the host already knows, so a
      // saved name survives a reload instead of showing a blank box.
      React.useEffect(() => {
        const name = typeof state.data?.self?.selfName === 'string' ? state.data.self.selfName : '';
        setSelfNickname((current) => (current === '' ? name : current));
      }, [state.data?.self?.selfName]);

      React.useEffect(() => {
        loadSessions();
        loadAgents();
        loadWorkspaces();
      }, [loadSessions, loadAgents, loadWorkspaces]);

      React.useEffect(() => {
        if (sessionId === '') return;
        storeSession(sessionId);
      }, [sessionId]);

      React.useEffect(() => {
        let live = true;
        const tick = () => {
          if (live) refresh();
        };
        tick();
        const stop = every(4000, tick);
        return () => {
          live = false;
          stop();
        };
      }, [refresh]);

      // A different session has different rooms; the open one is almost never
      // still visible, and reading the first is cheaper than a wrong pane.
      React.useEffect(() => {
        setSelectedRoom('');
      }, [sessionId]);

      const refreshAll = () => {
        loadSessions();
        refresh();
        loadAgents();
      };

      const bringInAgent = async (row) => {
        setAgentBusy(`import:${row.id}`);
        flashAgent('', false);
        try {
          const value = await call('agentImport', { session: row.id, name: row.name });
          flashAgent(`${COPY.agentsImported}: ${value?.agent?.name ?? row.id}`, false);
          await loadAgents();
        } catch (error) {
          flashAgent(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setAgentBusy('');
        }
      };

      const createAgent = async () => {
        if (newCwd.trim() === '') {
          flashAgent(COPY.agentsNeedWorkspace, true);
          return;
        }
        if (newTitle.trim() === '') {
          flashAgent(COPY.agentsNeedTitle, true);
          return;
        }
        setAgentBusy('create');
        flashAgent('', false);
        try {
          const value = await call('agentImport', { cwd: newCwd.trim(), title: newTitle.trim() });
          setNewTitle('');
          flashAgent(`${COPY.agentsCreated}: ${value?.agent?.title || value?.agent?.name || ''}`, false);
          await loadAgents();
          await loadSessions();
        } catch (error) {
          flashAgent(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setAgentBusy('');
        }
      };

      /**
       * Store the person's own display name for this node.
       *
       * Saved on blur so typing does not hammer the host, and the label is what
       * peers show for the human member in a room.
       */
      const saveSelfNickname = async (name) => {
        try {
          await call('nickname', { self: true, name: name.trim() });
          await refresh();
        } catch (error) {
          flashRail(`${COPY.error}: ${errorText(error)}`, true);
        }
      };

      const dialAgent = async (row) => {
        // The dial prompt comes from the message box: one dialog, one instruction.
        if (text.trim() === '') {
          flashAgent(COPY.agentsNeedText, true);
          return;
        }
        setAgentBusy(`dial:${row.id}`);
        flashAgent('', false);
        try {
          await call('agentDial', {
            target: `${row.nodeId}/${row.id}`,
            text,
            topic: target.trim(),
          });
          setText('');
          flashAgent(`${COPY.agentsDialed}: ${row.name || row.id}`, false);
          await loadAgents();
        } catch (error) {
          flashAgent(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setAgentBusy('');
        }
      };

      const send = async () => {
        if (target.trim() === '' || text.trim() === '') {
          setSendNotice(COPY.empty);
          return;
        }
        setBusy(true);
        setSendNotice('');
        try {
          const report = await call('send', { target: target.trim(), text });
          const rows = Array.isArray(report?.delivered) ? report.delivered : [];
          const failed = rows.filter((row) => row.ok !== true);
          setSendNotice(failed.length === 0 ? COPY.sent : `${COPY.error}: ${failed[0].error ?? ''}`);
          if (failed.length === 0) setText('');
          await refresh();
        } catch (error) {
          setSendNotice(`${COPY.error}: ${errorText(error)}`);
        } finally {
          setBusy(false);
        }
      };

      const markRead = async () => {
        try {
          await call('markRead');
          await refresh();
        } catch (error) {
          setSendNotice(`${COPY.error}: ${errorText(error)}`);
        }
      };

      const doCreate = async () => {
        if (newName.trim() === '') {
          flashRail(COPY.needRoomName, true);
          return;
        }
        setRailNotice('');
        setJoinBusy('create');
        try {
          const value = await call('roomCreate', {
            name: newName.trim(),
            topic: newTopic.trim(),
            sessionId,
            sessionName: sessionId,
          });
          const room = value?.room;
          setNewName('');
          setNewTopic('');
          setCreateOpen(false);
          if (room !== null && typeof room === 'object' && typeof room.id === 'string') setSelectedRoom(room.id);
          flashRail(`${COPY.created}${typeof room?.name === 'string' && room.name !== '' ? `: ${room.name}` : ''}`, false);
          await refresh();
        } catch (error) {
          flashRail(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setJoinBusy('');
        }
      };

      const joinRoom = async (roomId) => {
        setJoinBusy(roomId);
        setRailNotice('');
        try {
          const value = await call('roomJoin', {
            room: roomId,
            sessionId,
            sessionName: sessionId,
          });
          const room = value?.room;
          if (room !== null && typeof room === 'object' && typeof room.id === 'string') setSelectedRoom(room.id);
          flashRail(value?.added === false ? COPY.alreadyMember : COPY.joined, false);
          await refresh();
        } catch (error) {
          flashRail(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setJoinBusy('');
        }
      };

      const data = state.data;
      const self = data?.self;
      const peers = Array.isArray(data?.peers) ? data.peers : [];
      const inbox = Array.isArray(data?.inbox?.messages) ? data.inbox.messages : [];
      const unreadCount = typeof data?.inbox?.unread === 'number' ? data.inbox.unread : 0;
      const rooms = Array.isArray(data?.rooms?.mine) ? data.rooms.mine : [];
      const allRooms = Array.isArray(data?.rooms?.all) ? data.rooms.all : [];
      const unreadMap = data?.rooms?.unread !== null && typeof data?.rooms?.unread === 'object' ? data.rooms.unread : {};
      const attention = Array.isArray(data?.attention?.messages) ? data.attention.messages : [];
      const mineIds = rooms.map((room) => room?.id);
      const joinable = allRooms.filter(
        (room) =>
          room !== null && typeof room === 'object' && room.isMember !== true && !mineIds.includes(room.id),
      );
      const selected = rooms.find((room) => room.id === selectedRoom);
      const canUseRooms = sessionId !== '';

      return h(
        'div',
        { className: 'lm-root' },
        h(Rail, {
          self,
          sessions,
          sessionId,
          onSession: setSessionId,
          onRefresh: refreshAll,
          rooms,
          joinable,
          attention,
          selfNickname,
          onSelfNickname: setSelfNickname,
          onSelfNicknameSave: () => saveSelfNickname(selfNickname),
          // Reading a room clears its badge on the host, so the count shown for
          // the open room drops to zero without waiting for the next snapshot.
          unread: selected === undefined ? unreadMap : { ...unreadMap, [selected.id]: 0 },
          activeId: selectedRoom,
          onSelect: setSelectedRoom,
          joinBusy,
          onJoin: joinRoom,
          createOpen,
          newName,
          newTopic,
          createBusy: joinBusy === 'create',
          onNewName: setNewName,
          onNewTopic: setNewTopic,
          onCreate: doCreate,
          onCreateOpen: setCreateOpen,
          railNotice,
          railNoticeBad,
        }),
        h(
          'div',
          { className: 'lm-main' },
          selected !== undefined
            ? h(RoomPane, {
                key: selected.id,
                room: selected,
                sessionId,
                self,
                call,
                localAgents: agents.local,
                onChanged: refresh,
                onExited: () => setSelectedRoom(''),
                onOpenSession: props?.openSession,
              })
            : h(EmptyPane, {
                peers,
                agents,
                messages: inbox,
                unread: unreadCount,
                target,
                text,
                busy,
                sendNotice,
                agentBusy,
                agentNotice,
                agentNoticeBad,
                newCwd,
                newTitle,
                workspaces,
                onNewCwd: setNewCwd,
                onNewTitle: setNewTitle,
                onTarget: setTarget,
                onText: setText,
                onSend: send,
                onMarkRead: markRead,
                onRefresh: refreshAll,
                onImport: bringInAgent,
                onDial: dialAgent,
                onCreateAgent: createAgent,
              }),
          canUseRooms ? null : h('div', { className: 'lm-muted', style: { padding: '0 20px 16px' } }, COPY.noSessions),
          state.status === 'error'
            ? h('div', { className: 'lm-error lm-note', style: { padding: '0 20px 16px' } }, `${COPY.error}: ${state.error}`)
            : null,
        ),
      );
    }

    return {
      name: 'dsh-lan-mesh',
      // `slots` is the only thing this half cannot work without. Navigation
      // services are looked up per click, because requiring them at boot makes
      // the whole Web UI fail to start on a profile that never mounts them.
      inject: ['slots'],
      apply(ctx) {
        // Nothing here may throw: a rejected apply fails the entire web boot
        // ("1 entry did not activate"), which is far worse than a quiet panel.
        try {
          // The navigation services are optional and are read at click time.
          const serviceOf = (name) => {
            try {
              const service = ctx.get(name);
              return service === undefined ? undefined : service;
            } catch (error) {
              void error;
              return undefined;
            }
          };
          const openSession = (id) => {
            const uiWorkspace = serviceOf('uiWorkspace');
            if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') return false;
            try {
              uiWorkspace.openSession(id);
            } catch (error) {
              console.error('[dsh-lan-mesh] cannot open that session', error);
              return false;
            }
            const layout = serviceOf('layout');
            try {
              if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(null);
            } catch (error) {
              console.error('[dsh-lan-mesh] cannot leave the panel', error);
            }
            return true;
          };
          const register = (what, effect) => {
            try {
              ctx.effect(effect);
            } catch (error) {
              console.error(`[dsh-lan-mesh] cannot register ${what}`, error);
            }
          };
          // `slots.inject` waits for the owner to declare the slot. Registering
          // straight into an undeclared slot leaves a pending entry the sidebar's
          // projection never sees, which is how this icon once went missing.
          register('the room panel', () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: 'dsh-lan-mesh' }, () => h(MeshPanel, { openSession })),
            ),
          );
          register('the sidebar icon', () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: 'dsh-lan-mesh',
                  order: 40,
                  label: () => COPY.title,
                },
                MeshIcon,
              ),
            ),
          );
        } catch (error) {
          console.error('[dsh-lan-mesh] cannot start the panel', error);
        }
      },
    };
  },
});
