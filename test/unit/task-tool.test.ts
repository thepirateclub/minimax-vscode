import { describe, expect, it } from 'vitest';
import { actionInput, createTaskTools, describeInput, type TaskOutcome } from '../../src/tools/task';
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

  it('refuses a task without a prompt', async () => {
    let called = false;
    const tools = createTaskTools({
      spawn: async () => {
        called = true;
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    const empty = await task!.execute(
      { description: 'Look', prompt: '' },
      makeContext()
    );
    const spaces = await task!.execute(
      { description: 'Look', prompt: '   ' },
      makeContext()
    );
    expect(empty.isError).toBe(true);
    expect(spaces.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('refuses a prompt that is not a text', async () => {
    let called = false;
    const tools = createTaskTools({
      spawn: async () => {
        called = true;
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 42 },
      makeContext()
    );
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('trims the role and falls back to explore when it is empty', async () => {
    const seen: string[] = [];
    const tools = createTaskTools({
      spawn: async (request) => {
        seen.push(request.role);
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    await task!.execute(
      { description: 'Look', prompt: 'Look around', role: '  worker  ' },
      makeContext()
    );
    await task!.execute(
      { description: 'Look', prompt: 'Look around', role: '   ' },
      makeContext()
    );
    expect(seen).toEqual(['worker', 'explore']);
  });

  it('passes the error of the child through', async () => {
    const tools = createTaskTools({
      spawn: async () => ({ content: 'the child failed', isError: true })
    });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toBe('the child failed');
  });

  it('carries no flag of an error when the child worked', async () => {
    const tools = createTaskTools({ spawn: async () => ({ content: 'done' }) });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext()
    );
    expect(result.isError).toBeUndefined();
  });

  it('names the target of the action and not its payload', () => {
    // The journal of a write names the file, the content of the file is not
    // a line of the journal.
    expect(
      describeInput({ path: 'note.txt', content: 'written by the agent' })
    ).toBe('note.txt');
    // The first field that is not a payload names the target.
    expect(describeInput({ command: 'npm test' })).toBe('npm test');
    // A tool without a target has no description.
    expect(describeInput({ content: 'written by the agent' })).toBe('');
    expect(describeInput({})).toBe('');
    // A long name is cut.
    expect(describeInput({ path: 'a'.repeat(80) })).toBe('a'.repeat(60) + '…');
  });
});

describe('actionInput', () => {
  it('keeps the fields that name the action and drops the payload', () => {
    expect(
      actionInput({ path: 'a.ts', content: 'body', old_string: 'x', new_string: 'y', start_line: 3, replace_all: true })
    ).toEqual({ path: 'a.ts', start_line: 3, replace_all: true });
  });

  it('keeps the lists of strings and cuts a long value', () => {
    const input = actionInput({ patterns: ['a', 'b', 1], command: 'x'.repeat(500), nested: { a: 1 } });
    expect(input['patterns']).toEqual(['a', 'b']);
    expect(String(input['command']).length).toBe(200);
    expect(input['nested']).toBeUndefined();
  });
});
