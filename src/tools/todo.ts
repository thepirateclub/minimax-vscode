import type {
  TodoItem,
  TodoPriority,
  TodoStatus,
  ToolStateUpdate
} from '../agent/state';
import type { ToolEntry } from './types';

const STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed'];
const PRIORITIES: TodoPriority[] = ['very_high', 'high', 'medium', 'low'];

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
    // A line break inside the text of a task breaks the section of the
    // prompt, the text of a task is always one line.
    const content =
      typeof record['content'] === 'string'
        ? record['content'].replace(/\s*\r?\n\s*/g, ' ').trim()
        : '';
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
  return orderByPriority(items);
}

// The priority is the order of the work: the list stands very high first,
// the order of the model stays inside one priority. Before, the priority
// only drew an arrow and the tasks went in the order they were written.
export function orderByPriority(items: TodoItem[]): TodoItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => PRIORITIES.indexOf(a.item.priority) - PRIORITIES.indexOf(b.item.priority) || a.index - b.index)
    .map(({ item }) => item);
}

// The task to take next: the first one in the order that is not done.
export function nextTodo(items: TodoItem[]): TodoItem | undefined {
  return items.find((item) => item.status === 'in_progress') ?? items.find((item) => item.status === 'pending');
}

export function createTodoTools(): ToolEntry[] {
  const todoWrite: ToolEntry = {
    name: 'todo_write',
    description:
      'Write the list of tasks of the session. The list is replaced by the new one, so send every task every time. Use it to show the plan and the progress to the user. The priority is the order of the work: the list is kept ordered by priority, very_high first, and you take the first task that is not completed. Keep exactly one task in_progress: set it in_progress when you start it, and mark it completed right after it is done, not at the end of the work.',
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
                enum: ['very_high', 'high', 'medium', 'low'],
                description: 'How urgent the task is. A higher priority is done earlier.'
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
      const next = nextTodo(todos);
      return {
        content:
          'The list of tasks has ' +
          todos.length +
          ' items, ' +
          done +
          ' of them are done.' +
          (next ? ' Next by priority: ' + next.content + '.' : '') +
          // The model left the list without a current task: the reader did
          // not see where the work stood.
          (next && next.status === 'pending' ? ' No task is in_progress: set the task you work on in_progress.' : ''),
        state
      };
    }
  };
  return [todoWrite];
}
