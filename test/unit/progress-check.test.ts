import { describe, expect, it } from 'vitest';
import { PROGRESS_EVERY, TODO_EVERY, todoCheck } from '../../src/agent/toolRunner';
import type { StreamEvent } from '../../src/api/types';
import { FakeClient, makeAgent, textResponse } from '../helpers/agentFixture';

// Many calls of the tools in one response, the way the model reads a folder.
function manyReads(from: number, count: number): StreamEvent[] {
  const blocks = Array.from({ length: count }, (_, i) => ({
    type: 'tool_use' as const,
    id: 'toolu_' + (from + i),
    name: 'read_file',
    input: { path: 'f' + (from + i) + '.ts' }
  }));
  return [
    { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 }, blocks }
  ];
}

function resultsOf(request: { messages: Array<{ content: Array<{ type: string; content?: unknown }> }> }): string[] {
  const last = request.messages[request.messages.length - 1]!;
  return last.content.filter((block) => block.type === 'tool_result').map((block) => String(block.content));
}

// A turn of hundreds of actions told the reader nothing: the model asks for
// a short note of the progress every few dozen actions.
describe('the check of the progress', () => {
  it('asks the model for a note of the progress when the actions cross the mark', async () => {
    const client = new FakeClient([
      manyReads(0, PROGRESS_EVERY - 5),
      manyReads(100, 10),
      textResponse('done')
    ]);
    const { agent } = makeAgent(client);
    await agent.run('read all', []);
    const first = resultsOf(client.requests[1]!);
    expect(first.some((text) => text.includes('Progress check'))).toBe(false);
    const second = resultsOf(client.requests[2]!);
    // The note rides on the last result: a text block next to the results
    // breaks the protocol of MiniMax (2013).
    expect(second[second.length - 1]).toContain('Progress check: ' + (PROGRESS_EVERY + 5) + ' actions');
    expect(second.slice(0, -1).every((text) => !text.includes('Progress check'))).toBe(true);
  });
});

// The model forgot the list: a done step stood open and no step was current.
describe('the reminder of the list of tasks', () => {
  const todos = [
    { content: 'Read the parser', status: 'completed' as const, priority: 'high' as const },
    { content: 'Fix the parser', status: 'in_progress' as const, priority: 'high' as const },
    { content: 'Run the tests', status: 'pending' as const, priority: 'medium' as const }
  ];

  it('waits for TODO_EVERY actions without todo_write', () => {
    expect(todoCheck(todos, TODO_EVERY - 1)).toBeUndefined();
    expect(todoCheck(todos, TODO_EVERY)).toContain('the current task is "Fix the parser"');
  });

  it('asks for a current task when none is in progress', () => {
    const idle = todos.map((item) => (item.status === 'in_progress' ? { ...item, status: 'pending' as const } : item));
    expect(todoCheck(idle, TODO_EVERY)).toContain('no task is in_progress');
    expect(todoCheck(idle, TODO_EVERY)).toContain('"Fix the parser"');
  });

  it('is silent when the list is done or empty', () => {
    expect(todoCheck([], TODO_EVERY)).toBeUndefined();
    expect(todoCheck([{ ...todos[0]! }], TODO_EVERY)).toBeUndefined();
  });
});
