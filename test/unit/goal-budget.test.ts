import { describe, expect, it } from 'vitest';
import { budgetOver } from '../../src/agent/goalBudget';
import type { GoalState } from '../../src/agent/state';

const GOAL: GoalState = {
  objective: 'Rewrite the parser',
  tokenBudget: 1000,
  requestLimit: 4,
  secondsLimit: 60,
  status: 'active',
  used: { tokens: 0, requests: 0, seconds: 0 }
};

describe('the budget of the goal', () => {
  it('lets the work continue while the limits are not reached', () => {
    expect(budgetOver(GOAL, { tokens: 999, requests: 3, seconds: 59 })).toBe(false);
  });

  it('stops by the limit of the tokens', () => {
    expect(budgetOver(GOAL, { tokens: 1000, requests: 0, seconds: 0 })).toBe(true);
  });

  it('stops by the limit of the requests', () => {
    expect(budgetOver(GOAL, { tokens: 0, requests: 4, seconds: 0 })).toBe(true);
  });

  it('stops by the limit of the time', () => {
    expect(budgetOver(GOAL, { tokens: 0, requests: 0, seconds: 60 })).toBe(true);
  });

  it('does not stop without a limit', () => {
    expect(
      budgetOver(
        { objective: 'work', status: 'active', used: { tokens: 0, requests: 0, seconds: 0 } },
        { tokens: 1000000, requests: 1000, seconds: 10000 }
      )
    ).toBe(false);
  });
});
