import type { TodoItem, TodoPriority, TodoStatus } from '../../agent/state';

const STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed'];
const PRIORITIES: TodoPriority[] = ['high', 'medium', 'low'];

// The card of todo_write reads the list from the arguments of the call: the
// model may send anything, a broken item is skipped, not drawn as garbage.
export function todoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: TodoItem[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const content = typeof record['content'] === 'string' ? record['content'].trim() : '';
    if (content.length === 0) {
      continue;
    }
    const status = STATUSES.find((item) => item === record['status']) ?? 'pending';
    const priority = PRIORITIES.find((item) => item === record['priority']) ?? 'medium';
    items.push({ content, status, priority });
  }
  return items;
}
