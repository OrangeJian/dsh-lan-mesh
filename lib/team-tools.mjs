/** Keep the Team tool contract separate from the existing Room tools. */
import { CONTEXT_SELECTION_SCHEMA } from './room-context-protocol.mjs';
export function teamToolDefinitions(node) {
  const string = { type: 'string' };
  const contextSelection=CONTEXT_SELECTION_SCHEMA;
  const definitions = [
    ['create', '由当前 Room Leader 创建可靠执行 Team。', ['roomId'], { roomId: string, contextSelection }],
    ['dispatch', 'Leader 向已授权远端 Worker 显式派发任务。返回执行 ID，完成结果须另行查询。', ['roomId', 'workerKey', 'title'], { roomId: string, workerKey: string, title: string, detail: string, contextSelection }],
    ['status', '查看项目 Team 任务、执行和本机会话执行记录。成功提交结果处于 review，尚未验收。', ['roomId'], { roomId: string }],
    ['report', 'Worker 汇报当前执行的进度或结果。成功仅表示提交待验收结果。', ['executionId'], { executionId: string, status: { type: 'string', enum: ['succeeded', 'failed'] }, summary: string, note: string, artifacts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: { type: string, value: string } } } }],
    ['reconcile', '仅在人工确认旧执行已经停止后，由 Leader 核对 uncertain 执行。必须记录原因。不要仅因超时自动调用。', ['executionId', 'stopped', 'reason'], { executionId: string, stopped: { type: 'boolean' }, reason: string }],
  ];
  return definitions.map(([action, description, required, properties]) => ({
    name: `lan_mesh_team_${action}`,
    description,
    parameters: { type: 'object', additionalProperties: false, required, properties },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['summary', 'dataJson'], properties: { summary: string, dataJson: string } },
      render: (_args, value) => [{ type: 'text', text: `${value.summary}\n${value.dataJson}` }],
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id;
      if (typeof sessionId !== 'string' || !sessionId) throw Object.assign(new Error('Authenticated local session required'), { code: 'BAD_REQUEST' });
      const method = `team${action[0].toUpperCase()}${action.slice(1)}`;
      const value = await node[method]({ ...args, sessionId });
      return { summary: `Team ${action} 已处理；状态与结果见执行记录。`, dataJson: JSON.stringify(value) };
    },
  }));
}
