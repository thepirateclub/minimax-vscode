// The state of the session that the model changes through the tools. The
// host owns it, a tool only sends a snapshot of it.

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

// The change of the state of the session, the host applies it.
export type ToolStateUpdate = {
  kind: 'todos';
  todos: TodoItem[];
};
