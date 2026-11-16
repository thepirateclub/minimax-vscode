// The state of the session that the model changes through the tools. The
// host owns it, a tool only sends a snapshot of it.

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

// The priority of a task. The very high one is the double arrow of jira.
export type TodoPriority = 'very_high' | 'high' | 'medium' | 'low';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export type GoalStatus = 'active' | 'complete' | 'blocked';

// The status that the model can set. The goal starts as active, the model
// only closes it.
export type GoalOutcome = Exclude<GoalStatus, 'active'>;

export interface GoalState {
  objective: string;
  // The limits of the budget. Undefined means no limit.
  tokenBudget?: number;
  requestLimit?: number;
  secondsLimit?: number;
  status: GoalStatus;
  used: { tokens: number; requests: number; seconds: number };
}

// The state of the session that the tools read. The host owns it, a tool
// never writes into it.
export interface SessionState {
  readonly todos: TodoItem[];
  readonly goal?: GoalState;
}

// The change of the state of the session, the host applies it.
export type ToolStateUpdate =
  | { kind: 'todos'; todos: TodoItem[] }
  | { kind: 'goal'; status: GoalOutcome; note?: string };
