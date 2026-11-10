import type {
  TodoItem,
  TodoPriority,
  TodoStatus,
  ToolStateUpdate
} from '../agent/state';
import type { ToolEntry } from './types';

const STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed'];
const PRIORITIES: TodoPriority[] = ['high', 'medium', 'low'];

// The list is a snapshot: the model sends every task every time and the
// host replaces the old list. A task without a text is dropped, an unknown
// status falls back to pending and an unknown priority to medium.
export function normalizeTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const items: TodoItem[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const content =
      typeof record['content'] === 'string' ? record['content'].trim() : '';
    if (content.length === 0) {
      continue;
    }
    const status = record['status'] as TodoStatus;
    const priority = record['priority'] as TodoPriority;
    items.push({
      content,
      status: STATUSES.includes(status) ? status : 'pending',
      priority: PRIORITIES.includes(priority) ? priority : 'medium'
    });
  }
  return items;
}

export function createTodoTools(): ToolEntry[] {
  const todoWrite: ToolEntry = {
    name: 'todo_write',
    description:
      'Write the list of tasks of the session. The list is replaced by the new one, so send every task every time. Use it to show the plan and the progress to the user.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Every task of the list with its state and its priority.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'What has to be done.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'The state of the task.'
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'How urgent the task is.'
              }
            },
            required: ['content']
          }
        }
      },
      required: ['todos']
    },
    async execute(input, ctx) {
      // The list belongs to the main agent, a sub-agent has its own work.
      if ((ctx.depth ?? 0) > 0) {
        return {
          content:
            'The list of tasks belongs to the main agent. A sub-agent cannot change it.',
          isError: true
        };
      }
      // A broken payload must not wipe the list of the user: only an empty
      // array clears it.
      const raw = input['todos'];
      if (!Array.isArray(raw)) {
        return {
          content: 'todo_write failed: todos must be an array',
          isError: true
        };
      }
      const todos = normalizeTodos(raw);
      const state: ToolStateUpdate = { kind: 'todos', todos };
      const done = todos.filter((item) => item.status === 'completed').length;
      return {
        content:
          'The list of tasks has ' +
          todos.length +
          ' items, ' +
          done +
          ' of them are done.',
        state
      };
    }
  };
  return [todoWrite];
}
