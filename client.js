window.__ModuleLoader__.load({
  id: 'dsh-lan-mesh',
  factory(require) {
    const PLUGIN_VERSION = '0.4.38';
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
          quickTaskLeaderOnly: '只有 leader 可以分派任务',
          taskFailed: '创建任务失败',
          // file sharing
          attachFile: '添加附件',
          fileTooLarge: '附件超过当前 Host 的数量或大小限制',
          attachmentUploading:'上传中…',attachmentReady:'已上传',attachmentRetry:'重试',attachmentUnavailable:'附件暂不可用',attachmentDirectory:'不支持上传文件夹',attachmentLimitsMissing:'暂未获取附件限制，请刷新后重试',
          fileName: '文件名',
          fileSize: '大小',
          download: '下载',
          removeFile: '移除',
          invite: '拉进房',
          inviteHint: '把本节点的一个会话拉进这个房间',
          inviteAction: '拉进来',
          inviteNone: '本节点没有可拉进来的会话',
          invited: '已拉进房',
          inviteForbidden: '只有房间成员可以拉会话进来',
          // room skill references: a reference names a capability, it never
          // installs or runs one.
          skill: '技能',
          skillPicker: '插入技能引用',
          skillHint: '引用一个本机技能，它只是提示，不会自动安装或执行',
          skillSearch: '搜索技能',
          skillNone: '没有匹配的技能',
          skillUnavailable: '本机技能目录不可用',
          skillMenuEmpty: '本机没有可引用的技能',
          skillSelected: '已引用',
          skillRemove: '移除引用',
          skillMissing: '本机未安装此技能',
          skillNamesake: '本机有同名技能，不一定是同一个',
          skillSourceOf: '来自',
          skillRefsLabel: '引用的技能',
          skillRefsAria: '本条消息引用的技能',
          skillPlain: '普通文本，不作为技能引用',
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
          navNetwork:'网络总览',navManage:'管理与诊断',
          projectSearch:'搜索已加入项目',projectSearchEmpty:'没有匹配的项目',sidebarUnavailable:'当前宿主不支持导航栏切换，仍可使用工作区选择器。',navigationLabels:{},
          surfaceLabels:{},networkLabels:{},managementLabels:{},
          navBoard: '任务看板',
          navBack: '← 返回',
          // takeover sidebar (v0.3.0)
          conversation: '对话',
          exitHint: '回到原生对话',
          returnNative: '返回对话',
          versionLabels: {versions:'身份与版本',ui:'界面',host:'服务端',unknown:'版本未知',node:'节点',mismatch:'版本不一致，请重新加载插件和界面'},
          projects: '项目',
          joinableShort: '可加入',
          discoverProjects:'发现项目',
          projectActions:'项目操作',
          discoverLabels:{},
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
          // shared documents (M4)
          chatTab: '对话',
          docsTab: '文档',
          docList: '共享文档',
          docEmpty: '这个房间还没有共享文档。',
          docLoading: '正在读取文档…',
          docUnavailable: '文档暂时读不到',
          docNew: '新建文档',
          docNewTitle: '文档标题',
          docNewTitleHint: '比如 接口说明',
          docNewContent: '初始正文',
          docNewMessage: '提交说明',
          docNewCreate: '创建',
          docCreating: '创建中…',
          docCreated: '已创建',
          docNeedTitle: '请填写文档标题',
          docHead: '版本',
          docAuthor: '作者',
          docUpdated: '更新于',
          docConflicts: '待解决冲突',
          docTask: '任务',
          docReadTab: '阅读',
          docEditTab: '编辑',
          docDiffTab: '差异',
          docHistoryTab: '历史',
          docSave: '提交修改',
          docSaving: '提交中…',
          docSaved: '已提交',
          docConflictFound: '这次修改与最新版本冲突，请先解决',
          docPending: '提案已记录，等待确认',
          docDiffEmpty: '与当前版本没有差异',
          docDiffTitle: '与当前版本的差异',
          docBaseline: '基线第',
          docBaselineUnit: '行起',
          docLineUnit: '行',
          docCurrent: '最新版本',
          docProposed: '我的提案',
          docHunk: '冲突块',
          docResolution: '解决后的正文',
          docResolve: '提交解决方案',
          docResolving: '提交中…',
          docResolved: '解决方案已提交',
          docConfirm: '确认到最新版本',
          docConfirming: '确认中…',
          docConfirmed: '已确认',
          docConfirmStale: '服务端已不允许确认，已刷新为最新版本',
          docHistoryEmpty: '还没有历史记录。',
          docHistoryMore: '加载更多',
          docRevision: '修订',
          docEvent: '事件',
          docReadOnly: '历史是只读的，旧版本不会被改写',
          docCopy: '复制为新提案',
          docCopied: '已复制到编辑器',
          docRenamed: '标题已更新',
          docRenameDoc: '改标题',
          docArchived: '已归档',
          docArchive: '归档',
          docSource: '来源',
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
          quickTaskLeaderOnly: 'Only the leader can assign tasks',
          taskFailed: 'Failed to create task',
          // file sharing
          attachFile: 'Attach file',
          fileTooLarge: 'Attachments exceed the current Host limits',
          attachmentUploading:'Uploading…',attachmentReady:'Ready',attachmentRetry:'Retry',attachmentUnavailable:'Attachment unavailable',attachmentDirectory:'Directories are not supported',attachmentLimitsMissing:'Attachment limits unavailable; refresh and retry',
          fileName: 'File name',
          fileSize: 'Size',
          download: 'Download',
          removeFile: 'Remove',
          invite: 'Invite into room',
          inviteHint: 'Pull a session from this node into the room',
          inviteAction: 'Invite',
          inviteNone: 'No session on this node to invite',
          invited: 'Invited',
          inviteForbidden: 'Only room members can invite a session',
          // room skill references
          skill: 'Skills',
          skillPicker: 'Insert a skill reference',
          skillHint: 'Reference one of this node’s skills — a hint, never an install or a run',
          skillSearch: 'Search skills',
          skillNone: 'No matching skill',
          skillUnavailable: 'This node’s skill catalogue is unavailable',
          skillMenuEmpty: 'This node has no skills to reference',
          skillSelected: 'Referenced',
          skillRemove: 'Remove reference',
          skillMissing: 'Not installed on this node',
          skillNamesake: 'This node has a skill by that name, not necessarily this one',
          skillSourceOf: 'from',
          skillRefsLabel: 'Referenced skills',
          skillRefsAria: 'Skills referenced by this message',
          skillPlain: 'Plain text, not a skill reference',
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
          navNetwork:'Network',navManage:'Manage and diagnose',
          projectSearch:'Search joined projects',projectSearchEmpty:'No matching projects',sidebarUnavailable:'This host cannot toggle the sidebar; use the workspace switcher.',navigationLabels:{back:'Back to conversation',backHint:'Return to native DSH conversation',toggle:'Toggle navigation sidebar',nav:'Navigation',switch:'Switch workspace or project',workspaces:'Workspaces',projects:'My projects',archived:'Archived',network:'Network',inbox:'Inbox',board:'Tasks',manage:'Manage and diagnose',rooms:'Projects',agents:'Sessions'},
          surfaceLabels:{loading:'Loading collaboration data…',failed:'Cannot read local collaboration data',stale:'Read failed; showing the last successful snapshot',hint:'Messages and projects have not been cleared. Check the local service or retry.',retry:'Retry'},
          networkLabels:{title:'Network',refresh:'Refresh',intro:'This node and recently discovered peers. Links between remote peers are not inferred.',local:'This node',peer:'Discovery record',unknown:'Unverified',sessions:'Catalogue sessions',running:'Local running',identity:'Node ID',empty:'No other devices discovered. Check DSH and the plugin on the other machine.',time:'seconds since observation',stale:'Historical snapshot; current state unverified',permissions:'Peer visibility, session presence and dispatch permission are separate facts.'},
          managementLabels:{title:'Manage and diagnose',intro:'Local identity and published configuration flags.',node:'Node ID',name:'Device name',ui:'UI version',host:'Host version',secret:'Cluster secret',autoWake:'Automatic wake',configured:'Configured',notConfigured:'Not configured',enabled:'Enabled',disabled:'Disabled',unknown:'Unknown',agents:'Manage sessions',diagnostics:'Diagnostic guidance',diagnosticHint:'Read-only reports are generated locally. This page does not run system commands; unchecked states are not healthy.',nickname:'Click the identity at the bottom of the sidebar to edit its display name.'},
          navBoard: 'Task board',
          navBack: '← Back',
          // takeover sidebar (v0.3.0)
          conversation: 'Chat',
          exitHint: 'Back to the conversation',
          returnNative: 'Back to conversation',
          versionLabels: {versions:'Identity and versions',ui:'UI',host:'Host',unknown:'Unknown version',node:'Node',mismatch:'Version mismatch; reload the plugin and UI'},
          projects: 'Projects',
          joinableShort: 'Joinable',
          discoverProjects:'Discover projects',
          projectActions:'Project actions',
          discoverLabels:{title:'Discover projects',close:'Close',search:'Search project, device or Room ID',leader:'Leader',unknownLeader:'Unknown leader',unknownDevice:'Unknown device',empty:'No matching projects available to join',join:'Join',joining:'Joining…',hint:'Check the leader device and Room ID for namesake projects. Existing room authorization still applies.'},
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
          // shared documents (M4)
          chatTab: 'Chat',
          docsTab: 'Docs',
          docList: 'Shared documents',
          docEmpty: 'This room has no shared documents yet.',
          docLoading: 'Loading documents…',
          docUnavailable: 'Documents are unavailable right now',
          docNew: 'New document',
          docNewTitle: 'Document title',
          docNewTitleHint: 'e.g. interface notes',
          docNewContent: 'Initial body',
          docNewMessage: 'Commit message',
          docNewCreate: 'Create',
          docCreating: 'Creating…',
          docCreated: 'Created',
          docNeedTitle: 'Enter a document title',
          docHead: 'Head',
          docAuthor: 'Author',
          docUpdated: 'Updated',
          docConflicts: 'Open conflicts',
          docTask: 'Task',
          docReadTab: 'Read',
          docEditTab: 'Edit',
          docDiffTab: 'Diff',
          docHistoryTab: 'History',
          docSave: 'Submit change',
          docSaving: 'Submitting…',
          docSaved: 'Submitted',
          docConflictFound: 'This change conflicts with the head revision; resolve it first',
          docPending: 'Proposal recorded, waiting for confirmation',
          docDiffEmpty: 'No difference from the head revision',
          docDiffTitle: 'Diff against the head revision',
          docBaseline: 'Base from line',
          docBaselineUnit: '',
          docLineUnit: 'lines',
          docCurrent: 'Head revision',
          docProposed: 'My proposal',
          docHunk: 'Conflict hunk',
          docResolution: 'Resolved body',
          docResolve: 'Submit resolution',
          docResolving: 'Submitting…',
          docResolved: 'Resolution submitted',
          docConfirm: 'Confirm onto head',
          docConfirming: 'Confirming…',
          docConfirmed: 'Confirmed',
          docConfirmStale: 'The server no longer allows confirmation; refreshed to the latest revision',
          docHistoryEmpty: 'No history yet.',
          docHistoryMore: 'Load more',
          docRevision: 'Revision',
          docEvent: 'Event',
          docReadOnly: 'History is read-only; old revisions are never rewritten',
          docCopy: 'Copy into a new proposal',
          docCopied: 'Copied into the editor',
          docRenamed: 'Title updated',
          docRenameDoc: 'Rename',
          docArchived: 'Archived',
          docArchive: 'Archive',
          docSource: 'Source',
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

    /* @ux-shell:model:start */
/** Pure projection: identity and version are not evidence of connection health. */
function workbenchIdentityView(self, uiVersion, hostVersion) {
  const value=x=>typeof x==='string'?x.trim():'';
  const ui=value(uiVersion),host=value(hostVersion);
  return { nodeId:value(self?.nodeId), name:value(self?.selfName)||value(self?.name), uiVersion:ui, hostVersion:host||null, versionMismatch:!!ui&&!!host&&ui!==host, connectionHealth:'unknown' };
}
    /* @ux-shell:model:end */
    /* @ux-shell:components:start */
/** Presentational only. The caller owns DSH navigation and all side effects. */
function WorkbenchReturnButton({h,onExit,label,hint,main=false}) {
  return h('button',{type:'button',className:main?'lm-navBtn lm-workbenchReturn lm-mainReturn':'lm-navBtn lm-conversation lm-workbenchReturn','aria-label':label,title:hint,onClick:onExit},
    h('span',{'aria-hidden':true,className:'lm-returnGlyph'},'←'),h('span',{className:'lm-returnLabel'},label));
}
function WorkbenchHeader({h,model,title,subtitle,backLabel,backHint,onExit,labels={}}) {
  const copy={versions:'身份与版本',ui:'界面',host:'服务端',unknown:'版本未知',node:'节点',mismatch:'版本不一致，请重新加载插件和界面',...labels};
  return h('header',{className:'lm-workbenchHeader'},
    WorkbenchReturnButton({h,onExit,label:backLabel,hint:backHint}),
    h('div',{className:'lm-brand'},h('strong',{className:'lm-brandTitle'},title),h('span',{className:'lm-brandSubtitle'},subtitle)),
    h('details',{className:'lm-versionDetails'},h('summary',null,copy.versions),
      h('div',{className:'lm-versionContent'},h('span',null,`${copy.ui} v${model.uiVersion}`),h('span',null,`${copy.host} ${model.hostVersion?`v${model.hostVersion}`:copy.unknown}`),
        model.nodeId?h('span',{className:'lm-nodeIdentity',title:model.nodeId},`${copy.node} · ${model.nodeId}`):null)),
    model.versionMismatch?h('div',{className:'lm-versionMismatch',role:'status'},copy.mismatch):null);
}
    /* @ux-shell:components:end */

    /* @ux-shell:project-model:start */
/** Project names are labels. Room IDs remain the identity for every action. */
function discoverProjectsView(input, query='') {
  const rows=Array.isArray(input)?input:[], seen=new Set(),needle=String(query??'').trim().toLocaleLowerCase();
  const value=x=>typeof x==='string'?x:'';
  return rows.filter(room=>room&&typeof room.id==='string'&&room.id&&!room.isMember&&room.deleted!==true&&room.lifecycle?.status!=='archived').filter(room=>{if(seen.has(room.id))return false;seen.add(room.id);return true;}).map(room=>({id:room.id,name:value(room.name)||room.id,topic:value(room.topic),leaderName:value(room.leader?.name)||value(room.leader?.title),deviceName:value(room.leader?.nodeName)||value(room.leader?.nodeId)})).filter(row=>!needle||[row.id,row.name,row.topic,row.leaderName,row.deviceName].some(x=>x.toLocaleLowerCase().includes(needle)));
}
    /* @ux-shell:project-model:end */
    /* @ux-shell:discovery:start */
/** Nonmodal read-only discovery surface; all joins use the existing Host handler. */
function DiscoverProjectsPanel({h,rows,query,onQuery,onJoin,onClose,busy,labels={},panelRef,error=''}) {
  const copy={title:'发现项目',close:'关闭',search:'搜索项目、设备或 Room ID',leader:'Leader',unknownLeader:'负责人未知',unknownDevice:'设备未知',empty:'没有符合条件的可加入项目',join:'加入',joining:'加入中…',hint:'同名项目请核对负责人设备与 Room ID。加入仍由现有房间权限校验。',...labels};
  return h('aside',{className:'lm-discoverPanel',id:'lm-discover-projects',role:'region','aria-label':copy.title,tabIndex:-1,ref:panelRef,onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}},
    h('div',{className:'lm-discoverHead'},h('h2',null,copy.title),h('button',{type:'button',className:'lm-btn lm-discoverClose',onClick:onClose,'aria-label':copy.close},copy.close)),
    h('p',{className:'lm-discoverHint'},copy.hint),
    h('input',{className:'lm-input lm-discoverSearch',type:'search',value:query,maxLength:200,'aria-label':copy.search,placeholder:copy.search,onChange:event=>onQuery(event.target.value)}),
    error?h('p',{className:'lm-error lm-discoverError',role:'alert'},error):null,
    h('div',{className:'lm-discoverResults','aria-live':'polite'},rows.length===0?h('p',{className:'lm-muted lm-discoverEmpty'},copy.empty):rows.map(row=>h('article',{key:row.id,className:'lm-discoverProject'},
      h('div',{className:'lm-discoverProjectBody'},h('strong',{className:'lm-discoverProjectName'},row.name),row.topic?h('p',{className:'lm-discoverTopic'},row.topic):null,
        h('p',{className:'lm-discoverLeader'},`${copy.leader}: ${row.leaderName||copy.unknownLeader} · ${row.deviceName||copy.unknownDevice}`),h('code',{className:'lm-discoverId'},row.id)),
      h('button',{type:'button',className:'lm-btn lm-btnPrimary lm-joinBtn',disabled:!!busy,onClick:()=>onJoin(row.id),'aria-label':`${copy.join} ${row.name} · ${row.id}`},busy===row.id?copy.joining:copy.join)))));
}
    /* @ux-shell:discovery:end */
    /* @ux-shell:workspace-model:start */
function shellReadState(state={}) {
 const hasData=state.data!==null&&state.data!==undefined;
 return {kind:!hasData?(state.status==='error'?'failed':'loading'):(state.status==='error'?'stale':'ready'),error:typeof state.error==='string'?state.error:'',observedAt:state.observedAt??null};
}
function networkWorkspaceView({self,peers,agents,agentsStatus,stale=false}={}) {
 const nodes=[],seen=new Set(),catalogueReady=agentsStatus==='ready';
 const list=Array.isArray(peers)?peers:[];
 if(typeof self?.nodeId==='string'&&self.nodeId){seen.add(self.nodeId);const local=Array.isArray(agents?.local)?agents.local:[];nodes.push({id:self.nodeId,name:self.selfName||self.name||self.nodeId,local:true,ageSeconds:null,sessions:catalogueReady?local.length:null,running:catalogueReady&&local.every(a=>a?.status==='running'||a?.status==='idle')?local.filter(a=>a.status==='running').length:null});}
 for(const peer of list){if(!peer||typeof peer.nodeId!=='string'||!peer.nodeId||seen.has(peer.nodeId))continue;seen.add(peer.nodeId);nodes.push({id:peer.nodeId,name:typeof peer.name==='string'&&peer.name?peer.name:peer.nodeId,local:false,ageSeconds:Number.isFinite(peer.ageSeconds)&&peer.ageSeconds>=0?peer.ageSeconds:null,sessions:null,running:null});}
 // The remote catalogue can be partial. A positive match is evidence, absence isn't zero.
 if(catalogueReady)for(const n of nodes.filter(n=>!n.local)){const matches=(Array.isArray(agents?.remote)?agents.remote:[]).filter(a=>a.nodeId===n.id);if(matches.length)n.sessions=matches.length;}
 return {nodes,peerCount:Array.isArray(peers)?nodes.filter(n=>!n.local).length:null,stale};
}
    /* @ux-shell:workspace-model:end */
    /* @ux-shell:workspace-components:start */
/** Pure surface components. Data access and navigation stay with the existing controller. */
function WorkspaceReadState({h,model,onRetry,labels={}}) {
 const copy={loading:'正在读取协作工作台…',failed:'暂时无法读取本机协作数据',stale:'连接或读取失败，当前显示上次成功读取的数据',hint:'这不表示消息或项目已被清空。请检查本机服务或重试。',retry:'重试',...labels};
 if(model.kind==='ready')return null;
 if(model.kind==='loading')return h('section',{className:'lm-shellReadState',role:'status'},h('h2',null,copy.loading),h('div',{className:'lm-shellSkeleton','aria-hidden':true}),h('div',{className:'lm-shellSkeleton','aria-hidden':true}));
 return h('section',{className:model.kind==='stale'?'lm-shellStale':'lm-shellReadState',role:'alert'},h('strong',null,model.kind==='stale'?copy.stale:copy.failed),model.kind==='failed'?h('p',null,copy.hint):null,model.error?h('p',{className:'lm-shellErrorText'},model.error):null,model.observedAt?h('p',{className:'lm-muted'},model.observedAt):null,h('button',{className:'lm-btn lm-shellRetry',type:'button',onClick:onRetry},copy.retry));
}
function NetworkWorkspace({h,model,onRefresh,labels={}}) {
 const copy={title:'网络总览',refresh:'刷新',intro:'当前展示本机和最近发现的设备，不推断其他设备之间的连接。',local:'本机',peer:'发现记录',unknown:'未核对',sessions:'目录会话',running:'本机执行中',identity:'节点身份',empty:'尚未发现其他设备。请确认另一端 DSH 和插件均已启动。',time:'秒前观测',stale:'历史快照 · 当前状态待核对',permissions:'设备可见、会话存活与允许派发是不同状态；派发仍按现有权限核对。',...labels};
 return h('section',{className:'lm-workspacePage lm-networkWorkspace'},h('header',{className:'lm-workspacePageHead'},h('div',null,h('h1',null,copy.title),h('p',null,copy.intro)),h('button',{type:'button',className:'lm-btn',onClick:onRefresh},copy.refresh)),model.stale?h('p',{className:'lm-workspaceHint'},copy.stale):null,
 h('div',{className:'lm-deviceList'},model.nodes.map(node=>h('article',{className:'lm-deviceRow',key:node.id},h('div',{className:'lm-deviceIdentity'},h('strong',null,node.name),h('span',{className:'lm-badge'},node.local?copy.local:copy.peer),h('p',{className:'lm-deviceId'},`${copy.identity} · ${node.id}`)),h('dl',{className:'lm-deviceFacts'},h('dt',null,copy.sessions),h('dd',null,model.stale||node.sessions===null?copy.unknown:String(node.sessions)),h('dt',null,node.local?copy.running:copy.peer),h('dd',null,model.stale?copy.unknown:node.local?(node.running===null?copy.unknown:String(node.running)):(node.ageSeconds===null?copy.unknown:`${node.ageSeconds} ${copy.time}`)))))),model.peerCount===0?h('p',{className:'lm-workspaceHint'},copy.empty):null,h('p',{className:'lm-workspaceHint'},copy.permissions));
}
function ManagementWorkspace({h,self,uiVersion,hostVersion,onOpenAgents,labels={}}) {
 const copy={title:'管理与诊断',intro:'本机身份与已公开的配置状态。',node:'节点身份',name:'本机名称',ui:'界面版本',host:'服务端版本',secret:'群组密钥',autoWake:'自动唤醒',configured:'已配置',notConfigured:'未配置',enabled:'已开启',disabled:'已关闭',unknown:'未知',agents:'会话管理',diagnostics:'诊断说明',diagnosticHint:'只读诊断报告需在本机生成。此页面不会执行系统命令；未检查的连接、授权和传输状态均不视为正常。',nickname:'本机显示名可在侧栏底部点击修改。',...labels};
 const flag=value=>value===true?copy.enabled:value===false?copy.disabled:copy.unknown;
 return h('section',{className:'lm-workspacePage lm-managementWorkspace'},h('header',{className:'lm-workspacePageHead'},h('div',null,h('h1',null,copy.title),h('p',null,copy.intro))),h('dl',{className:'lm-managementFacts'},...[[copy.name,self?.selfName||self?.name||copy.unknown],[copy.node,self?.nodeId||copy.unknown],[copy.ui,uiVersion||copy.unknown],[copy.host,hostVersion||copy.unknown],[copy.secret,self?.secured===true?copy.configured:self?.secured===false?copy.notConfigured:copy.unknown],[copy.autoWake,flag(self?.autoWake)]].flatMap(([label,value])=>[h('dt',{key:label+'-label'},label),h('dd',{key:label},value)])),h('p',{className:'lm-workspaceHint'},copy.nickname),h('button',{type:'button',className:'lm-btn lm-managementAgents',onClick:onOpenAgents},copy.agents),h('details',{className:'lm-diagnosticHelp'},h('summary',null,copy.diagnostics),h('p',null,copy.diagnosticHint)));
}

function AgentRegistryPane({h,React,call,self,localAgents=[]}) {
  const [rows,setRows]=React.useState(null);
  const [name,setName]=React.useState('');
  const [selected,setSelected]=React.useState('');
  const [session,setSession]=React.useState('');
  const [message,setMessage]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const running=React.useRef(false);
  const retry=React.useRef(null);
  const current=rows?.find(row=>row.agentId===selected);
  const bound=new Set((rows??[]).flatMap(row=>row.bindings.map(binding=>binding.sessionId)));
  async function refresh(){
    const result=await call('agentRegistry',{});
    if(!Array.isArray(result?.agents))throw new Error('无法读取 Agent 身份');
    setRows(result.agents);
  }
  async function run(action){
    if(running.current)return;
    running.current=true;
    setBusy(true);
    setMessage('');
    try{await action();}
    catch(error){setMessage(error?.code==='CONFLICT'||error?.message==='CONFLICT'?'记录已变更，请刷新后核对再试。':String(error?.message??error));}
    finally{running.current=false;setBusy(false);}
  }
  React.useEffect(()=>{void run(refresh);},[call]);
  function submit(command){
    void run(async()=>{
      const key=JSON.stringify(command);
      if(retry.current?.key!==key)retry.current={key,requestId:crypto.randomUUID()};
      await call('agentRegistryCommand',{command,requestId:retry.current.requestId});
      retry.current=null;
      setName('');
      setSession('');
      await refresh();
      setMessage('已保存');
    });
  }
  const button=(label,onClick,disabled=false)=>h('button',{type:'button',className:'lm-btn',onClick,disabled:busy||disabled},label);
  const nameInput=h('input',{value:name,maxLength:120,disabled:busy,'aria-label':'Agent 名称',placeholder:'Agent 名称',onChange:event=>setName(event.target.value)});
  return h('section',{className:'lm-workspacePage','aria-label':'本机 Agent 身份'},
    h('header',{className:'lm-workspacePageHead'},h('h2',null,'本机 Agent 身份'),button('刷新',()=>void run(refresh))),
    h('p',{className:'lm-muted'},self?.selfName||self?.name||self?.nodeId||'本机'),
    h('p',{role:'status'},message|| (busy?'处理中…':'')),
    rows===null?null:h('div',null,
      h('select',{value:selected,disabled:busy,'aria-label':'选择 Agent',onChange:event=>{setSelected(event.target.value);setName('');setSession('');}},
        h('option',{value:''},'新建 Agent'),...rows.map(row=>h('option',{key:row.agentId,value:row.agentId},row.name+' · '+row.agentId))),
      nameInput,
      current?button('重命名',()=>submit({type:'rename',agentId:current.agentId,expectedRevision:current.revision,name:name.trim()}),!name.trim()):
        button('创建',()=>submit({type:'define',agentId:retry.current?.createName===name.trim()?retry.current.agentId:prepareAgentId(name.trim()),name:name.trim()}),!name.trim()),
      current?h('div',null,
        h('p',{className:'lm-muted'},current.authorityNodeId+' · 版本 '+current.revision),
        h('select',{value:session,disabled:busy,'aria-label':'选择本机会话',onChange:event=>setSession(event.target.value)},
          h('option',{value:''},'选择本机会话'),...localAgents.filter(row=>row.cwd&&!bound.has(row.id)).map(row=>h('option',{key:row.id,value:row.id},(row.name||row.id)+' · '+row.id))),
        button('绑定会话',()=>submit({type:'bind',agentId:current.agentId,expectedRevision:current.revision,sessionId:session}),!session),
        h('ul',null,...current.bindings.map(binding=>h('li',{key:binding.sessionId},binding.sessionId,' ',button('解除绑定',()=>submit({type:'unbind',agentId:current.agentId,expectedRevision:current.revision,sessionId:binding.sessionId})))))):null));
  function prepareAgentId(createName){
    const agentId='agent-'+crypto.randomUUID();
    const key=JSON.stringify({type:'define',agentId,name:createName});
    retry.current={key,requestId:crypto.randomUUID(),agentId,createName};
    return agentId;
  }
}

function OwnerTeamOverview({h,React,call,roomId,selectedResults=[],onSelectResult}) {
  const [attempt,setAttempt]=React.useState(0);
  const [result,setResult]=React.useState(null);
  React.useEffect(()=>{
    let current=true;
    setResult(null);
    Promise.resolve().then(()=>call('teamOverview',{roomId})).then(
      value=>{if(current)setResult({value});},
      error=>{if(current)setResult({error:error?.code==='FORBIDDEN'?'当前无权查看 Team 概览。':'暂时无法读取 Team 概览。'});},
    );
    return ()=>{current=false;};
  },[call,roomId,attempt]);

  const states={absent:'本机暂无 Team 记录',active:'活动中',paused:'已暂停',archived:'已归档'};
  const labels={planned:'已计划',ready:'就绪',active:'进行中',review:'待审查',accepted:'已验收',blocked:'受阻',failed:'失败',cancelled:'已取消',queued:'排队中',acknowledged:'已确认',running:'运行中',uncertain:'待人工核对',succeeded:'已提交结果'};
  const value=result?.value;
  let summary='正在读取 Team 概览…';
  if(result?.error)summary=result.error;
  else if(result&&!value?.known)summary=value?.reason==='TEAM_DISABLED'?'本机未启用 Team 执行。':'本机 Team 状态暂不可用。';
  else if(value?.known)summary=states[value.status]??'未知状态';
  const counts=(title,items)=>h('div',null,h('strong',null,title),h('ul',null,...Object.entries(items).map(([state,count])=>h('li',{key:state},(labels[state]??state)+' '+count)),Object.keys(items).length?null:h('li',null,'暂无记录')));
  return h('section',{className:'lm-task lm-ownerTeamOverview','aria-label':'Team 概览'},
    h('div',{className:'lm-workspacePageHead'},h('h3',null,'Team 概览 · 本机'),h('button',{type:'button',className:'lm-btn',disabled:result===null,onClick:()=>{setResult(null);setAttempt(value=>value+1);}},'刷新概览')),
    h('p',{role:'status'},summary),
    onSelectResult&&value?.known?value.resultRefs?.map(ref=>{
      const selected=selectedResults.some(row=>row.executionId===ref.executionId&&row.resultHash===ref.resultHash);
      return h('div',{key:ref.executionId},
        h('span',null,ref.executionId+' · '+(labels[ref.reviewStatus]??ref.reviewStatus)+' · '+ref.resultHash.slice(0,12)+' '),
        h('button',{type:'button',className:'lm-btn lm-selectTaskResult','aria-pressed':selected,disabled:!selected&&selectedResults.length>=8,onClick:()=>onSelectResult(ref)},selected?'取消引用':'引用成果'));
    }):null,
    value?.known&&value.status!=='absent'&&value.taskCounts&&value.executionCounts?h('div',null,counts('任务状态',value.taskCounts),counts('执行状态',value.executionCounts)):null,
    value?.known&&value.status!=='absent'&&value.status!=='archived'&&Number.isSafeInteger(value.generation)?h(OwnerPlanPanel,{key:roomId,h,React,call,roomId,model:ownerPlanPanelModel,newRequestId:rpcId}):null,
    value?.known&&value.status!=='absent'&&value.status!=='archived'&&Number.isSafeInteger(value.generation)?h(OwnerResultPanel,{key:'result:'+roomId,h,React,call,roomId,model:ownerResultPanelModel,newRequestId:rpcId}):null);
}
    /* @ux-shell:workspace-components:end */
    /* @ux-shell:workspace-nav-model:start */
function filterJoinedProjects(input,query='') {
 const needle=String(query??'').trim().toLocaleLowerCase(),seen=new Set();
 return (Array.isArray(input)?input:[]).filter(room=>room&&typeof room.id==='string'&&room.id&&room.deleted!==true&&room.lifecycle?.status!=='archived').filter(room=>{if(seen.has(room.id))return false;seen.add(room.id);return true;}).filter(room=>!needle||[room.name,room.topic,room.id].some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(needle)));
}
function workspaceNavigationTarget(value,rooms=[]) {
 if(typeof value!=='string')return null;
 if(value.startsWith('view:')){const view=value.slice(5);return ['network','inbox','board','manage','rooms','agents'].includes(view)?{view,roomId:''}:null;}
 if(value.startsWith('room:')){const id=value.slice(5);return (Array.isArray(rooms)?rooms:[]).some(room=>room?.id===id&&room.deleted!==true)?{view:'rooms',roomId:id}:null;}
 return null;
}
    /* @ux-shell:workspace-nav-model:end */
    /* @ux-shell:workspace-nav:start */
/** Native sidebar geometry stays with DSH. This toolbar keeps routes reachable. */
function WorkbenchNavigation({h,rooms=[],archivedRooms=[],view,roomId,onExit,onToggle,onNavigate,notice='',resolveTarget,labels={}}) {
 const copy={back:'返回对话',backHint:'回到 DSH 原生对话',toggle:'展开或收起导航',nav:'导航',switch:'切换工作区或项目',workspaces:'工作区',projects:'我的项目',archived:'已归档',network:'网络总览',inbox:'收件箱',board:'任务看板',manage:'管理与诊断',rooms:'项目列表',agents:'会话管理',...labels};
 const mine=(Array.isArray(rooms)?rooms:[]).filter(r=>r&&typeof r.id==='string'),past=(Array.isArray(archivedRooms)?archivedRooms:[]).filter(r=>r&&typeof r.id==='string'),allowed=[...mine,...past];
 const current=roomId&&allowed.some(r=>r.id===roomId)?'room:'+roomId:'view:'+(['network','inbox','board','manage','rooms','agents'].includes(view)?view:'inbox');
 return h('div',{className:'lm-workbenchNavigationWrap'},h('nav',{className:'lm-workbenchNavigation','aria-label':copy.switch},
   h('button',{type:'button',className:'lm-navBtn lm-workbenchReturn lm-mainReturn','aria-label':copy.back,title:copy.backHint,onClick:onExit},h('span',{'aria-hidden':true},'←'),h('span',null,copy.back)),
   h('button',{type:'button',className:'lm-navBtn lm-sidebarToggle','aria-label':copy.toggle,title:copy.toggle,onClick:onToggle},h('span',{'aria-hidden':true},'☰'),h('span',{className:'lm-sidebarToggleLabel'},copy.nav)),
   h('select',{className:'lm-workspaceSwitch',value:current,'aria-label':copy.switch,onChange:event=>{const target=resolveTarget?.(event.target.value,allowed);if(target)onNavigate(target);}},
     h('optgroup',{label:copy.workspaces},...['network','inbox','board','manage','rooms','agents'].map(id=>h('option',{key:id,value:'view:'+id},copy[id]))),
     mine.length?h('optgroup',{label:copy.projects},...mine.map(room=>h('option',{key:room.id,value:'room:'+room.id},`${room.name||room.id} · ${room.id}`))):null,
     past.length?h('optgroup',{label:copy.archived},...past.map(room=>h('option',{key:room.id,value:'room:'+room.id},`${room.name||room.id} · ${room.id}`))):null)),
   notice?h('p',{className:'lm-navigationNotice',role:'status'},notice):null);
}
    /* @ux-shell:workspace-nav:end */
    /* @ux-shell:composer-drafts:start */
/** Page-local unsent drafts. No serialization, disk storage, messages, or permissions. */
function createRoomComposerDrafts() {
 const entries=new Map();
 const key=scope=>JSON.stringify([String(scope.nodeId??''),String(scope.sessionId??''),String(scope.roomId??'')]);
 function remove(record){if(entries.get(record.key)!==record)return;entries.delete(record.key);record.listeners.clear();record.observers.clear();record.attachments?.dispose();record.attachments=null;}
 return {
  get(scope){const id=key(scope);if(!entries.has(id))entries.set(id,{key:id,values:Object.create(null),attempt:{current:null},attachments:null,listeners:new Set(),observers:new Set(),revision:0,taskPending:null});return entries.get(id);},
  bindAttachments(record,create,listener,limits){
   if(!record.attachments)record.attachments=create(rows=>{record.revision++;for(const fn of [...record.listeners])fn([...rows]);});
   record.attachments.updateLimits?.(limits);
   record.listeners.add(listener);listener([...record.attachments.rows]);
   let subscribed=true;
   return ()=>{if(!subscribed)return;subscribed=false;record.listeners.delete(listener);if(!record.listeners.size&&record.attachments?.rows.length===0){record.attachments.dispose();record.attachments=null;}};
  },
  watch(record,listener){record.observers.add(listener);return()=>record.observers.delete(listener);},
  acknowledge(record,attempt,revision){
   if(record.attempt.current!==attempt)return false;
   record.attempt.current=null;
   if(record.revision!==revision)return false;
   for(const [field,value] of Object.entries({draft:'',draftMentions:[],draftSkills:[],caret:0,quickTask:false}))record.values[field]=value;
   record.attachments?.clear?.();record.revision++;
   for(const listener of [...record.observers])listener();
   return true;
  },
  acknowledgeForm(record,fields){
   if(!Object.entries(fields).every(([name,value])=>record.values[name]===value))return false;
   record.values.taskTitle='';record.values.taskDetail='';record.revision++;
   for(const listener of [...record.observers])listener();return true;
  },
  changed(record){for(const listener of [...record.observers])listener();},
  drop(scope){const record=entries.get(key(scope));if(record)remove(record);},
  dispose(){for(const record of [...entries.values()])remove(record);}
 };
}
/** Persist before React commits so immediate navigation cannot discard an edit. */
function useComposerField(React,record,name,initial,canWrite=()=>true) {
 if(!Object.hasOwn(record.values,name))record.values[name]=typeof initial==='function'?initial():initial;
 const [snapshot,setSnapshot]=React.useState(()=>({record,name,value:record.values[name]}));
 const value=record.values[name];
 const set=next=>{if(!canWrite())return;const updated=typeof next==='function'?next(record.values[name]):next;if(name!=='caret'&&record.values[name]!==updated)record.revision++;record.values[name]=updated;setSnapshot({record,name,value:updated});};
 return [value,set];
}
    /* @ux-shell:composer-drafts:end */
    const roomComposerDrafts=createRoomComposerDrafts();
    const STYLE_ID = 'dsh-lan-mesh-styles';
    /** The session id the backend reserves for "me, the human". */
    const HUMAN_SESSION_ID = 'human';
    const CSS = `
/* @ux-shell:styles:start */
.lm-workbenchHeader{position:sticky;top:-12px;z-index:2;background:var(--dsw-alias-bg-base);padding:8px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.lm-workbenchHeader .lm-workbenchReturn{width:100%;justify-content:flex-start;gap:8px;padding:8px 10px;margin-bottom:12px;min-height:34px;background:transparent}
.lm-returnGlyph{font-size:16px;line-height:1;flex:none}
.lm-workbenchHeader .lm-brand{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:0 8px 8px;min-width:0}
.lm-workbenchHeader .lm-brandTitle{font-size:20px;line-height:1.4;font-weight:600;white-space:nowrap}
.lm-brandSubtitle{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.lm-versionDetails{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 8px}
.lm-versionDetails summary{cursor:pointer;min-height:28px;display:list-item;list-style-position:inside;padding:4px 0}
.lm-versionContent{display:flex;flex-direction:column;gap:5px;padding:4px 0 8px}
.lm-nodeIdentity{overflow-wrap:anywhere;user-select:text}
.lm-versionMismatch{margin:6px 6px 0;padding:8px;font-size:12px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-state-warn);border-radius:6px}
.lm-mainReturn{align-self:flex-start;flex:none;margin:6px 12px;min-height:32px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-workbenchReturn:focus-visible,.lm-versionDetails summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
@media(max-width:1100px){.lm-mainReturn{position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-base);margin:4px 8px;min-height:32px}.lm-mainReturn .lm-returnLabel{display:inline}}
@media(prefers-reduced-motion:reduce){.lm-workbenchReturn{transition:none}}
    /* @ux-shell:styles:end */
/* @ux-shell:project-styles:start */
.lm-discoverTrigger{width:100%;justify-content:space-between;margin-top:10px}
.lm-discoverPanel{position:fixed;right:24px;top:72px;bottom:24px;width:min(680px,calc(100vw - 340px));z-index:50;display:flex;flex-direction:column;gap:12px;padding:20px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-sizing:border-box;box-shadow:0 8px 32px #0002;min-width:0;overflow:hidden}
.lm-discoverHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none}
.lm-discoverHead h2{margin:0;font-size:18px;font-weight:600}
.lm-discoverHint,.lm-discoverLeader,.lm-discoverTopic{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;overflow-wrap:anywhere}
.lm-discoverSearch{flex:none;width:100%;box-sizing:border-box}
.lm-discoverResults{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:0}
.lm-discoverProject{display:flex;align-items:flex-start;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-discoverProjectBody{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}
.lm-discoverProjectName{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.lm-discoverId{font-size:11px;overflow-wrap:anywhere;user-select:text;color:var(--dsw-alias-label-secondary)}
.lm-discoverEmpty{padding:20px 0;font-size:13px}.lm-discoverError{margin:0;font-size:12px}
.lm-projectEntry{display:flex;align-items:flex-start;position:relative;gap:4px;min-width:0}
.lm-projectEntry>.lm-roomRow{flex:1;min-width:0}
.lm-projectEntry>.lm-roomPreferences{flex:0 0 30px;position:relative}
.lm-projectEntry .lm-roomPreferences>summary{cursor:pointer;list-style:none;padding:7px 4px;min-height:32px;text-align:center;border-radius:6px;color:var(--dsw-alias-label-secondary)}
.lm-projectEntry .lm-roomPreferences>summary::-webkit-details-marker{display:none}
.lm-projectEntry .lm-roomPreferences>summary:hover{background:var(--dsw-alias-bg-layer-2)}
.lm-projectEntry .lm-roomPreferences>summary:focus-visible,.lm-discoverPanel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.lm-projectMenu{position:absolute;right:0;top:100%;width:238px;max-width:calc(100vw - 32px);padding:10px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;z-index:4;box-sizing:border-box;box-shadow:0 4px 16px #0002}
.lm-projectMenu .lm-row{align-items:flex-start;font-size:12px;gap:7px}.lm-projectMenu input{flex:none}
.lm-archiveConfirm{display:flex;flex-direction:column;gap:6px;font-size:12px}
.lm-archiveConfirmText{color:var(--dsw-alias-label-secondary);line-height:1.5;overflow-wrap:anywhere}
.lm-archiveConfirmActions{display:flex;gap:6px}
.lm-archiveRoom{align-self:flex-start;min-height:30px}
@media(max-width:1100px){.lm-discoverPanel{left:16px;right:16px;top:56px;bottom:16px;width:auto;max-width:720px;margin-left:auto}}
@media(max-width:600px){.lm-discoverPanel{left:8px;right:8px;top:48px;bottom:8px;padding:14px}.lm-discoverProject{gap:10px}.lm-discoverHead h2{font-size:16px}}
    /* @ux-shell:project-styles:end */
/* @ux-shell:workspace-styles:start */
.lm-workspacePage{padding:24px;overflow:auto;min-height:0;flex:1;color:var(--dsw-alias-label-primary)}
.lm-workspacePageHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}.lm-workspacePageHead h1{margin:0;font-size:20px;font-weight:600}.lm-workspacePageHead p{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.lm-deviceList{max-width:1040px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}.lm-deviceRow{padding:18px;display:flex;gap:24px;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l1)}.lm-deviceRow:last-child{border-bottom:0}.lm-deviceIdentity{flex:1;min-width:0}.lm-deviceIdentity>strong{margin-right:8px;font-size:14px;overflow-wrap:anywhere}.lm-deviceId{margin:6px 0 0;font-size:12px;overflow-wrap:anywhere;user-select:text;color:var(--dsw-alias-label-secondary)}
.lm-deviceFacts{display:grid;grid-template-columns:100px minmax(80px,1fr);gap:6px 16px;font-size:12px;margin:0;min-width:220px}.lm-deviceFacts dt,.lm-managementFacts dt{color:var(--dsw-alias-label-secondary)}.lm-deviceFacts dd,.lm-managementFacts dd{margin:0;overflow-wrap:anywhere}.lm-workspaceHint{max-width:900px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;margin:18px 0}
.lm-managementFacts{max-width:800px;display:grid;grid-template-columns:130px 1fr;gap:16px 24px;padding:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;font-size:13px}.lm-diagnosticHelp{margin:24px 0;max-width:800px;font-size:13px}.lm-diagnosticHelp summary{cursor:pointer;padding:8px 0}.lm-diagnosticHelp p{color:var(--dsw-alias-label-secondary);line-height:1.7}
.lm-shellReadState{flex:1;padding:40px 24px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;max-width:900px}.lm-shellReadState h2{font-size:16px;font-weight:600;margin:0}.lm-shellReadState p{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}.lm-shellErrorText{overflow-wrap:anywhere;font-size:12px}.lm-shellSkeleton{height:12px;width:min(480px,100%);background:var(--dsw-alias-bg-layer-2);border-radius:5px}.lm-shellSkeleton+ .lm-shellSkeleton{width:min(320px,85%)}
.lm-shellStale{flex:none;margin:0 20px 12px;padding:12px 14px;border:1px solid var(--dsw-alias-state-warn);border-radius:8px;font-size:12px}.lm-shellStale p{margin:5px 0;overflow-wrap:anywhere}.lm-shellStale .lm-shellRetry{margin-top:6px}
.lm-archivedToggle{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;padding:7px 9px;min-height:30px;border-radius:6px;cursor:pointer}.lm-archivedToggle:hover{background:var(--dsw-alias-bg-layer-2)}
@media(max-width:900px){.lm-workspacePage{padding:18px}.lm-deviceRow{align-items:flex-start;flex-direction:column;gap:12px}.lm-deviceFacts{width:100%;min-width:0}.lm-managementFacts{grid-template-columns:100px minmax(0,1fr);padding:16px;gap:12px}.lm-shellStale{margin:0 12px 10px}}

.lm-workspacePageHead>.lm-btn{flex:none;white-space:nowrap}
    /* @ux-shell:workspace-styles:end */
/* @ux-shell:workspace-nav-styles:start */
.lm-workbenchNavigationWrap{flex:none;min-width:0}.lm-workbenchNavigation{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;min-height:44px;border-bottom:1px solid var(--dsw-alias-border-l1)}.lm-workbenchNavigation>.lm-mainReturn{position:static;margin:0;white-space:nowrap;align-self:auto}.lm-sidebarToggle{font-size:12px;min-height:32px;gap:6px}.lm-workspaceSwitch{min-width:140px;max-width:340px;flex:1;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;min-height:32px;overflow:hidden;text-overflow:ellipsis}.lm-workspaceSwitch:focus-visible,.lm-sidebarToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.lm-navigationNotice{font-size:12px;color:var(--dsw-alias-label-secondary);margin:6px 20px;overflow-wrap:anywhere}.lm-projectSearch{font-size:12px;min-height:32px;box-sizing:border-box;flex:none;margin:2px 0 6px}.lm-rail .lm-projectSearch{width:100%}
@media(max-width:600px){.lm-workbenchNavigation{padding:5px 8px;gap:5px}.lm-sidebarToggleLabel{display:none}.lm-workspaceSwitch{min-width:120px}.lm-sidebarToggle{padding:6px 8px}}
    /* @ux-shell:workspace-nav-styles:end */
/* @ux-shell:message-styles:start */
.lm-chat{gap:14px;padding:20px clamp(12px,3vw,32px)}
.lm-chat .lm-bubbleRow{box-sizing:border-box;width:100%;max-width:900px;margin-inline:auto;align-self:center;align-items:stretch;min-width:0}
.lm-chat .lm-bubbleMeta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:0 2px;line-height:1.5}
.lm-chat .lm-bubbleWho{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.lm-messageKind{font-size:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px;color:var(--dsw-alias-label-secondary)}
.lm-messageDevice{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-chat .lm-bubbleWhen{font-size:11px;margin-left:auto;white-space:nowrap}
.lm-chat .lm-bubble{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);border-radius:8px;font-size:14px;line-height:1.7;min-width:0;overflow-wrap:anywhere}
.lm-chat .lm-bubbleMine{border-inline-start:3px solid var(--dsw-alias-brand-primary)}
.lm-chat .lm-messageContinuation{margin-top:-8px}
.lm-chat .lm-messageContinuation .lm-bubbleMeta{justify-content:flex-end}
@media(max-width:650px){.lm-chat{padding:12px 10px}.lm-chat .lm-bubbleWhen{margin-left:0}.lm-chat .lm-bubble{padding:8px 10px}.lm-chat .lm-messageDevice{flex-basis:100%}}
.lm-newMessages{display:flex;align-items:center;justify-content:center;gap:12px;flex:none;padding:6px 12px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}
.lm-jumpLatest:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.lm-messageBody{min-width:0}
.lm-messageText{min-width:0}
.lm-chat .lm-messageTextCollapsed{max-height:13.6em;overflow:hidden;mask-image:linear-gradient(to bottom,#000 80%,transparent)}
.lm-chat .lm-messageTextCollapsed.lm-messageCodePreview{max-height:20.4em}
.lm-messageBodyActions{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:5px;min-height:24px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.lm-messageExpand,.lm-messageCopy{font:inherit;color:var(--dsw-alias-label-secondary);background:transparent;border:0;border-radius:3px;padding:3px 1px;cursor:pointer;min-height:28px}
.lm-messageExpand:hover,.lm-messageCopy:hover{color:var(--dsw-alias-brand-primary)}
.lm-messageExpand:focus-visible,.lm-messageCopy:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.lm-messageCopy:disabled{cursor:wait;opacity:.7}
@media(prefers-reduced-transparency:reduce){.lm-chat .lm-messageTextCollapsed{mask-image:none}}
.lm-messageSummary{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.lm-historyToolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:none;justify-content:center;padding:4px 0 12px;font-size:11px}
.lm-roomPane>.lm-roomTabSurface{flex:1;min-height:0;max-height:none;overflow:auto;padding:18px clamp(12px,3vw,28px);margin:0;border:0}
.lm-roomPane>.lm-docsView{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.lm-roomPane .lm-roomTabs{flex:none;gap:4px;overflow-x:auto;white-space:nowrap;padding:8px 16px 0}
.lm-roomTabs .lm-roomTab{min-height:36px;flex:none}
.lm-roomTab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.lm-roomTabSurface .lm-memberRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px}
.lm-memberChip .lm-memberIdentity{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.lm-memberChip .lm-memberName{font-weight:600;overflow-wrap:anywhere}
.lm-memberChip .lm-memberDevice{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;white-space:normal}
.lm-roomTabSurface .lm-memberChip{padding:12px;min-width:0;align-items:flex-start;border-radius:8px}
.lm-contextSummary{flex:none;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);padding:4px max(12px,calc((100% - 900px)/2))}
.lm-contextSummary>summary{cursor:pointer;min-height:28px;padding:5px 0}
.lm-contextSummaryBody{display:grid;gap:4px;max-height:140px;overflow:auto;overflow-wrap:anywhere;padding:4px 0 8px}
.lm-roomTabSurface .lm-inviteRow .lm-btn{flex:none;white-space:nowrap}
.lm-roomTabSurface .lm-inviteRow .lm-select{flex:1;min-width:0}
.lm-roomTabSurface .lm-inviteRow>.lm-muted{flex:0 1 220px}
@media(max-width:650px){.lm-roomTabSurface .lm-inviteRow{flex-wrap:wrap}.lm-roomTabSurface .lm-inviteRow>.lm-muted{flex-basis:100%}}
    /* @ux-shell:message-styles:end */
/* @ux-shell:inbox-styles:start */
.lm-inboxWorkbench{display:flex;flex-direction:column;min-height:0;flex:1;padding:20px;overflow:hidden;color:var(--dsw-alias-label-primary)}
.lm-inboxWorkbench .lm-inboxToolbar,.lm-inboxWorkbench .lm-inboxFilters,.lm-inboxWorkbench .lm-inboxActions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex:none}
.lm-inboxWorkbench h1{font-size:20px;margin:0;flex:1}.lm-inboxWorkbench h2{font-size:16px;overflow-wrap:anywhere}
.lm-inboxWorkbench .lm-inboxScope{font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-inboxWorkbench .lm-inboxFilters input{flex:1;min-width:100px}.lm-inboxWorkbench input,.lm-inboxWorkbench select{font:inherit;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit}
.lm-inboxWorkbench .lm-inboxColumns{display:grid;grid-template-columns:minmax(260px,1fr) minmax(280px,1fr);min-height:0;flex:1;margin-top:16px;gap:16px}
.lm-inboxWorkbench .lm-inboxList,.lm-inboxWorkbench .lm-inboxDetail{min-width:0;overflow:auto}.lm-inboxWorkbench .lm-inboxRow{display:block;width:100%;margin:0;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;text-align:left;background:transparent;color:inherit;padding:12px;cursor:pointer;font:inherit;min-height:96px}
.lm-inboxWorkbench .lm-inboxRowSelected{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 3px 0 var(--dsw-alias-brand-primary)}
.lm-inboxWorkbench .lm-inboxRowMeta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px}.lm-inboxWorkbench time,.lm-inboxWorkbench small{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-inboxWorkbench .lm-inboxPreview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0;line-height:1.5}
.lm-inboxWorkbench .lm-inboxDetail{border-left:1px solid var(--dsw-alias-border-l1);padding:12px 16px}.lm-inboxWorkbench .lm-inboxFullText{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;margin:16px 0}
.lm-inboxWorkbench .lm-inboxConfirm{padding:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px;flex:none}.lm-inboxWorkbench .lm-inboxConfirm button{margin-right:10px}
.lm-inboxWorkbench button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
@media(max-width:850px){.lm-inboxWorkbench{padding:12px}.lm-inboxWorkbench .lm-inboxColumns{display:flex;flex-direction:column}.lm-inboxWorkbench .lm-inboxDetail{display:none}.lm-inboxWorkbench.lm-inboxHasDetail .lm-inboxList{display:none}.lm-inboxWorkbench.lm-inboxHasDetail .lm-inboxDetail{display:block;border:0;padding:4px;flex:1}}
.lm-inboxWorkbench .lm-inboxRow{padding:10px 12px;min-height:92px;font-size:13px;line-height:1.35}
.lm-inboxWorkbench .lm-inboxPreview{margin:4px 0;line-height:1.35}
.lm-inboxWorkbench .lm-inboxRow small{display:block;line-height:1.3}
.lm-inboxWorkbench{container-type:inline-size;container-name:lm-inbox}
@container lm-inbox (max-width:850px){.lm-inboxWorkbench .lm-inboxColumns{display:flex;flex-direction:column}.lm-inboxWorkbench .lm-inboxDetail{display:none}.lm-inboxWorkbench.lm-inboxHasDetail .lm-inboxList{display:none}.lm-inboxWorkbench.lm-inboxHasDetail .lm-inboxDetail{display:block;border:0;padding:4px;flex:1}}
    /* @ux-shell:inbox-styles:end */
/* @ux-shell:network-styles:start */
.lm-networkWorkbench{flex:1;min-width:0;min-height:0;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.lm-networkWorkbench .lm-networkHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
.lm-networkWorkbench h1{margin:0;font-size:21px;font-weight:600}.lm-networkWorkbench h2{margin:0;font-size:16px;overflow-wrap:anywhere}
.lm-networkWorkbench .lm-networkHeader p,.lm-networkWorkbench .lm-networkHint{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:8px 0 0;overflow-wrap:anywhere}
.lm-networkWorkbench .lm-networkRefresh{flex:none;min-height:34px}
.lm-networkWorkbench .lm-networkStale{padding:12px 14px;border:1px solid var(--dsw-alias-state-warn,var(--dsw-alias-border-l1));border-radius:8px;font-size:12px;margin-bottom:16px}
.lm-networkWorkbench .lm-networkSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 20px}
.lm-networkWorkbench .lm-networkSummary>span{padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:13px;overflow-wrap:anywhere}
.lm-networkWorkbench .lm-networkToolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.lm-networkWorkbench .lm-networkSearch{font:inherit;font-size:13px;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px 10px;min-width:0;flex:1;max-width:480px;min-height:36px}
.lm-networkWorkbench .lm-networkToolbar [role=group]{display:flex;gap:4px}
.lm-networkWorkbench .lm-networkModeTopology,.lm-networkWorkbench .lm-networkModeList{font:inherit;font-size:12px;min-height:36px;padding:7px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:inherit;cursor:pointer}
.lm-networkWorkbench [aria-pressed=true]{border-color:var(--dsw-alias-brand-primary)}
.lm-networkWorkbench .lm-networkLayout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:20px;align-items:start}
.lm-networkWorkbench .lm-networkPrimary{min-width:0}
.lm-networkWorkbench .lm-networkTopology{height:560px;position:relative;min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.lm-networkWorkbench .lm-networkEdges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.lm-networkWorkbench .lm-networkSpoke{stroke:var(--dsw-alias-border-l2);stroke-width:.3;stroke-dasharray:1 1}
.lm-networkWorkbench .lm-networkNode{font:inherit;font-size:12px;display:flex;flex-direction:column;gap:4px;text-align:left;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px;background:var(--dsw-alias-bg-base);color:inherit;cursor:pointer}
.lm-networkWorkbench .lm-networkNode:hover{background:var(--dsw-alias-bg-layer-2)}
.lm-networkWorkbench .lm-networkNodeSelected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.lm-networkWorkbench .lm-networkNode>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;width:100%}
.lm-networkWorkbench .lm-networkNodeId{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;color:var(--dsw-alias-label-secondary);font-size:11px}
.lm-networkWorkbench .lm-networkNodeFact{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-networkWorkbench .lm-networkTopology .lm-networkNode{position:absolute;transform:translate(-50%,-50%);width:min(150px,27%);padding:9px;gap:3px}
.lm-networkWorkbench .lm-networkList{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));gap:12px}
.lm-networkWorkbench .lm-networkDetail{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:18px;min-width:0;background:var(--dsw-alias-bg-layer-1)}
.lm-networkWorkbench .lm-networkDetailId{font-size:12px;overflow-wrap:anywhere;user-select:text;color:var(--dsw-alias-label-secondary);line-height:1.6}
.lm-networkWorkbench .lm-networkDetail dl{display:grid;grid-template-columns:75px minmax(0,1fr);gap:12px;font-size:12px;line-height:1.6;margin:20px 0}
.lm-networkWorkbench .lm-networkDetail dt{color:var(--dsw-alias-label-secondary)}.lm-networkWorkbench .lm-networkDetail dd{margin:0;overflow-wrap:anywhere}
.lm-networkWorkbench button:focus-visible,.lm-networkWorkbench input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
@media(max-width:1100px){.lm-networkWorkbench .lm-networkLayout{grid-template-columns:minmax(0,1fr)}.lm-networkWorkbench .lm-networkDetail{width:100%;box-sizing:border-box}.lm-networkWorkbench .lm-networkTopology{height:520px}}
@media(max-width:650px){.lm-networkWorkbench{padding:16px}.lm-networkWorkbench .lm-networkSummary{grid-template-columns:minmax(0,1fr);gap:6px}.lm-networkWorkbench .lm-networkSummary>span{padding:10px 12px}.lm-networkWorkbench .lm-networkTopology{height:440px}.lm-networkWorkbench .lm-networkTopology .lm-networkNode{font-size:11px;width:26%;padding:7px}.lm-networkWorkbench .lm-networkNodeFact{font-size:10px}.lm-networkWorkbench .lm-networkHeader{gap:8px}.lm-networkWorkbench .lm-networkDetail dl{grid-template-columns:70px minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.lm-networkWorkbench *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
/* Measure this workbench rather than the host window when its sidebar is open. */
.lm-networkWorkbench{container-type:inline-size;container-name:lm-network}
.lm-networkWorkbench .lm-networkCompactNotice{display:none;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:10px 0 0}
@container lm-network (max-width:650px){
 .lm-networkWorkbench .lm-networkTopology{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:10px;height:auto;overflow:visible;padding:12px}
 .lm-networkWorkbench .lm-networkTopology .lm-networkEdges{display:none}
 .lm-networkWorkbench .lm-networkTopology .lm-networkNode{position:static;transform:none;width:100%;box-sizing:border-box;padding:12px;font-size:12px}
 .lm-networkWorkbench .lm-networkCompactNotice{display:block}
 .lm-networkWorkbench .lm-networkLayout{grid-template-columns:minmax(0,1fr)}
}
/* Fallback for hosts whose engine does not support container queries. */
@media(max-width:650px){
 .lm-networkWorkbench .lm-networkTopology{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:10px;height:auto;overflow:visible;padding:12px}
 .lm-networkWorkbench .lm-networkTopology .lm-networkEdges{display:none}
 .lm-networkWorkbench .lm-networkTopology .lm-networkNode{position:static;transform:none;width:100%;box-sizing:border-box;padding:12px;font-size:12px}
 .lm-networkWorkbench .lm-networkCompactNotice{display:block}
}
    /* @ux-shell:network-styles:end */
/* @ux-shell:task-board-styles:start */
.lm-roomTaskBoard{display:flex;flex-direction:column;gap:16px;min-height:0;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary)}
.lm-roomTaskBoard header,.lm-roomTaskBoard .lm-taskBoardRowHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lm-roomTaskBoard h1{margin:0;font-size:20px}.lm-roomTaskBoard h2{margin:0 0 10px;font-size:14px}
.lm-roomTaskBoard .lm-taskBoardScope{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-roomTaskBoard .lm-taskBoardFilters{display:flex;flex-wrap:wrap;gap:8px}.lm-roomTaskBoard .lm-taskBoardFilters input{flex:1;min-width:180px}
.lm-roomTaskBoard input,.lm-roomTaskBoard select{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px;max-width:100%}
.lm-roomTaskBoard .lm-taskBoardRow{display:flex;flex-direction:column;align-items:stretch;gap:6px;width:100%;padding:12px 16px;margin-bottom:8px;text-align:left;white-space:normal;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-md,10px);color:inherit;transition:var(--lmr-raise)}
.lm-roomTaskBoard .lm-taskBoardRow:hover{border-color:var(--dsw-alias-border-l2);box-shadow:var(--lmr-shadow-card)}
.lm-roomTaskBoard small{color:var(--dsw-alias-label-secondary)}.lm-roomTaskBoard .lm-taskBoardPreview{white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px}
.lm-roomTaskBoard button:focus-visible,.lm-roomTaskBoard input:focus-visible,.lm-roomTaskBoard select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.lm-roomTaskBoard{container-type:inline-size;container-name:lm-task-board}
/* An element is never its own container, so the padding step stays a window query; the layout switch below is the pane-driven one that matters when the host main column is narrower than its window. */
@media(max-width:650px){.lm-roomTaskBoard{padding:16px}}
@container lm-task-board (max-width:650px){.lm-roomTaskBoard .lm-taskBoardFilters>*{width:100%}.lm-roomTaskBoard .lm-taskBoardRowHead{align-items:flex-start;flex-wrap:wrap}}
    /* @ux-shell:task-board-styles:end */
/* @ux-shell:owner-plan-styles:start */
.lm-ownerPlanPanel{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.lm-ownerPlanHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.lm-ownerPlanHead h3{margin:0;font-size:14px}
.lm-ownerPlanHead p{margin:4px 0 0;font-size:12px;line-height:1.6}
.lm-ownerPlanNotice{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-ownerPlanNoticeBad{color:var(--dsw-alias-state-warn)}
.lm-ownerPlanDenied{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-warn)}
.lm-ownerPlanBody{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:12px;min-width:0}
.lm-ownerPlanList{display:flex;flex-direction:column;gap:6px;min-width:0}
.lm-ownerPlanListHint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanRow{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;transition:var(--lmr-raise)}
.lm-ownerPlanRow:hover:not(.lm-ownerPlanRowActive){border-color:var(--dsw-alias-border-l2);box-shadow:var(--lmr-shadow-card)}
.lm-ownerPlanRow strong,.lm-ownerPlanRow span{overflow-wrap:anywhere}
.lm-ownerPlanRow small{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-ownerPlanRowActive{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1));box-shadow:var(--lmr-shadow-card)}
.lm-ownerPlanDetail{min-width:0;display:flex;flex-direction:column;gap:8px}
.lm-ownerPlanMeta p{margin:0 0 4px;font-size:12px;overflow-wrap:anywhere}
.lm-ownerPlanFingerprint{display:flex;gap:8px;align-items:flex-start}
.lm-ownerPlanFingerprint code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;overflow-wrap:anywhere;user-select:text}
.lm-ownerPlanTasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.lm-ownerPlanTasks li{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);padding:7px 10px;font-size:12px;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}
.lm-ownerPlanTasks small{display:block;margin-top:2px;color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanTaskDetail{margin:4px 0 0;white-space:pre-wrap;line-height:1.6}
.lm-ownerPlanActions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lm-ownerPlanApproved{font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanConfirm{border:1px solid var(--dsw-alias-state-warn);border-radius:8px;padding:10px;font-size:12px}
.lm-ownerPlanConfirm p{margin:0 0 6px;line-height:1.6;overflow-wrap:anywhere}
.lm-ownerPlanConfirmActions{display:flex;flex-wrap:wrap;gap:8px}
.lm-ownerPlanForm{display:flex;flex-direction:column;gap:8px;margin-top:4px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.lm-ownerPlanForm h4{margin:0;font-size:13px}
.lm-ownerPlanForm label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanForm input,.lm-ownerPlanForm textarea{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:7px;max-width:100%}
.lm-ownerPlanForm textarea{resize:vertical;min-height:120px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.lm-ownerPlanForm .lm-muted{margin:0;font-size:11px}
.lm-ownerPlanPanel button:focus-visible,.lm-ownerPlanPanel input:focus-visible,.lm-ownerPlanPanel textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.lm-ownerPlanCounts{margin:4px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-ownerPlanPreviewReport p{margin:0 0 4px;font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.lm-ownerPlanPreviewSummary,.lm-ownerPlanPreviewHint{color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanPreviewTasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.lm-ownerPlanPreviewRow{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);padding:7px 10px;font-size:12px;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}
.lm-ownerPlanPreviewRow small{display:block;margin-top:2px;color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanPreviewState{margin-left:6px;color:var(--dsw-alias-label-secondary)}
.lm-ownerPlanPreviewOk{border-color:var(--dsw-alias-brand-primary)}
.lm-ownerPlanPreviewWarn{border-color:var(--dsw-alias-state-warn)}
.lm-ownerPlanExplanations{list-style:none;margin:4px 0 0;padding:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-ownerPlanExplanations li{margin-top:2px}
@media(max-width:700px){.lm-ownerPlanBody{grid-template-columns:minmax(0,1fr)}}
    /* @ux-shell:owner-plan-styles:end */
/* @ux-shell:owner-result-styles:start */
.lm-ownerResultPanel{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.lm-ownerResultHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.lm-ownerResultHead h3{margin:0;font-size:14px}
.lm-ownerResultHead p{margin:4px 0 0;font-size:12px;line-height:1.6}
.lm-ownerResultNotice{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-ownerResultNoticeBad{color:var(--dsw-alias-state-warn)}
.lm-ownerResultDenied{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-warn)}
.lm-ownerResultBody{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:12px;min-width:0}
.lm-ownerResultList{display:flex;flex-direction:column;gap:6px;min-width:0}
.lm-ownerResultListHint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.lm-ownerResultRow{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;transition:var(--lmr-raise)}
.lm-ownerResultRow:hover:not(.lm-ownerResultRowActive){border-color:var(--dsw-alias-border-l2);box-shadow:var(--lmr-shadow-card)}
.lm-ownerResultRow strong,.lm-ownerResultRow span{overflow-wrap:anywhere}
.lm-ownerResultRow small{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.lm-ownerResultRowActive{border-color:var(--dsw-alias-brand-primary)}
.lm-ownerResultDetail{min-width:0;display:flex;flex-direction:column;gap:8px}
.lm-ownerResultMeta p{margin:0 0 4px;font-size:12px;overflow-wrap:anywhere}
.lm-ownerResultHash{display:flex;gap:8px;align-items:flex-start}
.lm-ownerResultHash code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;overflow-wrap:anywhere;user-select:text}
.lm-ownerResultMeta code{overflow-wrap:anywhere}
.lm-ownerResultActions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lm-ownerResultConfirm{border:1px solid var(--dsw-alias-state-warn);border-radius:8px;padding:10px;font-size:12px}
.lm-ownerResultConfirm p{margin:0 0 6px;line-height:1.6;overflow-wrap:anywhere}
.lm-ownerResultConfirmActions{display:flex;flex-wrap:wrap;gap:8px}
.lm-ownerResultReasonLabel{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-ownerResultReason{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:7px;max-width:100%;resize:vertical}
.lm-ownerResultPanel button:focus-visible,.lm-ownerResultPanel textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
@media(max-width:700px){.lm-ownerResultBody{grid-template-columns:minmax(0,1fr)}}
    /* @ux-shell:owner-result-styles:end */
.lm-panel{display:flex;width:100%;height:100%;min-height:0;min-width:0;overflow:hidden;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;background:var(--dsw-alias-bg-base)}
/* Design refresh tokens: one radius/shadow/motion scale for every surface.
   All values are theme-agnostic (they only shape, never color), so light and
   dark themes stay driven by the host's --dsw-alias-* palette. */
.lm-panel{--lmr-radius-sm:8px;--lmr-radius-md:10px;--lmr-radius-lg:14px;--lmr-radius-pill:999px;
  --lmr-shadow-card:0 1px 2px rgba(0,0,0,.04),0 2px 8px rgba(0,0,0,.04);
  --lmr-shadow-pop:0 6px 20px rgba(0,0,0,.14);
  --lmr-shadow-primary:0 1px 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);
  --lmr-raise:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}
.lm-panel ::-webkit-scrollbar{width:9px;height:9px}
.lm-panel ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 28%,transparent);border-radius:999px;border:2px solid transparent;background-clip:padding-box}
.lm-panel ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 48%,transparent);border:2px solid transparent;background-clip:padding-box}
.lm-panel ::-webkit-scrollbar-track{background:transparent}
.lm-panel ::-webkit-scrollbar-corner{background:transparent}
@media(prefers-reduced-motion:reduce){.lm-panel *,.lm-panel *::before,.lm-panel *::after{transition:none!important;animation-duration:0s!important}}
/* Keyboard focus fallback: :where keeps specificity at zero, so components
   that draw their own focus ring (tabs, inputs) keep winning. */
.lm-panel :where(button:focus-visible){outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.lm-panel :where([aria-busy='true']){cursor:progress}
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
.lm-agentSpinner{display:inline-block;flex:0 0 auto;width:10px;height:10px;border:1.5px solid var(--dsw-alias-border-l1);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:lm-agent-spin .8s linear infinite}
@keyframes lm-agent-spin{to{transform:rotate(360deg)}}
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
.lm-bubble{padding:9px 13px;border-radius:var(--lmr-radius-lg,14px);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);word-break:break-word;font-size:13px;line-height:1.6;max-width:100%;overflow-x:auto;box-shadow:var(--lmr-shadow-card)}
.lm-bubbleRowMine .lm-bubble{border-bottom-right-radius:4px}
.lm-bubbleRow:not(.lm-bubbleRowMine) .lm-bubble{border-bottom-left-radius:4px}
/* The pane sits close to layer-1/2, so each speaker kind gets a tint that is
   unmistakable: people read blue, agents read green, system notices stay grey.
   A message synced from another machine keeps its speaker's tint. */
.lm-bubbleHuman{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,var(--dsw-alias-border-l1))}
.lm-bubbleAgent{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,var(--dsw-alias-border-l1))}
.lm-bubbleSystem{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.lm-bubbleMine{border-color:var(--dsw-alias-brand-primary)}
.lm-bubblePlain{white-space:pre-wrap}
.lm-composer{border:0;margin:0;min-width:0;display:flex;flex-direction:column;align-items:center;padding:0 16px 12px}
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
/* Skill picker: the same popup shape as @completion, but each row also names
   the node the skill came from, because two machines can both offer "deploy"
   and a reference is useless if the reader cannot tell which one was meant. */
.lm-skillMenu{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;padding:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:6px}
.lm-skillSearchRow{padding:2px 2px 4px}
.lm-skillSearch{width:100%;box-sizing:border-box;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;outline:0}
.lm-skillItem{display:flex;flex-direction:column;align-items:flex-start;gap:1px;font:inherit;font-size:12px;text-align:left;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid transparent;border-radius:6px;padding:4px 7px;cursor:pointer}
.lm-skillItem:hover{background:var(--dsw-alias-bg-layer-1)}
.lm-skillItemActive{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}
.lm-skillName{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lm-skillSource{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lm-skillDesc{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lm-skillEmpty{padding:4px 7px;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* Selected references sit above the textarea as removable chips. */
.lm-skillChips{display:flex;flex-wrap:wrap;gap:5px;padding:0 12px}
.lm-skillChip{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:2px 4px 2px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-skillChipName{color:var(--dsw-alias-label-primary);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-skillChipSource{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.lm-skillChipRemove{flex:none;font:inherit;font-size:12px;line-height:1;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 5px}
.lm-skillChipRemove:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.lm-skillBtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.lm-skillIcon{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.lm-taskPill:disabled{opacity:.5;cursor:not-allowed}
.lm-skillBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lm-skillBtnOn,.lm-skillBtnOn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
/* A received reference is a label, never a button: nothing to install, run,
   or click through — it just says which capability the sender meant. */
.lm-skillRefs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:4px}
.lm-skillRef{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-skillRefName{color:var(--dsw-alias-label-primary);font-weight:600}
.lm-skillRefMissing{border-style:dashed;color:var(--dsw-alias-label-tertiary)}
.lm-skillRefNamesake{border-style:dotted;color:var(--dsw-alias-label-tertiary)}
.lm-skillRefMissing .lm-skillRefName{color:var(--dsw-alias-label-secondary);font-weight:500}
.lm-skillRefsLabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.lm-skillRefSource{color:var(--dsw-alias-label-tertiary)}
.lm-skillRefBadge{margin-left:3px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:10px}
.lm-roomRow{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid transparent;border-radius:var(--lmr-radius-sm,8px);background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;transition:var(--lmr-raise)}
.lm-roomRow:hover{background:var(--dsw-alias-bg-layer-2)}
.lm-roomRowActive{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}
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
.lm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);padding:14px 16px;transition:var(--lmr-raise)}
.lm-card:hover{border-color:var(--dsw-alias-border-l2);box-shadow:var(--lmr-shadow-card)}
.lm-cardHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.lm-cardTitle{font-weight:600}
.lm-btn{font:inherit;font-weight:500;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);padding:6px 14px;cursor:pointer;transition:var(--lmr-raise);line-height:1.4}
.lm-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1));background:var(--dsw-alias-bg-layer-2);box-shadow:var(--lmr-shadow-card)}
.lm-btn:active:not(:disabled){transform:translateY(.5px);box-shadow:none}
.lm-btn:disabled{opacity:.45;cursor:default}
.lm-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));font-weight:600;box-shadow:var(--lmr-shadow-primary)}
.lm-btnPrimary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,var(--dsw-alias-label-primary));box-shadow:var(--lmr-shadow-primary),var(--lmr-shadow-card);border-color:transparent}
.lm-btnSmall{padding:3px 9px;font-size:11px;border-radius:var(--lmr-radius-sm,8px)}
.lm-peers{display:flex;flex-direction:column;gap:6px}
.lm-peer{display:flex;align-items:baseline;gap:8px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.lm-peerName{font-weight:600}
.lm-peerMeta{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.lm-dotIdle{background:var(--dsw-alias-label-secondary)}
.lm-muted{color:var(--dsw-alias-label-secondary)}
.lm-input,.lm-textarea,.lm-select{font:inherit;width:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);padding:7px 11px;transition:var(--lmr-raise)}
.lm-input:hover,.lm-textarea:hover,.lm-select:hover{border-color:var(--dsw-alias-border-l2)}
.lm-input:focus,.lm-textarea:focus,.lm-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.lm-select{padding:5px 8px;cursor:pointer}
.lm-textarea{min-height:84px;resize:vertical;font-family:inherit}
.lm-textareaShort{min-height:52px}
.lm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}
.lm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.lm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lm-msgs{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto}
/* Standalone inbox: grow to fill the pane instead of capping at 340px. */
.lm-msgsPane{max-height:none;flex:1;min-height:0}
.lm-msg{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-md,10px);padding:8px 11px;transition:var(--lmr-raise)}
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
.lm-badge{font-size:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-pill,999px);padding:1px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.lm-badgeBtn{cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:border-color .15s ease}
.lm-badgeBtn:hover{border-color:var(--dsw-alias-brand-primary)}
.lm-caret{font-size:9px;opacity:.6}
.lm-badgeLeader{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.lm-task{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-md,10px);padding:7px 11px;background:var(--dsw-alias-bg-base);transition:var(--lmr-raise)}
.lm-task:hover{border-color:var(--dsw-alias-border-l2);box-shadow:var(--lmr-shadow-card)}
.lm-taskHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lm-taskTitle{font-weight:600}
.lm-taskAssignee{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-taskDetail{margin-top:5px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.lm-status{font-size:11px;font-weight:500;border-radius:var(--lmr-radius-pill,999px);padding:1px 9px;border:1px solid color-mix(in srgb,currentColor 40%,transparent);background:color-mix(in srgb,currentColor 9%,transparent);white-space:nowrap}
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
.lm-attachment{margin-top:6px;padding:8px 11px;border-radius:var(--lmr-radius-md,10px);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:10px;transition:var(--lmr-raise)}
.lm-attachment:hover{border-color:var(--dsw-alias-border-l2);box-shadow:var(--lmr-shadow-card)}
.lm-attachIcon{font-size:18px;flex:0 0 auto}
.lm-attachInfo{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.lm-attachName{font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-attachMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-attachDl{font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;flex:0 0 auto}
.lm-attachDl:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.lm-composerTools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 8px 0}
/* shared documents (M4) */
.lm-chatView{display:flex;flex-direction:column;flex:1;min-height:0}
.lm-roomTabs{display:flex;gap:4px;padding:8px 16px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-roomTab{font:inherit;font-size:12px;padding:6px 14px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:var(--lmr-raise)}
.lm-roomTab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.lm-roomTabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);font-weight:600;box-shadow:inset 0 2px 0 var(--dsw-alias-brand-primary)}
.lm-docsPane{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding:12px 16px;overflow:auto}
.lm-docListHead{display:flex;align-items:center;gap:8px}
.lm-docListTitle{flex:1 1 auto}
.lm-docList{display:flex;flex-direction:column;gap:6px}
.lm-docRow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--lmr-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;transition:var(--lmr-raise)}
.lm-docRow:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1));box-shadow:var(--lmr-shadow-card)}
.lm-docRowActive{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.lm-docRowTitle{font-weight:600;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-docRowHead{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.lm-docRowAuthor{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis}
.lm-docConflicts{font-size:11px;border-radius:999px;padding:1px 8px;white-space:nowrap;background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-foreground)}
.lm-docRowTask{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.lm-docDetail{display:flex;flex-direction:column;gap:10px;min-height:0;padding-top:4px}
.lm-docHead{display:flex;flex-direction:column;gap:2px}
.lm-docTitle{font-size:14px;font-weight:600}
.lm-docMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-docTabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.lm-docTab{font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}
.lm-docTabActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.lm-docBody{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;max-height:44vh;overflow:auto}
.lm-docRead{min-width:0;font-size:14px;line-height:1.75;overflow-wrap:anywhere}
.lm-docRead p,.lm-docRead li,.lm-docRead blockquote{white-space:pre-wrap}
.lm-docRead pre{max-width:100%;overflow-x:auto;white-space:pre;overflow-wrap:normal;word-break:normal;line-height:1.5}
.lm-docRead pre code{white-space:inherit;overflow-wrap:normal;word-break:normal}
.lm-docRead table{display:block;max-width:100%;overflow-x:auto;white-space:normal}
.lm-docRead img{max-width:100%;height:auto}
.lm-docEditor{min-height:160px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.lm-docMessage{margin-top:6px}
.lm-docDiffWrap{display:flex;flex-direction:column;gap:6px}
.lm-docDiff{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap}
.lm-docDiffRow{display:flex;gap:8px;border-radius:4px;padding:0 4px}
.lm-docDiffAdd{background:rgba(40,170,90,.14)}
.lm-docDiffDel{background:rgba(200,60,60,.14)}
.lm-docDiffSign{flex:0 0 auto;width:10px;color:var(--dsw-alias-label-secondary)}
.lm-docDiffText{flex:1 1 auto;min-width:0;word-break:break-word}
.lm-docColumns{display:flex;gap:8px;align-items:flex-start}
.lm-docColumn{flex:1 1 0;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px;max-height:30vh;overflow:auto}
.lm-docColumnTitle{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.lm-docColumnBody{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word}
.lm-docHunk{margin-bottom:10px}
.lm-docHunkRange{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.lm-docHistory{display:flex;flex-direction:column;gap:2px}
.lm-docHistoryRow{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.lm-docVersionRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lm-docVersionId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.lm-docVersionMessage{font-size:12px}
.lm-docEventRow{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lm-docCreate{display:flex;flex-direction:column;gap:2px}
.lm-docConfirm{align-items:center;gap:8px;margin-top:4px}
.lm-docRenameRow{margin-top:2px}
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
    /* @ux-shell:message-model:start */
/** Display-only rows. Exact author identities and transcript order remain authoritative. */
function roomMessageRows(messages, { self = {}, members = [], peers = [] } = {}) {
  const rows=Array.isArray(messages)?messages:[];
  const text=value=>typeof value==='string'?value.trim():'';
  const stamp=message=>message?.at??message?.receivedAt??message?.sentAt??'';
  const identity=message=>{const from=message?.from;return text(from?.nodeId)&&text(from?.sessionId)?JSON.stringify([from.nodeId,from.sessionId]):null;};
  const boundary=message=>message?.kind!=='room-message'||['skillRefs','documentRefs','structuredMentions','mentions','attachments'].some(key=>Array.isArray(message?.[key])&&message[key].length>0)||!!message?.file||!!message?.contextSelection||!!message?.contextPack;
  return rows.map((message,index)=>{
    const previous=rows[index-1];const timestamp=stamp(message),before=stamp(previous);
    const time=typeof timestamp==='string'&&timestamp!==''?Date.parse(timestamp):NaN;
    const prior=typeof before==='string'&&before!==''?Date.parse(before):NaN;
    const sameDay=Number.isFinite(time)&&Number.isFinite(prior)&&new Date(time).toDateString()===new Date(prior).toDateString();
    const continuation=!!previous&&identity(message)!==null&&identity(message)===identity(previous)&&!boundary(message)&&!boundary(previous)&&sameDay&&time>=prior&&time-prior<=180000;
    const nodeId=text(message?.from?.nodeId),sessionId=text(message?.from?.sessionId);
    const member=members.find(row=>row.nodeId===nodeId&&row.sessionId===sessionId);
    const peer=peers.find(row=>row.nodeId===nodeId);
    const deviceName=nodeId&&nodeId===self.nodeId?text(self.name):text(member?.nodeName)||text(peer?.name);
    return {message,continuation,timestamp:typeof timestamp==='string'?timestamp:'',kind:sessionId==='human'?'human':sessionId?'agent':'system',nodeId,sessionId,deviceLabel:nodeId?(deviceName?deviceName+' · '+nodeId:nodeId):'来源设备未知'};
  });
}
    /* @ux-shell:message-model:end */

    /* @ux-shell:timeline-model:start */
/** Local reading position only; does not change Room/Inbox read state. */
function createRoomTimeline() {
 let ids=[],pending=new Set(),following=true,top=0,anchor=null;
 const view=()=>({follow:following,pending:pending.size,top});
 return {
  update(messages){
   const next=[...new Set((Array.isArray(messages)?messages:[]).map(row=>typeof row?.id==='string'?row.id:'').filter(Boolean))];
   const known=new Set(ids);const anchor=ids.length?next.lastIndexOf(ids[ids.length-1]):-1;
   const arrivals=(anchor>=0?next.slice(anchor+1):next).filter(id=>!known.has(id));
   const retained=new Set(next);pending=new Set([...pending].filter(id=>retained.has(id)));
   if(following)pending.clear();else for(const id of arrivals)pending.add(id);
   ids=next;return view();
  },
  observe(node){
   const height=Number(node?.scrollHeight),size=Number(node?.clientHeight),position=Number(node?.scrollTop);
   if([height,size,position].every(Number.isFinite)){
    top=Math.max(0,position);following=height-size-top<=80;
    if(following){pending.clear();anchor=null;}
    else {
     const viewport=node.getBoundingClientRect?.();
     const first=viewport&&[...(node.querySelectorAll?.('[data-message-id]')??[])].find(row=>row.getBoundingClientRect().bottom>viewport.top);
     anchor=first?{id:first.getAttribute('data-message-key')||first.getAttribute('data-message-id'),offset:first.getBoundingClientRect().top-viewport.top}:null;
    }
   }
   return view();
  },
  restore(node){
   if(following||!node)return;
   const match=anchor&&[...(node.querySelectorAll?.('[data-message-id]')??[])].find(row=>(row.getAttribute('data-message-key')||row.getAttribute('data-message-id'))===anchor.id);
   if(match&&node.getBoundingClientRect){node.scrollTop+=match.getBoundingClientRect().top-node.getBoundingClientRect().top-anchor.offset;}
   else node.scrollTop=top;
   top=node.scrollTop;
  },
  pause(){following=false;return view();},
  jump(){following=true;anchor=null;pending.clear();return view();},
  current:view,
 };
}
    /* @ux-shell:timeline-model:end */

    /* @ux-shell:history-model:start */
/** Local display cache: exact origin + message ID, order unchanged, newer metadata wins. */
function mergeRoomTranscript(earlier,current) {
 const result=[],positions=new Map();
 for(const message of [...(Array.isArray(earlier)?earlier:[]),...(Array.isArray(current)?current:[])]){
  const node=message?.from?.nodeId,id=message?.id;
  const key=typeof node==='string'&&typeof id==='string'?JSON.stringify([node,id]):null;
  if(key!==null&&positions.has(key))result[positions.get(key)]=message;
  else{if(key!==null)positions.set(key,result.length);result.push(message);}
 }
 return result;
}
    /* @ux-shell:history-model:end */

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
     * Every candidate names its machine. Two sessions on that machine can carry
     * the same title ("新会话"), so those rows also append a short session id.
     * @param {object[]} members - room members.
     * @returns {(member: object) => string} label per member.
     */
    function mentionLabels(members) {
      const rows = Array.isArray(members) ? members : [];
      return (member) => {
        const label = labelOf(member);
        if (label === '') return label;
        const machine = member.nodeName || member.nodeId || '';
        const duplicates = rows.filter((row) => labelOf(row) === label &&
          (row.nodeName || row.nodeId || '') === machine);
        return `${label} · ${machine}${duplicates.length > 1 ? ` · ${shortId(member.sessionId ?? '')}` : ''}`;
      };
    }

    /** Keep identities only for unchanged mention spans across a draft edit. */
    function editedMentions(mentions, before, after, edit) {
      if (before === after) return mentions;
      let start = 0;
      while (start < before.length && start < after.length && before[start] === after[start]) start++;
      let oldEnd = before.length;
      let newEnd = after.length;
      while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      if (edit) ({ start, oldEnd, newEnd } = edit);
      return mentions.flatMap((item) => {
        const token = `@${item.label}`;
        // Text alone cannot tell which identical occurrence was edited. Drop
        // ambiguous identities rather than transferring them to typed text.
        // Picker replacements supply their exact range and do not need to guess.
        if (!edit && (before.split(token).length > 2 || after.split(token).length > 2)) return [];
        let retained;
        if (item.end <= start) retained = item;
        else if (item.start >= oldEnd) retained = { ...item, start: item.start + newEnd - oldEnd, end: item.end + newEnd - oldEnd };
        if (!retained || after.slice(retained.start, retained.end) !== token) return [];
        if (retained.start > 0 && !/\s/.test(after[retained.start - 1])) return [];
        if (retained.end < after.length && !/\s/.test(after[retained.end])) return [];
        return [retained];
      });
    }

    /**
     * The `/` token being typed, if the caret sits in one.
     *
     * A slash only opens the skill menu at the very start of what is being
     * written, because that is where a command is typed; `/` in the middle of
     * a sentence is ordinary prose ("and/or") and must stay that way.
     * @param {string} text - composer contents.
     * @param {number} caret - caret offset in `text`.
     * @returns {{ start: number, length: number, query: string } | undefined}
     */
    function slashAt(text, caret) {
      const body = typeof text === 'string' ? text : '';
      const at = typeof caret === 'number' && caret >= 0 && caret <= body.length ? caret : body.length;
      // Rewind to the beginning of the current line.
      let lineStart = body.lastIndexOf('\n', at - 1) + 1;
      const head = body.slice(lineStart, at);
      // The token must be the first thing on its line, with no space before it.
      if (!head.startsWith('/')) return undefined;
      if (/\s/.test(head.slice(1))) return undefined;
      const query = head.slice(1);
      return { start: lineStart, length: query.length + 1, query };
    }

    /**
     * Skills whose name or description contains the typed prefix.
     *
     * A name prefix outranks a description hit, then the shorter name wins so
     * `/de` offers "deploy" before "deploy-notes".
     * @param {object[]} skills - catalogue rows.
     * @param {string} query - text after `/`.
     * @returns {object[]} matches, best first.
     */
    function matchSkill(skills, query) {
      const needle = String(query ?? '').trim().toLowerCase();
      const rows = Array.isArray(skills) ? skills : [];
      return rows
        .filter((row) => typeof row?.name === 'string' && row.name !== '')
        .filter((row) => {
          if (needle === '') return true;
          const name = row.name.toLowerCase();
          const description = typeof row.description === 'string' ? row.description.toLowerCase() : '';
          return name.includes(needle) || description.includes(needle);
        })
        .sort((left, right) => {
          const leftName = left.name.toLowerCase();
          const rightName = right.name.toLowerCase();
          const leftStarts = needle !== '' && leftName.startsWith(needle) ? 0 : 1;
          const rightStarts = needle !== '' && rightName.startsWith(needle) ? 0 : 1;
          if (leftStarts !== rightStarts) return leftStarts - rightStarts;
          if (leftName.length !== rightName.length) return leftName.length - rightName.length;
          return leftName.localeCompare(rightName);
        });
    }

    /**
     * How the picker names one skill: its name plus the node it came from.
     *
     * Two machines can both offer `deploy`, and a reference that cannot say
     * which one it meant is worse than no reference at all, so the source node
     * is always shown rather than only when it looks ambiguous.
     * @param {object} skill - catalogue row.
     * @returns {string}
     */
    function skillSourceLabel(skill) {
      const name = typeof skill?.sourceNodeName === 'string' ? skill.sourceNodeName : '';
      if (name !== '') return name;
      const id = typeof skill?.sourceNodeId === 'string' ? skill.sourceNodeId : '';
      return id;
    }

    /**
     * How a received skill reference relates to this node's catalogue.
     *
     * Three answers, because two would lie. A reference names a skill at a
     * particular node, and this node may hold (a) that very row, (b) a different
     * skill that happens to share the name, or (c) nothing by that name. Only
     * (a) proves identity: a shared name is not a shared skill, and references
     * carry no version, so (b) is neither "the same capability" nor "not
     * installed here".
     * @param {object[]} skills - this node's catalogue rows.
     * @param {{ name?: string, sourceNodeId?: string }} ref - received reference.
     * @returns {'exact' | 'namesake' | 'missing'}
     */
    function skillRefState(skills, ref) {
      const rows = Array.isArray(skills) ? skills : [];
      const name = typeof ref?.name === 'string' ? ref.name : '';
      if (name === '') return 'missing';
      const named = rows.filter((row) => row?.name === name);
      if (named.length === 0) return 'missing';
      const source = typeof ref?.sourceNodeId === 'string' ? ref.sourceNodeId : '';
      if (source === '') return 'namesake';
      return named.some((row) => row?.sourceNodeId === source) ? 'exact' : 'namesake';
    }

    /**
     * One message's skill references, filtered to the well-formed ones.
     * @param {object} message - room message.
     * @returns {object[]}
     */
    function skillRefsOf(message) {
      const rows = Array.isArray(message?.skillRefs) ? message.skillRefs : [];
      return rows.filter((row) => row !== null && typeof row === 'object' && typeof row.name === 'string' && row.name !== '');
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
     * Reuse the plugin stylesheet element, updating its contents on plugin reload.
     * @returns {void}
     */
    function installStyles() {
      if (typeof document === 'undefined') return;
      const existing = document.getElementById(STYLE_ID);
      const style = existing ?? document.createElement('style');
      style.id = STYLE_ID;
      // Plugin reloads keep the document: retaining the tag must not retain old CSS.
      if (style.textContent !== CSS) style.textContent = CSS;
      style.dataset.lanMeshVersion = PLUGIN_VERSION;
      if (!existing) document.head.appendChild(style);
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
      const status = STATUS_ORDER.includes(task.status) ? task.status : 'unknown';
      // The service lets the leader move any task and an assignee move their own.
      const canMove = STATUS_ORDER.includes(task.status)&&canMoveRoomTask({task,nodeId:props.nodeId,sessionId:props.sessionId,isLeader:props.isLeader});
      const busy = props.busy === task.id;
      return h(
        'div',
        { className: 'lm-task' },
        h(
          'div',
          { className: 'lm-taskHead' },
          h('span', { className: STATUS_CLASS[status] ?? 'lm-status' }, STATUS_LABELS[status] ?? '未知状态'),
          h('span', { className: 'lm-taskTitle' }, task.title),
          h(
            'span',
            { className: 'lm-taskAssignee' },
            `${COPY.assignee}: ${labelOf(task.assignee) || '?'} · ${task.assignee?.nodeId || '来源未知'}`,
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
      const deviceName=member.nodeName||(props.peers??[]).find(row=>row.nodeId===member.nodeId)?.name||(member.nodeId===props.self?.nodeId?props.self.name:'');
      const deviceLabel=(deviceName?deviceName+' · ':'')+(member.nodeId||'来源未知');
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
        h('span', { className: member.live === true ? 'lm-mdot' : 'lm-mdot lm-mdotIdle',title:member.live===true?'节点近期可见；不代表Agent正在运行':'可见状态未确认' }),
        h('span',{className:'lm-memberIdentity'},h('span',{className:'lm-memberName'},labelOf(member)),h('span',{className:'lm-memberDevice'},(member.sessionId==='human'?'人类':'Agent')+' · '+deviceLabel)),
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
    function AttachmentCard({refData:ref,roomId}) {
      const [error,setError]=React.useState('');
      const [retry,setRetry]=React.useState(0);
      const url='/api/lan-mesh/attachments?'+new URLSearchParams({room:roomId,blobId:ref.blobId});
      const download=async()=>{
        try {const response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw Error(await response.text());const blob=await response.blob();const link=document.createElement('a');const objectURL=URL.createObjectURL(blob);link.href=objectURL;link.download=ref.name;link.click();URL.revokeObjectURL(objectURL);setError('');}
        catch(e){setError(COPY.attachmentUnavailable+' — '+errorText(e));}
      };
      return h('div',{className:'lm-attachment'},
        /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(ref.mediaType)&&!error?h('a',{href:url+'&preview=1',target:'_blank',rel:'noopener'},h('img',{key:retry,src:url+'&preview=1',alt:ref.name,onError:()=>setError(COPY.attachmentUnavailable),style:{maxWidth:160,maxHeight:120}})):null,
        h('span',null,ref.name+' · '+formatFileSize(ref.size)),h('button',{type:'button',onClick:download},COPY.download),
        error?h('span',{role:'alert'},error,h('button',{type:'button',onClick:()=>{setError('');setRetry(n=>n+1);}},COPY.attachmentRetry)):null);
    }

    /* @ux-shell:body-model:start */
/** Preserve the exact Markdown source; folding changes only its visible height. */
function messageBodyView(value) {
 const source=typeof value==='string'?value:String(value??'');
 const code=source.match(/^\s*(`{3,}|~{3,})[^\n]*\r?\n([\s\S]*?)\r?\n\1\s*$/);
 const previewLines=code?12:8;
 const lineCount=(code?code[2]:source).split(/\r?\n/).length;
 return {source,previewLines,codeOnly:!!code,collapsible:lineCount>previewLines||source.length>900};
}
const copyMessageSource = async (source,clipboard) => {
 if(typeof clipboard?.writeText!=='function')return {status:'unavailable'};
 try{await clipboard.writeText(source);return {status:'copied'};}catch{return {status:'failed'};}
};
    /* @ux-shell:body-model:end */
    /* @ux-shell:body-component:start */
