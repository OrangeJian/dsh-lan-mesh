import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { applyTeamCommand, teamId, teamMember, canonicalTeamJson } from './team-state.mjs';

function fail(code) { throw Object.assign(new Error(code), { code }); }
function nodeOf(key) { return key.split('/')[0]; }
const active = new Set(['received', 'starting', 'running', 'uncertain']);

/** Reliable explicit dispatch; no automatic retry of an uncertain execution. */
export class TeamCoordinator {
  constructor({ nodeId, store, send, wake, authorize, getRoom, prepareContext, recordContextDelivery, leaseMs = 90000, heartbeatMs = 20000, clock = { wallNow: Date.now, monotonicNow: () => performance.now() } }) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 250 || heartbeatMs >= leaseMs / 2) fail('BAD_CONFIG');
    Object.assign(this, { nodeId, store, send, wake, authorize, getRoom, prepareContext, recordContextDelivery, clock, leaseMs, heartbeatMs });
    this.permissions = new Map();
    this.closed = false;
    this.ticking = null;
  }

  async command(command) {
    return this.store.transact(state => applyTeamCommand(state, command, { now: this.clock.wallNow() }));
  }

  async allowed(body, operation) {
    if (!await this.authorize({ body, operation })) fail('FORBIDDEN');
    const room = this.getRoom(body.roomId);
    const leaderKey = body.leaderKey ?? this.store.read().teams[body.roomId]?.leaderKey;
    if (!room || room.deleted || room.leader?.key !== leaderKey) fail('ROOM_CHANGED');
    if (body.workerKey && !room.members?.some(m => m.key === body.workerKey)) fail('ROOM_CHANGED');
    return true;
  }

  async create({ roomId, actorKey, contextSelection }) {
    await this.allowed({ roomId, actorKey, leaderKey: actorKey }, 'create');
    validateSelection(contextSelection);
    return this.command({ type: 'create-team', roomId, actorKey, leaderKey: actorKey, contextSelection });
  }

  async dispatch(input) {
    const team = this.store.read().teams[input.roomId];
    if (!team || input.actorKey !== team.leaderKey) fail('FORBIDDEN');
    await this.allowed({ ...input, leaderKey: team.leaderKey }, 'dispatch');
    if (nodeOf(input.workerKey) === this.nodeId) fail('REMOTE_WORKER_REQUIRED');
    validateSelection(input.contextSelection);
    const taskId = input.taskId ?? this.store.read().executions[input.executionId]?.taskId ?? randomUUID();
    const executionId = input.executionId ?? randomUUID();
    const existing=this.store.read().executions[executionId]?.descriptor;
    if(existing){
      if(existing.roomId!==input.roomId||existing.taskId!==taskId||existing.workerKey!==input.workerKey||existing.title!==input.title||existing.detail!==(input.detail??''))fail('CONFLICT');
      await this.tick();
      return structuredClone(existing);
    }
    let contextPacket;
    const selection=input.contextSelection??team.contextSelection;
    if(selection){
      if(!this.prepareContext)fail('CONTEXT_UNAVAILABLE');
      contextPacket=structuredClone(await this.prepareContext({...input,contextSelection:selection,taskId,executionId}));
      validatePacket(contextPacket,input.roomId);
    }
    const descriptor = await this.store.transact(state => {
      const c = { ...input, taskId, executionId, generation: team.generation };
      let result = applyTeamCommand(state, { ...c, type: 'create-task' }, { now: this.clock.wallNow() });
      result = applyTeamCommand(result.state, { ...c, type: 'queue', leaseMs: this.leaseMs }, { now: this.clock.wallNow() });
      const body = { roomId: input.roomId, actorKey: team.leaderKey, leaderKey: team.leaderKey, generation: team.generation, workerKey: input.workerKey, taskId, executionId, title: input.title, detail: input.detail ?? '', ...(contextPacket ? {contextPacket} : {}) };
      result.state.executions[executionId].descriptor=structuredClone(body);
      result.state.outbox[executionId] = { target: nodeOf(input.workerKey), operation: 'dispatch', body };
      return { state: result.state, value: body };
    });
    await this.tick();
    return descriptor;
  }

  async handle(request) {
    if (this.closed) fail('CLOSED');
    const { operation, body: b } = request;
    await this.allowed(b, operation);
    if (operation === 'dispatch') {
      teamId(b.executionId); teamId(b.taskId); teamMember(b.workerKey);
      if(b.contextPacket!==undefined)validatePacket(b.contextPacket,b.roomId);
      if (b.actorKey !== b.leaderKey || nodeOf(b.workerKey) !== this.nodeId || b.generation !== 1 || !b.executionId || !b.taskId || typeof b.title !== 'string' || b.title.length > 200 || typeof b.detail !== 'string' || b.detail.length > 4000) fail('BAD_REQUEST');
      return this.store.transact(state => {
        state.workerExecutions ??= {};
        const old = state.workerExecutions[b.executionId];
        if (old) {
          if (old.tombstone && old.descriptor.leaderKey === b.leaderKey && old.descriptor.taskId === b.taskId && old.descriptor.workerKey === b.workerKey && old.descriptor.roomId === b.roomId && old.descriptor.generation === b.generation) return { state, value: { acknowledged: true, state: 'cancelled' } };
          if (canonicalTeamJson(old.descriptor) !== canonicalTeamJson(b)) fail('CONFLICT');
          return { state, value: { acknowledged: true, state: old.state } };
        }
        if (Object.values(state.workerExecutions).some(e => e.descriptor.workerKey === b.workerKey && active.has(e.state))) fail('CAPACITY');
        state.workerExecutions[b.executionId] = { descriptor: structuredClone(b), state: 'received', seq: 1, started: false, result: null };
        return { state, value: { acknowledged: true, state: 'received' } };
      });
    }
    if (operation === 'cancel' || operation === 'reconcile') {
      return this.store.transact(state => {
        let e = state.workerExecutions?.[b.executionId];
        if (!e && operation === 'reconcile' && b.stopped === true && typeof b.reason === 'string' && b.reason.trim() && b.actorKey === b.leaderKey) {
          e = { descriptor: { roomId: b.roomId, taskId: b.taskId, executionId: b.executionId, generation: b.generation, leaderKey: b.leaderKey, workerKey: b.workerKey, actorKey: b.actorKey, title: '', detail: '' }, state: 'cancelled', seq: 1, started: false, result: null, tombstone: true };
          state.workerExecutions[b.executionId] = e;
        }
        if (!e || b.actorKey !== e.descriptor.leaderKey || b.roomId !== e.descriptor.roomId || b.generation !== e.descriptor.generation) fail('FORBIDDEN');
        if (['succeeded', 'failed', 'cancelled'].includes(e.state)) return { state, value: { state: e.state, result: e.result } };
        if (operation === 'reconcile') {
          if (b.stopped !== true || typeof b.reason !== 'string' || !b.reason.trim()) fail('INVALID_TRANSITION');
          e.state = 'cancelled';
          e.reconciliation = b.reason.slice(0, 4000);
          return { state, value: { state: 'cancelled' } };
        }
        // Host APIs cannot prove interruption of external effects.
        e.state = 'uncertain';
        return { state, value: { state: 'uncertain' } };
      });
    }
    if (operation === 'status-query') {
      const e = this.store.read().workerExecutions?.[b.executionId];
      if (!e || b.actorKey !== e.descriptor.leaderKey || b.roomId !== e.descriptor.roomId || b.generation !== e.descriptor.generation || b.workerKey !== e.descriptor.workerKey) fail('FORBIDDEN');
      return { state: e.state, acknowledged: true, result: e.result };
    }
    const current = this.store.read();
    const e = current.executions[b.executionId];
    const team = e && current.teams[e.roomId];
    if (!e || !team || b.actorKey !== e.workerKey || b.workerKey !== e.workerKey || b.leaderKey !== team.leaderKey || b.generation !== e.generation || b.roomId !== e.roomId || b.taskId !== e.taskId) fail('FORBIDDEN');
    if (team.paused) fail('PAUSED');
    if (operation === 'start' || operation === 'heartbeat') {
      return this.store.transact(state => {
        let execution = state.executions[b.executionId];
        if (['queued', 'acknowledged'].includes(execution.state) && execution.admissionExpiresAt <= this.clock.wallNow()) fail('LEASE_EXPIRED');
        if (execution.state === 'queued') {
          state = applyTeamCommand(state, { ...b, type: 'ack', seq: 1 }).state;
          execution = state.executions[b.executionId];
        }
        if (execution.state === 'acknowledged') {
          state = applyTeamCommand(state, { ...b, actorKey: team.leaderKey, type: 'start', leaseMs: this.leaseMs }, { now: this.clock.wallNow() }).state;
          execution = state.executions[b.executionId];
        } else if (execution.state !== 'running' || execution.leaseExpiresAt <= this.clock.wallNow()) fail('LEASE_EXPIRED');
        else if (operation === 'heartbeat') execution.leaseExpiresAt = this.clock.wallNow() + this.leaseMs;
        return { state, value: { leaseMs: Math.max(0, execution.leaseExpiresAt - this.clock.wallNow()) } };
      });
    }
    if (['progress', 'result'].includes(operation)) {
      const value = await this.store.transact(state => {
        const execution = state.executions[b.executionId];
        if (execution.state === 'running' && execution.leaseExpiresAt <= this.clock.wallNow()) state = applyTeamCommand(state, { ...b, type: 'expire', actorKey: team.leaderKey }, { now: this.clock.wallNow() }).state;
        return applyTeamCommand(state, { ...b, type: operation }, { now: this.clock.wallNow() });
      });
      return { eventAck: b.seq, state: value.state };
    }
    fail('UNSUPPORTED');
  }

  async report({ executionId, actorKey, result, note }) {
    return this.store.transact(state => {
      const e = state.workerExecutions?.[executionId];
      if (!e || e.descriptor.workerKey !== actorKey) fail('FORBIDDEN');
      if (!['running', 'uncertain'].includes(e.state)) fail('INVALID_TRANSITION');
      if (result && (!['succeeded', 'failed'].includes(result.status) || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 4000)) fail('BAD_REQUEST');
      const operation = result ? 'result' : 'progress';
      if (result) {
        e.result = structuredClone(result);
        if (e.state !== 'uncertain') e.state = result.status;
      }
      e.seq++;
      const body = { ...e.descriptor, actorKey, seq: e.seq, ...(result ? { result } : { note }) };
      // Leave room for the protocol wrapper inside the 256 KiB HTTP limit.
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 255 * 1024) fail('BAD_REQUEST');
      state.outbox[`${executionId}:${e.seq}`] = { target: nodeOf(e.descriptor.leaderKey), operation, body };
      return { state, value: { executionId, seq: e.seq } };
    });
  }

  async recover() {
    this.permissions.clear();
    await this.store.transact(state => {
      for (const e of Object.values(state.workerExecutions ?? {})) if (['starting', 'running'].includes(e.state)) e.state = 'uncertain';
      return { state };
    });
  }

  tick() {
    if (this.closed) return Promise.resolve();
    if (this.ticking) return this.ticking;
    this.ticking = this.#tick().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  async #tick() {
    // State changes fail closed on storage errors. Only network failures are retried.
    for (const team of Object.values(this.store.read().teams)) {
      if (team.paused) continue;
      try { await this.allowed({ roomId: team.roomId, actorKey: team.leaderKey, leaderKey: team.leaderKey }, 'create'); }
      catch { await this.command({ type: 'pause', roomId: team.roomId, actorKey: team.leaderKey, generation: team.generation }); }
    }
    for (const e of Object.values(this.store.read().executions)) {
      const team = this.store.read().teams[e.roomId];
      try { await this.allowed({ ...e, actorKey: team.leaderKey, leaderKey: team.leaderKey }, 'dispatch'); }
      catch { await this.command({ type: 'pause', roomId: e.roomId, actorKey: team.leaderKey, generation: team.generation }); }
      if (['queued', 'acknowledged', 'running'].includes(e.state) && (e.state === 'running' ? e.leaseExpiresAt : e.admissionExpiresAt) <= this.clock.wallNow()) {
        await this.store.transact(state => {
          const result = applyTeamCommand(state, { ...e, type: 'expire', actorKey: team.leaderKey }, { now: this.clock.wallNow() });
          delete result.state.outbox[e.executionId];
          return result;
        });
      }
    }
    for (const [key, item] of Object.entries(this.store.read().outbox)) {
      if (item.operation === 'dispatch' && this.store.read().teams[item.body.roomId]?.paused) continue;
      try { await this.allowed(item.body, item.operation); } catch { continue; }
      let answer;
      if (item.operation === 'dispatch' && item.attempted) {
        try { answer = await this.send(item.target, { operation: 'status-query', body: item.body }); }
        catch { /* An absent record is safe to retransmit with the same executionId. */ }
      }
      await this.store.transact(state => { if (state.outbox[key]) state.outbox[key].attempted = true; return { state }; });
      try { answer ??= await this.send(item.target, { operation: item.operation, body: item.body }); }
      catch (error) {
        await this.store.transact(state => { if (state.outbox[key]) state.outbox[key].lastError = error.code ?? 'NETWORK_ERROR'; return { state }; });
        continue;
      }
      await this.store.transact(state => {
        if (item.operation === 'dispatch') {
          const e = state.executions[item.body.executionId];
          if (!answer.acknowledged) fail('BAD_RESPONSE');
          if (e.state === 'queued') state = applyTeamCommand(state, { ...item.body, type: 'ack', actorKey: item.body.workerKey, seq: 1 }).state;
        } else if (item.operation === 'reconcile') {
          if (!['cancelled', 'succeeded', 'failed'].includes(answer.state)) fail('BAD_RESPONSE');
          state.executions[item.body.executionId].workerReconciledState = answer.state;
        } else if (answer.eventAck !== item.body.seq) fail('BAD_RESPONSE');
        delete state.outbox[key];
        return { state };
      });
    }
    for (const [id, entry] of Object.entries(this.store.read().workerExecutions ?? {})) {
      if (!['received', 'running'].includes(entry.state)) continue;
      try { await this.allowed(entry.descriptor, 'dispatch'); }
      catch { await this.#uncertain(id); continue; }
      const permission = this.permissions.get(id);
      if (entry.state === 'running' && (!permission || permission.deadline <= this.clock.monotonicNow())) { await this.#uncertain(id); continue; }
      if (entry.state === 'running' && permission.nextHeartbeat > this.clock.monotonicNow()) continue;
      const begin = this.clock.monotonicNow();
      let grant;
      try { grant = await this.send(nodeOf(entry.descriptor.leaderKey), { operation: entry.state === 'received' ? 'start' : 'heartbeat', body: { ...entry.descriptor, actorKey: entry.descriptor.workerKey } }); }
      catch (error) {
        if (['LEASE_EXPIRED', 'FORBIDDEN', 'PAUSED', 'ROOM_CHANGED'].includes(error.code)) await this.#uncertain(id);
        continue;
      }
      const deadline = begin + grant.leaseMs;
      if (!Number.isFinite(deadline) || deadline <= this.clock.monotonicNow()) { await this.#uncertain(id); continue; }
      this.permissions.set(id, { deadline, nextHeartbeat: begin + this.heartbeatMs });
      if (entry.state === 'received') {
        await this.store.transact(state => {
          const e = state.workerExecutions[id];
          if (e.state !== 'received' || e.started) fail('INVALID_TRANSITION');
          e.state = 'starting';
          e.started = true;
          return { state };
        });
        let ok;
        const canStart = async () => {
          try { await this.allowed(entry.descriptor, 'dispatch'); } catch { return false; }
          return !this.closed && this.store.read().workerExecutions[id]?.state === 'starting' && this.permissions.get(id)?.deadline > this.clock.monotonicNow();
        };
        try {
          if(entry.descriptor.contextPacket){
            if(!this.recordContextDelivery)fail('CONTEXT_AUDIT_UNAVAILABLE');
            await this.recordContextDelivery({executionId:id,sessionId:entry.descriptor.workerKey.split('/').slice(1).join('/'),packet:structuredClone(entry.descriptor.contextPacket),status:'prepared'});
          }
          ok = await canStart() && await this.wake({ executionId: id, sessionId: entry.descriptor.workerKey.split('/').slice(1).join('/'), task: entry.descriptor, canStart }); }
        catch { ok = false; }
        await this.store.transact(state => {
          if (state.workerExecutions[id].state === 'starting') state.workerExecutions[id].state = ok ? 'running' : 'uncertain';
          return { state };
        });
      }
    }
  }

  async #uncertain(id) {
    await this.store.transact(state => { if (active.has(state.workerExecutions[id].state)) state.workerExecutions[id].state = 'uncertain'; return { state }; });
    this.permissions.delete(id);
  }

  async close() {
    this.closed = true;
    await this.ticking;
    await this.store.flush();
  }
}

function validateSelection(selection){
 if(selection===undefined)return;
 if(!selection||typeof selection!=='object'||Array.isArray(selection))fail('BAD_REQUEST');
 for(const [key,value] of Object.entries(selection)){
  if(key==='selectedDocumentVersions'){
   if(!Array.isArray(value)||value.length>8||value.some(x=>!x||!/^doc-[a-z0-9]{12}$/.test(x.documentId)||!/^rev-[a-z0-9]{12}$/.test(x.revisionId)||!/^[a-f0-9]{64}$/.test(x.contentHash)))fail('BAD_REQUEST');
  }else if(!['documentIds','messageIds','attachmentIds','skillNames'].includes(key)||!Array.isArray(value)||value.length>100||value.some(x=>typeof x!=='string'||!x||x.length>200))fail('BAD_REQUEST');
 }
}
function validatePacket(packet,roomId){
 if(!packet||packet.roomId!==roomId||Buffer.byteLength(JSON.stringify(packet))>65536)fail('BAD_REQUEST');
 for(const key of ['selectedDocumentVersions','confirmedDecisions','openQuestions','referencedMessages','attachmentRefs','skillRefs'])if(!Array.isArray(packet[key]))fail('BAD_REQUEST');
 if(packet.selectedDocumentVersions.length>8||packet.referencedMessages.length>20)fail('BAD_REQUEST');
 for(const doc of packet.selectedDocumentVersions)if(!doc||!['documentId','revisionId','contentHash','content'].every(k=>typeof doc[k]==='string')||doc.roomId&&doc.roomId!==roomId)fail('BAD_REQUEST');
}
