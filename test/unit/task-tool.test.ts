import { describe, expect, it } from 'vitest';
import { createTaskTools, type TaskOutcome } from '../../src/tools/task';
import type { ToolContext } from '../../src/tools/types';

function makeContext(over: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: '/tmp/root',
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    ...over
  };
}

describe('the tool of a sub-agent', () => {
  it('asks the host to start a child and returns its answer', async () => {
    const seen: string[] = [];
    const tools = createTaskTools({
      spawn: async (request) => {
        seen.push(request.role);
        return { content: 'The parser reads the file in src/app.ts.' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Find the parser', prompt: 'Where is the parser?', role: 'explore' },
      makeContext()
    );
    expect(seen).toEqual(['explore']);
    expect(result.content).toContain('src/app.ts');
    expect(result.isError).toBeUndefined();
  });

  it('takes the role explore when the model names none', async () => {
    let role = '';
    const tools = createTaskTools({
      spawn: async (request) => {
        role = request.role;
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    await task!.execute({ description: 'Look', prompt: 'Look around' }, makeContext());
    expect(role).toBe('explore');
  });

  it('refuses an unknown role', async () => {
    const tools = createTaskTools({ spawn: async () => ({ content: 'done' }) });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around', role: 'chief' },
      makeContext()
    );
    expect(result.isError).toBe(true);
  });

  it('refuses the call of a sub-agent', async () => {
    let called = false;
    const tools = createTaskTools({
      spawn: async () => {
        called = true;
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext({ depth: 1 })
    );
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('writes the journal of the child into the progress of the call', async () => {
    const lines: string[] = [];
    const tools = createTaskTools({
      spawn: async (_request, _ctx, progress) => {
        progress('read_file src/app.ts');
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext({ progress: (line) => lines.push(line) })
    );
    expect(lines).toEqual(['read_file src/app.ts']);
  });

  it('gives the spend of the child back', async () => {
    const outcome: TaskOutcome = {
      content: 'done',
      usage: { inputTokens: 100, outputTokens: 20 }
    };
    const tools = createTaskTools({ spawn: async () => outcome });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext()
    );
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });
});
