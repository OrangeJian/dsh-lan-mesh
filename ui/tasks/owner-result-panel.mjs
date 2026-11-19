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
export function OwnerResultPanel(props) {
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
