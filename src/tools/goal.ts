import { closeGoal } from '../agent/stateMachines';
import type { GoalOutcome, GoalState, ToolStateUpdate } from '../agent/state';
import type { ToolEntry } from './types';

const STATUSES: GoalOutcome[] = ['complete', 'blocked'];

// The status of the goal that the model can set.
function isGoalOutcome(value: string): value is GoalOutcome {
  return STATUSES.some((status) => status === value);
}

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
      // The status of the goal belongs to the main agent, a sub-agent does
      // not close the goal.
      if ((ctx.depth ?? 0) > 0) {
        return {
          content: 'The status of the goal belongs to the main agent.',
          isError: true
        };
      }
      if (!ctx.sessionState?.goal) {
        return {
          content: 'There is no goal for this session, there is nothing to update.',
          isError: true
        };
      }
      const status = String(input['status'] ?? '');
      if (!isGoalOutcome(status)) {
        return {
          content:
            'The status of the goal is "complete" or "blocked", not "' + status + '".',
          isError: true
        };
      }
      // The goal moves by its table: a completed goal is not blocked
      // afterwards, the model hears why.
      const move = closeGoal(ctx.sessionState.goal.status, status);
      if (!move.ok) {
        return {
          content: 'The goal is ' + ctx.sessionState.goal.status + ', it cannot become ' + status + '.',
          isError: true
        };
      }
      const keys = Object.keys(input);
      // The limits belong to the user. A tool that changes them would let
      // the model walk around the stop of the budget. The key matters, not
      // its value: an empty value is still an attempt to change a limit.
      for (const key of ['tokenBudget', 'requestLimit', 'secondsLimit']) {
        if (keys.includes(key)) {
          return {
            content:
              'The limits of the goal belong to the user, the model cannot change them.',
            isError: true
          };
        }
      }
      // A note of the wrong type is not dropped silently: the model must not
      // believe that a note was recorded.
      if (keys.includes('note') && typeof input['note'] !== 'string') {
        return {
          content:
            'The note of the goal must be a string, not ' +
            typeof input['note'] +
            '.',
          isError: true
        };
      }
      // A key that the tool does not know must not look like an accepted
      // change: the tool takes only the status and the note.
      for (const key of keys) {
        if (key !== 'status' && key !== 'note') {
          return {
            content:
              'The tool takes only the status and the note, the key "' +
              key +
              '" is not part of the input.',
            isError: true
          };
        }
      }
      const note = typeof input['note'] === 'string' ? input['note'].trim() : '';
      const state: ToolStateUpdate = {
        kind: 'goal',
        status,
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
