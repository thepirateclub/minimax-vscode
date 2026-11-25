import { describe, expect, it } from 'vitest';
import { closeGoal, describeTodoChanges, resumeGoal, todoChanges } from '../../src/agent/stateMachines';
import { createGoalTools } from '../../src/tools/goal';
import type { GoalState, TodoItem } from '../../src/agent/state';

const task = (content: string, status: TodoItem['status']): TodoItem => ({ content, status, priority: 'medium' });

describe('the machine of the goal', () => {
  it('closes an active goal and refuses to block a completed one', () => {
    expect(closeGoal('active', 'complete')).toEqual({ ok: true, state: 'complete' });
    expect(closeGoal('blocked', 'complete')).toEqual({ ok: true, state: 'complete' });
    expect(closeGoal('complete', 'blocked').ok).toBe(false);
  });

  it('the user resumes a goal from any status', () => {
    expect(resumeGoal('complete')).toBe('active');
    expect(resumeGoal('blocked')).toBe('active');
  });

  it('update_goal tells the model why the step is refused', async () => {
    const goal: GoalState = { objective: 'x', status: 'complete', used: { tokens: 0, requests: 0, seconds: 0 } };
    const update = createGoalTools().find((tool) => tool.name === 'update_goal')!;
    const result = await update.execute({ status: 'blocked' }, { sessionState: { todos: [], goal } } as never);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('is complete, it cannot become blocked');
  });
});

describe('the machine of the tasks', () => {
  it('names the tasks that started and ended', () => {
    const changes = todoChanges(
      [task('read', 'pending'), task('edit', 'in_progress'), task('test', 'pending')],
      [task('read', 'in_progress'), task('edit', 'completed'), task('test', 'pending')]
    );
    expect(changes.map((change) => [change.content, change.events])).toEqual([
      ['read', ['start']],
      ['edit', ['complete']]
    ]);
    expect(describeTodoChanges(changes)).toBe('Started: read. Done: edit.');
  });

  it('a task done straight from waiting passes the work and is named', () => {
    const changes = todoChanges([task('read', 'pending')], [task('read', 'completed')]);
    expect(changes[0]?.events).toEqual(['start', 'complete']);
    expect(describeTodoChanges(changes)).toContain('Marked done without being in_progress first: read.');
  });
});
