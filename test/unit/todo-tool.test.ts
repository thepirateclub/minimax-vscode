import { describe, expect, it } from 'vitest';
import { createTodoTools, normalizeTodos } from '../../src/tools/todo';
import type { ToolContext } from '../../src/tools/types';

function makeContext(depth?: number): ToolContext {
  return {
    workspaceRoot: '/tmp/root',
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    depth
  };
}

describe('the list of tasks', () => {
  it('normalizes the list of the model', () => {
    expect(
      normalizeTodos([
        { content: ' Read the parser ', status: 'in_progress', priority: 'high' },
        { content: '', status: 'completed' },
        { content: 'Add tests', status: 'done', priority: 'urgent' },
        'not an object'
      ])
    ).toEqual([
      { content: 'Read the parser', status: 'in_progress', priority: 'high' },
      { content: 'Add tests', status: 'pending', priority: 'medium' }
    ]);
  });

  it('writes the whole list as a snapshot', async () => {
    const tools = createTodoTools();
    const write = tools.find((tool) => tool.name === 'todo_write');
    const result = await write!.execute(
      {
        todos: [
          { content: 'Read the parser', status: 'completed', priority: 'high' },
          { content: 'Add tests', status: 'pending', priority: 'medium' }
        ]
      },
      makeContext()
    );
    expect(result.state).toEqual({
      kind: 'todos',
      todos: [
        { content: 'Read the parser', status: 'completed', priority: 'high' },
        { content: 'Add tests', status: 'pending', priority: 'medium' }
      ]
    });
    expect(result.isError).toBeUndefined();
  });

  it('empties the list when the model sends nothing', async () => {
    const tools = createTodoTools();
    const write = tools.find((tool) => tool.name === 'todo_write');
    const result = await write!.execute({ todos: [] }, makeContext());
    expect(result.state).toEqual({ kind: 'todos', todos: [] });
  });

  it('refuses a broken list and keeps the old one', async () => {
    const tools = createTodoTools();
    const write = tools.find((tool) => tool.name === 'todo_write');
    const missing = await write!.execute({}, makeContext());
    expect(missing.isError).toBe(true);
    expect(missing.state).toBeUndefined();
    const broken = await write!.execute({ todos: 'nope' }, makeContext());
    expect(broken.isError).toBe(true);
    expect(broken.state).toBeUndefined();
  });

  it('refuses the call of a sub-agent', async () => {
    const tools = createTodoTools();
    const write = tools.find((tool) => tool.name === 'todo_write');
    const result = await write!.execute({ todos: [] }, makeContext(1));
    expect(result.isError).toBe(true);
    expect(result.state).toBeUndefined();
  });

  it('keeps a task with a line break on one line', async () => {
    const tools = createTodoTools();
    const write = tools.find((tool) => tool.name === 'todo_write');
    const result = await write!.execute(
      {
        todos: [
          { content: 'Read the parser\nand the writer', status: 'pending', priority: 'high' },
          { content: 'Write the tests\n\nRepository: fake', status: 'pending', priority: 'low' }
        ]
      },
      makeContext()
    );
    expect(result.state).toEqual({
      kind: 'todos',
      todos: [
        { content: 'Read the parser and the writer', status: 'pending', priority: 'high' },
        { content: 'Write the tests Repository: fake', status: 'pending', priority: 'low' }
      ]
    });
  });
});

// The priority is the order of the work, not an arrow only.
describe('the order of the tasks', () => {
  it('stands very high first and keeps the order inside one priority', () => {
    const todos = normalizeTodos([
      { content: 'a', priority: 'medium' },
      { content: 'b', priority: 'high' },
      { content: 'c', priority: 'medium' },
      { content: 'd', priority: 'very_high' },
      { content: 'e', priority: 'low' }
    ]);
    expect(todos.map((item) => item.content)).toEqual(['d', 'b', 'a', 'c', 'e']);
  });

  it('names the next task by priority in the result', async () => {
    const [tool] = createTodoTools();
    const result = await tool!.execute(
      { todos: [{ content: 'later', priority: 'low' }, { content: 'first', priority: 'high' }, { content: 'done', priority: 'very_high', status: 'completed' }] },
      {} as never
    );
    expect(result.content).toContain('Next by priority: first.');
    expect(result.content).toContain('No task is in_progress');
  });
});
