import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyTeamState, teamId, teamMember } from './team-state.mjs';

function validate(state) {
  if (state?.version !== 1) throw new Error('Unsupported Team storage version');
  for (const name of ['teams', 'tasks', 'executions', 'workerExecutions', 'outbox', 'nonces']) {
    if (!state[name] || typeof state[name] !== 'object' || Array.isArray(state[name])) throw new Error(`Invalid Team ${name}`);
  }
  const check = (condition) => { if (!condition) throw new Error('Invalid Team storage record'); };
  const positive = value => Number.isSafeInteger(value) && value >= 1;
  const descriptor = value => {
    check(value && typeof value === 'object');
    for (const key of ['roomId', 'taskId', 'executionId']) teamId(value[key]);
    for (const key of ['leaderKey', 'workerKey', 'actorKey']) teamMember(value[key]);
    check(positive(value.generation));
  };
  for (const [key, value] of Object.entries(state.teams)) {
    teamId(key); teamMember(value.leaderKey);
    check(value.roomId === key && positive(value.generation) && positive(value.revision) && typeof value.paused === 'boolean');
  }
  for (const [key, value] of Object.entries(state.tasks)) {
    teamId(key); teamMember(value.workerKey);
    check(value.taskId === key && state.teams[value.roomId] && typeof value.title === 'string' && value.title.trim() && value.title.length <= 200 && typeof value.detail === 'string' && value.detail.length <= 4000 && positive(value.revision));
    check(['planned', 'ready', 'active', 'review', 'accepted', 'blocked', 'failed', 'cancelled'].includes(value.status));
    check(Array.isArray(value.dependsOn) && value.dependsOn.length === 0);
    check(value.currentExecutionId === null || state.executions[value.currentExecutionId]?.taskId === key);
  }
  for (const [key, value] of Object.entries(state.executions)) {
    teamId(key); teamMember(value.workerKey);
    check(value.executionId === key && state.tasks[value.taskId]?.roomId === value.roomId && state.tasks[value.taskId]?.workerKey === value.workerKey && positive(value.attempt) && positive(value.generation));
    check(['queued', 'acknowledged', 'running', 'uncertain', 'succeeded', 'failed', 'cancelled'].includes(value.state));
    check(Number.isFinite(value.admissionExpiresAt) && (value.leaseExpiresAt === null || Number.isFinite(value.leaseExpiresAt)) && Number.isSafeInteger(value.lastEventSeq) && value.lastEventSeq >= 0);
    check(value.events && typeof value.events === 'object' && !Array.isArray(value.events));
    check(Object.keys(value.events).length === value.lastEventSeq);
    for (const [seq, event] of Object.entries(value.events)) {
      check(positive(Number(seq)) && Number(seq) <= value.lastEventSeq && event.seq === Number(seq) && event.executionId === key && event.eventId === `${key}:${seq}` && typeof event.fingerprint === 'string' && typeof event.createdAt === 'string');
      teamMember(event.actorKey);
    }
  }
  for (const [key, value] of Object.entries(state.workerExecutions)) {
    teamId(key); descriptor(value.descriptor);
    check(value.descriptor.executionId === key && value.descriptor.actorKey === value.descriptor.leaderKey && typeof value.started === 'boolean' && positive(value.seq));
    check(['received', 'starting', 'running', 'uncertain', 'succeeded', 'failed', 'cancelled'].includes(value.state));
    check(typeof value.descriptor.title === 'string' && value.descriptor.title.length <= 200 && typeof value.descriptor.detail === 'string' && value.descriptor.detail.length <= 4000);
    check(value.tombstone !== true || value.state === 'cancelled');
    check(!['starting', 'running', 'succeeded', 'failed'].includes(value.state) || value.started);
  }
  for (const value of Object.values(state.outbox)) {
    check(value && ['dispatch', 'progress', 'result', 'reconcile'].includes(value.operation));
    descriptor(value.body);
    check(typeof value.target === 'string' && value.target.length > 0);
    check(value.operation === 'dispatch' || value.operation === 'reconcile' ? state.executions[value.body.executionId] : state.workerExecutions[value.body.executionId]);
  }
  for (const [key, expiry] of Object.entries(state.nonces)) check(key.length <= 256 && Number.isFinite(expiry));
  return state;
}

/** One process owns a store; callers must not open concurrent writers for one directory. */
export async function openTeamStore({ directory, io = fs }) {
  await io.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'team.json');
  let current;
  try {
    current = validate(JSON.parse(await io.readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') current = emptyTeamState();
    else throw Object.assign(new Error(`Cannot load Team storage: ${error.message}`, { cause: error }), { code: 'TEAM_STORAGE' });
  }
  let pending = Promise.resolve();
  return {
    read: () => structuredClone(current),
    transact(fn) {
      const operation = pending.then(async () => {
        const result = await fn(structuredClone(current));
        validate(result.state);
        const temp = `${file}.${randomUUID()}.tmp`;
        let handle;
        try {
          handle = await io.open(temp, 'wx', 0o600);
          await handle.writeFile(`${JSON.stringify(result.state)}\n`, 'utf8');
          await handle.sync();
          await handle.close();
          handle = undefined;
          await io.rename(temp, file);
        } catch (error) {
          await handle?.close().catch(() => {});
          await io.unlink(temp).catch(() => {});
          throw error;
        }
        current = structuredClone(result.state);
        return structuredClone(result.value);
      });
      pending = operation.catch(() => {});
      return operation;
    },
    flush: () => pending,
  };
}
