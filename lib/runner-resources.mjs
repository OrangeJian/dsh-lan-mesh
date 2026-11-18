import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { prepareRunnerWorkspace } from './runner-workspace.mjs';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Local resource metadata on the existing Worker ledger. No task transitions. */
export async function prepareExecutionWorkspace({store, executionId, generation, binding, baseCommit, resourcesRoot, authorize}) {
  if (typeof authorize !== 'function' || !await authorize()) fail('FORBIDDEN');
  if (typeof binding?.repoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(binding.repoId) ||
      typeof baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) fail('BAD_REQUEST');
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) fail('WORKSPACE_UNAVAILABLE');
  const root = await realpath(resourcesRoot);
  const key = createHash('sha256').update(JSON.stringify([executionId,generation])).digest('hex').slice(0,32);
  const record = { generation, repoId: binding.repoId, baseCommit, key, phase: 'reserved' };
  await store.transact(async state => {
    const execution = Object.hasOwn(state.workerExecutions,executionId) ? state.workerExecutions[executionId] : undefined;
    if (!execution || execution.descriptor.generation !== generation) fail('STALE_EXECUTION');
    if (execution.workspaceResource) fail('WORKSPACE_ALREADY_RESERVED');
    if (execution.state !== 'received' || execution.started) fail('INVALID_TRANSITION');
    if (!await authorize()) fail('FORBIDDEN');
    execution.workspaceResource = record;
    return {state};
  });

  // Persist the reservation first. A failure leaves the path discoverable for reconciliation.
  const resourceRoot = join(root,key);
  if (!await authorize()) fail('FORBIDDEN');
  await mkdir(resourceRoot);
  const result = await prepareRunnerWorkspace({binding,repoId:record.repoId,baseCommit,resourceRoot});
  await store.transact(async state => {
    const execution = state.workerExecutions[executionId];
    if (execution?.descriptor.generation !== generation ||
        execution?.workspaceResource?.key !== key ||
        execution?.workspaceResource?.phase !== 'reserved' ||
        execution.state !== 'received' || execution.started) fail('STALE_EXECUTION');
    if (!await authorize()) fail('FORBIDDEN');
    execution.workspaceResource.phase = 'prepared';
    return {state};
  });
  return result;
}
