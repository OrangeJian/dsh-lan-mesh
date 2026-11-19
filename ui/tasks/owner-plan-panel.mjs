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
export function OwnerPlanPanel(props) {
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
  return h('section', { className: 'lm-task lm-ownerPlanPanel', 'aria-label': 'M6 计划草稿与批准' },
    h('div', { className: 'lm-ownerPlanHead' },
      h('div', null,
        h('h3', null, '计划草稿与批准 · 本机'),
        h('p', { className: 'lm-muted' }, '服务端账本校验版本、代次与指纹。批准只绑定下面展示的确切版本。')),
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
          planPreview?.report ? h('div', { role: 'status' },
            h('p', null, '依赖顺序：', planPreview.report.dag?.order?.join(' → ') || '无可展示的顺序'),
            Array.isArray(planPreview.report.dag?.order) ? h('ul', null, ...planPreview.report.dag.order.map(id => {
              const candidate = planPreview.report.candidates?.[id];
              return h('li', { key: id }, id, ' · ', candidate?.dependencySatisfied ? '依赖已满足' : '依赖待满足', ' · ', candidate?.recommended?.join(', ') || '候选不可用');
            })) : null) : null,
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
