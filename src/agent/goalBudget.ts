import type { GoalState } from './state';

export interface GoalUsage {
  tokens: number;
  requests: number;
  seconds: number;
}

// The budget of the goal is over when one of its limits is reached. The
// host counts the spend and asks this function, the agent only obeys the
// answer.
export function budgetOver(goal: GoalState, usage: GoalUsage): boolean {
  if (goal.tokenBudget !== undefined && usage.tokens >= goal.tokenBudget) {
    return true;
  }
  if (goal.requestLimit !== undefined && usage.requests >= goal.requestLimit) {
    return true;
  }
  if (goal.secondsLimit !== undefined && usage.seconds >= goal.secondsLimit) {
    return true;
  }
  return false;
}
