import test from 'node:test';
import assert from 'node:assert/strict';
import { teamToolDefinitions } from '../lib/team-tools.mjs';

test('tools bind actor to host execution context and serialize structured output', async () => {
  let received;
  const node = { teamDispatch: async args => { received = args; return { executionId: 'e1' }; } };
  const tool = teamToolDefinitions(node).find(t => t.name === 'lan_mesh_team_dispatch');
  const result = await tool.execute({ roomId: 'r1', workerKey: 'b/worker', title: 'Build', sessionId: 'forged' }, { agent: { id: 'leader' } });
  assert.equal(received.sessionId, 'leader');
  assert.equal(JSON.parse(result.dataJson).executionId, 'e1');
  await assert.rejects(tool.execute({}, {}), { code: 'BAD_REQUEST' });
});
