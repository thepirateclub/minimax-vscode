import { describe, expect, it } from 'vitest';
import { Agent, MAX_PARALLEL_TASKS } from '../../src/agent/agent';
import type { StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate } from '../../src/ui/approvals';
import { FakeClient, textResponse } from '../helpers/agentFixture';

// One answer of the model with several calls.
function calls(names: string[]): StreamEvent[] {
  const blocks = names.map((name, index) => ({ type: 'tool_use' as const, id: 't' + index, name, input: { n: index } }));
  return [{ type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 }, blocks }];
}

describe('the sub-agents of one answer', () => {
  it('run at the same time, in groups of the limit, and keep the order of the results', async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const registry = new ToolRegistry();
    const slow = (name: string, sideEffect: boolean) =>
      registry.register({
        name,
        description: name,
        approval: 'never',
        sideEffect,
        inputSchema: { type: 'object', properties: {} },
        execute: async (input) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 30 + (3 - Number(input['n'])) * 10));
          running -= 1;
          order.push(name + input['n']);
          return { content: name + ' ' + String(input['n']), usage: { inputTokens: 100, outputTokens: 0 } };
        }
      });
    slow('task', true);
    slow('read_file', false);
    const client = new FakeClient([calls(['task', 'task', 'task', 'task', 'read_file']), textResponse('done')]);
    const agent = new Agent({
      client,
      registry,
      approval: new ApprovalGate({ autoApprove: [], request: async () => ({ approved: true, allowForSession: false }) }),
      model: 'MiniMax-M3',
      maxTokens: 1000,
      maxIterations: 3,
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      logger: { info: () => undefined, error: () => undefined },
      onEvent: () => undefined
    });
    const result = await agent.run('go', []);
    expect(peak).toBe(MAX_PARALLEL_TASKS);
    // The fourth task waits for the first group, the read waits for it.
    expect(order.slice(3)).toEqual(['task3', 'read_file4']);
    const sent = client.requests[1]!.messages.at(-1)!.content;
    expect(sent.map((block) => (block.type === 'tool_result' ? block.content : ''))).toEqual([
      'task 0', 'task 1', 'task 2', 'task 3', 'read_file 4'
    ]);
    expect(result.usage.inputTokens).toBeGreaterThanOrEqual(500);
  });
});