/** Rendering only: original source always reaches the host Markdown component. */
function MessageBody(props) {
 const {h,React}=props;
 const view=props.viewOf(props.text);
 const [expanded,setExpanded]=React.useState(false);
 const [copyState,setCopyState]=React.useState('idle');
 const lifetime=React.useRef({alive:true,pending:false});
 React.useEffect(()=>{lifetime.current.alive=true;return()=>{lifetime.current.alive=false;};},[]);
 React.useEffect(()=>{props.onLayoutChanged?.();},[expanded]);
 const copy=async()=>{
  if(lifetime.current.pending)return;
  lifetime.current.pending=true;setCopyState('copying');
  const result=await props.copySource(view.source,props.clipboard);
  lifetime.current.pending=false;if(lifetime.current.alive)setCopyState(result.status);
 };
 if(view.source==='')return null;
 const collapsed=view.collapsible&&!expanded;
 const feedback=copyState==='copied'?'已复制全文':copyState==='failed'?'复制失败，请重试':copyState==='unavailable'?'当前环境不支持复制，请手动选择正文':'';
 return h('div',{className:'lm-messageBody'},
  collapsed?h('span',{className:'lm-messageSummary'},view.source.slice(0,180)+'…正文已折叠，展开全文阅读'):null,
  h('div',{id:props.bodyId,ref:node=>{if(node)node.inert=collapsed;},className:'lm-messageText'+(collapsed?' lm-messageTextCollapsed':'')+(view.codeOnly?' lm-messageCodePreview':'')},
   props.MarkdownText?h(props.MarkdownText,{text:view.source,labels:props.labels}):h('div',{className:'lm-bubblePlain'},view.source)),
  h('div',{className:'lm-messageBodyActions'},
   view.collapsible?h('button',{type:'button',className:'lm-messageExpand','aria-expanded':expanded,'aria-controls':props.bodyId,onClick:()=>setExpanded(value=>!value)},expanded?'收起全文':'展开全文'):null,
   h('button',{type:'button',className:'lm-messageCopy',disabled:copyState==='copying',onClick:copy},copyState==='copying'?'正在复制…':'复制全文'),
   feedback?h('span',{className:'lm-messageCopyState',role:'status','aria-live':'polite'},feedback):null));
}
    /* @ux-shell:body-component:end */

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
       const body = text===''?null:h(MessageBody,{h,React,text,viewOf:messageBodyView,copySource:copyMessageSource,clipboard:window.navigator?.clipboard,MarkdownText,labels:markdownLabels(),bodyId:message.id?'lm-message-body-'+encodeURIComponent(message.id):undefined,onLayoutChanged:props.onLayoutChanged});
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
       // Two attachments can share identical bytes (same blobId) but different
       // file names, or the same file can be selected twice. The blob is still
       // content-addressed in storage, but each card needs a stable per-message
       // key so React never collapses or mis-orders them.
       (message.attachments??[]).forEach((ref,index)=>bubbleContents.push(h(AttachmentCard,{key:`${ref.blobId}/${index}`,refData:ref,roomId:props.roomId})));
       // Skill references ride beside the text, never inside it: the body keeps
       // the exact words the sender typed, and the chips name the capabilities
       // they pointed at along with the node that owns each one. A reference
       // this node cannot resolve stays visible, because the reader still has to
       // see what was meant; one that merely shares a name with a local skill
       // says exactly that instead of impersonating the sender's capability.
       const refs = skillRefsOf(message);
       if (refs.length > 0) {
         const catalogue = Array.isArray(props.skills) ? props.skills : [];
         bubbleContents.push(
           h(
             'div',
             { className: 'lm-skillRefs', role: 'group', 'aria-label': COPY.skillRefsAria },
             h('span', { className: 'lm-skillRefsLabel' }, `${COPY.skillRefsLabel}:`),
             ...refs.map((ref, index) => {
               const state = skillRefState(catalogue, ref);
               const note =
                 state === 'missing' ? COPY.skillMissing : state === 'namesake' ? COPY.skillNamesake : '';
               const source = String(ref.sourceNodeName ?? '') || String(ref.sourceNodeId ?? '');
               const title = `${ref.name}${note === '' ? '' : ` \u00b7 ${note}`}` +
                 (source === '' ? '' : ` \u00b7 ${COPY.skillSourceOf} ${source}`);
               return h(
                 'span',
                 {
                   key: `${ref.sourceNodeId ?? ''}/${ref.name}/${index}`,
                   className:
                     state === 'exact'
                       ? 'lm-skillRef'
                       : state === 'namesake'
                         ? 'lm-skillRef lm-skillRefNamesake'
                         : 'lm-skillRef lm-skillRefMissing',
                   title,
                 },
                 h('span', { className: 'lm-skillRefName' }, String(ref.name)),
                 source === '' ? null : h('span', { className: 'lm-skillRefSource' }, `${COPY.skillSourceOf} ${source}`),
                 note === '' ? null : h('span', { className: 'lm-skillRefBadge' }, note),
               );
             }),
           ),
         );
       }
       // Who spoke decides the tint: a person and an agent read differently at
       // a glance, and the rule follows the session, so a message synced from
       // another machine keeps its speaker's colour.
       const kind = props.kind === 'human' || props.kind === 'agent' ? props.kind : 'system';
       const bubbleClass =
         'lm-bubble lm-bubble' + (kind === 'human' ? 'Human' : kind === 'agent' ? 'Agent' : 'System') +
         (props.mine === true ? ' lm-bubbleMine' : '');
       return h(
         'div',
         { className: (props.mine ? 'lm-bubbleRow lm-bubbleRowMine' : 'lm-bubbleRow')+(props.messageRow?.continuation?' lm-messageContinuation':''), 'data-message-id':message.id??undefined,'data-message-key':typeof message.id==='string'?JSON.stringify([message.from?.nodeId??'',message.id]):undefined },
         h(
           'div',
           { className: 'lm-bubbleMeta' },
           props.messageRow?.continuation ? null : h('strong', { className: 'lm-bubbleWho lm-bubbleWho' + (kind === 'human' ? 'Human' : kind === 'agent' ? 'Agent' : 'System') }, sender),
           props.messageRow?.continuation ? null : h('span',{className:'lm-messageKind'},kind==='human'?'人类':kind==='agent'?'Agent':'系统'),
           props.messageRow?.continuation ? null : h('span',{className:'lm-messageDevice'},props.messageRow?.deviceLabel||'来源设备未知'),
           h('time', { className: 'lm-bubbleWhen', dateTime:props.messageRow?.timestamp||undefined,title:props.messageRow?.timestamp||messageStamp(message),'aria-label':sender+' · '+(props.messageRow?.timestamp||messageStamp(message)) }, messageStamp(message)),
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
    function createAttachmentDraft({room, limits, onChange}) {
      let rows=[], live=true; const jobs=new Set();
      const notify=()=>{if(live)onChange([...rows]);};
      const upload=async row=>{
        row.controller=new AbortController();row.status='uploading';row.error='';notify();
        try {
          const bytes=await row.file.arrayBuffer();
          if(!live||!rows.includes(row))return;
          const hash=await crypto.subtle.digest('SHA-256',bytes);
          if(!live||!rows.includes(row))return;
          const blobId=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
          const query=new URLSearchParams({room,blobId,name:row.file.name,size:String(row.file.size)});
          const response=await fetch('/api/lan-mesh/attachments?'+query,{method:'POST',credentials:'same-origin',headers:{'content-type':row.mediaType},body:row.file,signal:row.controller.signal});
          if(!response.ok)throw new Error(await response.text()||'Upload failed');
          const ref=await response.json();
          if(live&&rows.includes(row)){row.ref=ref;row.status='ready';notify();}
        }catch(error){if(live&&rows.includes(row)){row.status='error';row.error=String(error.message||error);notify();}}
      };
      const start=row=>{const job=upload(row);jobs.add(job);job.finally(()=>jobs.delete(job));};
      const remove=id=>{const row=rows.find(r=>r.id===id);if(!row)return;row.controller?.abort();if(row.preview)URL.revokeObjectURL(row.preview);rows=rows.filter(r=>r!==row);notify();};
      return {
        get rows(){return rows;},
        updateLimits(value){limits=value;},
        add(files){
          const list=Array.from(files);if(!list.length)return;
          if(!limits)throw new Error(COPY.attachmentLimitsMissing);
          if(rows.length+list.length>limits.maxAttachments||list.some(f=>!Number.isSafeInteger(f.size)||f.size<0||f.size>limits.maxFileBytes||f.isDirectory||f.webkitRelativePath)||rows.reduce((n,r)=>n+r.file.size,0)+list.reduce((n,f)=>n+f.size,0)>Math.min(limits.maxMessageBytes,limits.maxTotalBytes??Infinity))throw new Error(COPY.fileTooLarge);
          const next=list.map(file=>({id:crypto.randomUUID(),file,mediaType:file.type||'application/octet-stream',preview:/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.type)?URL.createObjectURL(file):'',status:'uploading'}));
          rows.push(...next);notify();next.forEach(start);
        },remove,retry(id){const row=rows.find(r=>r.id===id);if(row?.status==='error')start(row);},
        ready(){return rows.every(r=>r.status==='ready');},
        clear(){[...rows].forEach(r=>remove(r.id));},
        dispose(){live=false;[...rows].forEach(r=>remove(r.id));},
        async settled(){await Promise.all([...jobs]);}
      };
    }
    // Attachment draft end

    /**
     * Line-level diff without a dependency: the common prefix and suffix are
     * context, whatever sits between them is the change. Markdown bodies are
     * small enough that an O(n) trim beats carrying a diff engine.
     * @param {string} baseText - the text the reader is comparing from.
     * @param {string} nextText - the text to compare against.
     * @returns {Array<{ sign: string, text: string }>} rows in reading order.
     */
    function docLineDiff(baseText, nextText) {
      const base = String(baseText ?? '').split('\n');
      const next = String(nextText ?? '').split('\n');
      let head = 0;
      while (head < base.length && head < next.length && base[head] === next[head]) head += 1;
      let tail = 0;
      while (
        tail < base.length - head &&
        tail < next.length - head &&
        base[base.length - 1 - tail] === next[next.length - 1 - tail]
      ) {
        tail += 1;
      }
      const rows = [];
      for (let i = 0; i < head; i += 1) rows.push({ sign: ' ', text: base[i] });
      for (let i = head; i < base.length - tail; i += 1) rows.push({ sign: '-', text: base[i] });
      for (let i = head; i < next.length - tail; i += 1) rows.push({ sign: '+', text: next[i] });
      for (let i = base.length - tail; i < base.length; i += 1) rows.push({ sign: ' ', text: base[i] });
      return rows;
    }

    /**
     * A document history row's timestamp. `HistoryRow` names it `createdAt`,
     * while a room message names it `at`, so the two stamps stay separate.
     * @param {object} row - document revision or event row.
     * @returns {string} the stamp, or '' when the server sent none.
     */
    function docStamp(row) {
      const value = row?.createdAt ?? row?.at ?? '';
      return String(value).replace('T', ' ').slice(0, 19);
    }

    /**
     * Panel statuses that mean "the server said no". Anything else is a
     * success: the document endpoints differ in their success word
     * (`clean`, `pending`, `confirmed`, …), and this panel must not guess.
     * @param {object} value - the endpoint value.
     * @returns {boolean} true when the call may be treated as accepted.
     */
    function docAccepted(value) {
      const status = value?.status;
      if (typeof status !== 'string') return false;
      return ['unavailable', 'error', 'not-found', 'rejected', 'stale'].includes(status) !== true;
    }

    /**
     * The shared documents of one room: the list, and the four read/edit/diff/
     * history areas plus the three-way conflict area for the open document.
     *
     * Everything rendered here comes from the server; the only permission
     * inputs are `DocumentView.canConfirm` and `DocumentView.isMaintainer`,
     * both read from the response and never inferred from a local role.
     * Author names, titles and commit messages are untrusted text and are only
     * ever rendered as children so the renderer escapes them.
     *
     * @param {{ roomId: string, call: Function, isMember: boolean, onChanged?: Function }} props
     * @returns {object} pane element.
     */
    function DocumentsPane(props) {
      const roomId = String(props.roomId ?? '');
      const call = props.call;
      const canCreate = props.isMember === true;

      const [list, setList] = React.useState({ status: 'loading', documents: [], reason: '' });
      const [selectedId, setSelectedId] = React.useState('');
      const [view, setView] = React.useState({ status: 'idle', document: null, revision: null, reason: '' });
      const [mode, setMode] = React.useState('read');
      /** The edit draft survives a rejected save; only an accepted one clears it. */
      const [editText, setEditText] = React.useState('');
      const [editBase, setEditBase] = React.useState('');
      const [baseContent, setBaseContent] = React.useState('');
      const [editMessage, setEditMessage] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [noticeBad, setNoticeBad] = React.useState(false);
      const [history, setHistory] = React.useState({ status: 'idle', revisions: [], events: [], cursor: '', reason: '' });
      const [conflict, setConflict] = React.useState(null);
      const [resolveText, setResolveText] = React.useState('');
      const [pending, setPending] = React.useState(null);
      const [createOpen, setCreateOpen] = React.useState(false);
      const [newTitle, setNewTitle] = React.useState('');
      const [newContent, setNewContent] = React.useState('');
      const [newMessage, setNewMessage] = React.useState('');
      const [renaming, setRenaming] = React.useState(false);
      const [titleDraft, setTitleDraft] = React.useState('');
      const readSequence = React.useRef(0);
      const documentLifetime = React.useRef({live:true});
      const proposalRetry = React.useRef(null);
      const creationRetry = React.useRef(null);
      const [deliveriesOpen, setDeliveriesOpen] = React.useState(false);
      const [deliveries, setDeliveries] = React.useState({status:'idle', rows:[], reason:''});
      const deliverySequence = React.useRef(0);
      React.useEffect(() => () => { deliverySequence.current += 1; }, [roomId]);
      const loadDeliveries = async () => {
        const sequence = ++deliverySequence.current;
        setDeliveriesOpen(true);setDeliveries({status:'loading',rows:[],reason:''});
        try {const value=await call('contextDeliveries',{roomId,limit:20});
          if(sequence!==deliverySequence.current)return;
          setDeliveries({status:value?.status==='ready'?'ready':'error',rows:Array.isArray(value?.deliveries)?value.deliveries:[],reason:String(value?.reason??'')});
        }catch(error){if(sequence===deliverySequence.current)setDeliveries({status:'error',rows:[],reason:errorText(error)});}
      };
      const importRetry = React.useRef(null);
      React.useEffect(() => () => { readSequence.current += 1; documentLifetime.current.live=false; }, [roomId]);

      const flash = React.useCallback((text, bad) => {
        setNotice(text);
        setNoticeBad(bad === true);
      }, []);

      const loadList = React.useCallback(async () => {
        try {
          const value = await call('documents', { roomId });
          setList({
            status: value?.status === 'ready' ? 'ready' : 'unavailable',
            documents: Array.isArray(value?.documents) ? value.documents : [],
            reason: String(value?.reason ?? ''),
            offline:value?.offline===true,
          });
        } catch (error) {
          setList({ status: 'error', documents: [], reason: errorText(error) });
        }
      }, [call, roomId]);

      React.useEffect(() => {
        loadList();
      }, [loadList]);

      /**
       * Read one document (optionally one of its revisions).
       * `keepDraft` is how a conflict refresh leaves the user's draft alone.
       */
      const readDocument = React.useCallback(
        async (documentId, revisionId, keepDraft) => {
          const sequence = ++readSequence.current;
          const payload = { documentId };
          if (typeof revisionId === 'string' && revisionId !== '') payload.revisionId = revisionId;
          const value = await call('documentRead', payload);
          if (sequence !== readSequence.current) return null;
          const document = value?.document ?? null;
          setView({
            status: value?.status === 'ready' ? 'ready' : 'unavailable',
            document,
            revision: value?.revision ?? null,
            offline:value?.offline===true,
            reason: String(value?.reason ?? ''),
          });
          if (document !== null && keepDraft !== true) {
            const content = String(document.content ?? '');
            setEditText(content);
            setBaseContent(content);
            setEditBase(String(value?.revision?.revisionId ?? document.headRevisionId ?? ''));
          }
          return value;
        },
        [call],
      );

      const openDocument = React.useCallback(
        async (documentId) => {
          setBusy('read');
          try {
            const read = await readDocument(documentId, '', false);
            if (!read) return;
            setMode('read');
            const proposal = read.proposal ?? read.document?.proposal ?? null;
            if (proposal?.status === 'conflicted' || (proposal && typeof proposal.baseContent === 'string' && proposal.status !== 'pending')) {
              setConflict({documentId, proposal, base:String(proposal.baseContent ?? ''), current:String(proposal.currentContent ?? read.document?.content ?? ''), proposed:String(proposal.proposedContent ?? '')});
              setResolveText(String(proposal.resolutionContent ?? proposal.proposedContent ?? ''));
              setPending(null);
            } else {
              setConflict(null);
              setPending(proposal?.status === 'pending' ? {documentId,proposal,headRevisionId:String(read.document?.headRevisionId ?? '')} : null);
            }
            setHistory({ status: 'idle', revisions: [], events: [], cursor: '', reason: '' });
          } catch (error) {
            setView({ status: 'error', document: null, revision: null, reason: errorText(error) });
          } finally {
            setBusy('');
          }
        },
        [readDocument],
      );

      const loadHistory = React.useCallback(
        async (cursor) => {
          const document = view.document;
          if (document === null || document === undefined) return;
          setBusy('history');
          try {
            const payload = { documentId: String(document.documentId ?? '') };
            if (typeof cursor === 'string' && cursor !== '') payload.cursor = cursor;
            const value = await call('documentHistory', payload);
            const revisions = Array.isArray(value?.revisions) ? value.revisions : [];
            const events = Array.isArray(value?.events) ? value.events : [];
            const firstPage = typeof cursor !== 'string' || cursor === '';
            setHistory((current) => ({
              status: value?.status === 'ready' ? 'ready' : 'unavailable',
              revisions: firstPage ? revisions : current.revisions.concat(revisions),
              events: firstPage ? events : current.events.concat(events),
              cursor: String(value?.nextCursor ?? ''),
              reason: String(value?.reason ?? ''),
            }));
          } catch (error) {
            setHistory({ status: 'error', revisions: [], events: [], cursor: '', reason: errorText(error) });
          } finally {
            setBusy('');
          }
        },
        [call, view.document],
      );

      const saveEdit = async () => {
        const document = view.document;
        if (document === null || document === undefined) return;
        const documentId = String(document.documentId ?? '');
        const baseRevisionId = editBase !== '' ? editBase : String(document.headRevisionId ?? '');
        setBusy('save');
        try {
          const signature = JSON.stringify([documentId, baseRevisionId, editText, editMessage]);
          if (proposalRetry.current?.signature !== signature) proposalRetry.current = {signature, proposalId: 'prop-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)};
          const value = await call('documentPropose', {
            proposalId: proposalRetry.current.proposalId,
            documentId,
            baseRevisionId,
            content: editText,
            message: editMessage,
          });
          if (!documentLifetime.current.live) return;
          const status = String(value?.status ?? '');
          if (docAccepted(value)) proposalRetry.current = null;
          if (status === 'conflict') {
            // The draft stays exactly as typed: the user is about to resolve it.
            const fresh = await readDocument(documentId, '', true);
            const current = String(fresh?.document?.content ?? document.content ?? '');
            setConflict({
              documentId,
              proposal: value?.proposal ?? null,
              base: baseContent !== '' ? baseContent : String(document.content ?? ''),
              current,
              proposed: editText,
            });
            setResolveText(editText);
            flash(COPY.docConflictFound, true);
          } else if (status === 'pending') {
            setPending({
              documentId,
              proposal: value?.proposal ?? null,
              headRevisionId: baseRevisionId,
            });
            flash(COPY.docPending, false);
            await readDocument(documentId, '', true);
          } else if (docAccepted(value) !== true) {
            flash(`${COPY.error}: ${String(value?.reason ?? '')}`, true);
          } else {
            setConflict(null);
            setPending(null);
            setEditMessage('');
            flash(COPY.docSaved, false);
            await openDocument(documentId);
            await loadList();
          }
          props.onChanged?.();
        } catch (error) {
          if (!documentLifetime.current.live) return;
          // A transport failure is not a reason to throw the draft away either.
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const submitResolution = async () => {
        if (conflict === null) return;
        const documentId = String(conflict.documentId ?? '');
        setBusy('resolve');
        try {
          const value = await call('documentResolve', {
            documentId,
            proposalId: String(conflict.proposal?.proposalId ?? ''),
            content: resolveText,
            message: editMessage,
          });
          if (docAccepted(value) !== true) {
            flash(`${COPY.error}: ${String(value?.reason ?? '')}`, true);
            return;
          }
          const proposal = value?.proposal ?? conflict.proposal ?? null;
          const head = String(view.document?.headRevisionId ?? '');
          setConflict(null);
          flash(COPY.docResolved, false);
          // Re-read so `canConfirm` is the server's fresh answer, not the one
          // from before the resolution.
          await openDocument(documentId);
          setPending({ documentId, proposal, headRevisionId: editBase !== '' ? editBase : head });
          await loadList();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const confirmPending = async () => {
        if (pending === null) return;
        const documentId = String(pending.documentId ?? '');
        setBusy('confirm');
        try {
          // Never confirm against a stale head: read first, decide after.
          const fresh = await call('documentRead', { documentId });
          const freshDocument = fresh?.document ?? null;
          const freshHead = String(freshDocument?.headRevisionId ?? '');
          if (freshDocument === null || freshDocument?.canConfirm !== true) {
            setPending(null);
            flash(COPY.docConfirmStale, true);
            await openDocument(documentId);
          } else if (freshHead !== String(pending.headRevisionId ?? '')) {
            setPending(null);
            flash(COPY.docConfirmStale, true);
            await openDocument(documentId);
          } else {
            const value = await call('documentConfirm', {
              documentId,
              proposalId: String(pending.proposal?.proposalId ?? ''),
            });
            if (docAccepted(value) !== true) {
              flash(`${COPY.error}: ${String(value?.reason ?? '')}`, true);
            } else {
              setPending(null);
              flash(COPY.docConfirmed, false);
            }
            await openDocument(documentId);
            await loadList();
          }
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const copyRevision = async (revisionId) => {
        const document = view.document;
        if (document === null || document === undefined) return;
        setBusy('copy');
        try {
          const value = await call('documentRead', {
            documentId: String(document.documentId ?? ''),
            revisionId: String(revisionId ?? ''),
          });
          if (value?.status !== 'ready' || !value.document) throw new Error(value?.reason || '历史版本不可用');
          const content = String(value.document.content ?? value?.revision?.content ?? '');
          setEditText(content);
          // Copying an old revision into the editor does not move the base:
          // the next proposal is still built on the current head.
          setEditBase(String(document.headRevisionId ?? ''));
          setBaseContent(String(document.content ?? ''));
          setMode('edit');
          flash(COPY.docCopied, false);
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const doCreate = async () => {
        const title = newTitle.trim();
        if (title === '') {
          flash(COPY.docNeedTitle, true);
          return;
        }
        setBusy('create');
        try {
          const fingerprint = JSON.stringify([roomId, title, newContent]);
          if (creationRetry.current?.fingerprint !== fingerprint) creationRetry.current = {fingerprint, requestId: crypto.randomUUID()};
          const value = await call('documentCreate', {
            requestId: creationRetry.current.requestId,
            roomId,
            title,
            content: newContent,
            message: newMessage,
          });
          if (docAccepted(value) !== true) {
            flash(`${COPY.error}: ${String(value?.reason ?? '')}`, true);
            return;
          }
          creationRetry.current = null;
          const created = value?.document ?? null;
          setCreateOpen(false);
          setNewTitle('');
          setNewContent('');
          setNewMessage('');
          flash(COPY.docCreated, false);
          await loadList();
          if (created?.documentId !== undefined) {
            setSelectedId(String(created.documentId));
            await openDocument(String(created.documentId));
          }
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const doRename = async () => {
        const document = view.document;
        if (document === null || document === undefined) return;
        const title = titleDraft.trim();
        if (title === '') {
          flash(COPY.docNeedTitle, true);
          return;
        }
        setBusy('rename');
        try {
          const value = await call('documentRename', { documentId: String(document.documentId ?? ''), title });
          if (docAccepted(value) !== true) {
            flash(`${COPY.error}: ${String(value?.reason ?? '')}`, true);
            return;
          }
          setRenaming(false);
          flash(COPY.docRenamed, false);
          await openDocument(String(document.documentId ?? ''));
          await loadList();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const doArchive = async () => {
        const document = view.document;
        if (document === null || document === undefined) return;
        setBusy('archive');
        try {
          const value = await call('documentArchive', { documentId: String(document.documentId ?? '') });
          if (docAccepted(value) !== true) {
            flash(`${COPY.error}: ${String(value?.reason ?? '')}`, true);
            return;
          }
          setSelectedId('');
          setView({ status: 'idle', document: null, revision: null, reason: '' });
          flash(COPY.docArchived, false);
          await loadList();
          props.onChanged?.();
        } catch (error) {
          flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          setBusy('');
        }
      };

      const stateLine =
        list.status === 'loading'
          ? h('div', { className: 'lm-muted lm-docListState' }, COPY.docLoading)
          : list.status === 'unavailable' || list.status === 'error'
            ? h(
                'div',
                { className: 'lm-error lm-note lm-docListState' },
                `${COPY.docUnavailable}${list.reason === '' ? '' : `: ${list.reason}`}`,
              )
            : null;

      const listBlock =
        stateLine !== null
          ? stateLine
          : list.documents.length === 0
            ? h('div', { className: 'lm-muted lm-docListState' }, COPY.docEmpty)
            : h(
                'div',
                { className: 'lm-docList' },
                ...list.documents.map((row) =>
                  h(
                    'button',
                    {
                      key: row.documentId ?? labelOf(row),
                      type: 'button',
                      className:
                        String(row.documentId ?? '') === selectedId ? 'lm-docRow lm-docRowActive' : 'lm-docRow',
                      onClick: () => {
                        setSelectedId(String(row.documentId ?? ''));
                        openDocument(String(row.documentId ?? ''));
                      },
                    },
                    h('span', { className: 'lm-docRowTitle' }, String(row.title ?? '')),
                    h('span', { className: 'lm-docRowHead' }, shortId(row.headRevisionId)),
                    h('span', { className: 'lm-docRowAuthor' }, String(row.authorName ?? '')),
                    row.relatedTaskId === undefined || row.relatedTaskId === ''
                      ? null
                      : h('span', { className: 'lm-docRowTask' }, `${COPY.docTask} ${shortId(row.relatedTaskId)}`),
                    typeof row.conflictCount === 'number' && row.conflictCount > 0
                      ? h('span', { className: 'lm-docConflicts' }, `${COPY.docConflicts} ${row.conflictCount}`)
                      : null,
                  ),
                ),
              );

      const createForm = h(
        'div',
        { className: 'lm-docCreate lm-card' },
        h('div', { className: 'lm-label' }, COPY.docNew),
        h('input', {
          className: 'lm-input lm-docTitleInput',
          value: newTitle,
          placeholder: COPY.docNewTitleHint,
          'aria-label': COPY.docNewTitle,
          onChange: (event) => setNewTitle(event.target.value),
        }),
        h('textarea', {
          className: 'lm-textarea lm-textareaShort lm-docContentInput',
          value: newContent,
          placeholder: COPY.docNewContent,
          'aria-label': COPY.docNewContent,
          onChange: (event) => setNewContent(event.target.value),
        }),
        h('input', {
          className: 'lm-input lm-docMessageInput',
          value: newMessage,
          placeholder: COPY.docNewMessage,
          'aria-label': COPY.docNewMessage,
          onChange: (event) => setNewMessage(event.target.value),
        }),
        h(
          'div',
          { className: 'lm-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'lm-btn lm-btnPrimary lm-btnSmall lm-docCreateBtn',
              disabled: busy === 'create',
              onClick: doCreate,
            },
            busy === 'create' ? COPY.docCreating : COPY.docNewCreate,
          ),
          h('button', { type: 'button', className: 'lm-btn lm-btnSmall', onClick: () => setCreateOpen(false) }, COPY.collapse),
        ),
      );

      const document = view.document;
      let detailBlock = null;

      if (document !== null && document !== undefined) {
        const documentId = String(document.documentId ?? '');
        const body = String(document.content ?? '');
        const tabs = props.readOnly ? ['read','history'] : ['read', 'edit', 'diff', 'history'];
        const tabLabels = {
          read: COPY.docReadTab,
          edit: COPY.docEditTab,
          diff: COPY.docDiffTab,
          history: COPY.docHistoryTab,
        };
        const diffRows = docLineDiff(body, editText);
        const changed = diffRows.some((row) => row.sign !== ' ');

        const editorBlock = h(
          'div',
          { className: 'lm-docEditorWrap' },
          h('textarea', {
            className: 'lm-textarea lm-docEditor',
            value: editText,
            disabled: busy === 'save',
            'aria-label': COPY.docEditTab,
            onChange: (event) => setEditText(event.target.value),
          }),
          h('input', {
            className: 'lm-input lm-docMessageInput',
            value: editMessage,
            placeholder: COPY.docNewMessage,
            'aria-label': COPY.docNewMessage,
            disabled: busy === 'save',
            onChange: (event) => setEditMessage(event.target.value),
          }),
          h(
            'div',
            { className: 'lm-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnPrimary lm-btnSmall lm-docSaveBtn',
                disabled: busy === 'save',
                onClick: saveEdit,
              },
              busy === 'save' ? COPY.docSaving : COPY.docSave,
            ),
            h('span', { className: 'lm-muted lm-note' }, `${COPY.docBaseline} ${shortId(editBase)}`),
          ),
        );

        const diffBlock = h(
          'div',
          { className: 'lm-docDiffWrap' },
          h('div', { className: 'lm-muted lm-note' }, COPY.docDiffTitle),
          changed === true
            ? h(
                'div',
                { className: 'lm-docDiff' },
                ...diffRows.map((row, index) =>
                  h(
                    'div',
                    {
                      key: `${index}-${row.sign}`,
                      className:
                        row.sign === '+'
                          ? 'lm-docDiffRow lm-docDiffAdd'
                          : row.sign === '-'
                            ? 'lm-docDiffRow lm-docDiffDel'
                            : 'lm-docDiffRow',
                    },
                    h('span', { className: 'lm-docDiffSign' }, row.sign),
                    h('span', { className: 'lm-docDiffText' }, row.text),
                  ),
                ),
              )
            : h('div', { className: 'lm-muted lm-docDiffEmpty' }, COPY.docDiffEmpty),
        );

        const historyBlock = h(
          'div',
          { className: 'lm-docHistoryWrap' },
          h('div', { className: 'lm-muted lm-note' }, COPY.docReadOnly),
          history.status === 'idle' || history.status === 'loading'
            ? h('div', { className: 'lm-muted' }, COPY.docLoading)
            : null,
          history.status === 'unavailable' || history.status === 'error'
            ? h(
                'div',
                { className: 'lm-error lm-note' },
                `${COPY.docUnavailable}${history.reason === '' ? '' : `: ${history.reason}`}`,
              )
            : null,
          history.status === 'ready' && history.revisions.length === 0
            ? h('div', { className: 'lm-muted lm-docHistoryEmpty' }, COPY.docHistoryEmpty)
            : null,
          h(
            'div',
            { className: 'lm-docHistory' },
            ...history.revisions.map((revision) =>
              h(
                'div',
                { key: revision.revisionId ?? messageStamp(revision), className: 'lm-docHistoryRow' },
                h(
                  'div',
                  { className: 'lm-docVersionRow' },
                  h('span', { className: 'lm-docVersionId lm-docRevisionId' }, shortId(revision.revisionId)),
                  h('span', { className: 'lm-docVersionMessage' }, String(revision.message ?? '')),
                  h('span', { className: 'lm-muted' }, String(revision.authorName ?? '')),
                  h('span', { className: 'lm-muted' }, messageStamp(revision)),
                  h('span', { className: 'lm-badge' }, `${COPY.docSource} ${String(revision.source ?? '')}`),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnSmall lm-docCopyBtn',
                      disabled: props.readOnly || busy === 'copy',
                      onClick: () => copyRevision(revision.revisionId),
                    },
                    COPY.docCopy,
                  ),
                ),
                Array.isArray(revision.eventTypes) && revision.eventTypes.length > 0
                  ? h(
                      'div',
                      { className: 'lm-docEventRow' },
                      `${COPY.docEvent} ${revision.eventTypes.map((type) => String(type)).join(', ')}`,
                    )
                  : null,
              ),
            ),
          ),
          history.events.length > 0
            ? h(
                'div',
                { className: 'lm-docEvents' },
                ...history.events.map((event, index) =>
                  h(
                    'div',
                    { key: `${index}`, className: 'lm-docEventRow' },
                    `${COPY.docEvent} ${String(event?.summary ?? event?.type ?? '')}`,
                  ),
                ),
              )
            : null,
          history.cursor === ''
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'lm-btn lm-btnSmall lm-docHistoryMore',
                  disabled: busy === 'history',
                  onClick: () => loadHistory(history.cursor),
                },
                COPY.docHistoryMore,
              ),
        );

        const conflictBlock =
          conflict === null
            ? null
            : h(
                'div',
                { className: 'lm-docConflict' },
                h('div', { className: 'lm-error lm-note' }, COPY.docConflictFound),
                Array.isArray(conflict.proposal?.conflict?.hunks) && conflict.proposal.conflict.hunks.length > 0
                  ? h(
                      'div',
                      { className: 'lm-docHunks' },
                      ...conflict.proposal.conflict.hunks.map((hunk, index) =>
                        h(
                          'div',
                          { key: `${index}`, className: 'lm-docHunk' },
                          h(
                            'div',
                            { className: 'lm-docHunkRange' },
                            `${COPY.docHunk} ${index + 1} · ${COPY.docBaseline} ${String(hunk.baseStart)} ${COPY.docBaselineUnit} ${String(hunk.baseCount)} ${COPY.docLineUnit}`,
                          ),
                        ),
                      ),
                    )
                  : null,
                h(
                  'div',
                  { className: 'lm-docColumns' },
                  h(
                    'div',
                    { className: 'lm-docColumn lm-docColumnBase' },
                    h('div', { className: 'lm-docColumnTitle' }, COPY.docBaseline),
                    h('div', { className: 'lm-docColumnBody' }, String(conflict.base ?? '')),
                  ),
                  h(
                    'div',
                    { className: 'lm-docColumn lm-docColumnCurrent' },
                    h('div', { className: 'lm-docColumnTitle' }, COPY.docCurrent),
                    h('div', { className: 'lm-docColumnBody' }, String(conflict.current ?? '')),
                  ),
                  h(
                    'div',
                    { className: 'lm-docColumn lm-docColumnProposed' },
                    h('div', { className: 'lm-docColumnTitle' }, COPY.docProposed),
                    h('div', { className: 'lm-docColumnBody' }, String(conflict.proposed ?? '')),
                  ),
                ),
                h(
                  'div',
                  { className: 'lm-field' },
                  h('span', { className: 'lm-label' }, COPY.docResolution),
                  h('textarea', {
                    className: 'lm-textarea lm-docResolutionInput',
                    value: resolveText,
                    disabled: busy === 'resolve',
                    'aria-label': COPY.docResolution,
                    onChange: (event) => setResolveText(event.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: 'lm-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnPrimary lm-btnSmall lm-docResolveBtn',
                      disabled: busy === 'resolve',
                      onClick: submitResolution,
                    },
                    busy === 'resolve' ? COPY.docResolving : COPY.docResolve,
                  ),
                ),
              );

        const pendingBlock =
          pending === null
            ? null
            : h(
                'div',
                { className: 'lm-docPending' },
                h('div', { className: 'lm-note' }, COPY.docPending),
                h(
                  'div',
                  { className: 'lm-row lm-docConfirm' },
                  // The server decides who may confirm; this panel only mirrors
                  // `canConfirm` and never derives the capability itself.
                  document.canConfirm === true
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'lm-btn lm-btnPrimary lm-btnSmall lm-docConfirmBtn',
                          disabled: busy === 'confirm',
                          onClick: confirmPending,
                        },
                        busy === 'confirm' ? COPY.docConfirming : COPY.docConfirm,
                      )
                    : null,
                ),
              );

        detailBlock = h(
          'div',
          { className: 'lm-docDetail' },
          h(
            'div',
            { className: 'lm-docHead' },
            h('span', { className: 'lm-docTitle' }, String(document.title ?? '')),
            h(
              'span',
              { className: 'lm-docMeta' },
              `${COPY.docHead} ${shortId(document.headRevisionId)} · ${String(document.contentHash ?? '').slice(0, 8)}`,
            ),
            view.revision === null
              ? null
              : h(
                  'span',
                  { className: 'lm-docMeta' },
                  `${COPY.docAuthor} ${String(view.revision.authorName ?? '')} · ${COPY.docUpdated} ${messageStamp(view.revision)}`,
                ),
          ),
          h(
            'div',
            { className: 'lm-docTabs', role: 'tablist' },
            ...tabs.map((tab) =>
              h(
                'button',
                {
                  key: tab,
                  type: 'button',
                  className: mode === tab ? 'lm-docTab lm-docTabActive' : 'lm-docTab',
                  role: 'tab',
                  'aria-selected': mode === tab,
                  onClick: () => {
                    if (tab === 'edit' && editBase === '') {
                      // Editing always starts from the head this document was
                      // read at, so the base revision cannot drift silently.
                      setEditBase(String(document.headRevisionId ?? ''));
                      setBaseContent(body);
                    }
                    setMode(tab);
                    if (tab === 'history' && history.status === 'idle') loadHistory('');
                  },
                },
                tabLabels[tab],
              ),
            ),
          ),
          mode === 'read'
            ? h(
                'div',
                { className: 'lm-docBody lm-docRead' },
                MarkdownText === undefined
                  ? h('div', { className: 'lm-bubblePlain' }, body)
                  : h(MarkdownText, { text: body, labels: markdownLabels() }),
              )
            : null,
          mode === 'edit' && !props.readOnly ? editorBlock : null,
          mode === 'diff' ? diffBlock : null,
          mode === 'history' ? historyBlock : null,
          props.readOnly ? null : conflictBlock,
          props.readOnly ? null : pendingBlock,
          document.isMaintainer === true && !props.readOnly
            ? h(
                'div',
                { className: 'lm-docAdmin' },
                h(
                  'div',
                  { className: 'lm-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnSmall lm-docRenameBtn',
                      onClick: () => {
                        setTitleDraft(String(document.title ?? ''));
                        setRenaming((open) => open !== true);
                      },
                    },
                    COPY.docRenameDoc,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lm-btn lm-btnSmall lm-docArchiveBtn',
                      disabled: busy === 'archive',
                      onClick: doArchive,
                    },
                    COPY.docArchive,
                  ),
                ),
                renaming === true
                  ? h(
                      'div',
                      { className: 'lm-row lm-docRenameRow' },
                      h('input', {
                        className: 'lm-input lm-docTitleInput',
                        value: titleDraft,
                        'aria-label': COPY.docNewTitle,
                        onChange: (event) => setTitleDraft(event.target.value),
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'lm-btn lm-btnPrimary lm-btnSmall lm-docTitleSave',
                          disabled: busy === 'rename',
                          onClick: doRename,
                        },
                        COPY.save,
                      ),
                    )
                  : null,
              )
            : null,
          h(
            'div',
            { className: 'lm-row lm-docActions' },
            h(
              'button',
              {
                type: 'button',
                className: 'lm-btn lm-btnSmall lm-docRefreshBtn',
                disabled: busy === 'read',
                onClick: () => {
                  openDocument(documentId);
                  loadList();
                },
              },
              COPY.refresh,
            ),
          ),
        );
      }

      return h(
        'div',
        { className: 'lm-docsPane' },
        h(
          'div',
          { className: 'lm-docListHead' },
          h('span', { className: 'lm-docListTitle lm-sectionHead' }, COPY.docList),
          h('button',{type:'button',className:'lm-contextDeliveriesToggle','aria-expanded':deliveriesOpen,onClick:()=>deliveriesOpen?setDeliveriesOpen(false):loadDeliveries()},'上下文投递记录'),

          canCreate ? h('input',{type:'file',accept:'.md,.markdown,text/plain,text/markdown','aria-label':'导入 Markdown',disabled:!!busy,onChange:async(event)=>{
            const file=event.target.files?.[0];if(!file)return;event.target.value='';setBusy('import');
            try{if(file.size>256*1024)throw new Error('文档超过 256 KiB');const content=await file.text();const fingerprint=JSON.stringify([roomId,file.name,content]);if(importRetry.current?.fingerprint!==fingerprint)importRetry.current={fingerprint,requestId:crypto.randomUUID()};const value=await call('documentImport',{roomId,content,name:file.name,title:file.name,requestId:importRetry.current.requestId});if(!docAccepted(value))throw new Error(value?.reason||'导入不可用');importRetry.current=null;await loadList();}catch(error){flash(errorText(error),true);}finally{setBusy('');}
          }}) : null,
          view.offline?h('div',{className:'lm-muted lm-note'},'当前显示本机缓存，恢复连接后同步。'):null,
          view.status==='ready' ? h('button',{type:'button',onClick:async()=>{try{const value=await call('documentExport',{documentId:view.document.documentId,revisionId:view.revision?.revisionId});if(!docAccepted(value)||typeof value.content!=='string')throw new Error(value?.reason||'导出不可用');const url=URL.createObjectURL(new Blob([value.content],{type:'text/markdown;charset=utf-8'}));const link=globalThis.document.createElement('a');link.href=url;link.download=value.name||'document.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){flash(errorText(error),true);}}},'下载 Markdown') : null,
          view.status==='ready' ? h('button',{type:'button',disabled:!view.document.contentHash,onClick:()=>props.onContextSelect?.({documentId:view.document.documentId,revisionId:view.revision?.revisionId??view.document.headRevisionId,contentHash:view.document.contentHash,title:view.document.title})},(props.contextDocuments??[]).some(r=>r.documentId===view.document.documentId)?'取消上下文文档':'选择此版本为上下文') : null,

          canCreate === true
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'lm-btn lm-btnSmall lm-docNewBtn',
                  'aria-pressed': createOpen === true,
                  onClick: () => setCreateOpen((open) => open !== true),
                },
                createOpen === true ? COPY.collapse : COPY.docNew,
              )
            : null,
        ),
        notice === '' ? null : h('div', { className: noticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, notice),
        deliveriesOpen ? h('section',{className:'lm-contextDeliveries','aria-label':'上下文投递记录'},
          deliveries.status==='loading'?h('div',{role:'status'},'正在加载投递记录…'):null,
          deliveries.status==='error'?h('div',{role:'alert'},deliveries.reason||'投递记录不可用'):null,
          h('button',{type:'button',className:'lm-contextDeliveriesRetry',disabled:deliveries.status==='loading',onClick:loadDeliveries},'刷新 / 重试'),
          deliveries.status==='ready'&&deliveries.rows.length===0?h('div',{},'暂无投递记录'):null,
          ...deliveries.rows.map(row=>h('article',{key:row.deliveryId},
            h('div',{},'Agent: '+String(row.recipient??'')+' · '+String(row.status??'')),
            ...(row.packet?.selectedDocumentVersions??[]).map((ref,index)=>h('div',{key:String(ref.documentId??index)},String(ref.title??ref.documentId??'')+' · '+String(ref.revisionId??'')+' · '+String(ref.contentHash??''))),
            ...(row.packet?.taskResultRefs??[]).map(ref=>h('div',{key:'result:'+ref.executionId},
              '成果 · '+ref.executionId+' · '+ref.resultHash+' · '+({review:'待审查',accepted:'已验收',failed:'失败',blocked:'受阻',cancelled:'已取消',unverified:'未经核验'}[ref.reviewStatus]??'未知状态')))
          ))) : null,
        createOpen === true ? createForm : null,
        listBlock,
        detailBlock,
      );
    }

    /* @ux-shell:room-tabs:start */
/** Public Room navigation only; it never grants task or membership authority. */
function RoomTabs(props) {
 const {h}=props,ids=['chat','docs','tasks','members'];
 const labels=props.labels??{chat:'对话',docs:'文档',tasks:'任务',members:'成员'};
 const count=value=>Number.isFinite(value)?' '+Math.max(0,Math.trunc(value)):'';
 return h('div',{className:'lm-roomTabs',role:'tablist','aria-label':'房间内容'},...ids.map((id,index)=>h('button',{
  key:id,type:'button',id:props.prefix+'-'+id+'-tab',role:'tab','data-tab':id,
  className:'lm-roomTab lm-roomTab-'+id+(props.value===id?' lm-roomTabActive':''),
  'aria-selected':props.value===id,'aria-controls':props.prefix+'-'+id+'-panel',tabIndex:props.value===id?0:-1,
  onClick:()=>props.onSelect(id),onKeyDown:event=>{
   let target;if(event.key==='ArrowRight')target=(index+1)%ids.length;else if(event.key==='ArrowLeft')target=(index+ids.length-1)%ids.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=ids.length-1;else return;
   event.preventDefault();props.onSelect(ids[target]);event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[target]?.focus();
  },
 },labels[id]+(id==='tasks'?count(props.tasks):id==='members'?count(props.members):''))));
}
    /* @ux-shell:room-tabs:end */

    function RoomPane(props) {
      const roomId = String(props.room?.id ?? '');
      const sessionId = props.sessionId;
      const call = props.call;
      const localAgents = Array.isArray(props.localAgents) ? props.localAgents : [];
      const draftScope={nodeId:props.self?.nodeId??'',sessionId:sessionId??HUMAN_SESSION_ID,roomId};
      const draftRecord=roomComposerDrafts.get(draftScope);
      const draftLifetime=React.useRef({alive:true});
      React.useEffect(()=>{draftLifetime.current.alive=true;return()=>{draftLifetime.current.alive=false;};},[draftRecord]);
      const draftField=(name,initial)=>useComposerField(React,draftRecord,name,initial,()=>draftLifetime.current.alive);

      const [contextDocuments, setContextDocuments] = draftField('contextDocuments',[]);
      const [contextResults,setContextResults]=draftField('contextResults',[]);
      const contextSelection={
        ...(contextDocuments.length?{selectedDocumentVersions:contextDocuments.map(({documentId,revisionId,contentHash})=>({documentId,revisionId,contentHash}))}:{}),
        ...(contextResults.length?{selectedTaskResults:contextResults.map(({executionId,resultHash})=>({executionId,resultHash}))}:{}),
      };
      const [documentCatalogue,setDocumentCatalogue]=React.useState({status:'idle',rows:[]});
      const [documentPicking,setDocumentPicking]=React.useState(false);
      const documentPicker=React.useRef({alive:true,pending:false,sequence:0});
      const composerSnapshot=React.useRef({});
      React.useEffect(()=>{documentPicker.current.alive=true;return()=>{documentPicker.current.alive=false;documentPicker.current.pending=false;documentPicker.current.sequence++;};},[roomId]);
      const [history,setHistory]=React.useState({messages:[],cursor:null,status:'idle',error:''});
      const historyFlight=React.useRef(false);
      const historyRoom=React.useRef(roomId);historyRoom.current=roomId;
      React.useEffect(()=>{setHistory({messages:[],cursor:null,status:'idle',error:''});historyFlight.current=false;},[roomId]);
      const roomReadSequence=React.useRef(0);
      const [detail, setDetail] = React.useState({ status: 'loading', room: null, messages: [], viewer: null, error: '' });
      const [draft, setDraft] = draftField('draft','');
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [noticeBad, setNoticeBad] = React.useState(false);
      const [,setDraftPulse]=React.useState(0);
      React.useEffect(()=>roomComposerDrafts.watch(draftRecord,()=>setDraftPulse(value=>value+1)),[draftRecord]);
      const [renaming, setRenaming] = React.useState(false);
      const [nameDraft, setNameDraft] = React.useState('');
      const [assignee, setAssignee] = draftField('assignee','');
      const [taskTitle, setTaskTitle] = draftField('taskTitle','');
      const [taskDetail, setTaskDetail] = draftField('taskDetail','');
      /** Caret position, so `@` completion knows which token is being typed. */
      const [caret, setCaret] = draftField('caret',0);
      /** Set by Escape, so the list can be dismissed without changing the text. */
      const [mentionOff, setMentionOff] = React.useState(false);
      /** Highlighted row of the `@` completion list. */
      const [mentionPick, setMentionPick] = React.useState(0);
      /** Selected identities; readable labels are never routing authority. */
      const [draftMentions, setDraftMentions] = draftField('draftMentions',[]);
      /** Member being renamed locally, plus the draft for the nickname. */
      const [nickMember, setNickMember] = React.useState(null);
      const [nickDraft, setNickDraft] = React.useState('');
      /** Local session the leader wants to pull into this room. */
      const [inviteSession, setInviteSession] = React.useState('');
      /** Whether the member row is expanded — collapsed by default to keep
       *  the room pane focused on conversation instead of a list of faces. */
      /** Quick-task: when checked, the next message also becomes a task
       *  assigned to the first @mentioned member (or everyone if @all). */
      const [quickTask, setQuickTask] = draftField('quickTask',false);
      /** Local originals and uploaded references stay in this room draft until acceptance. */
      const [attachmentRows, setAttachmentRows] = React.useState(()=>[...(draftRecord.attachments?.rows??[])]);
      const attachmentDraft = React.useRef(null);
      const sendAttempt = draftRecord.attempt;
      React.useEffect(()=>{
        const unsubscribe=roomComposerDrafts.bindAttachments(draftRecord,notify=>createAttachmentDraft({room:roomId,limits:props.attachmentLimits,onChange:notify}),setAttachmentRows,props.attachmentLimits);
        const draft=draftRecord.attachments;attachmentDraft.current=draft;setBusy('');
        return ()=>{if(attachmentDraft.current===draft)attachmentDraft.current=null;unsubscribe();};
      },[draftRecord]);
      React.useEffect(()=>{draftRecord.attachments?.updateLimits?.(props.attachmentLimits);},[draftRecord,props.attachmentLimits?.maxFileBytes,props.attachmentLimits?.maxMessageBytes,props.attachmentLimits?.maxAttachments,props.attachmentLimits?.maxTotalBytes]);

      /**
       * This node's public skill catalogue, as the Host reported it.
       * `status` is 'idle' before the first read, then 'ready' or 'unavailable'
       * — a node without a skill registry must say so rather than look empty.
       */
      const [skillCatalogue, setSkillCatalogue] = React.useState({ status: 'idle', skills: [], reason: '' });
      /** Confirmed skill references for the message being written. */
      const [draftSkills, setDraftSkills] = draftField('draftSkills',[]);
      /** Whether the shared skill menu is open, and its query/highlight. */
      const [skillMenuOpen, setSkillMenuOpen] = React.useState(false);
      const [skillQuery, setSkillQuery] = React.useState('');
      const [skillPick, setSkillPick] = React.useState(0);
      const chatRef = React.useRef(null);
      const timeline = React.useRef(null);
      if(timeline.current===null)timeline.current=createRoomTimeline();
      const [newMessageCount,setNewMessageCount]=React.useState(0);
      const jumpToLatest=()=>{timeline.current.jump();setNewMessageCount(0);const node=chatRef.current;if(node)node.scrollTop=node.scrollHeight;};
      const observeChat=event=>setNewMessageCount(timeline.current.observe(event.currentTarget).pending);
      const followLoadedContent=()=>{const node=chatRef.current;if(node){if(timeline.current.current().follow)node.scrollTop=node.scrollHeight;else timeline.current.restore(node);}};
      /**
       * Which content view the room shows. Chat is the default and the state is
       * deliberately per-mount: docs/ui-contract.md keeps it out of
       * localStorage so two rooms never share a remembered tab.
       */
      const [panelTab, setPanelTab] = React.useState('chat');
      React.useEffect(()=>setPanelTab('chat'),[roomId]);

      const flash = React.useCallback((text, bad) => {
        setNotice(text);
        setNoticeBad(bad === true);
      }, []);

      const load = React.useCallback(async () => {
        if(!draftLifetime.current.alive)return;
        const request=++roomReadSequence.current;
        try {
          const value = await call('roomDetail', { room: roomId, sessionId });
          if(!draftLifetime.current.alive||request!==roomReadSequence.current)return;
          setHistory(current=>({...current,messages:mergeRoomTranscript(current.messages,value?.messages)}));
          setDetail({
            status: 'ready',
            room: value?.room ?? null,
            messages: Array.isArray(value?.messages) ? value.messages : [],
            viewer: value?.viewer ?? null,
            error: '',
          });
        } catch (error) {
          // A transient failure keeps the last good transcript on screen.
          if(draftLifetime.current.alive&&request===roomReadSequence.current)setDetail((current) => ({ ...current, status: 'error', error: errorText(error) }));
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

      /**
       * Read this node's skill catalogue once per room visit.
       *
       * The catalogue is a property of the node, not of the room, so it is read
       * on demand the first time the picker is opened and kept for the rest of
       * the visit. A failure leaves the composer working and the picker honest:
       * `unavailable` is a state the user can read, not an empty list that
       * would look like "this node has no skills".
       */
      const skillState = React.useRef({ loading: false, loaded: false });
      const loadSkills = React.useCallback(async () => {
        if (skillState.current.loading === true) return;
        skillState.current.loading = true;
        try {
          const value = await call('roomSkills', {});
          const status = value?.status === 'ready' ? 'ready' : 'unavailable';
          setSkillCatalogue({
            status,
            skills: Array.isArray(value?.skills) ? value.skills : [],
            reason: typeof value?.reason === 'string' ? value.reason : '',
          });
        } catch (error) {
          setSkillCatalogue({ status: 'unavailable', skills: [], reason: errorText(error) });
        } finally {
          skillState.current.loading = false;
          skillState.current.loaded = true;
        }
      }, [call]);
      React.useEffect(() => {
        // Read it with the room, so a received reference can already say
        // whether this node has that skill without waiting for a click.
        loadSkills();
      }, [loadSkills]);

      const view = detail.room ?? props.room ?? {};
      const viewer = detail.viewer ?? { isMember: true, isLeader: props.room?.isLeader === true, role: '' };
      const isLeader = viewer.isLeader === true;
      const roomArchived = view.lifecycle?.status === 'archived';
      const members = Array.isArray(view.members) ? view.members : [];
      const tasks = Array.isArray(view.tasks) ? view.tasks : [];
      // Only the conversation belongs in the chat: `room-task` rows are the
      // assignment notices and they are already shown in the task list.
      const messageRows = roomMessageRows(mergeRoomTranscript(history.messages,detail.messages),{self:props.self,members,peers:props.peers}).filter(row=>row.message?.kind==='room-message');
      const messages = messageRows.map(row=>row.message);

      // Following belongs to this chat viewport, never the document or Inbox count.
      const loadEarlier=async()=>{
        if(historyFlight.current||!draftLifetime.current.alive)return;
        const first=mergeRoomTranscript(history.messages,detail.messages)[0];
        if(chatRef.current){timeline.current.observe(chatRef.current);timeline.current.pause();}
        historyFlight.current=true;setHistory(current=>({...current,status:'loading',error:''}));
        try{
          const value=await call('roomHistory',{room:roomId,limit:50,...(history.cursor?{cursor:history.cursor}:first?.id&&first?.from?.nodeId?{before:{id:first.id,nodeId:first.from.nodeId}}:{})});
          if(!draftLifetime.current.alive||historyRoom.current!==roomId)return;
          if(!Array.isArray(value?.messages)||typeof value?.cursor!=='string')throw Error('历史返回格式不可用');
          setHistory(current=>({...current,messages:mergeRoomTranscript(value.messages,current.messages),cursor:value.cursor,status:'ready',error:''}));
        }catch(error){if(draftLifetime.current.alive&&historyRoom.current===roomId)setHistory(current=>({...current,status:'error',error:errorText(error)}));}
        finally{historyFlight.current=false;}
      };
      const timelineMessages=messages.map(message=>({id:typeof message.id==='string'?JSON.stringify([message.from?.nodeId??'',message.id]):null}));
      const transcriptIdentity=JSON.stringify(timelineMessages.map(message=>message.id));
      React.useEffect(()=>{
        if(detail.status!=='ready'||panelTab!=='chat')return;
        const reading=timeline.current.update(timelineMessages);
        setNewMessageCount(reading.pending);
        const node=chatRef.current;
        if(node){
          if(reading.follow)node.scrollTop=node.scrollHeight;
          else timeline.current.restore(node);
        }
      },[detail.status,transcriptIdentity,panelTab]);
      const self = props.self ?? {};
      const selfMember = members.find((member) => member.sessionId === sessionId);
      const selfName = selfMember?.name || self.name || '';
      const selfLabel = self.selfName || (selfMember === undefined ? '' : labelOf(selfMember));
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
      composerSnapshot.current={draft,caret,contextDocuments};
      const mention = mentionOff ? undefined : mentionAt(draft, caret);
      React.useEffect(()=>{
        if(mention===undefined&&contextDocuments.length===0)return;
        let live=true;setDocumentCatalogue(current=>({...current,status:'loading'}));
        call('documents',{roomId}).then(value=>{
          if(!live)return;
          if(value?.status!=='ready')throw Error(value?.reason||'文档列表暂不可用');
          setDocumentCatalogue({status:'ready',rows:(value.documents??[]).filter(row=>row.headRevisionId&&row.archived!==true)});
        }).catch(error=>{if(live)setDocumentCatalogue({status:'error',rows:[],reason:errorText(error)});});
        return()=>{live=false;};
      },[mention!==undefined,contextDocuments.length,roomId,call]);
      // Rows show disambiguated labels; the draft keeps readable text and keys
      // separately so selecting a duplicate never changes its target identity.
      const mentionLabel = mentionLabels(members);
      const memberMatches = mention === undefined ? [] : matchMention(members, mention.query, mentionLabel);
      // Include "@all" in the popup when the query is empty or matches "all".
      const allEntry = { __all: true, name: COPY.mentionAll, title: COPY.mentionAll };
      const query = (mention?.query ?? '').toLowerCase();
      const showAll = mention !== undefined && (query === '' || '所有成员'.includes(query) || 'all'.startsWith(query));
      const memberCandidates=showAll?[allEntry,...memberMatches]:memberMatches;
      const documentCandidates=mention===undefined?[]:documentCatalogue.rows.filter(row=>(String(row.title)+' '+row.documentId).toLowerCase().includes(query)).map(row=>({...row,__document:true}));
      const matches=documentCandidates.length?[...memberCandidates.slice(0,8-Math.min(4,documentCandidates.length)),...documentCandidates.slice(0,4)]:memberCandidates;
      React.useEffect(() => {
        setMentionPick(0);
      }, [mention?.query]);
      const applyDocumentMention=async(row)=>{
        const picker=documentPicker.current;
        if(!mention||picker.pending)return;
        if(contextDocuments.length>=8&&!contextDocuments.some(ref=>ref.documentId===row.documentId)){flash('最多引用8份文档',true);return;}
        const snapshot={draft,caret,token:{...mention}},sequence=++picker.sequence;
        picker.pending=true;setDocumentPicking(true);setMentionOff(true);
        try{
          const result=await call('documentRead',{documentId:row.documentId,revisionId:row.headRevisionId});
          if(!picker.alive||picker.sequence!==sequence)return;
          const current=composerSnapshot.current;
          if(current.draft!==snapshot.draft||current.caret!==snapshot.caret){flash('输入已变化，请重新选择文档',true);return;}
          if(result?.status!=='ready'||result.document?.documentId!==row.documentId||result.document.roomId!==roomId||result.revision?.revisionId!==row.headRevisionId||!/^[a-f0-9]{64}$/.test(result.document.contentHash))throw Error('文档版本不可用，请刷新后重试');
          if(current.contextDocuments.length>=8&&!current.contextDocuments.some(ref=>ref.documentId===row.documentId))throw Error('最多引用8份文档');
          const reference={documentId:row.documentId,revisionId:row.headRevisionId,contentHash:result.document.contentHash,title:String(row.title??row.documentId)};
          setContextDocuments(current.contextDocuments.filter(ref=>ref.documentId!==row.documentId).concat(reference));
          const next=snapshot.draft.slice(0,snapshot.token.start)+snapshot.draft.slice(snapshot.token.start+snapshot.token.length);
          setDraft(next);setCaret(snapshot.token.start);
          setDraftMentions(rows=>editedMentions(rows,snapshot.draft,next,{start:snapshot.token.start,oldEnd:snapshot.token.start+snapshot.token.length,newEnd:snapshot.token.start}));
        }catch(error){if(picker.alive&&picker.sequence===sequence){flash(errorText(error),true);setMentionOff(false);}}
        finally{if(picker.alive&&picker.sequence===sequence){picker.pending=false;setDocumentPicking(false);}}
      };
      const applyMention = (member) => {
        if (mention === undefined) return;
        if(member.__document){void applyDocumentMention(member);return;}
        const insert = member.__all === true
          ? 'all '
          : `${labelOf(member)} `;
        const next = `${draft.slice(0, mention.start)}@${insert}${draft.slice(mention.start + mention.length)}`;
        setDraft(next);
        const retained = editedMentions(draftMentions, draft, next, {
          start: mention.start, oldEnd: mention.start + mention.length,
          newEnd: mention.start + insert.length + 1,
        });
        if (member.__all !== true && member.key) {
          retained.push({ memberKey: member.key, label: labelOf(member), start: mention.start,
            end: mention.start + insert.length });
        }
        setDraftMentions(member.__all === true ? [] : retained);
        setCaret(mention.start + insert.length + 1);
        setMentionOff(false);
      };

      // ——— skill references ———
      // A reference is created only by picking a row from this menu. Text that
      // merely looks like a slash command stays text, so typing "/deploy" in a
      // sentence never becomes a claim about a capability.
      const available = Array.isArray(skillCatalogue.skills) ? skillCatalogue.skills : [];
      const slash = mentionOff ? undefined : slashAt(draft, caret);
      // The `/` menu and the toolbar button share one list: `skillMenuOpen`
      // may be true with no slash token at all (the button opened it).
      const skillMenuVisible = skillMenuOpen || slash !== undefined;
      const effectiveQuery = slash !== undefined ? slash.query : skillQuery;
      const skillMatches = skillMenuVisible ? matchSkill(available, effectiveQuery) : [];
      React.useEffect(() => {
        setSkillPick(0);
      }, [effectiveQuery, skillMenuVisible]);

      /** Close the menu and clear the query the button/search box left behind. */
      const closeSkillMenu = () => {
        setSkillMenuOpen(false);
        setSkillQuery('');
        setSkillPick(0);
      };

      /**
       * Turn one picked skill into a confirmed reference.
       *
       * Picking removes the `/query` text it replaced, so the message reads as
       * prose plus a chip instead of a half-typed command, and appends the
       * reference to the draft's skill list. The chip is the only record: the
       * text does not encode the reference.
       * @param {object} skill - catalogue row chosen from the menu.
       */
      const applySkill = (skill) => {
        if (skill === null || skill === undefined) return;
        const already = draftSkills.some(
          (row) => row.name === skill.name && row.sourceNodeId === skill.sourceNodeId,
        );
        if (!already) {
          setDraftSkills((current) => [
            ...current,
            {
              name: String(skill.name),
              sourceNodeId: String(skill.sourceNodeId ?? ''),
              sourceNodeName: String(skill.sourceNodeName ?? ''),
            },
          ]);
        }
        if (slash !== undefined) {
          // Drop the token the menu consumed; keep the caret where it began.
          const next = `${draft.slice(0, slash.start)}${draft.slice(slash.start + slash.length)}`;
          setDraft(next);
          setCaret(slash.start);
          setDraftMentions((current) => editedMentions(current, draft, next, {
            start: slash.start, oldEnd: slash.start + slash.length, newEnd: slash.start,
          }));
        }
        closeSkillMenu();
      };

      /** Drop one confirmed reference; the message text is left untouched. */
      const removeSkill = (skill) => {
        setDraftSkills((current) =>
          current.filter((row) => !(row.name === skill.name && row.sourceNodeId === skill.sourceNodeId)),
        );
      };

      /** The toolbar button: open the whole catalogue, no slash needed. */
      const toggleSkillMenu = () => {
        if (skillMenuVisible) {
          closeSkillMenu();
          return;
        }
        if (skillCatalogue.status === 'idle') loadSkills();
        setSkillQuery('');
        setSkillMenuOpen(true);
      };

      const intakeFiles = files => {if(busy==='say')return;try{attachmentDraft.current.add(files);}catch(error){flash(errorText(error),true);}};
      const onFilePicked = event => {intakeFiles(event.target.files||[]);event.target.value='';};
      const transferFiles = (event, paste=false) => {
        const transfer=paste?event.clipboardData:event.dataTransfer;
        const items=Array.from(transfer?.items||[]);
        if(items.some(i=>i.webkitGetAsEntry?.()?.isDirectory)){event.preventDefault();flash(COPY.attachmentDirectory,true);return;}
        const files=Array.from(transfer?.files||[]).filter(f=>!paste||f.type.startsWith('image/'));
        if(files.length){event.preventDefault();intakeFiles(files);}
      };

      const doSay = async () => {
        if(documentPicker.current.pending)return;
        const readableSkills = draftSkills.map((skill) => `/${skill.name}`)
          .filter((token) => !draft.split(/\s+/u).includes(token));
        const text = [draft.trim(), ...readableSkills].filter(Boolean).join('\n') || attachmentRows.map(row=>row.file.name).join(', ');
        if (busy==='say' || !attachmentDraft.current?.ready()) return;
        if (text === '' && attachmentRows.length === 0) {
          flash(COPY.needMessage, true);
          return;
        }
        const sendingDraft=attachmentDraft.current;
        setBusy('say');
        try {
          const sayArgs = { room: roomId, sessionId, text, ...(Object.keys(contextSelection).length?{contextSelection}:{}) };
          if (draftMentions.length > 0 && !/@all(?:\s|$)/i.test(text)) sayArgs.mentions = draftMentions.map(({ memberKey, label }) => ({ memberKey, label }));
          // Only confirmed picks become references. `skillRefs` is metadata for
          // the reader, never an instruction to this node: nothing is loaded,
          // installed, or invoked on the strength of one.
          if (draftSkills.length > 0) {
            sayArgs.skillRefs = draftSkills.map(({ name, sourceNodeId, sourceNodeName }) => ({
              name,
              sourceNodeId,
              sourceNodeName,
            }));
          }
          if (attachmentRows.length) sayArgs.attachments=attachmentRows.map(row=>row.ref);
          const fingerprint=JSON.stringify(sayArgs);
          if(sendAttempt.current?.fingerprint!==fingerprint)sendAttempt.current={fingerprint,messageId:window.crypto.randomUUID()};
          sayArgs.messageId=sendAttempt.current.messageId;
          const submittedAttempt=sendAttempt.current,submittedRevision=draftRecord.revision;
          const value = await call('roomSay', sayArgs);
          const delivered = Array.isArray(value?.delivered) ? value.delivered : [];
          const failed = delivered.filter((row) => row.ok !== true);
          if(draftLifetime.current.alive){if (failed.length > 0) flash(`${COPY.deliverFailed}: ${failed[0].name ?? ''} ${failed[0].error ?? ''}`, true);else flash('', false);}
          roomComposerDrafts.acknowledge(draftRecord,submittedAttempt,submittedRevision);
          // Quick-task flow: if the user ticked the "as task" box, turn the
          // message into a task right after it was sent. The title is the
          // first line (or first 40 chars), and the assignee is the first
          // @mention in the text — falling back to the room leader (i.e. the
          // sender) if nobody was named.
          if (quickTask === true && isLeader === true && !submittedAttempt.taskStarted) {
            submittedAttempt.taskStarted=true;
            const firstLine = text.split('\n')[0].trim();
            const title = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
            const detail = firstLine.length <= 40 ? text.slice(firstLine.length).trim() : text;
            // Pull the first @mention out of the text: "@name" at a word boundary.
            const mentionMatch = text.match(/@(\S+)/);
            let assigneeHandle = '';
            if (draftMentions.length > 0) {
              assigneeHandle = draftMentions[0].memberKey;
            } else if (mentionMatch !== null) {
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
              await call('roomAssign', {
                room: roomId,
                sessionId,
                assignee: assigneeHandle,
                title,
                detail,
              });
            } catch (taskError) {
              if(draftLifetime.current.alive)flash(`${COPY.taskFailed}: ${errorText(taskError)}`, true);
            }
          }
          if(draftLifetime.current.alive){await load();props.onChanged?.();}
        } catch (error) {
          if(attachmentDraft.current===sendingDraft)flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          if(attachmentDraft.current===sendingDraft)setBusy('');
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
          roomComposerDrafts.drop(draftScope);
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
        if(documentPicker.current.pending||draftRecord.taskPending)return;
        if (taskTitle.trim() === '') {
          flash(COPY.needTaskTitle, true);
          return;
        }
        const submittedForm={taskTitle,taskDetail,assignee},pendingTask={};
        draftRecord.taskPending=pendingTask;roomComposerDrafts.changed(draftRecord);
        setBusy('assign');
        try {
          const value = await call('roomAssign', {
            room: roomId,
            sessionId,
            assignee: assigneeValue,
            title: taskTitle.trim(),
            detail: taskDetail,
            ...(Object.keys(contextSelection).length?{contextSelection}:{}),
          });
          const delivered = Array.isArray(value?.delivered) ? value.delivered : [];
          const failed = delivered.filter((row) => row.ok !== true);
          if(draftLifetime.current.alive){if (failed.length > 0) flash(`${COPY.deliverFailed}: ${failed[0].name ?? ''} ${failed[0].error ?? ''}`, true);else flash(COPY.assigned, false);}
          roomComposerDrafts.acknowledgeForm(draftRecord,submittedForm);
          if(draftLifetime.current.alive){await load();props.onChanged?.();}
        } catch (error) {
          if(draftLifetime.current.alive)flash(`${COPY.error}: ${errorText(error)}`, true);
        } finally {
          if(draftRecord.taskPending===pendingTask){draftRecord.taskPending=null;roomComposerDrafts.changed(draftRecord);}
          if(draftLifetime.current.alive)setBusy('');
        }
      };

      /**
       * Pull one local agent session into this room.
       *
       * The server decides whether this may happen (the room leader, or a human
       * member of this room). The authority is not something this call can
       * claim: the endpoint is reached only through the owner-authenticated
       * panel route, and the server derives the human rule from that fact. The
       * row is rendered for members and leaders as a convenience only — hiding
       * or showing a button never widens what the server accepts.
       */
      const doInvite = async () => {
        if (inviteSession === '') {
          flash(COPY.inviteNone, true);
          return;
        }
        setBusy('invite');
        try {
          await call('roomInvite', { room: roomId, memberSessionId: inviteSession });
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

      const roomTabPrefix='lm-room-'+encodeURIComponent(roomId);
      const memberContent=panelTab==='members'
            ? h(
                'div',
                { className:'lm-memberPanel lm-roomTabSurface',role:'tabpanel',id:roomTabPrefix+'-members-panel','aria-labelledby':roomTabPrefix+'-members-tab' },
                h(
                  'div',
                  { className: 'lm-memberRow' },
                  ...members.map((member) =>
                    h(MemberChip, {
                      key: member.key ?? `${member.nodeId}/${member.sessionId}`,
                      member,
                      sessionId,
                      nodeId: self.nodeId,
                      self,peers:props.peers,
                      isLeader:isLeader&&!roomArchived,
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
                // discover the room on its own, and so can any human member of the
                // room. Only this node's own sessions are offered, since a peer's
                // membership belongs to the peer. The server re-derives both facts —
                // this is a convenience, never the authorization.
                !roomArchived&&(isLeader === true || viewer.isMember === true)
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
            : null;
      const taskContent=panelTab==='tasks'?h(
          'div',
          { className:'lm-tasksWrap lm-roomTabSurface',role:'tabpanel',id:roomTabPrefix+'-tasks-panel','aria-labelledby':roomTabPrefix+'-tasks-tab' },
          isLeader && sessionId === HUMAN_SESSION_ID ? h(OwnerTeamOverview,{key:roomId,h,React,call,roomId,selectedResults:contextResults,onSelectResult:roomArchived?undefined:ref=>setContextResults(rows=>rows.some(row=>row.executionId===ref.executionId&&row.resultHash===ref.resultHash)?rows.filter(row=>row.executionId!==ref.executionId):rows.filter(row=>row.executionId!==ref.executionId).concat(ref))}) : null,
          panelTab==='tasks'
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
                        nodeId:self.nodeId,
                        isLeader,
                        busy,
                        onStatus: doStatus,
                      }),
                    ),
                isLeader && !roomArchived && members.length > 0
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
                          disabled: busy === 'assign'||!!draftRecord.taskPending,
                          onClick: doAssign,
                        },
                        busy === 'assign'||draftRecord.taskPending ? COPY.assigning : COPY.assignAction,
                      ),
                    )
                  : null,
              )
            : null,
        ):null;

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
                    onClick: () => setPanelTab('members'),
                    title:'查看成员',
                  },
                  `${members.length || view.memberCount} ${COPY.memberCount}`,
                  h('span', { className: 'lm-caret' }, '→'),
                )
              : null,
            h(
              'div',
              { className: 'lm-roomHeadBtns' },
              // Renaming is leader-only on the service, so the button only exists there.
              isLeader && !roomArchived && !renaming
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
          detail.status === 'error'
            ? h('div', { className: 'lm-error lm-note' }, `${COPY.detailUnavailable} ${detail.error}`)
            : null,
          notice === '' ? null : h('div', { className: noticeBad ? 'lm-error lm-note' : 'lm-ok lm-note' }, notice),
        ),

        h(RoomTabs,{h,value:panelTab,prefix:roomTabPrefix,tasks:tasks.length,members:members.length,onSelect:setPanelTab,labels:{chat:COPY.chatTab,docs:COPY.docsTab,tasks:COPY.tasksLabel,members:'成员'}}),
        memberContent,
        taskContent,

        panelTab === 'docs'
          ? h('div',{className:'lm-docsView',role:'tabpanel',id:roomTabPrefix+'-docs-panel','aria-labelledby':roomTabPrefix+'-docs-tab'},h(DocumentsPane, {
              key: `docs-${roomId}`,
              contextDocuments,
              onContextSelect: (ref) => setContextDocuments(rows => rows.some(r => r.documentId === ref.documentId) ? rows.filter(r => r.documentId !== ref.documentId) : rows.length < 8 ? rows.concat(ref) : rows),
              roomId,
              call,
              isMember: viewer.isMember === true && !roomArchived,
              readOnly: roomArchived,
              onChanged: props.onChanged,
            }))
          : null,

        panelTab === 'chat'
          ? h(
          'div',
          { className:'lm-chatView',role:'tabpanel',id:roomTabPrefix+'-chat-panel','aria-labelledby':roomTabPrefix+'-chat-tab' },

        h(
          'div',
          { className: 'lm-chat', ref: chatRef, onScroll:observeChat, onLoad:followLoadedContent },
          h('div',{className:'lm-historyToolbar'},h('button',{type:'button',className:'lm-btn lm-btnSmall lm-loadEarlier',disabled:history.status==='loading',onClick:loadEarlier},history.status==='loading'?'正在加载历史…':history.cursor===''?'重新检查更早记录':'加载更早记录'),h('span',{className:'lm-muted'},history.cursor===''?'已到本机当前保留记录的开头；不代表其他设备历史完整。':'本机历史记录'),history.error?h('span',{role:'alert',className:'lm-error'},history.error):null),
          messages.length === 0
            ? h('div', { className: 'lm-muted' }, detail.status === 'loading' ? COPY.loading : COPY.noChat)
            : messageRows.map((messageRow) => {
                const message=messageRow.message;
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
                  key: typeof message.id==='string'?JSON.stringify([message.from?.nodeId??'',message.id]):`${messageStamp(message)}-${senderOf(message)}`,
                  message,
                  roomId,
                  mine,
                  kind,
                  senderLabel,
                  messageRow,
                  onLayoutChanged:followLoadedContent,
                  selfLabel: selfLabel,
                  skills: available,
                });
              }),
        ),

        contextDocuments.length+draftSkills.length+attachmentRows.length>0?h('details',{className:'lm-contextSummary'},h('summary',null,'本次发送上下文 · 文档 '+contextDocuments.length+' · 技能 '+draftSkills.length+' · 附件 '+attachmentRows.length),h('div',{className:'lm-contextSummaryBody'},...contextDocuments.map(ref=>h('div',{key:'doc:'+ref.documentId},'文档 · '+(ref.title||ref.documentId)+' · '+ref.revisionId)),...draftSkills.map((ref,index)=>h('div',{key:'skill:'+ref.name+index},'技能提示 · '+ref.name+' · '+(ref.sourceNodeName||ref.sourceNodeId))),...attachmentRows.map(row=>h('div',{key:row.id},'附件 · '+(row.file?.name||row.name||'文件')+' · '+row.status)))):null,
        newMessageCount>0 ? h('div',{className:'lm-newMessages'},h('span',{role:'status','aria-live':'polite'},newMessageCount+' 条新消息'),h('button',{type:'button',className:'lm-btn lm-btnSmall lm-jumpLatest',onClick:jumpToLatest},'跳到最新')):null,
        h(
          'fieldset',
          { disabled:busy==='say'||roomArchived,className: 'lm-composer', onDragOver:event=>event.preventDefault(),onDrop:event=>transferFiles(event),onPaste:event=>transferFiles(event,true) },
          roomArchived ? h('div',{role:'status'},'房间已归档，仅供阅读。已有任务仍可核对。') : null,
          documentPicking?h('div',{role:'status'},'正在固定文档版本…'):null,
          contextResults.length?h('div',{className:'lm-referenceRail'},...contextResults.map(ref=>h('span',{className:'lm-badge',key:ref.executionId},'成果 · '+ref.executionId+' · '+ref.resultHash.slice(0,12),h('button',{type:'button','aria-label':'移除成果引用',onClick:()=>setContextResults(rows=>rows.filter(row=>row.executionId!==ref.executionId))},'×')))):null,
          contextDocuments.length?h('div',{className:'lm-referenceRail'},...contextDocuments.map(ref=>h('span',{className:'lm-contextDocument lm-badge',key:ref.documentId},(ref.title||ref.documentId)+' · '+ref.revisionId,h('button',{type:'button','aria-label':'移除文档引用',onClick:()=>setContextDocuments(rows=>rows.filter(row=>row.documentId!==ref.documentId))},'×'))),h('button',{type:'button',onClick:()=>setContextDocuments([])},'移除全部文档引用')):null,
          mention!==undefined&&documentCatalogue.status==='loading'?h('div',{role:'status'},'正在读取文档候选…'):null,
          mention!==undefined&&documentCatalogue.status==='error'?h('div',{className:'lm-muted'},'文档候选暂不可用：'+documentCatalogue.reason):null,
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
                  const displayName = member.__document ? `文档 · ${member.title||member.documentId} · ${member.headRevisionId}` : isAll ? `@${COPY.mentionAll}` : mentionLabel(member);
                  const key = member.__document ? 'doc:'+member.documentId : isAll ? '@all' : member.key ?? `${member.nodeId}/${member.sessionId}`;
                  return h(
                    'button',
                    {
                      key,
                      type: 'button',
                      className:
                        index === mentionPick
                          ? 'lm-mentionItem lm-mentionItemActive'+(member.__document?' lm-mentionDocument':'')
                          : 'lm-mentionItem'+(member.__document?' lm-mentionDocument':''),
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
          // The `/` menu and the toolbar button render the same list, so a pick
          // from either path produces the identical reference.
          skillMenuVisible
            ? h(
                'div',
                { className: 'lm-skillMenu' },
                h(
                  'div',
                  { className: 'lm-skillSearchRow' },
                  h('input', {
                    className: 'lm-skillSearch',
                    value: effectiveQuery,
                    placeholder: COPY.skillSearch,
                    onChange: (event) => {
                      // Editing the search box keeps the menu open even when it
                      // was opened by the button rather than by a `/` token.
                      setSkillQuery(event.target.value);
                      setSkillMenuOpen(true);
                    },
                  }),
                ),
                skillCatalogue.status === 'unavailable'
                  ? h('div', { className: 'lm-skillEmpty' }, COPY.skillUnavailable)
                  : skillMatches.length === 0
                    ? h('div', { className: 'lm-skillEmpty' }, COPY.skillMenuEmpty)
                    : null,
                ...skillMatches.slice(0, 8).map((skill, index) => {
                  const source = skillSourceLabel(skill);
                  return h(
                    'button',
                    {
                      key: `${skill.sourceNodeId ?? ''}/${skill.name}`,
                      type: 'button',
                      className: index === skillPick ? 'lm-skillItem lm-skillItemActive' : 'lm-skillItem',
                      // Same rule as the mention menu: the textarea must not
                      // lose its caret to a blur before the pick lands.
                      onMouseDown: (event) => {
                        event.preventDefault?.();
                        applySkill(skill);
                      },
                    },
                    h('span', { className: 'lm-skillName' }, `/${skill.name}`),
                    source === '' ? null : h('span', { className: 'lm-skillSource' }, `${COPY.skillSourceOf} ${source}`),
                    typeof skill.description === 'string' && skill.description !== ''
                      ? h('span', { className: 'lm-skillDesc' }, skill.description)
                      : null,
                  );
                }),
              )
            : null,
          draftSkills.length === 0
            ? null
            : h(
                'div',
                { className: 'lm-skillChips' },
                ...draftSkills.map((skill) => {
                  const source = skillSourceLabel(skill);
                  return h(
                    'span',
                    { key: `${skill.sourceNodeId}/${skill.name}`, className: 'lm-skillChip' },
                    h('span', { className: 'lm-skillChipName' }, `/${skill.name}`),
                    source === '' ? null : h('span', { className: 'lm-skillChipSource' }, `${COPY.skillSourceOf} ${source}`),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'lm-skillChipRemove',
                        title: COPY.skillRemove,
                        'aria-label': `${COPY.skillRemove} /${skill.name}`,
                        onClick: () => removeSkill(skill),
                      },
                      '×',
                    ),
                  );
                }),
              ),
          h('div',{className:'lm-composerTools'},attachmentRows.map(row=>h('div',{className:'lm-fileChip',key:row.id},
            row.preview?h('img',{src:row.preview,alt:row.file.name,style:{width:48,height:48,objectFit:'cover'}}):null,
            h('span',{className:'lm-fileChipName'},row.file.name),
            h('span',{role:'status'},row.status==='uploading'?COPY.attachmentUploading:row.status==='ready'?COPY.attachmentReady:row.error),
            row.status==='error'?h('button',{type:'button',disabled:busy==='say',onClick:()=>attachmentDraft.current.retry(row.id)},COPY.attachmentRetry):null,
            h('button',{type:'button',className:'lm-fileChipRemove',disabled:busy==='say',onClick:()=>attachmentDraft.current.remove(row.id)},'×')
          ))),
          h('textarea', {
            className: 'lm-composerInput',
              disabled: busy==='say',
              value: draft,
              placeholder: COPY.sayHint,
              onChange: (event) => {
                composerSnapshot.current={...composerSnapshot.current,draft:event.target.value,caret:event.target.selectionStart??event.target.value.length};
                setDraft(event.target.value);
                setDraftMentions((current) => editedMentions(current, draft, event.target.value));
                setCaret(event.target.selectionStart ?? event.target.value.length);
                if (mentionOff) setMentionOff(false);
              },
              onKeyUp: (event) => {composerSnapshot.current.caret=event.target.selectionStart??0;setCaret(event.target.selectionStart??0);},
              onClick: (event) => {composerSnapshot.current.caret=event.target.selectionStart??0;setCaret(event.target.selectionStart??0);},
              onKeyDown: (event) => {
                // The skill menu takes the keys first when it is open: Enter
                // must confirm a reference rather than send a half-typed `/`.
                if (skillMenuVisible) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSkillPick((current) => (current + 1) % Math.max(Math.min(skillMatches.length, 8), 1));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    const size = Math.max(Math.min(skillMatches.length, 8), 1);
                    setSkillPick((current) => (current + size - 1) % size);
                    return;
                  }
                  if ((event.key === 'Enter' || event.key === 'Tab') && skillMatches.length > 0) {
                    // Only a real row is consumable. With nothing to pick, Enter
                    // falls through to sending, because a half-typed `/foo` is
                    // ordinary text and the menu simply had no answer for it.
                    event.preventDefault();
                    applySkill(skillMatches[skillPick] ?? skillMatches[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSkillMenu();
                    return;
                  }
                }
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
                  multiple: true,
                  disabled: busy==='say',
                  className: 'lm-fileInput',
                  onChange: onFilePicked,
                }),
              ),
              // Skill picker button: the same menu `/` opens, so the capability
              // is discoverable without knowing the slash convention.
              h(
                'button',
                {
                  type: 'button',
                  className: skillMenuVisible ? 'lm-skillBtn lm-skillBtnOn' : 'lm-skillBtn',
                  'aria-pressed': skillMenuVisible,
                  'aria-label': COPY.skillPicker,
                  title: `${COPY.skillPicker} — ${COPY.skillHint}`,
                  onClick: toggleSkillMenu,
                },
                h('svg', { className: 'lm-skillIcon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                  h('path', { d: 'm9 5-6 7 6 7m6-14 6 7-6 7M14 3l-4 18' })),
              ),
              // Quick-task toggle: the leader can turn the next message into a
              // task with one click. The assignee is derived from the first @mention.
              viewer.isMember === true
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: quickTask ? 'lm-taskPill lm-taskPillOn' : 'lm-taskPill',
                      'aria-pressed': quickTask,
                      disabled: isLeader !== true,
                      title: isLeader === true ? COPY.quickTaskLabel : COPY.quickTaskLeaderOnly,
                      'aria-label': isLeader === true ? COPY.quickTaskLabel : `${COPY.quickTaskLabel}: ${COPY.quickTaskLeaderOnly}`,
                      onClick: () => { if (isLeader === true) setQuickTask((current) => !current); },
                    },
                    h('span', null, COPY.quickTaskLabel),
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'lm-sendBtn',
                  disabled: documentPicking || busy === 'say' || viewer.isMember !== true || attachmentRows.some(row=>row.status!=='ready'),
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
          )
          : null,
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
      const [showArchived,setShowArchived] = React.useState(false);
      const [projectQuery,setProjectQuery]=React.useState('');
      const visibleRooms=filterJoinedProjects(rooms,projectQuery);
      const [showDiscover,setShowDiscover]=React.useState(false);
      const [discoverQuery,setDiscoverQuery]=React.useState('');
      // Archiving is a lifecycle change a misclick should not make: the menu
      // button first asks, and only the explicit confirm row calls lifecycle.
      const [archiveConfirmRoom,setArchiveConfirmRoom]=React.useState('');
      const discoverRef=React.useRef(null),discoverTriggerRef=React.useRef(null),discoverCycle=React.useRef(0);
      const closeDiscover=()=>{discoverCycle.current++;setShowDiscover(false);discoverTriggerRef.current?.focus?.();};
      React.useEffect(()=>{if(showDiscover)discoverRef.current?.focus?.();},[showDiscover]);
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
        h(WorkbenchHeader,{h,model:workbenchIdentityView(props.self,PLUGIN_VERSION,props.pluginVersion),title:'LAN Mesh',subtitle:COPY.title,backLabel:COPY.returnNative,backHint:COPY.exitHint,onExit:props.onExit,labels:COPY.versionLabels}),

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
              ['inbox','board'].includes(view.id)?h('span', { className: 'lm-navCount' }, String(navCount(view.id))):null,
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
          h('button',{type:'button',className:'lm-archivedToggle','aria-expanded':showArchived,onClick:()=>setShowArchived(value=>!value)},`已归档 (${props.archivedRooms?.length??0})`),
          showArchived ? (props.archivedRooms??[]).map(room=>h('div',{key:room.id},
            h('button',{type:'button',className:'lm-archivedRoom',onClick:()=>props.onSelect(room.id)},room.name),
            room.isLeader ? h('button',{type:'button',className:'lm-restoreRoom',disabled:!!props.preferenceBusy,onClick:()=>props.onLifecycle?.(room,'active')},'恢复房间') : null)) : null,
          h('input',{className:'lm-input lm-projectSearch',type:'search',maxLength:200,value:projectQuery,'aria-label':COPY.projectSearch,placeholder:COPY.projectSearch,onChange:event=>setProjectQuery(event.target.value)}),
          visibleRooms.length === 0
            ? h('div', { className: 'lm-muted lm-railEmpty' }, projectQuery?COPY.projectSearchEmpty:COPY.noMineRooms)
            : h(
                'div',
                { className: 'lm-railList' },
                ...visibleRooms.map((room) =>
                  h('div', {key:room.id,className:'lm-projectEntry'}, h(
                    'button',
                    {
                      key: room.id,
                      type: 'button',
                      className: props.activeId === room.id ? 'lm-roomRow lm-roomRowActive' : 'lm-roomRow',
                      title: room.topic || room.name || room.id,
                      onClick: () => props.onSelect(room.id),
                    },
                    h('span', { className: 'lm-roomRowName' }, room.name || room.id),
                    room.localPreferences?.pinned ? h('span',{className:'lm-badge'},'置顶') : null,
                    room.localPreferences?.muted ? h('span',{className:'lm-badge'},'静音') : null,
                    room.isLeader === true ? h('span', { className: 'lm-badge lm-badgeLeader' }, COPY.roleLeader) : null,
                    unreadOf(room.id) > 0 ? h('span', { className: 'lm-roomUnread' }, String(unreadOf(room.id))) : null,
                  ),                   h('details',{className:'lm-roomPreferences',onToggle:event=>{if(event.currentTarget.open)event.currentTarget.querySelector?.('.lm-projectMenu')?.scrollIntoView?.({block:'nearest'});else setArchiveConfirmRoom('');},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector?.('summary')?.focus?.();}}},
                    h('summary',{'aria-label':COPY.projectActions+' · '+(room.name||room.id),title:COPY.projectActions},'…'),
                    h('div',{className:'lm-projectMenu'},
                    room.isLeader ? (archiveConfirmRoom===room.id
                      ? h('div',{className:'lm-archiveConfirm'},
                          h('span',{className:'lm-archiveConfirmText'},'归档后房间移入历史，可从「已归档」恢复。'),
                          h('div',{className:'lm-archiveConfirmActions'},
                            h('button',{type:'button',className:'lm-btn lm-btnSmall lm-archiveRoomConfirm',disabled:!!props.preferenceBusy,onClick:()=>{setArchiveConfirmRoom('');props.onLifecycle?.(room,'archived');}},'确认归档'),
                            h('button',{type:'button',className:'lm-btn lm-btnSmall',disabled:!!props.preferenceBusy,onClick:()=>setArchiveConfirmRoom('')},'取消')))
                      : h('button',{type:'button',className:'lm-archiveRoom',disabled:!!props.preferenceBusy,onClick:()=>setArchiveConfirmRoom(room.id)},'归档房间')) : null,
                    ...[['pinned','置顶'],['muted','静音'],['muteAtException','静音时被 @ 仍提醒']].map(([field,label])=>h('label',{key:field,className:'lm-row'},
                      h('input',{type:'checkbox',className:`lm-pref-${field}`,checked:room.localPreferences?.[field] ?? (field==='muteAtException'),disabled:!!props.preferenceBusy,onChange:event=>props.onPreferences?.(room.id,{[field]:event.target.checked})}),label)),
                    props.preferenceBusy===room.id ? h('span',{role:'status'},'正在保存…') : null,
                    ),
                  )),
                ),
              ),
          h('button',{type:'button',className:'lm-navBtn lm-discoverTrigger',ref:discoverTriggerRef,'aria-expanded':showDiscover,'aria-controls':'lm-discover-projects',onClick:()=>{discoverCycle.current++;setShowDiscover(value=>!value)}},h('span',null,COPY.discoverProjects),h('span',{className:'lm-navCount'},String(discoverProjectsView(joinable).length))),
          showDiscover ? h(DiscoverProjectsPanel,{h,rows:discoverProjectsView(joinable,discoverQuery),query:discoverQuery,onQuery:setDiscoverQuery,panelRef:discoverRef,labels:COPY.discoverLabels,busy:props.joinBusy,error:props.railNoticeBad?props.railNotice:'',onClose:closeDiscover,onJoin:async id=>{const cycle=discoverCycle.current;if(await props.onJoin(id)===true&&cycle===discoverCycle.current)closeDiscover();}}):null,
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
                    row.status === 'running'
                      ? h('span', { className: 'lm-agentSpinner', role: 'status', 'aria-label': COPY.agentsLive })
                      : h('span', { className: row.live === true ? 'lm-dot' : 'lm-dot lm-dotIdle' }),
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
      {id:'network',label:()=>COPY.navNetwork},
      { id: 'inbox', label: () => COPY.navInbox },
      { id: 'board', label: () => COPY.navBoard },
      {id:'manage',label:()=>COPY.navManage},
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
      if(view==='network')return h(NetworkWorkbench,{h,React,model:networkWorkspaceView({self:props.self,peers:props.peerSource,agents:props.agents,agentsStatus:props.agentsStatus,stale:props.snapshotStale}),onRefresh:props.onRefresh,labels:COPY.networkLabels});
      if(view==='manage')return h(React.Fragment,null,h(ManagementWorkspace,{h,self:props.self,uiVersion:PLUGIN_VERSION,hostVersion:props.pluginVersion,onOpenAgents:props.onOpenAgents,labels:COPY.managementLabels}),h(AgentRegistryPane,{h,React,call:props.call,self:props.self,localAgents:agents.local}));
      if (view === 'rooms') return RoomListPane(props);
      if (view === 'inbox') return h(InboxPane,props);
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
    function unreadMessages(messages, self) {
      return (Array.isArray(messages) ? messages : []).filter((message) => message.read !== true
        && !(message.from?.nodeId === self?.nodeId
          && (!message.from?.sessionId || message.from.sessionId === HUMAN_SESSION_ID)));
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
          const outgoing = message.from?.nodeId === selfNodeId
            && (fromSessionId === HUMAN_SESSION_ID || fromSessionId === '');
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
          const open = async () => {
            if (await props.onMarkMessageRead?.(message.id) === false) return;
            if (isRoomMsg) props.onOpenRoom?.(message.room);
          };
          return h(
            'div',
            {
              className:
                (message.read === true ? 'lm-msg ' : 'lm-msg lm-msgUnread ') +
                (outgoing === true ? 'lm-msgOut ' : '') +
                (isRoomMsg === true ? 'lm-msgRoom ' : '') +
                (isRoomMsg === true ? 'lm-msgJump ' : ''),
              key: message.id,
              ...{
                    role: 'button',
                    tabIndex: 0,
                    title: isRoomMsg ? `${COPY.openRoom} #${roomLabel}` : COPY.markRead,
                    onClick: open,
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      open();
                    },
                  },
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
    /* @ux-shell:inbox-model:start */
/** Pure projection over the returned unread subset; no routing or read-state mutation. */
function inboxWorkbenchView({messages,self,rooms=[],peers=[],query='',filter='all'}={}) {
 const string=value=>typeof value==='string'?value:'';
 const roomList=Array.isArray(rooms)?rooms:[],peerList=Array.isArray(peers)?peers:[];
 const allRows=(Array.isArray(messages)?messages:[]).filter(message=>message&&typeof message==='object'&&message.read!==true&&!(self?.nodeId&&message.from?.nodeId===self.nodeId&&(!message.from.sessionId||message.from.sessionId==='human'))).slice().reverse().map(message=>{
  const nodeId=string(message.from?.nodeId),id=string(message.id),roomId=string(message.room);
  const sender=string(message.from?.title)||string(message.from?.name)||nodeId||'未知作者';
  const deviceName=nodeId&&nodeId===self?.nodeId?string(self?.name):string(peerList.find(peer=>peer?.nodeId===nodeId)?.name);
  const device=nodeId?(deviceName?deviceName+' · '+nodeId:nodeId):'来源设备未知';
  const roomLabel=string(roomList.find(room=>room?.id===roomId)?.name)||string(message.topic)||roomId;
  const body=string(message.text),preview=body.replace(/\s+/g,' ').slice(0,240);
  const category=message.kind==='room-task'?'tasks':['system','system-event'].includes(message.kind)?'system':'ordinary';
  const mentioned=!!self?.nodeId&&Array.isArray(message.structuredMentions)&&message.structuredMentions.some(ref=>ref?.memberKey===self.nodeId+'/human');
  return {key:JSON.stringify([nodeId,id]),message,id,nodeId,sender,device,roomId,roomLabel,body,preview,timestamp:string(message.at??message.receivedAt??message.sentAt),category,mentioned};
 });
 const counts={all:allRows.length,mentions:allRows.filter(row=>row.mentioned).length,tasks:allRows.filter(row=>row.category==='tasks').length,system:allRows.filter(row=>row.category==='system').length};
 const availableFilters=['all',...['mentions','tasks','system'].filter(key=>counts[key]>0)];
 const activeFilter=availableFilters.includes(filter)?filter:'all';
 const needle=string(query).trim().toLocaleLowerCase();
 const rows=allRows.filter(row=>(activeFilter==='all'||activeFilter==='mentions'&&row.mentioned||row.category===activeFilter)&&(!needle||[row.sender,row.device,row.roomLabel,row.roomId,row.body].join(' ').toLocaleLowerCase().includes(needle)));
 return {rows,allRows,counts,availableFilters,activeFilter};
}
    /* @ux-shell:inbox-model:end */
    /* @ux-shell:inbox-component:start */
function InboxWorkbench(props){
 const {h,React}=props;const [query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all'),[selected,setSelected]=React.useState(''),[confirm,setConfirm]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const life=React.useRef({alive:true,pending:false}),focus=React.useRef(null),detailFocus=React.useRef(null);
 React.useEffect(()=>{life.current.alive=true;return()=>{life.current.alive=false;};},[]);
 const model=props.modelOf({messages:props.messages,self:props.self,rooms:props.rooms,peers:props.peers,query,filter});
 const row=model.allRows.find(r=>r.key===selected);
 React.useEffect(()=>{if(selected)detailFocus.current?.focus?.();},[selected]);
 const readableIdentity=!!row&&typeof row.id==='string'&&row.id.trim()!==''&&typeof row.nodeId==='string'&&row.nodeId.trim()!=='';
 const close=()=>{setSelected('');focus.current?.focus?.();};
 const act=async(all)=>{if(life.current.pending)return;if(!all&&!readableIdentity){setError('消息身份不完整，无法单独标为已读');return;}const submitted=selected;life.current.pending=true;setBusy(true);setError('');try{const result=all?await props.onMarkRead():await props.onMarkMessageRead(row.id,row.nodeId);if(!life.current.alive)return;if(result===false){setError('保存已读状态失败，请重试');return;}setSelected(current=>current===submitted?'':current);setConfirm(false);}catch{if(life.current.alive)setError('保存已读状态失败，请重试');}finally{life.current.pending=false;if(life.current.alive)setBusy(false);}};
 const names={all:'全部未读',mentions:'@我',tasks:'任务',system:'系统'};
 return h('section',{className:'lm-inboxWorkbench'+(row?' lm-inboxHasDetail':''),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();if(confirm)setConfirm(false);else close();}}},
 h('header',{className:'lm-inboxToolbar'},h('h1',null,'收件箱'),h('button',{type:'button',className:'lm-btn',disabled:busy,onClick:()=>setConfirm(true)},'全部标为已读')),
 h('p',{className:'lm-inboxScope'},'当前返回 '+model.allRows.length+' 条未读；搜索范围为本次返回的记录。'),
 h('div',{className:'lm-inboxFilters'},h('input',{type:'search',value:query,'aria-label':'搜索提醒',placeholder:'搜索正文、项目或来源',onChange:e=>setQuery(e.target.value)}),h('select',{value:model.activeFilter??filter,'aria-label':'提醒类型',onChange:e=>setFilter(e.target.value)},...(model.availableFilters??['all']).map(id=>h('option',{key:id,value:id},names[id]||id)))),
 confirm?h('div',{className:'lm-inboxConfirm',role:'group','aria-label':'确认全部已读'},h('p',null,'将确认时本节点的当前未读记录标为已读，不删除来源记录；范围不限于当前搜索结果。'),h('button',{type:'button',className:'lm-btn',disabled:busy,onClick:()=>act(true)},'确认全部标为已读'),h('button',{type:'button',className:'lm-btn',disabled:busy,onClick:()=>setConfirm(false)},'取消')):null,
 error?h('p',{role:'alert',className:'lm-error'},error):null,
 h('div',{className:'lm-inboxColumns'},h('div',{className:'lm-inboxList','aria-label':'未读提醒'},model.rows.length?model.rows.map(item=>h('button',{type:'button',key:item.key,className:'lm-msg lm-inboxRow'+(selected===item.key?' lm-inboxRowSelected':''),'aria-pressed':selected===item.key,onClick:e=>{focus.current=e.currentTarget;setSelected(item.key);setError('');}},h('div',{className:'lm-inboxRowMeta'},h('strong',null,item.sender),h('span',null,item.roomLabel||'直接消息'),h('time',null,item.timestamp)),h('div',{className:'lm-inboxPreview'},item.preview||item.body),h('small',null,item.device))):h('p',{className:'lm-muted'},'当前没有匹配的未读提醒')),
 row?h('aside',{className:'lm-inboxDetail','aria-label':'提醒详情'},h('button',{type:'button',className:'lm-btn',ref:detailFocus,onClick:close},'返回列表'),h('h2',null,row.sender),h('p',null,row.device+' · '+(row.roomLabel||'直接消息')),h('time',null,row.timestamp),h('div',{className:'lm-inboxFullText'},props.MarkdownText?h(props.MarkdownText,{text:row.body}):row.body),h('div',{className:'lm-inboxActions'},h('button',{type:'button',className:'lm-btn',disabled:busy||!readableIdentity,onClick:()=>act(false)},busy?'正在保存…':'标为已读'),!readableIdentity?h('span',{role:'status'},'消息身份不完整，无法单独标为已读'):null,row.roomId?h('button',{type:'button',className:'lm-btn',disabled:busy,onClick:()=>props.onOpenRoom?.(row.roomId)},'前往房间（不定位具体消息）'):null)):h('aside',{className:'lm-inboxDetail lm-muted'},'选择提醒查看全文；查看不会自动标为已读。')));
}
    /* @ux-shell:inbox-component:end */
    /* @ux-shell:network-component:start */
/** Read-only projections of observed node records; never conveys dispatch authority. */
function NetworkWorkbench(props) {
 const {h,React}=props,model=props.model??{},stale=model.stale===true;
 const source=Array.isArray(model.nodes)?model.nodes:[],seen=new Set();
 const nodes=source.filter(n=>n&&typeof n.id==='string'&&n.id&&!seen.has(n.id)&&(seen.add(n.id),true));
 const [modeChoice,setMode]=React.useState(null);
 const mode=modeChoice??(nodes.length>10?'list':'topology');
 const [query,setQuery]=React.useState('');
 const [selectedId,setSelectedId]=React.useState(()=>nodes.find(n=>n.local)?.id||nodes[0]?.id||'');
 const clean=value=>typeof value==='string'?value:'';
 const numeric=value=>Number.isFinite(value)&&value>=0?String(Math.trunc(value)):null;
 const matching=nodes.filter(n=>(clean(n.name)+' '+n.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const selected=nodes.find(n=>n.id===selectedId)||nodes.find(n=>n.local)||nodes[0];
 const local=nodes.find(n=>n.local),chart=matching.slice(0,10),remoteChart=chart.filter(n=>!n.local);
 const position=n=>n.local?{x:50,y:50}:(()=>{const i=remoteChart.indexOf(n),angle=-Math.PI/2+2*Math.PI*i/Math.max(1,remoteChart.length);return {x:50+36*Math.cos(angle),y:50+36*Math.sin(angle)};})();
 const sessions=n=>stale?'数量未核对':numeric(n.sessions)===null?'目录会话未核对':'目录会话 '+numeric(n.sessions);
 const age=n=>stale?'当前可见性未核对':n.local?'本机记录':Number.isFinite(n.ageSeconds)&&n.ageSeconds>=0?'约 '+Math.floor(n.ageSeconds)+' 秒前观测':'最近观测时间未知';
 const nodeButton=(n,topology)=>{const p=position(n);return h('button',{type:'button',key:n.id,className:'lm-networkNode'+(selected?.id===n.id?' lm-networkNodeSelected':''),'aria-pressed':selected?.id===n.id,onClick:()=>setSelectedId(n.id),style:topology?{left:p.x+'%',top:p.y+'%'}:undefined},h('strong',null,clean(n.name)||n.id),h('span',{className:'lm-networkNodeId'},n.id),h('span',{className:'lm-networkNodeFact'},n.local?'本机':age(n)),h('span',{className:'lm-networkNodeFact'},sessions(n)));};
 const label=(key,fallback)=>clean(props.labels?.[key])||fallback;
 return h('section',{className:'lm-networkWorkbench','aria-label':'网络总览'},
  h('header',{className:'lm-networkHeader'},h('div',null,h('h1',null,label('title','网络总览')),h('p',null,'节点发现、会话目录和执行状态分别核对。')),h('button',{type:'button',className:'lm-btn lm-networkRefresh',onClick:props.onRefresh},label('refresh','刷新'))),
  stale?h('div',{className:'lm-networkStale',role:'status'},'快照已过期：数量未核对，以下为上次读取的记录。'):null,
  h('div',{className:'lm-networkSummary'},h('span',null,stale?'节点数量未核对':'本机记录 '+(local?'1':'未核对')),h('span',null,stale?'发现数量未核对':'发现节点 '+(numeric(model.peerCount)??'未核对')),h('span',null,'派发权限未核对')),
  h('div',{className:'lm-networkToolbar'},h('input',{type:'search',className:'lm-networkSearch','aria-label':'搜索设备名称或节点ID',placeholder:'搜索设备名称或节点 ID',value:query,onChange:event=>setQuery(event.target.value)}),h('div',{role:'group','aria-label':'网络显示方式'},h('button',{type:'button',className:'lm-networkModeTopology','aria-pressed':mode==='topology',onClick:()=>setMode('topology')},'拓扑'),h('button',{type:'button',className:'lm-networkModeList','aria-pressed':mode==='list',onClick:()=>setMode('list')},'列表'))),
  h('div',{className:'lm-networkLayout'},h('div',{className:'lm-networkPrimary'},
   mode==='list'?h('div',{className:'lm-networkList'},...matching.map(n=>nodeButton(n,false))):h('div',{className:'lm-networkTopology'},
    h('svg',{className:'lm-networkEdges',viewBox:'0 0 100 100',preserveAspectRatio:'none','aria-hidden':'true'},...(local&&chart.some(n=>n.id===local.id)?remoteChart:[]).map(n=>{const p=position(n);return h('line',{key:n.id,className:'lm-networkSpoke',x1:50,y1:50,x2:p.x,y2:p.y});})),...chart.map(n=>nodeButton(n,true))),
   mode==='topology'?h('p',{className:'lm-networkCompactNotice'},'小窗以节点排列显示；节点详情和列表入口保持可用。'):null,
   matching.length===0?h('p',{className:'lm-networkHint'},nodes.length?'没有匹配的设备记录。':'暂无设备记录，请刷新后核对。'):null,
   mode==='topology'&&matching.length>10?h('p',{className:'lm-networkHint'},'拓扑仅展示当前匹配的前10个节点；请切换列表查看全部 '+matching.length+' 个。'):null,
   !local?h('p',{className:'lm-networkHint'},'本机身份尚未读取；不绘制中心连接。'):null,
   h('p',{className:'lm-networkHint'},'连线仅表示本机发现节点的观测关系，不代表传输健康、Peer之间互联或可向Agent派发任务。')),
   selected?h('aside',{className:'lm-networkDetail','aria-label':'所选节点详情'},h('h2',null,clean(selected.name)||selected.id),h('p',{className:'lm-networkDetailId'},selected.id),h('dl',null,h('dt',null,'来源'),h('dd',null,selected.local?'本机':'发现记录'),h('dt',null,'最近观测'),h('dd',null,age(selected)),h('dt',null,'目录会话'),h('dd',null,sessions(selected)),h('dt',null,'执行状态'),h('dd',null,stale?'执行状态未核对':selected.local&&numeric(selected.running)!==null?'正在运行 '+numeric(selected.running):selected.local?'本机执行状态未知':'远端执行状态未知'),h('dt',null,'授权'),h('dd',null,'派发权限未核对')),h('p',{className:'lm-networkHint'},'目录可能不完整；未找到会话不能直接视为零。')):null));
}
    /* @ux-shell:network-component:end */
    function InboxPane(props) {
      return h(InboxWorkbench,{...props,h,React,modelOf:inboxWorkbenchView,MarkdownText});
    }

    /**
     * Detail view: a summary of tasks across every room this node belongs to.
     * Flat (no per-room status moves) — the room pane owns task status.
     * @param {object} props - rooms with tasks, handlers.
     * @returns {object} pane element.
     */
    /* @ux-shell:task-board-model:start */
/** Room task projection only: no Team execution or acceptance inference. */
function canMoveRoomTask({task,nodeId,sessionId,isLeader}={}) {
 return isLeader===true||!!(typeof nodeId==='string'&&nodeId&&typeof sessionId==='string'&&sessionId&&task?.assignee?.nodeId===nodeId&&task.assignee.sessionId===sessionId);
}
function roomTaskBoardView({rooms,self,query='',status='all',assignee='all'}={}) {
 const text=v=>typeof v==='string'?v:'';const states=['open','doing','blocked','done','unknown'];
 const labels={open:'待开始',doing:'进行中',blocked:'受阻',done:'已完成',unknown:'未知状态'};
 const allRows=[];
 for(const room of Array.isArray(rooms)?rooms:[]){if(!room||room.deleted===true||!text(room.id))continue;for(const task of Array.isArray(room.tasks)?room.tasks:[]){if(!task||task.deleted===true||!text(task.id))continue;const owner=task.assignee??{},nodeId=text(owner.nodeId),sessionId=text(owner.sessionId),ownerKey=nodeId&&sessionId?JSON.stringify([nodeId,sessionId]):null;const ownerName=text(owner.title)||text(owner.name)||sessionId||'负责人未知';const deviceName=text(owner.nodeName)||(nodeId===self?.nodeId?text(self?.name):'');const device=nodeId?(deviceName?deviceName+' · '+nodeId:nodeId):'来源设备未知';const state=states.slice(0,4).includes(task.status)?task.status:'unknown';allRows.push({key:JSON.stringify([room.id,task.id]),task,roomId:room.id,roomName:text(room.name)||room.id,title:text(task.title)||task.id,detail:text(task.detail),status:state,statusLabel:state==='unknown'?labels.unknown+(text(task.status)?' · '+task.status:''):labels[state],assigneeKey:ownerKey,assigneeName:ownerName,device,updatedAt:Number.isFinite(Date.parse(task.updatedAt))?task.updatedAt:'时间未知',source:'Room任务',archived:room.lifecycle?.status==='archived'});}}
 const counts=Object.fromEntries([['all',allRows.length],...states.map(id=>[id,allRows.filter(r=>r.status===id).length])]);
 const assignees=[...new Map(allRows.filter(r=>r.assigneeKey).map(r=>[r.assigneeKey,{key:r.assigneeKey,label:r.assigneeName+' · '+r.device}])).values()];
 const activeStatus=status==='all'||states.includes(status)&&counts[status]>0?status:'all';const activeAssignee=assignee==='all'||assignees.some(a=>a.key===assignee)?assignee:'all';const needle=text(query).trim().toLocaleLowerCase();
 const rows=allRows.filter(r=>(activeStatus==='all'||r.status===activeStatus)&&(activeAssignee==='all'||r.assigneeKey===activeAssignee)&&(!needle||[r.title,r.detail,r.roomName,r.roomId,r.assigneeName,r.device].join(' ').toLocaleLowerCase().includes(needle)));
 return {rows,groups:states.map(id=>({id,label:labels[id],rows:rows.filter(r=>r.status===id)})).filter(g=>g.rows.length),counts,assignees,activeStatus,activeAssignee};
}
    /* @ux-shell:task-board-model:end */
    /* @ux-shell:task-board-component:start */
/** Read-only cross-Room board; existing Room owns every task mutation. */
function RoomTaskBoard(props){
 const {h,React}=props;const [query,setQuery]=React.useState(''),[status,setStatus]=React.useState('all'),[assignee,setAssignee]=React.useState('all');
 const model=props.modelOf({rooms:props.rooms,self:props.self,query,status,assignee});const labels={all:'全部状态',open:'待开始',doing:'进行中',blocked:'受阻',done:'已完成',unknown:'未知状态'};
 return h('section',{className:'lm-roomTaskBoard'},h('header',null,h('h1',null,'任务看板'),props.onRefresh?h('button',{type:'button',className:'lm-btn',disabled:props.refreshing===true,'aria-busy':props.refreshing===true?'true':undefined,onClick:props.onRefresh},props.refreshing===true?'刷新中…':'刷新'):null),h('p',{className:'lm-taskBoardScope'},'跨房间任务汇总 · 当前返回的 Room 任务；进入房间查看和核对，不代表 Team 执行或成果验收。'),h('div',{className:'lm-taskBoardFilters'},h('input',{type:'search',value:query,'aria-label':'搜索房间任务',placeholder:'搜索任务、项目或负责人',onChange:e=>setQuery(e.target.value)}),h('select',{value:model.activeStatus,'aria-label':'任务状态',onChange:e=>setStatus(e.target.value)},...Object.keys(labels).filter(id=>id==='all'||model.counts[id]>0).map(id=>h('option',{key:id,value:id},labels[id]+' '+model.counts[id]))),h('select',{value:model.activeAssignee,'aria-label':'任务负责人',onChange:e=>setAssignee(e.target.value)},h('option',{value:'all'},'全部负责人'),...model.assignees.map(a=>h('option',{key:a.key,value:a.key},a.label)))),model.groups.length?model.groups.map(group=>h('section',{key:group.id,className:'lm-taskBoardGroup'},h('h2',null,group.label+' '+group.rows.length),...group.rows.map(row=>h('button',{key:row.key,type:'button',className:'lm-roomRow lm-boardRow lm-taskBoardRow',onClick:()=>props.onOpenRoom?.(row.roomId),'aria-label':row.title+' · '+row.roomName+' · 进入房间'},h('div',{className:'lm-taskBoardRowHead'},h('strong',null,row.title),h('span',null,row.statusLabel)),h('div',null,row.roomName+' · '+row.roomId+(row.archived?' · 已归档':'')),h('small',null,row.assigneeName+' · '+row.device+' · '+row.updatedAt),row.detail?h('div',{className:'lm-taskBoardPreview'},row.detail):null)))):h('p',{className:'lm-muted'},model.counts.all?'没有匹配的房间任务':'当前没有房间任务'));
}
    /* @ux-shell:task-board-component:end */
    /* @ux-shell:owner-plan-model:start */
/**
 * M6 Owner plan panel view model.
 *
 * Pure presentation helpers: no network, no storage, no authority. The Host
 * ledger is the only source of plan revision, generation, fingerprint and
 * approval state; this module only formats what the server returned.
 */

const CONFLICT_CODES = ['REVISION_CONFLICT', 'STALE_GENERATION', 'APPROVAL_BINDING_MISMATCH'];

function stringList(value) {
  return Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : [];
}

/**
 * Chinese label for one candidate exclusion reason. The reasons come from the
 * Host's candidate filter (lib/m6-worker-candidates.mjs); unknown codes render
 * verbatim instead of being hidden.
 */
function ownerPlanCandidateReasonText(reason) {
  const labels = {
    UNAUTHORIZED: '不在本机授权范围',
    NO_PROFILE: '无能力声明',
    CAPABILITY_MISMATCH: '能力不匹配',
    CAPACITY_FULL: '执行槽已占用（uncertain 占槽）',
  };
  return typeof reason === 'string' && reason !== '' ? (labels[reason] ?? reason) : '';
}

/**
 * Per-task preview rows + a three-way summary from a bound preview report.
 * State is derived ONLY from the fields the Host returned: dispatchable needs
 * BOTH dependencySatisfied and candidateAvailable (the server sends all three
 * separately; neither implies the other).
 */
function ownerPlanPreviewRows(report) {
  const reportView = report && typeof report === 'object' ? report : {};
  const candidates = reportView.candidates && typeof reportView.candidates === 'object' ? reportView.candidates : {};
  const ids = Array.isArray(reportView.dag?.order) && reportView.dag.order.length > 0
    ? reportView.dag.order
    : Object.keys(candidates);
  const rows = ids.map(taskId => {
    const candidate = candidates && typeof candidates[taskId] === 'object' && candidates[taskId] !== null ? candidates[taskId] : null;
    const recommended = stringList(candidate?.recommended);
    const excluded = (Array.isArray(candidate?.excluded) ? candidate.excluded : [])
      .filter(entry => entry && typeof entry === 'object' && typeof entry.memberKey === 'string' && entry.memberKey !== '')
      .map(entry => ({ memberKey: entry.memberKey, reason: typeof entry.reason === 'string' ? entry.reason : '', text: ownerPlanCandidateReasonText(entry.reason) }));
    const state = candidate === null ? 'unknown'
      : candidate.dispatchable === true ? 'dispatchable'
      : candidate.dependencySatisfied === true ? 'noCandidate'
      : 'blocked';
    const labels = { dispatchable: '可派发', blocked: '等待依赖验收', noCandidate: '无可用候选', unknown: '无候选数据' };
    return {
      taskId: String(taskId),
      state,
      stateLabel: labels[state],
      dependencySatisfied: candidate?.dependencySatisfied === true,
      candidateAvailable: candidate?.candidateAvailable === true,
      dispatchable: candidate?.dispatchable === true,
      recommended,
      excluded,
    };
  });
  return {
    rows,
    summary: {
      dispatchable: rows.filter(row => row.state === 'dispatchable').length,
      blocked: rows.filter(row => row.state === 'blocked').length,
      noCandidate: rows.filter(row => row.state === 'noCandidate').length,
      unknown: rows.filter(row => row.state === 'unknown').length,
    },
  };
}

/**
 * Chinese lines for the report-level explanations. Unknown codes are skipped:
 * the panel never invents an explanation the Host did not send.
 */
function ownerPlanExplanationLines(explanations) {
  const labels = {
    DEPENDENCY_NOT_ACCEPTED: '依赖尚未验收，等待 Owner 在成果评审中接受',
    NO_CANDIDATE: '没有可派发的候选 Worker',
    CANDIDATE_FILTER_FAILED: '候选过滤失败',
    INVALID_PLAN: '计划内容不合法',
    MISSING_PLAN_TASKS: '缺少任务清单',
    INVALID_APPROVAL_CONTEXT: '批准上下文不完整',
    APPROVAL_TEAM_MISMATCH: '批准与当前 Room 不一致',
    APPROVAL_GENERATION_MISMATCH: '批准与当前 Team 代次不一致',
  };
  return (Array.isArray(explanations) ? explanations : [])
    .map(entry => {
      if (!entry || typeof entry !== 'object' || typeof entry.code !== 'string') return null;
      const label = labels[entry.code];
      if (label === undefined) return null;
      const where = typeof entry.taskId === 'string' && entry.taskId !== '' ? `（${entry.taskId}）` : '';
      const detail = typeof entry.detail === 'string' && entry.detail !== '' ? `：${entry.detail}` : '';
      return `${label}${where}${detail}`;
    })
    .filter(Boolean);
}

/**
 * One line summarizing the Team's task/execution states from the owner
 * overview counts the Host already returns (no invented fields; a missing or
 * empty overview renders as an empty string so the panel hides the line).
 */
function ownerTeamCountLine(overview) {
  if (!overview || typeof overview !== 'object' || overview.known !== true || overview.status === 'absent') return '';
  const taskLabels = { planned: '待依赖', ready: '待派发', active: '执行中', review: '待评审', accepted: '已验收', blocked: '受阻', failed: '失败', cancelled: '已取消' };
  const executionLabels = { queued: '已排队', acknowledged: '已确认', running: '运行中', uncertain: '不确定（占槽）' };
  const part = (counts, labels) => {
    if (!counts || typeof counts !== 'object') return '';
    const line = Object.entries(labels)
      .filter(([status]) => Number.isSafeInteger(counts[status]) && counts[status] > 0)
      .map(([status, label]) => `${label} ${counts[status]}`)
      .join(' · ');
    return line === '' ? '' : line;
  };
  const tasks = part(overview.taskCounts, taskLabels);
  const executions = part(overview.executionCounts, executionLabels);
  return [tasks && `任务 ${tasks}`, executions && `执行 ${executions}`].filter(Boolean).join('；');
}

/** A failed write that changed the version underneath the user, not a bad input. */
function ownerPlanConflict(code) {
  return CONFLICT_CODES.includes(code);
}

/** Stable Chinese text for the codes the plan entry can return. */
function ownerPlanErrorText(code, fallback = '') {
  const messages = {
    FORBIDDEN: '当前无权执行该计划操作；团队权限由服务端判定。',
    NOT_OWNER: '仅本机 Owner 可执行该计划操作。',
    NOT_READY: '本机 Team 账本尚未就绪，请稍后刷新。',
    UNKNOWN_ROOM: '找不到该 Room，可能已被移除。',
    MISSING_CANONICAL_ROOM: '无法确认该 Room 的权威标识。',
    NOT_FOUND: '该计划不存在，或不属于当前 Room。',
    REVISION_CONFLICT: '计划版本已变化，已重新读取，请核对后再次提交。',
    STALE_GENERATION: 'Team 代次已变化，已重新读取，请核对后再操作。',
    APPROVAL_BINDING_MISMATCH: '批准绑定的版本或指纹与服务端不一致，已重新读取。',
    INVALID_PLAN_GRAPH: '计划依赖不合法：不能有循环或跨 Room 依赖。',
    INVALID_PLAN: '计划内容不合法，请检查任务字段。',
    PLAN_TAMPER: '计划记录校验失败，已停止操作。',
    PLAN_ID_CONFLICT: '该计划 ID 已属于其他 Room。',
    REQUEST_CONFLICT: '同一请求对应了不同内容，请刷新后重试。',
    BAD_REQUEST: '请求内容不合法，请检查计划 ID 与任务清单。',
    ROOM_CHANGED: 'Room 或 Team 状态已变化，请刷新后重试。',
    PAUSED: 'Team 已暂停，请恢复后再操作。',
    PLAN_NOT_APPROVED: '该计划尚未批准，请先批准确切版本。',
    DEPENDENCY_NOT_ACCEPTED: '依赖任务尚未验收，暂不能派发。',
    NO_DISPATCHABLE_CANDIDATE: '没有满足授权、能力与容量的候选 Worker。',
    CANDIDATES_UNAVAILABLE: '候选授权数据不可用，已按安全策略拒绝。',
    CAPACITY: '目标 Worker 的执行槽已占用（含 uncertain）。',
    UNRESOLVED_EXECUTION: '该任务仍有未决执行（含 uncertain），需人工核对后再继续。',
    LAN_MESH_FAILED: '请求失败，请稍后重试。',
  };
  return messages[code] ?? (fallback || '操作失败，请稍后重试。');
}

/** Parse the draft task textarea; structural checks only, the Host validates the plan. */
function parseOwnerPlanTasks(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? ''));
  } catch {
    throw Object.assign(new Error('tasks must be JSON'), { code: 'BAD_REQUEST' });
  }
  if (!Array.isArray(value) || value.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
    throw Object.assign(new Error('tasks must be a JSON array of objects'), { code: 'BAD_REQUEST' });
  }
  return value;
}

/** Short fingerprint for dense rows; detail views always show the full value. */
function ownerPlanFingerprintShort(fingerprint) {
  return typeof fingerprint === 'string' && fingerprint.length > 12 ? `${fingerprint.slice(0, 12)}…` : String(fingerprint ?? '');
}

/** Room list rows, newest first, with no invented fields. */
function ownerPlanRows(plans) {
  return (Array.isArray(plans) ? plans : [])
    .filter(plan => plan && typeof plan === 'object' && typeof plan.planId === 'string' && plan.planId !== '')
    .map(plan => ({
      planId: plan.planId,
      roomId: typeof plan.roomId === 'string' ? plan.roomId : '',
      revision: plan.revision,
      generation: plan.generation,
      fingerprint: typeof plan.fingerprint === 'string' ? plan.fingerprint : '',
      approved: plan.approval !== null && plan.approval !== undefined,
      taskCount: Array.isArray(plan.tasks) ? plan.tasks.length : 0,
      updatedAt: typeof plan.updatedAt === 'string' ? plan.updatedAt : '',
    }))
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '') || left.planId.localeCompare(right.planId));
}

/** Exact stored version; task objects are kept as returned so a bump resubmits the same content. */
function ownerPlanDetail(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    planId: plan.planId,
    roomId: plan.roomId,
    revision: plan.revision,
    generation: plan.generation,
    fingerprint: typeof plan.fingerprint === 'string' ? plan.fingerprint : '',
    approved: plan.approval !== null && plan.approval !== undefined,
    approval: plan.approval && typeof plan.approval === 'object' ? { ...plan.approval } : null,
    tasks: Array.isArray(plan.tasks) ? plan.tasks.filter(task => task && typeof task === 'object' && !Array.isArray(task)).map(task => ({ ...task })) : [],
    createdAt: typeof plan.createdAt === 'string' ? plan.createdAt : '',
    updatedAt: typeof plan.updatedAt === 'string' ? plan.updatedAt : '',
  };
}

/** Display rows for the exact version's tasks. */
function ownerPlanTaskRows(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map((task, index) => ({
    key: `${String(task.taskId ?? 'task')}-${index}`,
    taskId: String(task.taskId ?? ''),
    title: typeof task.title === 'string' && task.title !== '' ? task.title : String(task.taskId ?? ''),
    detail: typeof task.detail === 'string' ? task.detail : '',
    dependsOn: stringList(task.dependsOn),
    requiredCapabilities: stringList(task.requiredCapabilities),
  }));
}

/** The exact sentence a person must confirm before an approval is sent. */
function ownerPlanApprovalPrompt(plan) {
  return `确认批准计划 ${plan.planId} 的版本 ${plan.revision}，指纹 ${plan.fingerprint}。`;
}


/**
 * Helpers the panel needs, passed explicitly like every other UI fragment so
 * the same component can be rendered in isolation by its own tests.
 */
const ownerPlanPanelModel = Object.freeze({
  conflict: ownerPlanConflict,
  errorText: ownerPlanErrorText,
  parseTasks: parseOwnerPlanTasks,
  fingerprintShort: ownerPlanFingerprintShort,
  rows: ownerPlanRows,
  detail: ownerPlanDetail,
  taskRows: ownerPlanTaskRows,
  approvalPrompt: ownerPlanApprovalPrompt,
  candidateReasonText: ownerPlanCandidateReasonText,
  previewRows: ownerPlanPreviewRows,
  explanationLines: ownerPlanExplanationLines,
  teamCountLine: ownerTeamCountLine,
});
    /* @ux-shell:owner-plan-model:end */
    /* @ux-shell:owner-plan-component:start */
/**
 * M6 Owner plan panel.
 *
 * Shown only inside the existing local Owner Team surface (Room tasks tab, the
 * local human session that currently leads the Room). It lists plan drafts,
 * reads one exact version, submits a draft and requires an explicit
 * confirmation of the version + fingerprint on screen before approving.
 *
 * Server authority is never inferred here:
 *  - every revision/fingerprint/approval shown comes from a Host response;
 *  - a version conflict triggers a READ of the current version, never a silent
 *    write retry;
 *  - switching Rooms discards in-flight answers from the previous Room.
 */
/**
 * Render the bound preview report: per-task state, exclusion reasons (with
 * Chinese labels) and the Host's explanations. Presentation only: every value
 * comes from the report the Host returned.
 */
function planPreviewView(h, model, report) {
  const view = model.previewRows(report);
  const lines = model.explanationLines(report.explanations);
  const orderLine = h('p', null, '依赖顺序：', report.dag?.order?.join(' → ') || '无可展示的顺序');
  const summary = view.rows.length
    ? h('p', { className: 'lm-ownerPlanPreviewSummary' },
        `可派发 ${view.summary.dispatchable} · 等待依赖 ${view.summary.blocked} · 无可用候选 ${view.summary.noCandidate}`
        + (view.summary.unknown ? ` · 无候选数据 ${view.summary.unknown}` : ''))
    : null;
  // Purely informational: scheduling itself stays a chat-tool action (opt-in),
  // the panel never becomes a dispatch write surface.
  const hint = view.summary.dispatchable > 0
    ? h('p', { className: 'lm-ownerPlanPreviewHint' },
        `有 ${view.summary.dispatchable} 项满足依赖、授权、能力与容量，可进入派单；派单由 Leader Agent 会话通过调度工具发起。`)
    : null;
  const taskRows = view.rows.length
    ? h('ul', { className: 'lm-ownerPlanPreviewTasks' }, ...view.rows.map(row => planPreviewRow(h, row)))
    : null;
  const explanationRows = lines.length
    ? h('ul', { className: 'lm-ownerPlanExplanations', 'aria-label': '候选说明' },
        ...lines.map((line, index) => h('li', { key: String(index) }, line)))
    : null;
  return h('div', { className: 'lm-ownerPlanPreviewReport', role: 'status' }, orderLine, summary, hint, taskRows, explanationRows);
}

function planPreviewRow(h, row) {
  const className = 'lm-ownerPlanPreviewRow'
    + (row.state === 'dispatchable' ? ' lm-ownerPlanPreviewOk' : '')
    + (row.state === 'noCandidate' ? ' lm-ownerPlanPreviewWarn' : '');
  const children = [
    h('strong', null, row.taskId),
    h('span', { className: 'lm-ownerPlanPreviewState' }, row.stateLabel),
    row.recommended.length ? h('small', null, '候选 ' + row.recommended.join('、')) : null,
    ...row.excluded.map(entry => h('small', { key: entry.memberKey + '|' + entry.reason },
      `${entry.memberKey}：${entry.text || entry.reason}`)),
  ];
  return h('li', { key: row.taskId, className }, ...children);
}

function OwnerPlanPanel(props) {
  const { h, React, call, roomId } = props;
  const model = props.model ?? ownerPlanPanelModel;
  // `randomUUID` is secure-context only; the panel's Host route is often plain
  // HTTP on a LAN, so the caller can supply the same fallback `rpcId` uses.
  const newRequestId = typeof props.newRequestId === 'function' ? props.newRequestId : () => crypto.randomUUID();
  const [team, setTeam] = React.useState(() => ({ status: 'loading', room: roomId, overview: null, error: '', code: '' }));
  const [list, setList] = React.useState(() => ({ status: 'loading', room: roomId, rows: [], error: '', code: '' }));
  const [selected, setSelected] = React.useState('');
  const [detail, setDetail] = React.useState(() => ({ status: 'idle', room: roomId, plan: null, error: '', code: '' }));
  const [planId, setPlanId] = React.useState('');
  const [tasksText, setTasksText] = React.useState('');
  const [draftBase, setDraftBase] = React.useState(null);
  const [confirming, setConfirming] = React.useState(null);
  const [notice, setNotice] = React.useState({ text: '', bad: false });
  const [busy, setBusy] = React.useState('');
  const [preview, setPreview] = React.useState(null);
  const retry = React.useRef(null);
  const page = React.useRef({ room: roomId, teamSeq: 0, listSeq: 0, detailSeq: 0 });

  function errorOf(error, fallback) {
    const code = typeof error?.code === 'string' ? error.code : '';
    const message = fallback ?? String(error?.message ?? error ?? '');
    return { code, text: model.errorText(code, message) };
  }

  async function reloadTeam() {
    const room = roomId;
    if (page.current.room !== room) return null;
    const token = ++page.current.teamSeq;
    try {
      const value = await call('teamOverview', { roomId });
      if (page.current.room !== room || page.current.teamSeq !== token) return null;
      setTeam({ status: 'ready', room, overview: value, error: '', code: '' });
      return value;
    } catch (error) {
      if (page.current.room !== room || page.current.teamSeq !== token) return null;
      const failed = errorOf(error);
      setTeam({ status: 'error', room, overview: null, error: failed.text, code: failed.code });
      return null;
    }
  }

  async function reloadList() {
    const room = roomId;
    if (page.current.room !== room) return null;
    const token = ++page.current.listSeq;
    try {
      const value = await call('planList', { roomId });
      if (page.current.room !== room || page.current.listSeq !== token) return null;
      setList({ status: 'ready', room, rows: model.rows(value), error: '', code: '' });
      return value;
    } catch (error) {
      if (page.current.room !== room || page.current.listSeq !== token) return null;
      const failed = errorOf(error);
      setList({ status: 'error', room, rows: [], error: failed.text, code: failed.code });
      return null;
    }
  }

  async function loadDetail(id) {
    const room = roomId;
    if (page.current.room !== room) return null;
    const token = ++page.current.detailSeq;
    setPreview(null);
    setSelected(id);
    setConfirming(null);
    setDetail({ status: 'loading', room, plan: null, error: '', code: '' });
    try {
      const value = await call('planRead', { roomId, planId: id });
      if (page.current.room !== room || page.current.detailSeq !== token) return null;
      const plan = model.detail(value);
      if (!plan || plan.planId !== id || plan.roomId !== room) {
        setDetail({ status: 'error', room, plan: null, error: '服务端返回的版本与请求或当前 Room 不一致，请刷新核对。', code: 'MISMATCH' });
        return null;
      }
      setDetail({ status: 'ready', room, plan, error: '', code: '' });
      return plan;
    } catch (error) {
      if (page.current.room !== room || page.current.detailSeq !== token) return null;
      const failed = errorOf(error);
      setDetail({ status: 'error', room, plan: null, error: failed.text, code: failed.code });
      return null;
    }
  }

  async function loadPreview(plan) {
    const room = roomId;
    const token = page.current.detailSeq;
    const active = () => page.current.room === room && page.current.detailSeq === token;
    const version = { room, token };
    setPreview({ ...version, loading: true });
    try {
      const report = await call('planPreview', {
        roomId: room, planId: plan.planId, expectedGeneration: plan.generation,
        expectedRevision: plan.revision, fingerprint: plan.fingerprint,
      });
      if (!active()) return;
      const approval = report?.approval;
      if (report?.bound !== true || approval?.roomId !== room || approval.planId !== plan.planId ||
          approval.generation !== plan.generation || approval.revision !== plan.revision ||
          approval.fingerprint !== plan.fingerprint) {
        setPreview({ ...version, error: '预览版本已变更，请重新打开计划。' });
        return;
      }
      setPreview({ ...version, report });
    } catch (error) {
      if (active()) setPreview({ ...version, error: errorOf(error).text });
    }
  }

  React.useEffect(() => {
    const room = roomId;
    const current = page.current;
    current.room = room;
    const teamToken = ++current.teamSeq;
    const listToken = ++current.listSeq;
    ++current.detailSeq;
    setSelected('');
    setConfirming(null);
    setPlanId('');
    setTasksText('');
    setDraftBase(null);
    setNotice({ text: '', bad: false });
    retry.current = null;
    setTeam({ status: 'loading', room, overview: null, error: '', code: '' });
    setList({ status: 'loading', room, rows: [], error: '', code: '' });
    setDetail({ status: 'idle', room, plan: null, error: '', code: '' });
    Promise.resolve().then(() => call('teamOverview', { roomId })).then(
      value => {
        if (current.room !== room || current.teamSeq !== teamToken) return;
        setTeam({ status: 'ready', room, overview: value, error: '', code: '' });
      },
      error => {
        if (current.room !== room || current.teamSeq !== teamToken) return;
        const failed = errorOf(error);
        setTeam({ status: 'error', room, overview: null, error: failed.text, code: failed.code });
      },
    );
    Promise.resolve().then(() => call('planList', { roomId })).then(
      value => {
        if (current.room !== room || current.listSeq !== listToken) return;
        setList({ status: 'ready', room, rows: model.rows(value), error: '', code: '' });
      },
      error => {
        if (current.room !== room || current.listSeq !== listToken) return;
        const failed = errorOf(error);
        setList({ status: 'error', room, rows: [], error: failed.text, code: failed.code });
      },
    );
  }, [call, roomId]);

  const teamView = team.room === roomId ? team : { status: 'loading', room: roomId, overview: null, error: '', code: '' };
  const listView = list.room === roomId ? list : { status: 'loading', room: roomId, rows: [], error: '', code: '' };
  const detailView = detail.room === roomId ? detail : { status: 'idle', room: roomId, plan: null, error: '', code: '' };
  const generation = Number.isSafeInteger(teamView.overview?.generation) ? teamView.overview.generation : null;
  const denied = [teamView, listView, detailView].some(view => view.status === 'error' && view.code === 'FORBIDDEN');
  const detailPlan = detailView.status === 'ready' ? detailView.plan : null;
  const planPreview = preview?.room === roomId && preview.token === page.current.detailSeq ? preview : null;
  const trimmedPlanId = planId.trim();
  const expectedRevision = draftBase && draftBase.planId === trimmedPlanId ? draftBase.revision : 0;

  async function refreshAll() {
    const room = roomId;
    await Promise.all([reloadTeam(), reloadList()]);
    if (page.current.room !== room) return;
    if (selected) await loadDetail(selected);
  }

  async function submitDraft() {
    if (busy !== '') return;
    const room = roomId;
    const id = planId.trim();
    if (id === '') {
      setNotice({ text: '请填写计划 ID。', bad: true });
      return;
    }
    if (generation === null) {
      setNotice({ text: 'Team 代次未知，请刷新后再提交。', bad: true });
      return;
    }
    let tasks;
    try {
      tasks = model.parseTasks(tasksText);
    } catch {
      setNotice({ text: '任务清单必须是 JSON 数组，且每一项都是对象。', bad: true });
      return;
    }
    const intent = JSON.stringify({ roomId, planId: id, expectedRevision, expectedGeneration: generation, tasks });
    if (retry.current?.key !== intent) retry.current = { key: intent, requestId: newRequestId() };
    const requestId = retry.current.requestId;
    setBusy('submit');
    setConfirming(null);
    setNotice({ text: '', bad: false });
    try {
      const result = await call('planSubmit', { requestId, roomId, planId: id, expectedRevision, expectedGeneration: generation, tasks });
      if (page.current.room !== room) return;
      retry.current = null;
      setDraftBase({ planId: id, revision: result.revision });
      await reloadList();
      if (page.current.room !== room) return;
      const fresh = await loadDetail(id);
      if (page.current.room !== room) return;
      if (!fresh) {
        setNotice({ text: '服务端已保存草稿：版本 ' + result.revision + ' · 指纹 ' + result.fingerprint + '；但重新读取详情失败，请手动刷新核对。', bad: true });
      } else if (fresh.revision !== result.revision || fresh.fingerprint !== result.fingerprint) {
        setNotice({ text: '服务端已保存版本 ' + result.revision + '，但重新读取得到版本 ' + fresh.revision + '；内容已被再次修改，请核对。', bad: true });
      } else {
        setNotice({ text: '服务端已保存草稿：版本 ' + result.revision + ' · 指纹 ' + result.fingerprint, bad: false });
      }
    } catch (error) {
      if (page.current.room !== room) return;
      const code = typeof error?.code === 'string' ? error.code : '';
      if (model.conflict(code)) {
        if (code === 'STALE_GENERATION') await reloadTeam();
        if (page.current.room !== room) return;
        const fresh = await loadDetail(id);
        if (page.current.room !== room) return;
        if (fresh) setDraftBase({ planId: id, revision: fresh.revision });
        setNotice({
          text: fresh
            ? '服务端版本已变化，已重新读取：版本 ' + fresh.revision + ' · 指纹 ' + fresh.fingerprint + '。请核对后再次提交，不会自动重试。'
            : '服务端版本已变化，但重新读取失败，请刷新后核对。',
          bad: true,
        });
      } else {
        setNotice({ text: model.errorText(code, String(error?.message ?? error)), bad: true });
        if (code === 'FORBIDDEN') {
          retry.current = null;
          await refreshAll();
        }
      }
    } finally {
      if (page.current.room === room) setBusy('');
    }
  }

  function beginApprove() {
    if (!detailPlan || busy !== '') return;
    setConfirming({
      planId: detailPlan.planId,
      revision: detailPlan.revision,
      generation: detailPlan.generation,
      fingerprint: detailPlan.fingerprint,
    });
    setNotice({ text: '', bad: false });
  }

  async function approveConfirmed() {
    if (!confirming || busy !== '') return;
    const room = roomId;
    const target = confirming;
    const shown = detailView.status === 'ready' ? detailView.plan : null;
    if (!shown || shown.planId !== target.planId || shown.revision !== target.revision || shown.fingerprint !== target.fingerprint) {
      setConfirming(null);
      setNotice({ text: '已展示的版本与确认内容不一致，请重新选择版本后再批准。', bad: true });
      return;
    }
    if (!Number.isSafeInteger(target.generation)) {
      setConfirming(null);
      setNotice({ text: '该版本的 Team 代次未知，请重新读取后再批准。', bad: true });
      return;
    }
    const intent = JSON.stringify(target);
    if (retry.current?.key !== intent) retry.current = { key: intent, requestId: newRequestId() };
    const requestId = retry.current.requestId;
    setBusy('approve');
    try {
      const result = await call('planApprove', {
        requestId,
        roomId,
        planId: target.planId,
        expectedRevision: target.revision,
        expectedGeneration: target.generation,
        fingerprint: target.fingerprint,
      });
      if (page.current.room !== room) return;
      retry.current = null;
      if (result.revision !== target.revision || result.fingerprint !== target.fingerprint) {
        setConfirming(null);
        setNotice({ text: '批准响应与确认的版本或指纹不一致，已重新读取，请核对。', bad: true });
        await loadDetail(target.planId);
        return;
      }
      setConfirming(null);
      const fresh = await loadDetail(target.planId);
      if (page.current.room !== room) return;
      setNotice({
        text: '已批准版本 ' + result.revision + ' · 指纹 ' + result.fingerprint + (fresh ? '' : '（详情刷新失败，请手动刷新核对）'),
        bad: false,
      });
      await reloadList();
    } catch (error) {
      if (page.current.room !== room) return;
      const code = typeof error?.code === 'string' ? error.code : '';
      setConfirming(null);
      if (model.conflict(code)) {
        if (code === 'STALE_GENERATION') await reloadTeam();
        if (page.current.room !== room) return;
        const fresh = await loadDetail(target.planId);
        if (page.current.room !== room) return;
        setNotice({
          text: fresh
            ? '版本已变化，已重新读取：版本 ' + fresh.revision + ' · 指纹 ' + fresh.fingerprint + '。原确认已失效，请核对后重新批准。'
            : '版本已变化，重新读取失败，请刷新后核对。',
          bad: true,
        });
      } else {
        setNotice({ text: model.errorText(code, String(error?.message ?? error)), bad: true });
        if (code === 'FORBIDDEN') {
          retry.current = null;
          await refreshAll();
        }
      }
    } finally {
      if (page.current.room === room) setBusy('');
    }
  }

  function loadAsDraft(plan) {
    setDraftBase({ planId: plan.planId, revision: plan.revision });
    setPlanId(plan.planId);
    setTasksText(JSON.stringify(plan.tasks, null, 2));
    setNotice({ text: '已载入版本 ' + plan.revision + ' 的任务清单；提交草稿会基于该版本创建新版本。', bad: false });
  }

  if (denied) {
    return h('section', { className: 'lm-task lm-ownerPlanPanel', 'aria-label': 'M6 计划草稿与批准' },
      h('div', { className: 'lm-ownerPlanHead' }, h('h3', null, '计划草稿与批准 · 本机')),
      h('p', { className: 'lm-ownerPlanDenied', role: 'alert' }, '当前无权查看或变更该 Room 的计划；团队权限由服务端判定。'));
  }

  const rows = listView.rows;
  const tasks = detailPlan ? model.taskRows(detailPlan.tasks) : [];
  const teamCounts = model.teamCountLine(teamView.overview);
  return h('section', { className: 'lm-task lm-ownerPlanPanel', 'aria-label': 'M6 计划草稿与批准' },
    h('div', { className: 'lm-ownerPlanHead' },
      h('div', null,
        h('h3', null, '计划草稿与批准 · 本机'),
        h('p', { className: 'lm-muted' }, '服务端账本校验版本、代次与指纹。批准只绑定下面展示的确切版本。'),
        teamCounts !== '' ? h('p', { className: 'lm-ownerPlanCounts' }, teamCounts) : null),
      h('button', { type: 'button', className: 'lm-btn lm-ownerPlanRefresh', disabled: busy !== '', onClick: () => { void refreshAll(); } }, '刷新计划')),
    teamView.status === 'error' ? h('p', { className: 'lm-ownerPlanNotice lm-ownerPlanNoticeBad', role: 'alert' }, teamView.error) : null,
    h('p', { className: 'lm-ownerPlanNotice' + (notice.bad ? ' lm-ownerPlanNoticeBad' : ''), role: notice.bad ? 'alert' : 'status' }, notice.text || (busy !== '' ? '处理中…' : '')),
    h('div', { className: 'lm-ownerPlanBody' },
      h('div', { className: 'lm-ownerPlanList', role: 'group', 'aria-label': '计划列表' },
        h('p', { className: 'lm-ownerPlanListHint' }, listView.status === 'loading' ? '正在读取计划…' : (listView.error || (rows.length === 0 ? '当前 Room 还没有计划草稿' : '选择一个计划查看确切版本'))),
        ...rows.map(row => h('button', {
          key: row.planId,
          type: 'button',
          className: 'lm-ownerPlanRow' + (row.planId === selected ? ' lm-ownerPlanRowActive' : ''),
          'aria-pressed': row.planId === selected,
          onClick: () => { void loadDetail(row.planId); },
        },
          h('strong', null, row.planId),
          h('span', null, '版本 ' + row.revision + ' · ' + (row.approved ? '已批准' : '未批准')),
          h('small', null, '指纹 ' + model.fingerprintShort(row.fingerprint) + ' · ' + row.taskCount + ' 项任务')))),
      h('div', { className: 'lm-ownerPlanDetail' },
        detailView.status === 'idle' ? h('p', { className: 'lm-muted' }, '选择左侧计划查看服务端保存的确切版本与指纹。') : null,
        detailView.status === 'loading' ? h('p', { className: 'lm-muted' }, '正在读取版本…') : null,
        detailView.status === 'error' ? h('p', { className: 'lm-ownerPlanNotice lm-ownerPlanNoticeBad', role: 'alert' }, detailView.error) : null,
        detailPlan ? h('div', null,
          h('div', { className: 'lm-ownerPlanMeta' },
            h('p', null, h('strong', null, detailPlan.planId), ' · 版本 ', String(detailPlan.revision), ' · 代次 ', String(detailPlan.generation)),
            h('p', { className: 'lm-ownerPlanFingerprint' }, h('span', null, '指纹'), h('code', null, detailPlan.fingerprint)),
            h('p', null, detailPlan.approved
              ? '已批准' + (detailPlan.approval?.approvedAt ? ' · ' + detailPlan.approval.approvedAt : '')
              : '未批准')),
          h('ul', { className: 'lm-ownerPlanTasks' }, ...tasks.map(task => h('li', { key: task.key },
            h('strong', null, task.title), h('span', { className: 'lm-muted' }, ' · ' + task.taskId),
            task.dependsOn.length ? h('small', null, '依赖 ' + task.dependsOn.join('、')) : null,
            task.requiredCapabilities.length ? h('small', null, '能力 ' + task.requiredCapabilities.join('、')) : null,
            task.detail ? h('p', { className: 'lm-ownerPlanTaskDetail' }, task.detail) : null))),
          h('div', { className: 'lm-ownerPlanActions' },
            h('button', { type: 'button', className: 'lm-btn lm-ownerPlanLoadDraft', onClick: () => loadAsDraft(detailPlan) }, '载入为草稿'),
            detailPlan.approved ? h('button', { type: 'button', className: 'lm-btn lm-ownerPlanPreview', disabled: planPreview?.loading, onClick: () => { void loadPreview(detailPlan); } }, planPreview?.loading ? '读取预览中…' : '预览已批准版本 ' + detailPlan.revision) : null,
            !detailPlan.approved && !confirming ? h('button', { type: 'button', className: 'lm-btn lm-btnPrimary lm-ownerPlanApprove', disabled: busy !== '', onClick: beginApprove }, '批准此版本') : null),
          planPreview?.error ? h('p', { role: 'alert' }, planPreview.error) : null,
          planPreview?.report ? planPreviewView(h, model, planPreview.report) : null,
          !detailPlan.approved && confirming ? h('div', { className: 'lm-ownerPlanConfirm', role: 'group', 'aria-label': '批准确认' },
            h('p', null, model.approvalPrompt(confirming)),
            h('p', { className: 'lm-muted' }, '确认后服务端会原子绑定计划、版本、代次与指纹；版本变化会使旧批准失效。'),
            h('div', { className: 'lm-ownerPlanConfirmActions' },
              h('button', { type: 'button', className: 'lm-btn lm-btnPrimary lm-ownerPlanConfirmBtn', disabled: busy !== '', onClick: () => { void approveConfirmed(); } }, busy === 'approve' ? '批准中…' : '确认批准版本 ' + confirming.revision),
              h('button', { type: 'button', className: 'lm-btn lm-ownerPlanCancel', disabled: busy !== '', onClick: () => setConfirming(null) }, '取消'))) : null) : null,
        h('form', { className: 'lm-ownerPlanForm', onSubmit: event => { event.preventDefault(); void submitDraft(); } },
          h('h4', null, '提交计划草稿'),
          h('label', null, '计划 ID',
            h('input', { className: 'lm-ownerPlanPlanId', value: planId, maxLength: 120, disabled: busy !== '', onChange: event => setPlanId(event.target.value) })),
          h('label', null, '任务清单（JSON 数组）',
            h('textarea', { className: 'lm-ownerPlanTasksInput', value: tasksText, rows: 10, disabled: busy !== '', spellCheck: false, onChange: event => setTasksText(event.target.value) })),
          h('p', { className: 'lm-muted' }, '期望版本 ' + expectedRevision + ' · Team 代次 ' + (generation === null ? '未知' : generation)),
          h('button', { type: 'submit', className: 'lm-btn lm-btnPrimary lm-ownerPlanSubmit', disabled: busy !== '' || generation === null }, busy === 'submit' ? '提交中…' : '提交草稿')))));
}
    /* @ux-shell:owner-plan-component:end */
    /* @ux-shell:owner-result-model:start */
/**
 * M6 Owner fixed-result review panel view model.
 *
 * Pure presentation helpers only: no network, no storage, no authority and no
 * hash computation. Every executionId, resultHash, generation and review
 * status shown by the panel comes from a Host response; this module only
 * formats and filters what the server returned.
 */

const HASH_RE = /^[a-f0-9]{64}$/;
const REVIEWABLE = 'review';

// A decision failure that means the fixed result moved underneath the user.
// The panel re-READS the current overview for these and never retries blindly.
const RESULT_CONFLICT_CODES = [
  'STALE_GENERATION',
  'STALE_RESULT',
  'RESULT_HASH_MISMATCH',
  'RESULT_NOT_REVIEWABLE',
  'NOT_IN_REVIEW',
  'ROOM_CHANGED',
  'EXECUTION_NOT_FOUND',
  'EXECUTION_SCOPE_MISMATCH',
];

/** True when the failure invalidates the confirmed execution/result pair. */
function ownerResultConflict(code) {
  return RESULT_CONFLICT_CODES.includes(code);
}

/** Stable Chinese text for the codes the result-review entry can return. */
function ownerResultErrorText(code, fallback = '') {
  const messages = {
    FORBIDDEN: '当前无权评审该 Room 的成果；团队权限由服务端判定。',
    NOT_OWNER: '仅本机 Owner 可执行成果评审。',
    NOT_READY: '本机 Team 账本尚未就绪，请稍后刷新。',
    UNKNOWN_ROOM: '找不到该 Room，可能已被移除。',
    MISSING_CANONICAL_ROOM: '无法确认该 Room 的权威标识。',
    BAD_REQUEST: '请求内容不合法，请刷新后重新选择成果。',
    NOT_FOUND: '该任务或执行已不存在，请刷新。',
    NOT_CURRENT_LEADER: '当前 Team Leader 已变化，不能评审该成果。',
    NOT_LOCAL_LEADER: '只有本机当前的 Team Leader 可以评审。',
    ROOM_CHANGED: 'Room 的负责人或成员已变化，请刷新后核对。',
    STALE_GENERATION: 'Team 代次已变化，该结果已失效，已重新读取。',
    STALE_RESULT: '该执行已不是任务的当前结果，已重新读取。',
    EXECUTION_NOT_FOUND: '找不到该执行，可能已被替换，已重新读取。',
    EXECUTION_SCOPE_MISMATCH: '该执行不属于此 Room 或任务，已重新读取。',
    RESULT_NOT_REVIEWABLE: '该执行不是可评审的成功结果，已重新读取。',
    RESULT_HASH_MISMATCH: '结果指纹与服务端不一致，已重新读取，请核对后重试。',
    RESULT_MISSING: '该执行没有可评审的结果内容，已重新读取。',
    MISSING_REASON: '拒绝必须填写原因。',
    NOT_IN_REVIEW: '该任务已不在待评审状态，已重新读取。',
    CONFLICT: '同一请求对应了不同内容，请刷新后重新评审。',
    LAN_MESH_FAILED: '请求失败，请稍后重试。',
  };
  return messages[code] ?? (fallback || '操作失败，请稍后重试。');
}

/**
 * Fixed-result rows from the owner overview projection.
 *
 * Only fields the server actually returned are kept. A row is actionable only
 * when the task, execution, generation and a canonical lowercase sha256 hash
 * are all present; nothing is invented for a partial row.
 */
function ownerResultRows(refs) {
  return (Array.isArray(refs) ? refs : [])
    .filter(ref => ref && typeof ref === 'object')
    .map(ref => {
      const taskId = typeof ref.taskId === 'string' ? ref.taskId : '';
      const executionId = typeof ref.executionId === 'string' ? ref.executionId : '';
      const resultHash = typeof ref.resultHash === 'string' ? ref.resultHash : '';
      const generation = Number.isSafeInteger(ref.generation) && ref.generation > 0 ? ref.generation : null;
      const reviewStatus = typeof ref.reviewStatus === 'string' ? ref.reviewStatus : '';
      return {
        taskId,
        executionId,
        resultHash,
        generation,
        reviewStatus,
        reviewable: reviewStatus === REVIEWABLE,
        actionable: taskId !== '' && executionId !== '' && HASH_RE.test(resultHash) && generation !== null,
      };
    })
    .filter(row => row.reviewable)
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.executionId.localeCompare(right.executionId));
}

/** Short fingerprint for dense rows; the detail view always shows it in full. */
function ownerResultHashShort(resultHash) {
  return typeof resultHash === 'string' && resultHash.length > 12 ? `${resultHash.slice(0, 12)}…` : String(resultHash ?? '');
}

/** The exact sentence a person must confirm before a decision is sent. */
function ownerResultDecisionPrompt(row, decision) {
  const verb = decision === 'rejected' ? '拒绝' : '接受';
  return `确认${verb}任务 ${row.taskId} 的执行 ${row.executionId}，结果指纹 ${row.resultHash}。`;
}

/**
 * Helpers the panel needs, passed explicitly like every other UI fragment so
 * the same component can be rendered in isolation by its own tests.
 */
const ownerResultPanelModel = Object.freeze({
  conflict: ownerResultConflict,
  errorText: ownerResultErrorText,
  rows: ownerResultRows,
  hashShort: ownerResultHashShort,
  decisionPrompt: ownerResultDecisionPrompt,
});
    /* @ux-shell:owner-result-model:end */
    /* @ux-shell:owner-result-component:start */
/**
 * M6 Owner fixed-result review panel.
 *
 * Shown only inside the existing local Owner Team surface (the local human who
 * currently leads the Room). It lists the executions awaiting review from the
 * owner overview projection, shows the exact fixed executionId + resultHash and
 * sends an explicit accept or a reject with a mandatory reason.
 *
 * Server authority is never inferred here:
 *  - the executionId/resultHash/generation shown are always the ones the Host
 *    returned; the panel never computes or guesses a hash;
 *  - a decision is only sent after confirming the exact reference on screen,
 *    and the response is checked against that confirmed reference;
 *  - a stale/generation failure triggers a READ of the current overview, never
 *    a silent write retry; the same requestId is reused only for a retry of the
 *    same confirmed intent;
 *  - switching Rooms discards in-flight answers from the previous Room.
 */
function OwnerResultPanel(props) {
  const { h, React, call, roomId } = props;
  const model = props.model ?? ownerResultPanelModel;
  // `randomUUID` is secure-context only; the Host route is often plain HTTP on
  // a LAN, so the caller can supply the same fallback the plan panel uses.
  const newRequestId = typeof props.newRequestId === 'function' ? props.newRequestId : () => crypto.randomUUID();
  const [view, setView] = React.useState(() => ({ status: 'loading', room: roomId, overview: null, error: '', code: '' }));
  const [selected, setSelected] = React.useState('');
  const [confirming, setConfirming] = React.useState(null);
  const [reason, setReason] = React.useState('');
  const [notice, setNotice] = React.useState({ text: '', bad: false });
  const [busy, setBusy] = React.useState('');
  const inflight = React.useRef('');
  const retry = React.useRef(null);
  const page = React.useRef({ room: roomId, seq: 0 });

  function errorOf(error, fallback) {
    const code = typeof error?.code === 'string' ? error.code : '';
    const message = fallback ?? String(error?.message ?? error ?? '');
    return { code, text: model.errorText(code, message) };
  }

  async function reload() {
    const room = roomId;
    if (page.current.room !== room) return null;
    const token = ++page.current.seq;
    try {
      const value = await call('teamOverview', { roomId });
      if (page.current.room !== room || page.current.seq !== token) return null;
      setView({ status: 'ready', room, overview: value, error: '', code: '' });
      return value;
    } catch (error) {
      if (page.current.room !== room || page.current.seq !== token) return null;
      const failed = errorOf(error);
      setView({ status: 'error', room, overview: null, error: failed.text, code: failed.code });
      return null;
    }
  }

  React.useEffect(() => {
    const room = roomId;
    const current = page.current;
    current.room = room;
    const token = ++current.seq;
    inflight.current = '';
    retry.current = null;
    setSelected('');
    setConfirming(null);
    setReason('');
    setNotice({ text: '', bad: false });
    setBusy('');
    setView({ status: 'loading', room, overview: null, error: '', code: '' });
    Promise.resolve().then(() => call('teamOverview', { roomId })).then(
      value => {
        if (current.room !== room || current.seq !== token) return;
        setView({ status: 'ready', room, overview: value, error: '', code: '' });
      },
      error => {
        if (current.room !== room || current.seq !== token) return;
        const failed = errorOf(error);
        setView({ status: 'error', room, overview: null, error: failed.text, code: failed.code });
      },
    );
  }, [call, roomId]);

  const current = view.room === roomId ? view : { status: 'loading', room: roomId, overview: null, error: '', code: '' };
  const generation = Number.isSafeInteger(current.overview?.generation) ? current.overview.generation : null;
  const denied = current.status === 'error' && current.code === 'FORBIDDEN';
  const rows = current.status === 'ready' ? model.rows(current.overview?.resultRefs) : [];
  const activeRow = rows.find(row => row.executionId === selected) ?? null;
  const staleRow = Boolean(activeRow && generation !== null && activeRow.generation !== generation);

  function selectRow(row) {
    if (inflight.current !== '') return;
    setSelected(row.executionId);
    setConfirming(null);
    setReason('');
    setNotice({ text: '', bad: false });
  }

  function beginDecision(decision) {
    if (!activeRow || inflight.current !== '' || denied) return;
    if (!activeRow.actionable) {
      setNotice({ text: '该记录缺少可用的任务、执行或指纹，无法评审，请刷新核对。', bad: true });
      return;
    }
    if (generation === null) {
      setNotice({ text: 'Team 代次未知，请刷新后再评审。', bad: true });
      return;
    }
    if (activeRow.generation !== generation) {
      setNotice({ text: '该执行属于旧 Team 代次，不能评审；请刷新等待当前结果。', bad: true });
      return;
    }
    setReason('');
    setConfirming({
      decision,
      taskId: activeRow.taskId,
      executionId: activeRow.executionId,
      resultHash: activeRow.resultHash,
      generation: activeRow.generation,
    });
    setNotice({ text: '', bad: false });
  }

  async function sendDecision() {
    if (!confirming || inflight.current !== '') return;
    const room = roomId;
    const target = confirming;
    const shown = rows.find(row => row.executionId === target.executionId) ?? null;
    if (!shown
      || shown.taskId !== target.taskId
      || shown.resultHash !== target.resultHash
      || shown.generation !== target.generation) {
      setConfirming(null);
      setNotice({ text: '已展示的成果与确认内容不一致，请重新选择后再评审。', bad: true });
      return;
    }
    const trimmedReason = reason.trim();
    if (target.decision === 'rejected' && trimmedReason === '') {
      setNotice({ text: '拒绝必须填写原因，返工需要新的执行。', bad: true });
      return;
    }
    const intent = JSON.stringify({
      roomId,
      taskId: target.taskId,
      executionId: target.executionId,
      resultHash: target.resultHash,
      generation: target.generation,
      decision: target.decision,
      reason: target.decision === 'rejected' ? trimmedReason : '',
    });
    if (retry.current?.key !== intent) retry.current = { key: intent, requestId: newRequestId() };
    const requestId = retry.current.requestId;
    const method = target.decision === 'rejected' ? 'resultReject' : 'resultAccept';
    inflight.current = method;
    setBusy(method);
    setNotice({ text: '', bad: false });
    try {
      const payload = {
        requestId,
        roomId,
        taskId: target.taskId,
        generation: target.generation,
        executionId: target.executionId,
        resultHash: target.resultHash,
      };
      if (target.decision === 'rejected') payload.reason = trimmedReason;
      const result = await call(method, payload);
      if (page.current.room !== room) return;
      retry.current = null;
      const record = result?.record;
      const bound = record && record.decision === target.decision
        && record.reviewedExecutionId === target.executionId
        && record.resultHash === target.resultHash
        && record.taskId === target.taskId;
      if (!bound) {
        setConfirming(null);
        setNotice({ text: '评审响应与确认的成果不一致，已重新读取，请核对。', bad: true });
        await reload();
        return;
      }
      setConfirming(null);
      setReason('');
      setSelected('');
      const fresh = await reload();
      if (page.current.room !== room) return;
      const still = fresh
        ? model.rows(fresh.resultRefs).some(row => row.executionId === target.executionId)
        : false;
      const verb = target.decision === 'rejected' ? '已拒绝' : '已接受';
      setNotice({
        text: verb + '任务 ' + target.taskId + ' 的执行 ' + target.executionId + ' · 指纹 ' + target.resultHash
          + (result.replayed ? '（该请求此前已生效，未重复写入）' : '')
          + (still ? '；该执行仍在待评审列表中，请刷新核对。' : '')
          + (fresh ? '' : '；列表刷新失败，请手动刷新核对。'),
        bad: still || !fresh,
      });
    } catch (error) {
      if (page.current.room !== room) return;
      const code = typeof error?.code === 'string' ? error.code : '';
      setConfirming(null);
      if (model.conflict(code)) {
        const fresh = await reload();
        if (page.current.room !== room) return;
        setSelected('');
        setNotice({
          text: fresh
            ? model.errorText(code) + '不会自动重试，请核对当前列表后重新选择。'
            : model.errorText(code) + '；重新读取失败，请手动刷新核对。',
          bad: true,
        });
      } else {
        setNotice({ text: model.errorText(code, String(error?.message ?? error)), bad: true });
        if (code === 'FORBIDDEN') {
          retry.current = null;
          await reload();
        }
      }
    } finally {
      if (page.current.room === room) {
        inflight.current = '';
        setBusy('');
      }
    }
  }

  if (denied) {
    return h('section', { className: 'lm-task lm-ownerResultPanel', 'aria-label': 'M6 固定成果评审' },
      h('div', { className: 'lm-ownerResultHead' }, h('h3', null, '固定成果评审 · 本机')),
      h('p', { className: 'lm-ownerResultDenied', role: 'alert' }, '当前无权评审该 Room 的成果；团队权限由服务端判定。'));
  }

  const meta = activeRow ? h('div', { className: 'lm-ownerResultMeta' },
    h('p', null, h('strong', null, activeRow.taskId || '未知任务'), ' · 执行 ', h('code', { className: 'lm-ownerResultExecution' }, activeRow.executionId || '未知')),
    h('p', { className: 'lm-ownerResultHash' }, h('span', null, '结果指纹'), h('code', null, activeRow.resultHash || '未知')),
    h('p', { className: 'lm-muted' }, '代次 ' + (activeRow.generation === null ? '未知' : String(activeRow.generation))
      + ' · 当前 Team 代次 ' + (generation === null ? '未知' : String(generation))
      + ' · 状态 ' + (activeRow.reviewStatus || '未知')),
    staleRow ? h('p', { className: 'lm-ownerResultNotice lm-ownerResultNoticeBad', role: 'alert' }, '该执行属于旧 Team 代次，不能评审；请刷新等待当前结果。') : null,
    !activeRow.actionable ? h('p', { className: 'lm-ownerResultNotice lm-ownerResultNoticeBad', role: 'alert' }, '该记录缺少可用的任务、执行或指纹，无法评审。') : null,
    activeRow.reviewable && activeRow.actionable && generation !== null && !staleRow && !confirming ? h('div', { className: 'lm-ownerResultActions' },
      h('button', { type: 'button', className: 'lm-btn lm-btnPrimary lm-ownerResultAccept', disabled: busy !== '', onClick: () => beginDecision('accepted') }, '接受成果'),
      h('button', { type: 'button', className: 'lm-btn lm-ownerResultReject', disabled: busy !== '', onClick: () => beginDecision('rejected') }, '拒绝成果')) : null,
    confirming ? h('div', { className: 'lm-ownerResultConfirm', role: 'group', 'aria-label': '成果评审确认' },
      h('p', null, model.decisionPrompt(confirming, confirming.decision)),
      h('p', { className: 'lm-muted' }, confirming.decision === 'rejected'
        ? '拒绝会记录原因并保留原执行；返工需要新的执行，不会自动重派。'
        : '接受只绑定上面展示的执行与指纹；之后的结果变化需要新的评审。'),
      confirming.decision === 'rejected' ? h('label', { className: 'lm-ownerResultReasonLabel' }, '拒绝原因',
        h('textarea', {
          className: 'lm-ownerResultReason',
          value: reason,
          rows: 3,
          maxLength: 4000,
          disabled: busy !== '',
          onChange: event => setReason(event.target.value),
        })) : null,
      h('div', { className: 'lm-ownerResultConfirmActions' },
        h('button', {
          type: 'button',
          className: 'lm-btn lm-btnPrimary lm-ownerResultConfirmBtn',
          disabled: busy !== '' || (confirming.decision === 'rejected' && reason.trim() === ''),
          onClick: () => { void sendDecision(); },
        }, busy === 'resultReject' ? '拒绝中…' : busy === 'resultAccept' ? '接受中…' : (confirming.decision === 'rejected' ? '确认拒绝执行 ' + confirming.executionId : '确认接受执行 ' + confirming.executionId)),
        h('button', { type: 'button', className: 'lm-btn lm-ownerResultCancel', disabled: busy !== '', onClick: () => { setConfirming(null); setReason(''); } }, '取消'))) : null) : null;

  return h('section', { className: 'lm-task lm-ownerResultPanel', 'aria-label': 'M6 固定成果评审' },
    h('div', { className: 'lm-ownerResultHead' },
      h('div', null,
        h('h3', null, '固定成果评审 · 本机'),
        h('p', { className: 'lm-muted' }, '仅列出待评审的执行；接受或拒绝都绑定下面展示的确切执行 ID 与结果指纹。')),
      h('button', { type: 'button', className: 'lm-btn lm-ownerResultRefresh', disabled: busy !== '', onClick: () => { void reload(); } }, '刷新成果')),
    current.status === 'error' ? h('p', { className: 'lm-ownerResultNotice lm-ownerResultNoticeBad', role: 'alert' }, current.error) : null,
    h('p', { className: 'lm-ownerResultNotice' + (notice.bad ? ' lm-ownerResultNoticeBad' : ''), role: notice.bad ? 'alert' : 'status' }, notice.text || (busy !== '' ? '处理中…' : '')),
    h('div', { className: 'lm-ownerResultBody' },
      h('div', { className: 'lm-ownerResultList', role: 'group', 'aria-label': '待评审成果' },
        h('p', { className: 'lm-ownerResultListHint' }, current.status === 'loading'
          ? '正在读取待评审成果…'
          : (current.error || (rows.length === 0 ? '当前 Room 没有待评审的固定成果。' : '选择一个执行查看确切结果'))),
        ...rows.map(row => h('button', {
          key: row.executionId,
          type: 'button',
          className: 'lm-ownerResultRow' + (row.executionId === selected ? ' lm-ownerResultRowActive' : ''),
          'aria-pressed': row.executionId === selected,
          disabled: busy !== '',
          onClick: () => selectRow(row),
        },
          h('strong', null, row.taskId || '未知任务'),
          h('span', null, '执行 ' + (row.executionId || '未知')),
          h('small', null, '指纹 ' + model.hashShort(row.resultHash) + ' · 代次 ' + (row.generation === null ? '未知' : String(row.generation)))))),
      h('div', { className: 'lm-ownerResultDetail' },
        rows.length === 0 ? h('p', { className: 'lm-muted' }, '待评审执行的执行 ID 与结果指纹会显示在这里。') : null,
        rows.length > 0 && !activeRow ? h('p', { className: 'lm-muted' }, '选择左侧执行查看确切结果与指纹。') : null,
        meta)));
}
    /* @ux-shell:owner-result-component:end */
    function BoardPane(props) {return h(RoomTaskBoard,{...props,h,React,modelOf:roomTaskBoardView});}

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
      throw Object.assign(new Error(result?.error?.message ?? 'request failed'), {code:result?.error?.code});
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
      const [preferenceBusy, setPreferenceBusy] = React.useState('');
      const preferencePending = React.useRef(false);
      const snapshotRequest = React.useRef(0);

      const refresh = React.useCallback(async (isActive = () => true) => {
        const request = ++snapshotRequest.current;
        try {
          const value = await panelCall('snapshot', { sessionId: HUMAN_SESSION_ID });
          if (!isActive() || request !== snapshotRequest.current) return;
          setSnapshot(value);
          const name = typeof value?.self?.selfName === 'string' ? value.self.selfName : '';
          setNickname((current) => (current === '' ? name : current));
        } catch (error) {
          if (isActive()) patchMeshNav({ notice: `${COPY.error}: ${errorText(error)}`, noticeBad: true });
        }
      }, []);

      const loadAgents = React.useCallback(async (isActive = () => true) => {
        try {
          const value = await panelCall('agents', { localOnly: true });
          if (!isActive()) return;
          setAgents({ local: Array.isArray(value?.agents) ? value.agents : [], remote: [] });
        } catch (error) {
          // Keep the last catalogue when a refresh temporarily fails.
          void error;
        }
      }, []);

      React.useEffect(() => {
        let live = true;
        let pending = false;
        const tick = async () => {
          if (!live || pending) return;
          pending = true;
          try {
            await Promise.all([refresh(() => live), loadAgents(() => live)]);
          } finally {
            pending = false;
          }
        };
        tick();
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
            sessionName: nickname.trim() || self?.selfName || self?.name || '',
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
            sessionName: nickname.trim() || self?.selfName || self?.name || '',
          });
          const room = value?.room;
          go({
            view: 'rooms',
            roomId: room !== null && typeof room === 'object' && typeof room.id === 'string' ? room.id : roomId,
            notice: value?.added === false ? COPY.alreadyMember : COPY.joined,
            noticeBad: false,
          });
          await refresh();
          return true;
        } catch (error) {
          notice(`${COPY.error}: ${errorText(error)}`, true);
          return false;
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
        pluginVersion: data?.pluginVersion,
        preferenceBusy,
        archivedRooms: data?.rooms?.archived ?? [],
        onLifecycle: async (room,status) => {
          if(preferencePending.current)return;
          preferencePending.current=true;setPreferenceBusy(room.id);
          try{await panelCall('roomLifecycle',{roomId:room.id,status,baseGeneration:room.lifecycle?.generation??0,requestId:crypto.randomUUID()});await refresh();}
          catch(error){notice(`房间操作失败：${errorText(error)}`,true);}
          finally{preferencePending.current=false;setPreferenceBusy('');}
        },
        onPreferences: async (roomId,patch) => {
          if (preferencePending.current) return;
          preferencePending.current = true;
          setPreferenceBusy(roomId);
          try { await panelCall('roomPreferences',{roomId,patch}); await refresh(); }
          catch(error) { notice(`设置保存失败：${errorText(error)}`,true); }
          finally { preferencePending.current = false; setPreferenceBusy(''); }
        },
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
      const [agentsStatus,setAgentsStatus]=React.useState('loading');
      const mounted=React.useRef(true),snapshotRequest=React.useRef(0),snapshotFlight=React.useRef(null),catalogueRequest=React.useRef(0);
      React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;snapshotRequest.current++;catalogueRequest.current++;snapshotFlight.current=null;};},[]);
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
      const [navigationNotice,setNavigationNotice]=React.useState('');
      // Refresh surfaces (network overview, task board) share one busy state;
      // refreshAll itself is single-flight, so repeated clicks never double-fire.
      const [refreshing, setRefreshing] = React.useState(false);
      const refreshPending = React.useRef(false);

      const call = React.useCallback(async (endpoint, payload) => panelCall(endpoint, payload), []);

      const refresh = React.useCallback(() => {
        if(snapshotFlight.current)return snapshotFlight.current;
        const request=++snapshotRequest.current;
        const pending=(async()=>{try {
          const value=await call('snapshot',{sessionId:HUMAN_SESSION_ID});
          if(mounted.current&&request===snapshotRequest.current)setState({status:'ready',data:value,error:'',observedAt:new Date().toISOString()});
        }catch(error){if(mounted.current&&request===snapshotRequest.current)setState(current=>({...current,status:'error',error:errorText(error)}));}
        finally{if(request===snapshotRequest.current)snapshotFlight.current=null;}})();
        snapshotFlight.current=pending;return pending;
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
        const request=++catalogueRequest.current;
        try {
          const value = await call('agents');
          if(!mounted.current||request!==catalogueRequest.current)return;
          setAgentsStatus(Array.isArray(value?.agents)?'ready':'error');
          setAgents({
            local: Array.isArray(value?.agents) ? value.agents : [],
            remote: Array.isArray(value?.remote) ? value.remote : [],
          });
        } catch (error) {
          if(!mounted.current||request!==catalogueRequest.current)return;
          setAgentsStatus('error');
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

      // Single-flight: repeated clicks during a refresh only re-enter after the
      // current round settles, and the surfaces show the busy state meanwhile.
      const refreshAll = async () => {
        if(refreshPending.current)return;
        refreshPending.current = true;
        setRefreshing(true);
        try { await Promise.all([refresh(), loadAgents()]); }
        finally { refreshPending.current = false; setRefreshing(false); }
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
          return true;
        } catch (error) {
          setSendNotice(`${COPY.error}: ${errorText(error)}`);
          return false;
        }
      };

      const markMessageRead = async (messageId,fromNodeId) => {
        if(typeof messageId!=='string'||!messageId.trim()||typeof fromNodeId!=='string'||!fromNodeId.trim())return false;
        try {
          await call('markRead', { messageId,...(fromNodeId?{fromNodeId}:{}) });
          await refresh();
          return true;
        } catch (error) {
          setSendNotice(`${COPY.error}: ${errorText(error)}`);
          return false;
        }
      };

      const joinRoom = async (roomId) => {
        setJoinBusy(roomId);
        patchMeshNav({ notice: '', noticeBad: false });
        try {
          const value = await call('roomJoin', {
            room: roomId,
            sessionId: HUMAN_SESSION_ID,
            sessionName: self?.selfName || self?.name || '',
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
      const selected = [...rooms,...(data?.rooms?.archived??[])].find((room) => room.id === selectedRoom);

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
          h(WorkbenchNavigation,{h,resolveTarget:workspaceNavigationTarget,rooms,archivedRooms:data?.rooms?.archived??[],view,roomId:selectedRoom,labels:COPY.navigationLabels,notice:navigationNotice,onExit:()=>props?.leavePanel?.(nav.lastSessionId),onToggle:()=>{setNavigationNotice(props?.toggleSidebar?.()===true?'':COPY.sidebarUnavailable);},onNavigate:target=>patchMeshNav(target)}),
          state.status==='error'&&state.data!==null ? h(WorkspaceReadState,{h,model:shellReadState(state),onRetry:refreshAll,labels:COPY.surfaceLabels}):null,
          state.data===null ? h(WorkspaceReadState,{h,model:shellReadState(state),onRetry:refreshAll,labels:COPY.surfaceLabels}) : selected !== undefined
            ? h(RoomPane, {
                key: selected.id,
                room: selected,
                attachmentLimits: state.data?.roomAttachmentLimits,
                sessionId: HUMAN_SESSION_ID,
                self,
                peers,
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
                peers,peerSource:data?.peers,
                agents,agentsStatus,snapshotStale:state.status==='error',pluginVersion:data?.pluginVersion,
                onOpenAgents:()=>patchMeshNav({view:'agents',roomId:''}),call,
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
                onMarkMessageRead: markMessageRead,
                onRefresh: refreshAll,
                refreshing,
                onImport: bringInAgent,
                onDial: dialAgent,
                onCreateAgent: createAgent,
              }),

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
          ctx.effect(()=>{const cleanup=()=>roomComposerDrafts.dispose();window.addEventListener?.('beforeunload',cleanup);return()=>{window.removeEventListener?.('beforeunload',cleanup);cleanup();};},'lanmesh: composer drafts');
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
          const toggleSidebar=()=>{try{const layout=serviceOf('layout');if(typeof layout?.toggleSidebar!=='function')return false;layout.toggleSidebar();return true;}catch(error){console.error('[dsh-lan-mesh] cannot toggle sidebar',error);return false;}};
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
                () => h(MeshPanel, { openSession, leavePanel, toggleSidebar })),
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
