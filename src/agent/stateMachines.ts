import type { GoalOutcome, GoalStatus, TodoItem, TodoStatus } from './state';
import { defineMachine, moveTo, step } from '../fsm/machine';
import type { StepResult } from '../fsm/machine';

// The goal of the session. The model closes it as complete or blocked, the
// user resumes it: a new goal or new limits of the same one make it active.
// A completed goal is not blocked afterwards: the model says it is done or
// the user gives it more work.
export type GoalEvent = 'complete' | 'block' | 'resume';

export const goalMachine = defineMachine<GoalStatus, GoalEvent>('goal', 'active', [
  { from: ['active', 'blocked', 'complete'], on: 'complete', to: 'complete' },
  { from: ['active', 'blocked'], on: 'block', to: 'blocked' },
  { from: ['active', 'blocked', 'complete'], on: 'resume', to: 'active' }
]);

const OUTCOME_EVENTS: Record<GoalOutcome, GoalEvent> = { complete: 'complete', blocked: 'block' };

// The step of the goal by the status the model sets.
export function closeGoal(status: GoalStatus, outcome: GoalOutcome): StepResult<GoalStatus> {
  return step(goalMachine, status, OUTCOME_EVENTS[outcome]);
}

// The user set the goal again: it is active whatever it was.
export function resumeGoal(status: GoalStatus): GoalStatus {
  return step(goalMachine, status, 'resume').state;
}

// A task of the list: it waits, the work on it goes, it is done. A task
// set aside goes back to wait, a done task may be opened again. A task done
// straight from waiting passes the work: the move is transitive.
export type TodoEvent = 'start' | 'complete' | 'pause' | 'reopen';

export const todoMachine = defineMachine<TodoStatus, TodoEvent>('task', 'pending', [
  { from: 'pending', on: 'start', to: 'in_progress' },
  { from: 'in_progress', on: 'complete', to: 'completed' },
  { from: 'in_progress', on: 'pause', to: 'pending' },
  { from: 'completed', on: 'reopen', to: 'in_progress' }
]);

export interface TodoChange {
  content: string;
  from: TodoStatus;
  to: TodoStatus;
  events: TodoEvent[];
}

// What the new snapshot of the list did to the tasks: a task is the same by
// its text, a new task starts from waiting. Unchanged tasks are left out.
export function todoChanges(previous: readonly TodoItem[], next: readonly TodoItem[]): TodoChange[] {
  const before = new Map(previous.map((item) => [item.content, item.status]));
  const changes: TodoChange[] = [];
  for (const item of next) {
    const from = before.get(item.content) ?? todoMachine.initial;
    const move = moveTo(todoMachine, from, item.status);
    if (move.ok && move.events.length > 0) {
      changes.push({ content: item.content, from, to: item.status, events: move.events });
    }
  }
  return changes;
}

// The changes in words for the result of todo_write. A task done without
// being in work is named: the reader did not see the work on it.
export function describeTodoChanges(changes: readonly TodoChange[]): string {
  const started = changes.filter((change) => change.to === 'in_progress').map((change) => change.content);
  const done = changes.filter((change) => change.to === 'completed').map((change) => change.content);
  const skipped = changes
    .filter((change) => change.to === 'completed' && change.events.includes('start'))
    .map((change) => change.content);
  const parts: string[] = [];
  if (started.length > 0) {
    parts.push('Started: ' + started.join('; ') + '.');
  }
  if (done.length > 0) {
    parts.push('Done: ' + done.join('; ') + '.');
  }
  if (skipped.length > 0) {
    parts.push('Marked done without being in_progress first: ' + skipped.join('; ') + '. Set a task in_progress when the work on it starts.');
  }
  return parts.join(' ');
}
