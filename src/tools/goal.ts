import type { GoalState, ToolStateUpdate } from '../agent/state';
import type { ToolEntry } from './types';

const STATUSES = ['complete', 'blocked'];

// The goal as the model reads it.
export function formatGoal(goal: GoalState): string {
  const lines: string[] = ['Goal: ' + goal.objective];
  const limits: string[] = [];
  if (goal.tokenBudget !== undefined) {
    limits.push(goal.tokenBudget + ' tokens');
  }
  if (goal.requestLimit !== undefined) {
    limits.push(goal.requestLimit + ' requests');
  }
  if (goal.secondsLimit !== undefined) {
    limits.push(goal.secondsLimit + ' seconds');
  }
  if (limits.length > 0) {
    lines.push('Budget: ' + limits.join(', '));
  }
  lines.push(
    'Used: ' +
      goal.used.tokens +
      ' tokens, ' +
      goal.used.requests +
      ' requests, ' +
      Math.round(goal.used.seconds) +
      ' seconds'
  );
  if (goal.status !== 'active') {
    lines.push('Status: ' + goal.status);
  }
  return lines.join('\n');
}

export function createGoalTools(): ToolEntry[] {
  const getGoal: ToolEntry = {
    name: 'get_goal',
    description:
      'Read the goal of the session with its limits and the spend of the budget. The goal is also in the context of every turn, use this tool when you need the exact numbers.',
    approval: 'never',
    sideEffect: false,
    inputSchema: { type: 'object', properties: {} },
    async execute(_input, ctx) {
      const goal = ctx.sessionState?.goal;
      if (!goal) {
        return { content: 'There is no goal for this session.' };
      }
      return { content: formatGoal(goal) };
    }
  };

  const updateGoal: ToolEntry = {
    name: 'update_goal',
    description:
      'Mark the goal of the session as complete or blocked. Use it when the work of the goal is done or when it cannot be done. You cannot change the limits of the goal, the user does that.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['complete', 'blocked'],
          description: 'The state of the goal.'
        },
        note: {
          type: 'string',
          description: 'A short reason, one line.'
        }
      },
      required: ['status']
    },
    async execute(input, ctx) {
      if (!ctx.sessionState?.goal) {
        return {
          content: 'There is no goal for this session, there is nothing to update.',
          isError: true
        };
      }
      const status = String(input['status'] ?? '');
      if (!STATUSES.includes(status)) {
        return {
          content:
            'The status of the goal is "complete" or "blocked", not "' + status + '".',
          isError: true
        };
      }
      // The limits belong to the user. A tool that changes them would let
      // the model walk around the stop of the budget.
      for (const key of ['tokenBudget', 'requestLimit', 'secondsLimit']) {
        if (input[key] !== undefined) {
          return {
            content:
              'The limits of the goal belong to the user, the model cannot change them.',
            isError: true
          };
        }
      }
      const note = typeof input['note'] === 'string' ? input['note'].trim() : '';
      const state: ToolStateUpdate = {
        kind: 'goal',
        status: status as 'complete' | 'blocked',
        note: note.length > 0 ? note : undefined
      };
      return {
        content:
          'The goal is marked as ' +
          status +
          (note.length > 0 ? ': ' + note : '.') +
          ' The status of the goal is set by the model, the limits stay with the user.',
        state
      };
    }
  };

  return [getGoal, updateGoal];
}
