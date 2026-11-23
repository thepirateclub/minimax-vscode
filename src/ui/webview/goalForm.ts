import type { GoalState } from '../../agent/state';
import { DEFAULT_GOAL_FORM, parseLimit, type GoalForm } from './goalWizard';

export interface GoalValues {
  objective: string;
  tokenBudget?: number;
  requestLimit?: number;
  secondsLimit?: number;
}

// The time of the goal is written in minutes and seconds.
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) {
    return rest + 's';
  }
  if (rest === 0) {
    return minutes + 'm';
  }
  return minutes + 'm ' + rest + 's';
}

// The form is filled from the goal when it opens, a new goal starts from
// the defaults.
export function goalFormValues(goal: GoalState | undefined): GoalForm {
  if (!goal) {
    return { ...DEFAULT_GOAL_FORM };
  }
  return {
    objective: goal.objective,
    tokens: goal.tokenBudget === undefined ? '' : String(goal.tokenBudget),
    requests: goal.requestLimit === undefined ? '' : String(goal.requestLimit),
    minutes: goal.secondsLimit === undefined ? '' : String(Math.round(goal.secondsLimit / 60))
  };
}

export function parseGoalForm(form: GoalForm): {
  values?: GoalValues;
  error?: 'empty' | 'badLimit';
} {
  if (form.objective.trim().length === 0) {
    return { error: 'empty' };
  }
  const tokens = parseLimit(form.tokens);
  const requests = parseLimit(form.requests);
  const minutes = parseLimit(form.minutes);
  if (!tokens.ok || !requests.ok || !minutes.ok) {
    return { error: 'badLimit' };
  }
  return {
    values: {
      // The objective is one line, the textarea of the wizard may wrap it.
      objective: form.objective.replace(/\s+/g, ' ').trim(),
      tokenBudget: tokens.value,
      requestLimit: requests.value,
      secondsLimit: minutes.value === undefined ? undefined : minutes.value * 60
    }
  };
}

// The host confirms the goal, the values of the form and the goal of the
// session have to be the same.
export function goalMatches(values: GoalValues, goal: GoalState | undefined): boolean {
  if (!goal) {
    return false;
  }
  return (
    goal.objective === values.objective &&
    goal.tokenBudget === values.tokenBudget &&
    goal.requestLimit === values.requestLimit &&
    goal.secondsLimit === values.secondsLimit
  );
}
