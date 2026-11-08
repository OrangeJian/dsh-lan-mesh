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

    // Try to load DSH native UI primitives for visual consistency. All of these
    // are optional: if the shell doesn't expose them, we fall back to our own
    // styled elements so the panel still works.
    let DshButton;
    let DshInput;
    let DshTextarea;
    let DshSelect;
    let DshCheckbox;
    let DshBadge;
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
      DshButton = primitives.Button;
      DshInput = primitives.Input;
      DshTextarea = primitives.Textarea;
      DshSelect = primitives.Select;
      DshCheckbox = primitives.Checkbox;
      DshBadge = primitives.Badge;
    } catch (error) {
      // Not available — stick with our custom-styled elements.
      void error;
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
          openRoom: '打开房间',
          refresh: '刷新',
          unread: '未读',
          port: '端口',
          secured: '需要口令',
          open: '开放',
          from: '来自',
          to: '发给',
          error: '出错了',
          empty: '请输入目标和内容',
          // identity + rail
          identity: '本机身份',
          you: '你的会话',
          me: '我',
          noSession: '未选择会话',
          myRooms: '我的房间',
          noMineRooms: '还没有加入任何房间。',
          // pending notifications (reserved notify extension point)
          notifyTitle: '待确认通知',
          notifyHint: '本机有多个通知渠道，选一个再发送：',
          notifySend: '发送',
          notifyDismiss: '忽略',
          notifySent: '已通知',
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
          kick: '踢出',
          kicking: '踢出中…',
          kicked: '已踢出',
          kickHint: '把成员移出这个房间',
          mentionAll: '所有成员',
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
          save: '保存',
          assign: '派活',
          assignee: '指派给',
          taskTitleHint: '一句话说清要做什么',
          taskDetailHint: '可选：验收标准、相关文件',
          assignAction: '分配',
          assigning: '分配中…',
          assigned: '任务已分配',
          needTaskTitle: '请输入任务标题',
          quickTaskLabel: '设为任务',
          taskFailed: '创建任务失败',
          // file sharing
          attachFile: '添加附件',
          fileTooLarge: '文件过大，单条消息最多支持约 180KB 的附件',
          fileName: '文件名',
          fileSize: '大小',
          download: '下载',
          removeFile: '移除',
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
          // nicknames
          nickname: '称呼',
          nicknameHint: '你叫它什么',
          nicknameSelf: '你的称呼',
          nicknameSelfHint: '房间里别人看到的名字',
          nicknameSaved: '已保存',
          // p2p
          selfOption: '我 (本人)',
          // navigation (v0.2.0)
          navRooms: '我的房间',
          navInbox: '收件箱',
          navBoard: '任务看板',
          navBack: '← 返回',
          // takeover sidebar (v0.3.0)
          conversation: '对话',
          exitHint: '回到原生对话',
          projects: '项目',
          joinableShort: '可加入',
          noAgentsRail: '还没有 Agent',
          sessionUnavailable: '打不开这个会话',
          inboxHint: '你参与的对话与项目活动会汇总在这里',
          boardHint: '所有项目里派给成员的任务',
          agentsHint: '常驻本机的会话，以及被拉进项目的会话。',
          agentsResident: '常驻',
          agentsInRoomsUnit: '个项目',
          emptyInboxTitle: '收件箱为空',
          emptyBoard: '还没有任务。进入房间后 leader 可以拆任务派给成员。',
          boardAcross: '跨房间任务汇总',
          boardNoRooms: '还没有加入任何房间，没有可汇总的任务。',
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
          openRoom: 'Open room',
          refresh: 'Refresh',
          unread: 'unread',
          port: 'port',
          secured: 'secret required',
          open: 'open',
          from: 'from',
          to: 'to',
          error: 'Failed',
          empty: 'Fill in a target and a message',
          identity: 'This node',
          you: 'Your session',
          me: 'me',
          noSession: 'no session picked',
          selfOption: 'Me (this human)',
          myRooms: 'My rooms',
          noMineRooms: 'Not in a room yet.',
          // pending notifications (reserved notify extension point)
          notifyTitle: 'Notifications to confirm',
          notifyHint: 'Several local channels found — pick one before sending:',
          notifySend: 'Send',
          notifyDismiss: 'Dismiss',
          notifySent: 'Notified',
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
          kick: 'Kick',
          kicking: 'Kicking…',
          kicked: 'Kicked',
          kickHint: 'Remove this member from the room',
          mentionAll: 'everyone',
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
          save: 'Save',
          assign: 'Assign a task',
          assignee: 'Assign to',
          taskTitleHint: 'One line saying what has to be done',
          taskDetailHint: 'Optional: acceptance criteria, files',
          assignAction: 'Assign',
          assigning: 'Assigning…',
          assigned: 'Task assigned',
          needTaskTitle: 'Enter a task title',
          quickTaskLabel: 'Mark as task',
          taskFailed: 'Failed to create task',
          // file sharing
          attachFile: 'Attach file',
          fileTooLarge: 'File too large — max ~180 KB per message',
          fileName: 'File name',
          fileSize: 'Size',
          download: 'Download',
          removeFile: 'Remove',
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
          nickname: 'Nickname',
          nicknameHint: 'What you call it',
          nicknameSelf: 'Your name',
          nicknameSelfHint: 'What the room shows for you',
          nicknameSaved: 'Saved',
          // navigation (v0.2.0)
          navRooms: 'My rooms',
          navInbox: 'Inbox',
          navBoard: 'Task board',
          navBack: '← Back',
          // takeover sidebar (v0.3.0)
          conversation: 'Chat',
          exitHint: 'Back to the conversation',
          projects: 'Projects',
          joinableShort: 'Joinable',
          noAgentsRail: 'No agent yet',
          sessionUnavailable: 'Could not open that session',
          inboxHint: 'Activity from your conversations and projects lands here',
          boardHint: 'Tasks handed to members across every project',
          agentsHint: 'Sessions kept on this node, and sessions pulled into a project.',
          agentsResident: 'resident',
          agentsInRoomsUnit: 'projects',
          emptyInboxTitle: 'Inbox is empty',
          emptyBoard: 'No tasks yet. The leader of a room can split the work into tasks for members.',
          boardAcross: 'Tasks across all rooms',
          boardNoRooms: 'Not in any room yet, so there are no tasks to summarise.',
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
    /** The session id the backend reserves for "me, the human". */
    const HUMAN_SESSION_ID = 'human';
    const CSS = `
.lm-panel{display:flex;width:100%;height:100%;min-height:0;min-width:0;overflow:hidden;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;background:var(--dsw-alias-bg-base)}
/* lanmesh mode takes the shell's New Session button and global panel rail off
   the left column, the same contract dsh-agent-team uses with
   html[data-agent-team-mode='team']: those two address the profile rather
   than the mesh, and the rail's own "对话" row is the way back. Both key off
   the html attribute this client owns, never a localized label. */
html[data-lan-mesh-mode='lanmesh'] button[class*='newSession'],
html[data-lan-mesh-mode='lanmesh'] nav[class*='panelList']{display:none}
/* The sidebar entry is a bare icon inside the shell's own row: the shell draws
   the row chrome, so the button must not add a browser-default box. */
.lm-panelHandle{display:inline-flex;align-items:center;justify-content:center;gap:0;border:0;background:transparent;padding:0;margin:0;color:inherit;cursor:pointer}
/* The overlay layer itself is pointer-events:none — children must opt in. */
.lm-railOverlay{position:absolute;left:0;top:0;bottom:0;width:300px;pointer-events:auto;z-index:20;overflow:hidden;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l1)}
.lm-rail{width:100%;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:12px;overflow:auto;background:transparent}
.lm-ident{display:flex;flex-direction:column;gap:2px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-identName{font-weight:600}
.lm-clickable{cursor:pointer;transition:opacity .15s ease}
.lm-clickable:hover{opacity:.8}
.lm-identMeta{color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}
.lm-railTitle{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}
.lm-nav{display:flex;flex-direction:column;gap:2px;padding:4px 0 8px}
.lm-navBtn{display:flex;align-items:center;gap:8px;border:0;background:none;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;padding:7px 10px;border-radius:8px;text-align:left;transition:all .12s ease}
.lm-navBtn:hover{background:var(--dsw-alias-bg-layer-2)}
.lm-navBtnActive{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600;box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.lm-navCount{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:18px;text-align:center;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);line-height:16px}
.lm-backBtn{border:0;background:none;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;padding:2px 6px;border-radius:6px;text-align:left}
.lm-backBtn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.lm-railList{display:flex;flex-direction:column;gap:2px}
.lm-railIdent{margin-top:auto;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:0}
.lm-railEmpty{font-size:12px;padding:2px 4px}
.lm-notify{gap:6px;padding:8px 6px;border:1px solid var(--dsw-alias-state-warn);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.lm-notifyItem{display:flex;flex-direction:column;gap:4px;padding:4px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.lm-notifyItem:first-of-type{border-top:0}
.lm-notifyText{font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.lm-notifyHint{font-size:11px}
.lm-notifyChannel{text-align:left}
.lm-notifyDismiss{align-self:flex-start;color:var(--dsw-alias-label-secondary)}
.lm-brand{display:flex;align-items:baseline;gap:8px;padding:2px 2px 8px}
.lm-brandTitle{font-size:14px;font-weight:700}
.lm-brandMeta{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-conversation{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);justify-content:center;margin-bottom:4px}
.lm-railSection{display:flex;flex-direction:column;gap:4px}
.lm-sectionAdd{margin-left:auto;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:1;cursor:pointer;padding:1px 6px;border-radius:6px}
.lm-sectionAdd:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.lm-sectionAdd:disabled{opacity:.4;cursor:default}
.lm-agentRow{padding:5px 9px}
.lm-agentName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-agentMeta{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.lm-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}
.lm-roomPane{display:flex;flex-direction:column;flex:1;min-height:0}
.lm-roomHead{display:flex;flex-direction:column;gap:6px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-roomTitleRow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.lm-roomTitle{font-size:15px;font-weight:600}
.lm-roomTopicText{color:var(--dsw-alias-label-secondary);font-size:12px}
.lm-roomHeadBtns{display:flex;gap:6px;margin-left:auto}
.lm-memberRow{display:flex;flex-wrap:wrap;gap:6px}
.lm-memberPanel{border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px 0;margin:4px 0;display:flex;flex-direction:column;gap:8px}
.lm-memberChip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;font-size:12px;background:var(--dsw-alias-bg-layer-1)}
.lm-memberChipSelf{border-color:var(--dsw-alias-brand-primary)}
.lm-inviteRow{display:flex;align-items:center;gap:6px;padding-top:8px;font-size:12px}
.lm-leaderTag{color:var(--dsw-alias-brand-primary);font-size:10px;font-weight:600}
.lm-mdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.lm-mdotIdle{background:var(--dsw-alias-state-idle-primary)}
.lm-openSession{padding:0 6px;font-size:10px;border-radius:6px;line-height:16px}
.lm-kickBtn{padding:0 6px;font-size:10px;border-radius:6px;line-height:16px;border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);margin-left:2px}
.lm-nickBtn{padding:0 4px;font-size:10px;border-radius:6px;line-height:14px;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}
.lm-nickBtn:hover{color:var(--dsw-alias-brand-primary)}
.lm-nickEdit{padding:6px 0 0}
.lm-nickRow{display:flex;align-items:center;gap:6px;margin-top:2px}
.lm-inputSmall{padding:2px 6px;font-size:11px}
.lm-tasksWrap{border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px 16px;max-height:42%;overflow:auto;flex:0 0 auto}
.lm-sectionHead{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:0;background:none;font:inherit;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);cursor:pointer}
.lm-taskList{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.lm-chat{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;padding:14px 18px;overflow:auto}
.lm-bubbleRow{display:flex;flex-direction:column;gap:4px;max-width:78%;align-self:flex-start;align-items:flex-start}
.lm-bubbleRowMine{align-self:flex-end;align-items:flex-end}
.lm-bubbleMeta{font-size:12px;color:var(--dsw-alias-label-secondary);padding:0 2px}
.lm-bubbleWho{font-weight:700;font-size:13px;color:var(--dsw-alias-label-primary)}
.lm-bubbleWhoHuman{color:var(--dsw-alias-brand-primary)}
.lm-bubbleWhoAgent{color:var(--dsw-alias-state-success-primary)}
.lm-bubbleWhen{font-weight:400;color:var(--dsw-alias-label-secondary)}
.lm-bubble{padding:9px 13px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);word-break:break-word;font-size:13px;line-height:1.6;max-width:100%;overflow-x:auto}
/* The pane sits close to layer-1/2, so each speaker kind gets a tint that is
   unmistakable: people read blue, agents read green, system notices stay grey.
   A message synced from another machine keeps its speaker's tint. */
.lm-bubbleHuman{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,var(--dsw-alias-border-l1))}
.lm-bubbleAgent{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,var(--dsw-alias-border-l1))}
.lm-bubbleSystem{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.lm-bubbleMine{border-color:var(--dsw-alias-brand-primary)}
.lm-bubblePlain{white-space:pre-wrap}
.lm-composer{display:flex;flex-direction:column;align-items:center;padding:0 16px 12px}
/* Composer card, matching dsh-agent-team's composer.module.css: the shell's
   input fill, a hairline drawn by the elevation stroke rather than a border,
   22px radius, and a 780px cap so a wide panel keeps a readable line length. */
.lm-composerCard{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;max-width:780px;box-sizing:border-box;padding:10px 0 0;border:0;border-radius:var(--dsw-radius-panel,22px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-elevation-soft);container-type:inline-size}
.lm-composerInput{display:block;width:100%;box-sizing:border-box;min-height:28px;max-height:336px;padding:4px 12px 0 16px;border:0;outline:0;resize:none;overflow-y:auto;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:24px;white-space:pre-wrap;overflow-wrap:anywhere}
.lm-composerInput::placeholder{color:var(--dsw-alias-label-tertiary)}
.lm-composerToolbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;min-height:34px;padding:2px 8px 6px}
.lm-attachBtn{display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;border-radius:999px;background:var(--dsw-specific-selector,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer}
.lm-attachBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lm-attachBtn .lm-fileInput{display:none}
.lm-taskPill{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px 0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer}
.lm-taskPill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lm-taskPillOn,.lm-taskPillOn:hover{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.lm-sendBtn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;margin-left:auto;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)));color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer;transition:background-color 100ms ease,opacity 100ms ease}
.lm-sendBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.lm-sendBtn:disabled{cursor:default;opacity:.4}
.lm-sendIcon{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@container (max-width:560px){.lm-composerToolbar{gap:8px}}
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
/* The inbox list scrolls inside itself, so the pane must not scroll twice. */
.lm-inboxPane{overflow:hidden}
.lm-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.lm-title{font-size:16px;font-weight:600}
.lm-formTitle{font-weight:600;margin-top:6px}
.lm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;transition:border-color .15s ease}
.lm-card:hover{border-color:var(--dsw-alias-border-l2)}
.lm-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.lm-cardTitle{font-weight:600}
.lm-btn{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 12px;cursor:pointer;transition:all .15s ease;line-height:1.4}
.lm-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.lm-btn:disabled{opacity:.5;cursor:default}
.lm-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:500}
.lm-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);opacity:.9;border-color:var(--dsw-alias-brand-primary)}
.lm-btnSmall{padding:2px 7px;font-size:11px;border-radius:5px}
.lm-peers{display:flex;flex-direction:column;gap:6px}
.lm-peer{display:flex;align-items:baseline;gap:8px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.lm-peerName{font-weight:600}
.lm-peerMeta{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.lm-dotIdle{background:var(--dsw-alias-label-secondary)}
.lm-muted{color:var(--dsw-alias-label-secondary)}
.lm-input,.lm-textarea,.lm-select{font:inherit;width:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:7px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.lm-input:focus,.lm-textarea:focus,.lm-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.lm-select{padding:5px 8px;cursor:pointer}
.lm-textarea{min-height:84px;resize:vertical;font-family:inherit}
.lm-textareaShort{min-height:52px}
.lm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}
.lm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lm-msgs{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto}
/* Standalone inbox: grow to fill the pane instead of capping at 340px. */
.lm-msgsPane{max-height:none;flex:1;min-height:0}
.lm-msg{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px}
.lm-msgUnread{border-color:var(--dsw-alias-brand-primary)}
.lm-msgOut{margin-left:24px;background:var(--dsw-alias-fill-l2);border-color:var(--dsw-alias-border-l2)}
.lm-msgRoom{border-left:3px solid var(--dsw-alias-brand-primary)}
.lm-msgJump{cursor:pointer;transition:border-color .15s ease,background .15s ease}
.lm-msgJump:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.lm-msgJump:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.lm-msgJumpHint{color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0}
.lm-msgJump:hover .lm-msgJumpHint,.lm-msgJump:focus-visible .lm-msgJumpHint{opacity:1}
.lm-msgHead{display:flex;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px;align-items:center;flex-wrap:wrap}
.lm-msgFrom{color:var(--dsw-alias-label-secondary)}
.lm-msgFrom strong{color:var(--dsw-alias-label-primary);font-weight:600}
.lm-msgRoomTag{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:500;white-space:nowrap}
.lm-msgText{white-space:pre-wrap;word-break:break-word}
/* Long bodies clamp to three lines; the toggle below opens the full text. */
.lm-msgTextClamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.lm-msgToggle{font:inherit;font-size:11px;color:var(--dsw-alias-brand-primary);background:none;border:0;padding:0;margin-top:6px;cursor:pointer;line-height:1.4}
.lm-msgToggle:hover{text-decoration:underline}
.lm-error{color:var(--dsw-alias-state-error-primary)}
.lm-ok{color:var(--dsw-alias-state-success-primary)}
.lm-icon{display:block}
.lm-session{display:flex;align-items:center;gap:6px;font-size:12px}
.lm-session .lm-select{width:auto;max-width:190px}
.lm-note{font-size:12px;margin:6px 0}
.lm-badge{font-size:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);white-space:nowrap}
.lm-badgeBtn{cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:border-color .15s ease}
.lm-badgeBtn:hover{border-color:var(--dsw-alias-brand-primary)}
.lm-caret{font-size:9px;opacity:.6}
.lm-badgeLeader{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.lm-task{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-base)}
.lm-taskHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lm-taskTitle{font-weight:600}
.lm-taskAssignee{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-taskDetail{margin-top:5px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.lm-status{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid currentColor;white-space:nowrap}
.lm-statusOpen{color:var(--dsw-alias-state-idle-primary)}
.lm-statusDoing{color:var(--dsw-alias-brand-primary)}
.lm-statusBlocked{color:var(--dsw-alias-state-warn-primary)}
.lm-statusDone{color:var(--dsw-alias-state-success-primary)}
.lm-statusBtns{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
/* file attachments */
.lm-fileInput{display:none}
.lm-fileChip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px}
.lm-fileChipName{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-fileChipSize{color:var(--dsw-alias-label-secondary);font-size:11px}
.lm-fileChipRemove{border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;padding:0 2px;line-height:1}
.lm-fileChipRemove:hover{color:var(--dsw-alias-state-error-primary)}
.lm-attachment{margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:10px}
.lm-attachIcon{font-size:18px;flex:0 0 auto}
.lm-attachInfo{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.lm-attachName{font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-attachMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-attachDl{font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;flex:0 0 auto}
.lm-attachDl:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.lm-composerTools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 8px 0}
`;

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
     * Format a byte count into a human-readable string.
     * @param {number} bytes - file size in bytes.
     * @returns {string}
     */
    function formatFileSize(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Pick an emoji icon for a file based on its MIME type or extension.
     * @param {string} type - MIME type.
     * @param {string} name - file name.
     * @returns {string}
     */
    function fileIcon(type = '', name = '') {
      const t = String(type).toLowerCase();
      const n = String(name).toLowerCase();
      if (t.startsWith('image/')) return '🖼️';
      if (t.startsWith('audio/')) return '🎵';
      if (t.startsWith('video/')) return '🎬';
      if (t.includes('pdf')) return '📄';
      if (t.includes('zip') || t.includes('rar') || t.includes('7z') || t.includes('tar')) return '📦';
      if (n.endsWith('.js') || n.endsWith('.ts') || n.endsWith('.jsx') || n.endsWith('.tsx')) return '📜';
      if (n.endsWith('.py') || n.endsWith('.java') || n.endsWith('.go') || n.endsWith('.rs')) return '📜';
      if (n.endsWith('.json') || n.endsWith('.yaml') || n.endsWith('.yml') || n.endsWith('.xml')) return '⚙️';
      if (n.endsWith('.md') || n.endsWith('.txt') || n.endsWith('.rtf')) return '📝';
      if (n.endsWith('.csv') || n.endsWith('.xlsx') || n.endsWith('.xls')) return '📊';
      if (n.endsWith('.docx') || n.endsWith('.doc')) return '📘';
      return '📎';
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
     * Pick which agent session the panel speaks as. v0.2.0: the panel always
     * acts as the human, so there is no picker.
     */
    // (removed in v0.2.0 — the panel is always the human)

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
      // Only the room leader may kick, and never another leader or the
      // current viewer themselves. Local agent members can also be kicked.
      const kickable =
        props.isLeader === true &&
        member.role !== 'leader' &&
        member.sessionId !== props.sessionId &&
        props.onKick !== undefined &&
        props.busy !== 'kick';
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
        kickable
          ? h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnSmall lm-kickBtn',
                title: COPY.kickHint,
                disabled: props.busy === `kick:${member.key}`,
                onClick: () => props.onKick(member),
              },
              props.busy === `kick:${member.key}` ? COPY.kicking : COPY.kick,
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
      * @param {object} props - message plus ownership flag and optional sender label.
      * @returns {object} bubble element.
      */
     function ChatBubble(props) {
       const message = props.message;
       // Own messages show "我" / "me" instead of the user's own name — every
       // chat app does this, and it removes the "why am I talking to myself"
       // confusion when the room has several local members.
       let sender;
       if (props.mine === true) {
         sender = props.selfLabel || COPY.me;
       } else if (typeof props.senderLabel === 'string' && props.senderLabel !== '') {
         sender = props.senderLabel;
       } else {
         sender = senderOf(message);
       }
       const text = String(message.text ?? '');
       const body =
         text === ''
           ? null
           : MarkdownText === undefined
           ? h('div', { className: 'lm-bubblePlain' }, text)
           : h(MarkdownText, { text, labels: markdownLabels() });
       // File attachment block: renders below the text when present.
       const file = message?.file && typeof message.file === 'object' ? message.file : null;
       const attachment =
         file === null
           ? null
           : h(
               'div',
               { className: 'lm-attachment' },
               h('span', { className: 'lm-attachIcon' }, fileIcon(file.type, file.name)),
               h(
                 'div',
                 { className: 'lm-attachInfo' },
                 h('div', { className: 'lm-attachName', title: file.name }, file.name),
                 h('div', { className: 'lm-attachMeta' }, formatFileSize(file.size)),
               ),
               file.data
                 ? h(
                     'a',
                     {
                       className: 'lm-attachDl',
                       href: file.data,
                       download: file.name,
                       title: COPY.download,
                     },
                     COPY.download,
                   )
                 : null,
             );
       const bubbleContents = [];
       if (body !== null) bubbleContents.push(body);
       if (attachment !== null) bubbleContents.push(attachment);
       // Who spoke decides the tint: a person and an agent read differently at
       // a glance, and the rule follows the session, so a message synced from
       // another machine keeps its speaker's colour.
       const kind = props.kind === 'human' || props.kind === 'agent' ? props.kind : 'system';
       const bubbleClass =
         'lm-bubble lm-bubble' + (kind === 'human' ? 'Human' : kind === 'agent' ? 'Agent' : 'System') +
         (props.mine === true ? ' lm-bubbleMine' : '');
       return h(
         'div',
         { className: props.mine ? 'lm-bubbleRow lm-bubbleRowMine' : 'lm-bubbleRow' },
         h(
           'div',
           { className: 'lm-bubbleMeta' },
           h('strong', { className: 'lm-bubbleWho lm-bubbleWho' + (kind === 'human' ? 'Human' : kind === 'agent' ? 'Agent' : 'System') }, sender),
           h('span', { className: 'lm-bubbleWhen' }, ` · ${messageStamp(message)}`),
         ),
         h('div', { className: bubbleClass }, ...bubbleContents),
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
      const [tasksOpen, setTasksOpen] = React.useState(false);
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
      /** Whether the member row is expanded — collapsed by default to keep
       *  the room pane focused on conversation instead of a list of faces. */
      const [membersOpen, setMembersOpen] = React.useState(false);
      /** Quick-task: when checked, the next message also becomes a task
       *  assigned to the first @mentioned member (or everyone if @all). */
      const [quickTask, setQuickTask] = React.useState(false);
      /** Attached file: { name, type, size, data (base64 data URL) } or null. */
      const [attachedFile, setAttachedFile] = React.useState(null);
      const chatRef = React.useRef(null);

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

      // Entering a room (or a new message arriving) must land the chat on the
      // latest message, not on whatever scroll position the room had before.
      // The ref is stable; the length drives the effect so a new message scrolls
      // to the bottom each time.
      React.useEffect(() => {
        const node = chatRef.current;
        if (node === null || node === undefined) return;
        node.scrollTop = node.scrollHeight;
        if (node.scrollHeight > node.clientHeight && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }, [detail.status, messages.length]);
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
      const memberMatches = mention === undefined ? [] : matchMention(members, mention.query, mentionLabel);
      // Include "@all" in the popup when the query is empty or matches "all".
      const allEntry = { __all: true, name: COPY.mentionAll, title: COPY.mentionAll };
      const query = (mention?.query ?? '').toLowerCase();
      const showAll = mention !== undefined && (query === '' || '所有成员'.includes(query) || 'all'.startsWith(query));
      const matches = showAll ? [allEntry, ...memberMatches] : memberMatches;
      React.useEffect(() => {
        setMentionPick(0);
      }, [mention?.query]);
      const applyMention = (member) => {
        if (mention === undefined) return;
        const insert = member.__all === true
          ? `${COPY.mentionAll} `
          : `${labelOf(member)} `;
        const next = `${draft.slice(0, mention.start)}@${insert}${draft.slice(mention.start + mention.length)}`;
        setDraft(next);
        setCaret(mention.start + insert.length + 1);
        setMentionOff(false);
      };

      // ——— file attachment ———
      const onFilePicked = (event) => {
        const input = event.target;
        const file = input.files && input.files[0];
        if (!file) return;
        // Rough size cap: the HTTP transport allows 256 KB per envelope, and
        // base64 encoding adds ~33% overhead, so ~180 KB is a safe upper bound.
        const MAX_FILE_BYTES = 180 * 1024;
        if (file.size > MAX_FILE_BYTES) {
          flash(COPY.fileTooLarge, true);
          input.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          setAttachedFile({
            name: file.name,
            type: file.type,
            size: file.size,
            data: String(reader.result || ''),
          });
          input.value = '';
        };
        reader.onerror = () => {
          flash(`${COPY.error}: ${reader.error?.message ?? 'file read failed'}`, true);
          input.value = '';
        };
        reader.readAsDataURL(file);
      };
      const removeAttachedFile = () => setAttachedFile(null);

      const doSay = async () => {
        const text = draft.trim();
        if (text === '' && attachedFile === null) {
          flash(COPY.needMessage, true);
          return;
        }
        setBusy('say');
        try {
          const sayArgs = { room: roomId, sessionId, text };
          if (attachedFile !== null) sayArgs.file = attachedFile;
          const value = await call('roomSay', sayArgs);
          const delivered = Array.isArray(value?.delivered) ? value.delivered : [];
          const failed = delivered.filter((row) => row.ok !== true);
          if (failed.length > 0) flash(`${COPY.deliverFailed}: ${failed[0].name ?? ''} ${failed[0].error ?? ''}`, true);
          else flash('', false);
          setDraft('');
          setAttachedFile(null);
          // Quick-task flow: if the user ticked the "as task" box, turn the
          // message into a task right after it was sent. The title is the
          // first line (or first 40 chars), and the assignee is the first
          // @mention in the text — falling back to the room leader (i.e. the
          // sender) if nobody was named.
          if (quickTask === true && isLeader === true) {
            const firstLine = text.split('\n')[0].trim();
            const title = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
            const detail = firstLine.length <= 40 ? text.slice(firstLine.length).trim() : text;
            // Pull the first @mention out of the text: "@name" at a word boundary.
            const mentionMatch = text.match(/@(\S+)/);
            let assigneeHandle = '';
            if (mentionMatch !== null) {
              const mentioned = mentionMatch[1];
              if (mentioned === 'all' || mentioned === 'everyone') {
                assigneeHandle = members.find((m) => m.role === 'leader')?.key ?? '';
              } else {
                const found = members.find((m) => labelOf(m) === mentioned);
                assigneeHandle = found?.key ?? mentioned;
              }
            } else {
              assigneeHandle = members.find((m) => m.role === 'leader')?.key ?? '';
            }
            try {
              await call('roomTaskAssign', {
                room: roomId,
                sessionId,
                assignee: assigneeHandle,
                title,
                detail,
              });
            } catch (taskError) {
              flash(`${COPY.taskFailed}: ${errorText(taskError)}`, true);
            }
            setQuickTask(false);
          }
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

      const doKick = async (member) => {
        setBusy(`kick:${member.key ?? `${member.nodeId}/${member.sessionId}`}`);
        try {
          await call('roomKick', { room: roomId, sessionId, member: member.key ?? `${member.nodeId}/${member.sessionId}` });
          flash(COPY.kicked, false);
          await load();
          props.onChanged?.();
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
            props.onBack !== undefined
              ? h(
                  'button',
                  { type: 'button', className: 'lm-backBtn', disabled: busy === 'leave', onClick: props.onBack },
                  `${COPY.navBack}${props.backLabel !== '' && props.backLabel !== undefined ? ` ${props.backLabel}` : ''}`,
                )
              : null,
            h('span', { className: 'lm-roomTitle' }, view.name || roomId),
            view.memberCount !== undefined || members.length > 0
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'lm-badge lm-badgeBtn',
                    onClick: () => setMembersOpen((v) => !v),
                    title: membersOpen === true ? COPY.collapse : COPY.expand,
                  },
                  `${members.length || view.memberCount} ${COPY.memberCount}`,
                  h('span', { className: 'lm-caret' }, membersOpen === true ? '▲' : '▼'),
                )
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
          membersOpen === true
            ? h(
                'div',
                { className: 'lm-memberPanel' },
                h(
                  'div',
                  { className: 'lm-memberRow' },
                  ...members.map((member) =>
                    h(MemberChip, {
                      key: member.key ?? `${member.nodeId}/${member.sessionId}`,
                      member,
                      sessionId,
                      nodeId: self.nodeId,
                      isLeader,
                      busy,
                      onOpenSession: props.onOpenSession,
                      onKick: doKick,
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
              )
            : null,
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
          { className: 'lm-chat', ref: chatRef },
          messages.length === 0
            ? h('div', { className: 'lm-muted' }, detail.status === 'loading' ? COPY.loading : COPY.noChat)
            : messages.map((message) => {
                // Look up the sender in the member list so remote humans and
                // agents show their room display name (nickname / title) instead
                // of just the node name that rides in the envelope.
                const fromNode = message.from?.nodeId ?? '';
                const fromSession = message.from?.sessionId ?? '';
                let senderLabel = '';
                if (fromNode !== '' && fromSession !== '') {
                  const member = members.find((m) => m.nodeId === fromNode && m.sessionId === fromSession);
                  if (member !== undefined) senderLabel = labelOf(member);
                }
                const mine = mineOf(message);
                // The envelope's session is the speaker: `human` is a person,
                // any other id is an agent. A task notice without a session is
                // system chrome, not somebody talking.
                const kind =
                  fromSession === HUMAN_SESSION_ID ? 'human' : fromSession === '' ? 'system' : 'agent';
                return h(ChatBubble, {
                  key: message.id ?? `${messageStamp(message)}-${senderOf(message)}`,
                  message,
                  mine,
                  kind,
                  senderLabel,
                  selfLabel: selfLabel,
                });
              }),
        ),

        h(
          'div',
          { className: 'lm-composer' },
          h(
            'div',
            { className: 'lm-composerCard' },
          matches.length === 0
            ? null
            : h(
                'div',
                { className: 'lm-mentionMenu' },
                ...matches.slice(0, 8).map((member, index) => {
                  const isAll = member.__all === true;
                  const displayName = isAll ? `@${COPY.mentionAll}` : mentionLabel(member);
                  const key = isAll ? '@all' : member.key ?? `${member.nodeId}/${member.sessionId}`;
                  return h(
                    'button',
                    {
                      key,
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
                    isAll
                      ? h('span', { className: 'lm-mdot' }, '')
                      : h('span', { className: member.live === true ? 'lm-mdot' : 'lm-mdot lm-mdotIdle' }),
                    h('span', { className: 'lm-mentionName' }, displayName),
                    !isAll && member.role === 'leader' ? h('span', { className: 'lm-leaderTag' }, COPY.roleLeader) : null,
                  );
                }),
              ),
          attachedFile === null
            ? null
            : h(
                'div',
                { className: 'lm-composerTools' },
                h(
                  'div',
                  { className: 'lm-fileChip' },
                  h('span', null, fileIcon(attachedFile.type, attachedFile.name)),
                  h('span', { className: 'lm-fileChipName', title: attachedFile.name }, attachedFile.name),
                  h('span', { className: 'lm-fileChipSize' }, formatFileSize(attachedFile.size)),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-fileChipRemove',
                      title: COPY.removeFile,
                      onClick: removeAttachedFile,
                    },
                    '×',
                  ),
                ),
              ),
          h('textarea', {
            className: 'lm-composerInput',
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
              'div',
              { className: 'lm-composerToolbar' },
              h(
                'label',
                { className: 'lm-attachBtn', title: COPY.attachFile },
                '📎',
                h('input', {
                  type: 'file',
                  className: 'lm-fileInput',
                  onChange: onFilePicked,
                }),
              ),
              // Quick-task toggle: the leader can turn the next message into a
              // task with one click. The assignee is derived from the first @mention.
              isLeader === true
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: quickTask ? 'lm-taskPill lm-taskPillOn' : 'lm-taskPill',
                      'aria-pressed': quickTask,
                      onClick: () => setQuickTask((current) => !current),
                    },
                    h('span', null, COPY.quickTaskLabel),
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'lm-sendBtn',
                  disabled: busy === 'say' || viewer.isMember !== true,
                  title: busy === 'say' ? COPY.saying : COPY.sayAction,
                  'aria-label': busy === 'say' ? COPY.saying : COPY.sayAction,
                  onClick: doSay,
                },
                h(
                  'svg',
                  { className: 'lm-sendIcon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                  h('path', { d: 'M12 19V5M5 12l7-7 7 7' }),
                ),
              ),
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
     * The left rail: who this panel is, the three navigation entries, and the
     * entry point for a new project. v0.2.0: the session picker is gone — the
     * panel always acts as the human — and the rooms/joinable lists moved to
     * the right pane, so the rail is a pure navigator.
     * @param {object} props - identity, nav state and handlers.
     * @returns {object} rail element.
     */
    function Rail(props) {
      const rooms = Array.isArray(props.rooms) ? props.rooms : [];
      const agents = Array.isArray(props.agents) ? props.agents : [];
      const joinable = Array.isArray(props.joinable) ? props.joinable : [];
      // Nickname inline-editing: the input is hidden by default to keep the
      // rail clean — a click on the name opens it, and blur / Enter saves.
      const [editingNick, setEditingNick] = React.useState(false);
      const [nickDraft, setNickDraft] = React.useState(props.selfNickname ?? '');
      const nickInputRef = React.useRef(null);
      React.useEffect(() => {
        if (editingNick === false) setNickDraft(props.selfNickname ?? '');
      }, [props.selfNickname, editingNick]);
      React.useEffect(() => {
        if (editingNick === true && nickInputRef.current !== null) {
          nickInputRef.current.focus();
          nickInputRef.current.select?.();
        }
      }, [editingNick]);
      const startNickEdit = () => {
        setNickDraft(props.selfNickname ?? '');
        setEditingNick(true);
      };
      const saveNick = () => {
        if (editingNick !== true) return;
        setEditingNick(false);
        if (nickDraft !== (props.selfNickname ?? '')) {
          props.onSelfNickname(nickDraft);
          props.onSelfNicknameSave?.();
        }
      };
      const cancelNick = () => {
        setNickDraft(props.selfNickname ?? '');
        setEditingNick(false);
      };
      const navCount = (view) => {
        if (view === 'inbox') return typeof props.unreadInbox === 'number' ? props.unreadInbox : 0;
        if (view === 'board') return props.taskTotal ?? 0;
        return 0;
      };
      const unreadOf = (roomId) => props.unreadMap?.[roomId] ?? 0;
      const displayName = props.self?.selfName || props.self?.name || COPY.selfOption;
      const nickName = (props.selfNickname ?? '').trim();
      return h(
        'div',
        { className: 'lm-rail' },
        h(
          'div',
          { className: 'lm-brand' },
          h('span', { className: 'lm-brandTitle' }, COPY.title),
          props.self === undefined ? null : h('span', { className: 'lm-brandMeta' }, props.self.nodeId),
        ),

        h(
          'button',
          { type: 'button', className: 'lm-navBtn lm-conversation', title: COPY.exitHint, onClick: props.onExit },
          h('span', null, `‹ ${COPY.conversation}`),
        ),

        props.railNotice === ''
          ? null
          : h('div', { className: props.railNoticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, props.railNotice),

        // Notifications that found several local channels wait here for a
        // human to pick one. One channel sends automatically (no pending row).
        (props.notify?.pending ?? []).length === 0
          ? null
          : h(
              'div',
              { className: 'lm-railSection lm-notify' },
              h('div', { className: 'lm-sectionHead' }, COPY.notifyTitle),
              ...(props.notify.pending ?? []).map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'lm-notifyItem' },
                  h('div', { className: 'lm-notifyText' }, item.message),
                  h('div', { className: 'lm-muted lm-notifyHint' }, COPY.notifyHint),
                  ...(item.channels ?? []).map((channel) =>
                    h(
                      'button',
                      {
                        key: channel.id,
                        type: 'button',
                        className: 'lm-btn lm-btnSmall lm-notifyChannel',
                        disabled: props.notifyBusy === item.id,
                        onClick: () => props.onNotifyConfirm?.(item.id, channel.id),
                      },
                      `${COPY.notifySend} · ${channel.label}`,
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnSmall lm-notifyDismiss',
                      disabled: props.notifyBusy === item.id,
                      onClick: () => props.onNotifyDismiss?.(item.id),
                    },
                    COPY.notifyDismiss,
                  ),
                ),
              ),
            ),

        h(
          'div',
          { className: 'lm-nav' },
          NAV_ORDER.map((view) =>
            h(
              'button',
              {
                key: view.id,
                type: 'button',
                className:
                  props.view === view.id ? `lm-navBtn lm-navBtnActive lm-nav-${view.id}` : `lm-navBtn lm-nav-${view.id}`,
                onClick: () => props.onNav(view.id),
              },
              h('span', null, view.label()),
              h('span', { className: 'lm-navCount' }, String(navCount(view.id))),
            ),
          ),
        ),

        h(
          'div',
          { className: 'lm-railSection' },
          h(
            'div',
            { className: 'lm-sectionHead lm-projectsToggle' },
            h('span', null, `${COPY.projects} (${rooms.length})`),
            h(
              'button',
              {
                type: 'button',
                className: 'lm-sectionAdd lm-projectsAdd',
                title: COPY.createRoom,
                disabled: props.createOpen,
                onClick: () => props.onCreateOpen(true),
              },
              '+',
            ),
          ),
          props.createOpen
            ? h(
                'div',
                { className: 'lm-card lm-createCard' },
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
                      className: 'lm-btn lm-btnPrimary',
                      disabled: props.createBusy,
                      onClick: props.onCreate,
                    },
                    props.createBusy ? COPY.creating : COPY.create,
                  ),
                  h('button', { type: 'button', className: 'lm-btn', onClick: () => props.onCreateOpen(false) }, COPY.collapse),
                ),
              )
            : null,
          rooms.length === 0
            ? h('div', { className: 'lm-muted lm-railEmpty' }, COPY.noMineRooms)
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
                      title: room.topic || room.name || room.id,
                      onClick: () => props.onSelect(room.id),
                    },
                    h('span', { className: 'lm-roomRowName' }, room.name || room.id),
                    room.isLeader === true ? h('span', { className: 'lm-badge lm-badgeLeader' }, COPY.roleLeader) : null,
                    unreadOf(room.id) > 0 ? h('span', { className: 'lm-roomUnread' }, String(unreadOf(room.id))) : null,
                  ),
                ),
              ),
          joinable.length === 0 ? null : h('div', { className: 'lm-railTitle' }, COPY.joinableShort),
          joinable.length === 0
            ? null
            : h(
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
          { className: 'lm-railSection' },
          h(
            'div',
            { className: 'lm-sectionHead lm-agentsToggle' },
            h('span', null, `${COPY.agents} (${agents.length})`),
            h(
              'button',
              { type: 'button', className: 'lm-sectionAdd lm-agentsAdd', title: COPY.agentsCreateAction, onClick: props.onViewAgents },
              '+',
            ),
          ),
          agents.length === 0
            ? h('div', { className: 'lm-muted lm-railEmpty' }, COPY.noAgentsRail)
            : h(
                'div',
                { className: 'lm-railList' },
                ...agents.map((row) =>
                  h(
                    'button',
                    {
                      key: `${row.nodeId}/${row.id}`,
                      type: 'button',
                      className: 'lm-navBtn lm-agentRow',
                      title: row.cwd || row.name,
                      onClick: () => props.onOpenAgent(row.id),
                    },
                    h('span', { className: row.live === true ? 'lm-dot' : 'lm-dot lm-dotIdle' }),
                    h('span', { className: 'lm-agentName' }, row.title || row.name),
                    h(
                      'span',
                      { className: 'lm-agentMeta' },
                      Array.isArray(row.rooms) && row.rooms.length > 0
                        ? `${row.rooms.length} ${COPY.agentsInRoomsUnit}`
                        : COPY.agentsResident,
                    ),
                  ),
                ),
              ),
        ),

        h(
          'div',
          { className: 'lm-ident lm-railIdent' },
          h('span', { className: 'lm-muted' }, COPY.identity),
          h(
            'span',
            {
              className: 'lm-identName lm-clickable',
              title: COPY.nicknameSelfHint,
              onClick: startNickEdit,
            },
            nickName !== '' ? nickName : displayName,
          ),
          props.self === undefined
            ? null
            : h(
                'span',
                { className: 'lm-identMeta' },
                `${props.self.nodeId} · ${COPY.port} ${props.self.port} · ${props.self.secured ? COPY.secured : COPY.open}`,
              ),
          editingNick === true
            ? h(
                'div',
                { className: 'lm-nickRow' },
                h('input', {
                  ref: nickInputRef,
                  className: 'lm-input lm-inputSmall',
                  style: { flex: '1 1 auto' },
                  value: nickDraft,
                  placeholder: COPY.nicknameSelfHint,
                  onChange: (event) => setNickDraft(event.target.value),
                  onBlur: saveNick,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveNick();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelNick();
                    }
                  },
                }),
                h('button', { type: 'button', className: 'lm-btn lm-btnSmall', onClick: saveNick }, COPY.save),
              )
            : null,
        ),
      );
    }

    /**
     * The rail navigation entries, in display order. Each maps to a right pane
     * view; a selected room shows live instead of a pane (handled in MeshPanel).
     */
    const NAV_ORDER = [
      { id: 'inbox', label: () => COPY.navInbox },
      { id: 'board', label: () => COPY.navBoard },
    ];
    const navLabel = (view) => (view === undefined ? '' : NAV_ORDER.find((entry) => entry.id === view)?.label?.() ?? '');
    /**
     * The right pane when no room is picked: inbox, task board, agents, and the
     * room list fallback. Reached from the takeover sidebar.
     * @param {object} props - snapshot data, agents, send state, handlers.
     * @returns {object} pane element.
     */
    function NavView(props) {
      const view = props.view ?? 'inbox';
      const agents = props.agents ?? { local: [], remote: [] };
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      if (view === 'rooms') return RoomListPane(props);
      if (view === 'inbox') return InboxPane(props);
      if (view === 'board') return BoardPane(props);
      if (view === 'agents')
        return h(
          'div',
          { className: 'lm-emptyPane' },
          h(
            'div',
            { className: 'lm-head' },
            h('span', { className: 'lm-title' }, COPY.agents),
            h('span', { className: 'lm-muted' }, COPY.agentsHint),
            h('button', { type: 'button', className: 'lm-btn', style: { marginLeft: 'auto' }, onClick: props.onRefresh }, COPY.refresh),
          ),
          h(AgentCatalogue, {
            agents,
            workspaces,
            busy: props.agentBusy,
            notice: props.agentNotice,
            noticeBad: props.agentNoticeBad,
            newCwd: props.newCwd,
            newTitle: props.newTitle,
            text: props.text,
            onNewCwd: props.onNewCwd,
            onNewTitle: props.onNewTitle,
            onText: props.onText,
            onImport: props.onImport,
            onDial: props.onDial,
            onCreateAgent: props.onCreateAgent,
          }),
        );
      return InboxPane(props);
    }
    /**
     * The agent catalogue card: local agents (import stored ones), create a new
     * agent in an existing workspace, and dial a remote agent — the human's
     * command staff, per v0.2.0 (FR-06).
     * @param {object} props - agent rows, workspaces, dial draft, handlers.
     * @returns {object} card element.
     */
    function AgentCatalogue(props) {
      const agents = props.agents ?? { local: [], remote: [] };
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const [createOpen, setCreateOpen] = React.useState(false);
      return h(
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
                  busy: props.busy === `import:${row.id}`,
                  action: row.live === true ? '' : COPY.agentsImport,
                  onAct: props.onImport,
                }),
              ),
            ),
        h(
          'button',
          {
            type: 'button',
            className: 'lm-sectionHead lm-tasksToggle',
            style: { marginTop: '10px' },
            onClick: () => setCreateOpen((open) => open !== true),
          },
          h('span', null, `+ ${COPY.agentsCreateAction}`),
          h('span', { style: { marginLeft: 'auto' } }, createOpen ? COPY.collapse : COPY.expand),
        ),
        createOpen
          ? h(
              'div',
              null,
              h(
                'div',
                { className: 'lm-field', style: { marginTop: '6px' } },
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
                    h('option', { key: workspace.path, value: workspace.path, title: workspace.path }, workspace.title || workspace.path),
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
                  className: 'lm-btn lm-btnPrimary',
                  disabled: props.busy === 'create',
                  onClick: props.onCreateAgent,
                },
                props.busy === 'create' ? COPY.agentsCreating : COPY.agentsCreateAction,
              ),
            )
          : null,
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
                  busy: props.busy === `dial:${row.id}`,
                  action: COPY.agentsDial,
                  onAct: props.onDial,
                }),
              ),
            ),
        props.notice === ''
          ? null
          : h('div', { className: props.noticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, props.notice),
      );
    }

    /**
     * Detail view: the rooms this node belongs to, each opening the room pane.
     * @param {object} props - rooms, unread map, selection, handlers.
     * @returns {object} pane element.
     */
    function RoomListPane(props) {
      const rooms = Array.isArray(props.rooms) ? props.rooms : [];
      return h(
        'div',
        { className: 'lm-emptyPane' },
        h(
          'div',
          { className: 'lm-head' },
          h('span', { className: 'lm-title' }, COPY.navRooms),
          h('button', { type: 'button', className: 'lm-btn', style: { marginLeft: 'auto' }, onClick: props.onRefresh }, COPY.refresh),
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
                  (props.unreadMap?.[room.id] ?? 0) > 0
                    ? h('span', { className: 'lm-roomUnread' }, String(props.unreadMap[room.id]))
                    : null,
                ),
              ),
            ),
      );
    }

    /**
     * The inbox surface only shows what still needs attention; read rows drop
     * out once the person has dealt with them.
     * @param {object[]} messages - inbox records.
     * @returns {object[]} the unread ones, order preserved.
     */
    function unreadMessages(messages) {
      return (Array.isArray(messages) ? messages : []).filter((message) => message.read !== true);
    }

    /**
     * One row per inbox message: who spoke, which room, and the body.
     *
     * The inbox is what reached this node, so the recipient is always this node
     * — a "sent to" label would say the same thing on every row. The sender and
     * the room are what the reader can act on. A room row opens that room; a
     * point-to-point note has nowhere to jump.
     * @param {object} props - messages, the node identity, open-room handler.
     * @returns {object[]} one row element per message.
     */
    function InboxRows(props) {
      const inbox = Array.isArray(props.messages) ? props.messages : [];
      const selfNodeId = props.self?.nodeId ?? '';
      const expanded = props.expandedMessages ?? {};
      return inbox
        .slice()
        .reverse()
        .map((message) => {
          // Same-machine is not the same actor: a local agent's reply also
          // carries this node's id, but it is the agent talking to the person.
          // The session decides the actor, exactly as the room bubbles do.
          const fromSessionId = message.from?.sessionId ?? '';
          const outgoing = fromSessionId === HUMAN_SESSION_ID
            || (fromSessionId === '' && message.from?.nodeId === selfNodeId);
          const isRoomMsg = typeof message.room === 'string' && message.room !== '';
          const senderName = outgoing === true
            ? COPY.me
            : message.from?.title || message.from?.name || message.from?.nodeId || '?';
          const roomLabel = message.topic || message.room;
          const body = String(message.text ?? '');
          // A long body would push every other message out of view, so it starts
          // clamped to three lines with a toggle. The length test keeps short
          // messages from growing a needless toggle.
          const long = body.split('\n').length > 3 || body.length > 200;
          const isOpen = expanded[message.id] === true;
          const open = () => props.onOpenRoom?.(message.room);
          return h(
            'div',
            {
              className:
                (message.read === true ? 'lm-msg ' : 'lm-msg lm-msgUnread ') +
                (outgoing === true ? 'lm-msgOut ' : '') +
                (isRoomMsg === true ? 'lm-msgRoom ' : '') +
                (isRoomMsg === true ? 'lm-msgJump ' : ''),
              key: message.id,
              ...(isRoomMsg === true
                ? {
                    role: 'button',
                    tabIndex: 0,
                    title: `${COPY.openRoom} #${roomLabel}`,
                    onClick: open,
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      open();
                    },
                  }
                : null),
            },
            h(
              'div',
              { className: 'lm-msgHead' },
              h('span', { className: 'lm-msgFrom' }, h('strong', null, senderName)),
              isRoomMsg === true
                ? h('span', { className: 'lm-msgRoomTag', title: message.room }, `#${roomLabel}`)
                : null,
              h('span', { style: { marginLeft: 'auto' } }, String(message.receivedAt).replace('T', ' ').slice(0, 19)),
              isRoomMsg === true ? h('span', { className: 'lm-msgJumpHint' }, '↗') : null,
            ),
            h(
              'div',
              { className: long === true && isOpen !== true ? 'lm-msgText lm-msgTextClamp' : 'lm-msgText' },
              message.text,
            ),
            long === true
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'lm-msgToggle',
                    // The whole row opens the room; the toggle must not.
                    onClick: (event) => {
                      event.stopPropagation();
                      props.onToggleMessage?.(message.id);
                    },
                    onKeyDown: (event) => event.stopPropagation(),
                  },
                  isOpen === true ? COPY.collapse : COPY.expand,
                )
              : null,
          );
        });
    }

    /**
     * Detail view: the point-to-point inbox for this node.
     * @param {object} props - messages, unread count, mark-read handler.
     * @returns {object} pane element.
     */
    function InboxPane(props) {
      const inbox = unreadMessages(props.messages);
      return h(
        'div',
        { className: 'lm-emptyPane lm-inboxPane' },
        h(
          'div',
          { className: 'lm-head' },
          h('span', { className: 'lm-title' }, COPY.navInbox),
          h('button', { type: 'button', className: 'lm-btn', style: { marginLeft: 'auto' }, onClick: props.onMarkRead }, COPY.markRead),
        ),
        inbox.length === 0
          ? h('div', { className: 'lm-muted' }, COPY.emptyInboxTitle)
          : h('div', { className: 'lm-msgs lm-msgsPane' }, h(InboxRows, {
              messages: inbox,
              self: props.self,
              expandedMessages: props.expandedMessages,
              onToggleMessage: props.onToggleMessage,
              onOpenRoom: props.onOpenRoom,
            })),
      );
    }

    /**
     * Detail view: a summary of tasks across every room this node belongs to.
     * Flat (no per-room status moves) — the room pane owns task status.
     * @param {object} props - rooms with tasks, handlers.
     * @returns {object} pane element.
     */
    function BoardPane(props) {
      const rooms = (Array.isArray(props.rooms) ? props.rooms : []).filter((room) => Array.isArray(room.tasks) && room.tasks.length > 0);
      const board = rooms
        .flatMap((room) =>
          (room.tasks ?? []).map((task) => ({
            roomId: room.id,
            roomName: room.name || room.id,
            task,
          })),
        )
        .sort((a, b) => String(a.task.status).localeCompare(String(b.task.status)));
      return h(
        'div',
        { className: 'lm-emptyPane' },
        h(
          'div',
          { className: 'lm-head' },
          h('span', { className: 'lm-title' }, COPY.navBoard),
          h('button', { type: 'button', className: 'lm-btn', style: { marginLeft: 'auto' }, onClick: props.onRefresh }, COPY.refresh),
        ),
        h('div', { className: 'lm-card' }, h('div', { className: 'lm-cardHead' }, h('span', { className: 'lm-cardTitle' }, COPY.boardAcross))),
        rooms.length === 0 || board.length === 0
          ? h('div', { className: 'lm-muted' }, COPY.boardNoRooms)
          : h(
              'div',
              { className: 'lm-railList' },
              ...board.map((row) =>
                h(
                  'button',
                  {
                    key: `${row.roomId}/${row.task.id}`,
                    type: 'button',
                    className: 'lm-roomRow lm-boardRow',
                    onClick: () => props.onOpenRoom(row.roomId),
                  },
                  h('span', { className: STATUS_CLASS[row.task.status] ?? 'lm-status' }, STATUS_LABELS[row.task.status] ?? row.task.status),
                  h('span', { className: 'lm-taskTitle' }, row.task.title),
                  h('span', { className: 'lm-roomRowMeta' }, row.roomName),
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
     * Navigation shared by the rail and the panel body.
     *
     * The rail lives in the native `sidebar.workspaces` slot while the body
     * lives in `main`: two component trees that cannot pass props to each
     * other, so the selected view and room travel through this module-level
     * store instead.
     */
    const meshNav = {
      view: 'inbox',
      roomId: '',
      createOpen: false,
      notice: '',
      noticeBad: false,
      lastSessionId: '',
      listeners: new Set(),
    };

    /**
     * Merge a patch into the navigation store and notify the rail / body.
     * @param {object} patch - keys to replace.
     * @returns {void}
     */
    function patchMeshNav(patch) {
      let changed = false;
      for (const key of Object.keys(patch)) {
        if (meshNav[key] !== patch[key]) {
          meshNav[key] = patch[key];
          changed = true;
        }
      }
      if (changed === false) return;
      for (const listener of meshNav.listeners) listener();
    }

    /**
     * Subscribe a component to the navigation store.
     * @returns {object} a plain snapshot of the store.
     */
    function useMeshNav() {
      const [snapshot, setSnapshot] = React.useState({ ...meshNav });
      React.useEffect(() => {
        const listener = () => setSnapshot({ ...meshNav });
        meshNav.listeners.add(listener);
        setSnapshot({ ...meshNav });
        return () => {
          meshNav.listeners.delete(listener);
        };
      }, []);
      return snapshot;
    }

    /**
     * Sessions the rail lists: the person's own agent staff (imported or in a
     * room), plus sessions pulled into a room that the catalogue does not
     * carry. Remote rows stay in the full catalogue view.
     * @param {object[]} localAgents - local rows from the agent endpoint.
     * @param {object[]} rooms - rooms this node belongs to.
     * @param {string} selfNodeId - this node's id.
     * @returns {object[]}
     */
    function railAgentsOf(localAgents, rooms, selfNodeId) {
      const rows = [];
      const seen = new Set();
      for (const row of Array.isArray(localAgents) ? localAgents : []) {
        if (row.imported !== true && !(Array.isArray(row.rooms) && row.rooms.length > 0)) continue;
        rows.push(row);
        seen.add(row.id);
      }
      for (const room of Array.isArray(rooms) ? rooms : []) {
        for (const member of Array.isArray(room.members) ? room.members : []) {
          if (member.nodeId !== selfNodeId || member.sessionId === HUMAN_SESSION_ID) continue;
          if (seen.has(member.sessionId)) continue;
          seen.add(member.sessionId);
          rows.push({
            nodeId: member.nodeId,
            id: member.sessionId,
            title: member.title || '',
            name: member.name || member.title || member.sessionId,
            live: member.live === true,
            rooms: [room.id],
          });
        }
      }
      return rows;
    }

    /**
     * The plugin rail, mounted in the native sidebar's workspace slot.
     *
     * It owns only what the rail shows: identity, the room list, agents and the
     * create/join forms. The room body stays in the `main` panel, so a
     * navigation click first brings that panel forward; opening an agent
     * instead opens the native conversation, which leaves the rail in place.
     * @param {object} props - slot helpers from the plugin entry.
     * @returns {object} the rail element.
     */
    function MeshRailHost(props) {
      const nav = useMeshNav();
      const [snapshot, setSnapshot] = React.useState(null);
      const [agents, setAgents] = React.useState({ local: [], remote: [] });
      const [nickname, setNickname] = React.useState('');
      const [newName, setNewName] = React.useState('');
      const [newTopic, setNewTopic] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [notifyBusy, setNotifyBusy] = React.useState('');

      const refresh = React.useCallback(async () => {
        try {
          const value = await panelCall('snapshot', { sessionId: HUMAN_SESSION_ID });
          setSnapshot(value);
          const name = typeof value?.self?.selfName === 'string' ? value.self.selfName : '';
          setNickname((current) => (current === '' ? name : current));
        } catch (error) {
          patchMeshNav({ notice: `${COPY.error}: ${errorText(error)}`, noticeBad: true });
        }
      }, []);

      const loadAgents = React.useCallback(async () => {
        try {
          const value = await panelCall('agents');
          setAgents({ local: Array.isArray(value?.agents) ? value.agents : [], remote: [] });
        } catch (error) {
          // The rail still lists rooms; an agent lookup failure only empties
          // the Agents section.
          void error;
        }
      }, []);

      React.useEffect(() => {
        let live = true;
        const tick = () => {
          if (live) refresh();
        };
        tick();
        loadAgents();
        const stop = every(4000, tick);
        return () => {
          live = false;
          stop();
        };
      }, [refresh, loadAgents]);

      const notice = (message, bad) => patchMeshNav({ notice: message, noticeBad: bad === true });

      const go = (patch) => {
        patchMeshNav(patch);
        if (typeof props.openPanel === 'function') props.openPanel();
      };

      const openAgent = (sessionId) => {
        patchMeshNav({ lastSessionId: sessionId });
        const opened = typeof props.openSession === 'function' ? props.openSession(sessionId) : false;
        if (opened === false) notice(COPY.sessionUnavailable, true);
      };

      const saveNickname = async () => {
        try {
          await panelCall('nickname', { self: true, name: nickname.trim() });
          await refresh();
        } catch (error) {
          notice(`${COPY.error}: ${errorText(error)}`, true);
        }
      };

      const confirmNotify = async (id, channel) => {
        setNotifyBusy(id);
        try {
          const value = await panelCall('notifyConfirm', { id, channel });
          notice(value?.summary ?? COPY.notifySent, value?.status === 'failed');
          await refresh();
        } catch (error) {
          notice(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setNotifyBusy('');
        }
      };

      const dismissNotify = async (id) => {
        setNotifyBusy(id);
        try {
          await panelCall('notifyDismiss', { id });
          await refresh();
        } catch (error) {
          notice(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setNotifyBusy('');
        }
      };

      const createRoom = async () => {
        if (newName.trim() === '') {
          notice(COPY.needRoomName, true);
          return;
        }
        setBusy('create');
        notice('', false);
        try {
          const value = await panelCall('roomCreate', {
            name: newName.trim(),
            topic: newTopic.trim(),
            sessionId: HUMAN_SESSION_ID,
            sessionName: HUMAN_SESSION_ID,
          });
          const room = value?.room;
          setNewName('');
          setNewTopic('');
          const roomId = room !== null && typeof room === 'object' && typeof room.id === 'string' ? room.id : nav.roomId;
          go({
            createOpen: false,
            view: 'rooms',
            roomId,
            notice: `${COPY.created}${typeof room?.name === 'string' && room.name !== '' ? `: ${room.name}` : ''}`,
            noticeBad: false,
          });
          await refresh();
        } catch (error) {
          notice(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const joinRoom = async (roomId) => {
        setBusy(roomId);
        notice('', false);
        try {
          const value = await panelCall('roomJoin', {
            room: roomId,
            sessionId: HUMAN_SESSION_ID,
            sessionName: HUMAN_SESSION_ID,
          });
          const room = value?.room;
          go({
            view: 'rooms',
            roomId: room !== null && typeof room === 'object' && typeof room.id === 'string' ? room.id : roomId,
            notice: value?.added === false ? COPY.alreadyMember : COPY.joined,
            noticeBad: false,
          });
          await refresh();
        } catch (error) {
          notice(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const data = snapshot;
      const self = data?.self;
      const rooms = Array.isArray(data?.rooms?.mine) ? data.rooms.mine : [];
      const allRooms = Array.isArray(data?.rooms?.all) ? data.rooms.all : [];
      const unreadMap = data?.rooms?.unread !== null && typeof data?.rooms?.unread === 'object' ? data.rooms.unread : {};
      const mineIds = rooms.map((room) => room?.id);
      const joinable = allRooms.filter(
        (room) => room !== null && typeof room === 'object' && room.isMember !== true && !mineIds.includes(room.id),
      );
      const unreadInbox = typeof data?.inbox?.unread === 'number' ? data.inbox.unread : 0;
      const taskTotal = rooms.reduce((total, room) => total + (Array.isArray(room.tasks) ? room.tasks.length : 0), 0);

      return h(Rail, {
        self,
        selfNickname: nickname,
        onSelfNickname: setNickname,
        onSelfNicknameSave: saveNickname,
        view: nav.view,
        onNav: (next) => go({ view: next, roomId: '' }),
        onExit: () => {
          if (typeof props.leavePanel === 'function') props.leavePanel(nav.lastSessionId);
        },
        rooms,
        joinable,
        onJoin: joinRoom,
        joinBusy: busy,
        agents: railAgentsOf(agents.local, rooms, self?.nodeId ?? ''),
        unreadMap,
        activeId: nav.roomId,
        onSelect: (roomId) => go({ view: 'rooms', roomId }),
        onOpenAgent: openAgent,
        onViewAgents: () => go({ view: 'agents', roomId: '' }),
        unreadInbox,
        taskTotal,
        railNotice: nav.notice,
        railNoticeBad: nav.noticeBad,
        notify: data?.notify,
        notifyBusy,
        onNotifyConfirm: confirmNotify,
        onNotifyDismiss: dismissNotify,
        onRefresh: refresh,
        createOpen: nav.createOpen,
        newName,
        newTopic,
        createBusy: busy === 'create',
        onNewName: setNewName,
        onNewTopic: setNewTopic,
        onCreate: createRoom,
        onCreateOpen: (next) => patchMeshNav({ createOpen: next === true }),
      });
    }

    /**
     * The panel body: a persistent room rail on the left, the selected room (or
     * the node view when nothing is selected) on the right.
     * @param {object} props - slot props; carries the client services the panel needs.
     * @returns {object} panel element.
     */
    function MeshPanel(props) {
      const nav = useMeshNav();
      const view = nav.view;
      const selectedRoom = nav.roomId;
      const [state, setState] = React.useState({ status: 'loading', data: null, error: '' });
      const [joinBusy, setJoinBusy] = React.useState('');
      const [agents, setAgents] = React.useState({ local: [], remote: [] });
      const [agentBusy, setAgentBusy] = React.useState('');
      const [agentNotice, setAgentNotice] = React.useState('');
      const [agentNoticeBad, setAgentNoticeBad] = React.useState(false);
      const [newCwd, setNewCwd] = React.useState('');
      const [newTitle, setNewTitle] = React.useState('');
      const [workspaces, setWorkspaces] = React.useState([]);
      const [target, setTarget] = React.useState('');
      const [text, setText] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [sendNotice, setSendNotice] = React.useState('');
      // Inbox rows clamp long bodies to a few lines; this map remembers which
      // ones the person opened. It lives here so its hook position is stable
      // no matter which nav view is showing.
      const [expandedMessages, setExpandedMessages] = React.useState({});

      const call = React.useCallback(async (endpoint, payload) => panelCall(endpoint, payload), []);

      const refresh = React.useCallback(async () => {
        try {
          const value = await call('snapshot', { sessionId: HUMAN_SESSION_ID });
          setState({ status: 'ready', data: value, error: '' });
        } catch (error) {
          setState((current) => ({ status: 'error', data: current.data, error: errorText(error) }));
        }
      }, [call]);

      const flashRail = React.useCallback((message, bad) => {
        // The rail is the only place with room for a notice; it reads this
        // through the shared navigation store.
        patchMeshNav({ notice: message, noticeBad: bad === true });
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

      React.useEffect(() => {
        loadAgents();
        loadWorkspaces();
      }, [loadAgents, loadWorkspaces]);

      // v0.2.0: the panel is always the human; there is no session to remember.
      React.useEffect(() => {}, []);

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

      const refreshAll = () => {
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
        } catch (error) {
          flashAgent(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setAgentBusy('');
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

      const joinRoom = async (roomId) => {
        setJoinBusy(roomId);
        patchMeshNav({ notice: '', noticeBad: false });
        try {
          const value = await call('roomJoin', {
            room: roomId,
            sessionId: HUMAN_SESSION_ID,
            sessionName: HUMAN_SESSION_ID,
          });
          const room = value?.room;
          patchMeshNav({
            view: 'rooms',
            roomId: room !== null && typeof room === 'object' && typeof room.id === 'string' ? room.id : roomId,
          });
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
      const mineIds = rooms.map((room) => room?.id);
      const joinable = allRooms.filter(
        (room) => room !== null && typeof room === 'object' && room.isMember !== true && !mineIds.includes(room.id),
      );
      const selected = rooms.find((room) => room.id === selectedRoom);

      const openRoom = (roomId) => {
        patchMeshNav({ roomId, view: 'rooms' });
      };
      const goInbox = () => {
        patchMeshNav({ roomId: '', view: 'inbox' });
      };

      return h(
        'div',
        { className: 'lm-panel' },
        h(
          'div',
          { className: 'lm-main' },
          selected !== undefined
            ? h(RoomPane, {
                key: selected.id,
                room: selected,
                sessionId: HUMAN_SESSION_ID,
                self,
                call,
                localAgents: agents.local,
                onChanged: refresh,
                onExited: goInbox,
                onBack: () => patchMeshNav({ roomId: '' }),
                onOpenSession: props?.openSession,
                backLabel: navLabel(view),
              })
            : h(NavView, {
                view,
                self,
                expandedMessages,
                onToggleMessage: (id) =>
                  setExpandedMessages((current) => ({ ...current, [id]: current[id] !== true })),
                peers,
                agents,
                messages: inbox,
                unread: unreadCount,
                rooms,
                joinable,
                joinBusy,
                onJoin: joinRoom,
                unread: unreadCount,
                unreadMap,
                activeId: selectedRoom,
                onSelect: openRoom,
                onOpenRoom: openRoom,
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
          // Install the stylesheet at boot, not from the panel's effect: a
          // reload can land with the panel unselected (mode restored as
          // lanmesh, main area still native), and the panel would never mount
          // to install it. That left both the rail unstyled and the chrome
          // marker rules inert on a fresh page.
          installStyles();
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

          // --- MeshNavigation: mode state machine ------------------------
          // Modeled after dsh-agent-team's TeamNavigation. 'conversation' is
          // native DSH; 'lanmesh' shadows sidebar.workspaces and the
          // conversation main seat. Persisted to localStorage so a reload
          // lands where you left off.
          const LANMESH_PANEL_ID = 'dsh-lan-mesh';
          const NAV_KEY = 'dsh.lanmesh.navigation';
          const readNav = () => {
            if (typeof localStorage === 'undefined') return { mode: 'conversation' };
            try { const p = JSON.parse(localStorage.getItem(NAV_KEY) ?? ''); return p?.mode === 'lanmesh' ? { mode: 'lanmesh' } : { mode: 'conversation' }; }
            catch { return { mode: 'conversation' }; }
          };
          const writeNav = (s) => { try { localStorage.setItem(NAV_KEY, JSON.stringify(s)); } catch { void 0; } };
          class MeshNavigation {
            constructor() { this.snapshot = readNav(); this.listeners = new Set(); }
            getSnapshot = () => this.snapshot;
            subscribe = (fn) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
            enterLanMesh = () => { if (this.snapshot.mode === 'lanmesh') return; this.snapshot = { mode: 'lanmesh' }; writeNav(this.snapshot); for (const l of this.listeners) l(); };
            leaveLanMesh = () => { if (this.snapshot.mode === 'conversation') return; this.snapshot = { mode: 'conversation' }; writeNav(this.snapshot); for (const l of this.listeners) l(); };
            dispose() { this.listeners.clear(); }
          }
          const navigation = new MeshNavigation();
          ctx.effect(() => () => navigation.dispose(), 'lanmesh: nav');

          // --- Shell chrome marker ------------------------------------------
          // dsh-agent-team's counterpart: the stylesheet above keys off this
          // attribute to hide the New Session button and the global panel
          // rail, so entering the mesh leaves one column that is the mesh.
          // Applied on boot too, which is what makes a reload land in the
          // same compact sidebar instead of showing both rails stacked.
          ctx.effect(() => {
            const mark = () => {
              const root = typeof document === 'undefined' ? undefined : document.documentElement;
              if (root === undefined) return;
              if (navigation.getSnapshot().mode === 'lanmesh') root.dataset.lanMeshMode = 'lanmesh';
              else delete root.dataset.lanMeshMode;
            };
            const unsubscribe = navigation.subscribe(mark);
            mark();
            return () => {
              unsubscribe();
              const root = typeof document === 'undefined' ? undefined : document.documentElement;
              if (root !== undefined) delete root.dataset.lanMeshMode;
            };
          }, 'lanmesh: mode marker');

          // --- openSession / openPanel / leavePanel ------------------------
          const openSession = (id) => {
            const uiWorkspace = serviceOf('uiWorkspace');
            if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') return false;
            // Try to verify the session exists in the host's catalogue before
            // opening it. The sessions service exposes its list in several
            // shapes across DSH versions — map-with-byId, function-returning-array,
            // plain array — so we probe each one in turn. If the service is not
            // available at all, we still attempt the open: a dead click is worse
            // than the host handling an unknown id gracefully (or failing loudly
            // in a way the user can see).
            const sessions = serviceOf('sessions');
            let known = true;
            if (sessions !== undefined) {
              const listVal = sessions.list;
              const byId = listVal?.byId;
              if (typeof byId === 'object' && byId !== null) {
                // Shape 1: sessions.list.byId is a map
                known = byId[id] !== undefined;
              } else if (typeof listVal === 'function') {
                // Shape 2: sessions.list() returns an array of session rows
                const live = [];
                try {
                  for (const row of listVal.call(sessions)) {
                    const rowId = typeof row?.id === 'string' ? row.id : '';
                    if (rowId !== '') live.push(rowId);
                  }
                } catch (error) {
                  console.error('[dsh-lan-mesh] cannot read the session catalogue', error);
                }
                if (live.length > 0) known = live.includes(id);
              } else if (Array.isArray(listVal)) {
                // Shape 3: sessions.list is a plain array of session rows
                const live = listVal
                  .filter((row) => typeof row?.id === 'string')
                  .map((row) => row.id);
                if (live.length > 0) known = live.includes(id);
              }
            }
            if (!known) return false;
            let opened = false;
            try {
              // Hand the column back before opening. While the mesh panel is
              // selected it owns `main`, so the conversation would render
              // behind it. `selectPanel(null)` is the "no plugin panel" state
              // (dsh-agent-team's openMemberSessionImpl does the same); the
              // rail lives in a sidebar seat and stays mounted because the
              // mode is still 'lanmesh'.
              const layout = serviceOf('layout');
              if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(null);
            } catch (error) {
              console.error('[dsh-lan-mesh] cannot release the main panel', error);
            }
            try {
              opened = uiWorkspace.openSession(id);
            } catch (error) {
              console.error('[dsh-lan-mesh] cannot open that session', error);
              return false;
            }
            return opened !== false;
          };
          const openPanel = () => {
            try {
              navigation.enterLanMesh();
              const layout = serviceOf('layout');
              if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(LANMESH_PANEL_ID);
            } catch (error) { console.error('[dsh-lan-mesh] cannot open the panel', error); }
          };
          const leavePanel = (sessionId) => {
            // Mirrors dsh-agent-team's leaveTeamForConversation: release the
            // column first, then flip the mode (which disposes the rail
            // shadow so native DSH takes the sidebar back), then land on the
            // session that was last opened from the rail.
            try {
              const layout = serviceOf('layout');
              if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(null);
            } catch (error) { console.error('[dsh-lan-mesh] cannot release the main panel', error); }
            if (typeof sessionId === 'string' && sessionId !== '') openSession(sessionId);
            navigation.leaveLanMesh();
          };
          const enterLanMesh = () => {
            navigation.enterLanMesh();
            try {
              const layout = serviceOf('layout');
              if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(LANMESH_PANEL_ID);
            } catch (error) { console.error('[dsh-lan-mesh] cannot enter the panel', error); }
          };
          const register = (what, effect) => {
            try { ctx.effect(effect); }
            catch (error) { console.error(`[dsh-lan-mesh] cannot register ${what}`, error); }
          };

          // --- registerModeShadow: conditional slot registration --------------
          // Mirrors dsh-agent-team's pattern: when navigation.mode enters
          // 'lanmesh', register our component into the target slot; when it
          // leaves, dispose. This avoids the "slot already taken" error and
          // lets native DSH resume as soon as we step aside.
          const registerModeShadow = (name, component, entryKey) => {
            ctx.slots.inject(name, () => {
              let dispose;
              const reconcile = () => {
                const active = navigation.getSnapshot().mode === 'lanmesh';
                if (active && dispose === undefined) {
                  dispose = ctx.slots.register(
                    { name, ...(entryKey === undefined ? {} : { key: entryKey }), priority: -100 },
                    component,
                  );
                } else if (!active && dispose !== undefined) {
                  dispose();
                  dispose = undefined;
                }
              };
              const unsubscribe = navigation.subscribe(reconcile);
              reconcile();
              return () => { unsubscribe(); if (dispose !== undefined) { dispose(); dispose = undefined; } };
            });
          };

          // --- Fixed layer: sidebar icon + keyed main panel -------------------
          // Always present. Clicking the icon calls enterLanMesh, which both
          // flips mode and selects this panel.
          register('the sidebar icon', () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register({
                name: 'sidebar.panellist',
                id: LANMESH_PANEL_ID,
                order: 40,
                label: () => COPY.title,
              }, () => h('button', {
                className: 'lm-panelHandle',
                onClick: () => enterLanMesh(),
                title: COPY.title,
              }, h(MeshIcon)))
            )
          );
          register('the fixed main panel', () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: LANMESH_PANEL_ID, priority: -100 },
                () => h(MeshPanel, { openSession })),
            ),
          );

          // --- Shadow layer: the sidebar's workspace seat ---------------------
          // Only active while mode === 'lanmesh'. The `main` / 'conversation'
          // seat is deliberately NOT shadowed: opening an agent has to render
          // the native conversation, and a shadow there would draw the room
          // panel over it instead (dsh-agent-team can shadow it because
          // TeamConversation is its own conversation view; we have none).
          registerModeShadow('sidebar.workspaces',
            () => h(MeshRailHost, { openSession, openPanel, leavePanel }));

          // --- Panel ownership effect ---------------------------------------
          // Rail selection and lanmesh mode are one fact, exactly like
          // dsh-agent-team: selecting our panel enters the mode, selecting any
          // other panel leaves it (which frees sidebar.workspaces for the
          // plugin that owns that panel — e.g. the Team entry). A `null`
          // selection is left alone: that is the native-conversation state a
          // rail agent click produces, and the rail must stay mounted.
          ctx.effect(() => {
            const sync = () => {
              const layout = serviceOf('layout');
              const info = layout?.panelInfo;
              if (info === undefined || typeof info.getSnapshot !== 'function') return;
              const active = info.getSnapshot()?.activePanelId;
              if (active === undefined) return;
              const snapshot = navigation.getSnapshot();
              if (active === LANMESH_PANEL_ID) {
                if (snapshot.mode !== 'lanmesh') navigation.enterLanMesh();
                return;
              }
              if (active !== null && snapshot.mode === 'lanmesh') navigation.leaveLanMesh();
            };
            const info = serviceOf('layout')?.panelInfo;
            if (info !== undefined && typeof info.subscribe === 'function') {
              sync();
              return info.subscribe(sync);
            }
            // Older shells expose the panel state without a subscription.
            sync();
            const iv = setInterval(sync, 400);
            return () => clearInterval(iv);
          }, 'lanmesh: panel ownership');
        } catch (error) {
          console.error('[dsh-lan-mesh] cannot start the panel', error);
        }
      },
    };
  },
});
