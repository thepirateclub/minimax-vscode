// The steps of the wizard of the goal. The logic lives apart from React:
// the tests run in node without a DOM.

export type GoalStep = 'objective' | 'limits' | 'review';

export const GOAL_STEPS: GoalStep[] = ['objective', 'limits', 'review'];

// The text of the form of the goal.
export interface GoalForm {
  objective: string;
  tokens: string;
  requests: string;
  minutes: string;
}

// The defaults of a new goal: the wizard starts from them and /goal takes
// them as they are. An empty field means no limit, the user sets a limit
// on purpose, a guessed number would stop the agent in the middle of work.
export const DEFAULT_GOAL_FORM: GoalForm = {
  objective: '',
  tokens: '',
  requests: '',
  minutes: ''
};

export function nextStep(step: GoalStep): GoalStep {
  const index = GOAL_STEPS.indexOf(step);
  return GOAL_STEPS[Math.min(index + 1, GOAL_STEPS.length - 1)]!;
}

export function previousStep(step: GoalStep): GoalStep {
  const index = GOAL_STEPS.indexOf(step);
  return GOAL_STEPS[Math.max(index - 1, 0)]!;
}

// An empty field means "without a limit". A field with a wrong number is
// an error, it never takes the limit away.
export function parseLimit(text: string): { ok: true; value?: number } | { ok: false } {
  const value = text.trim();
  if (value.length === 0) {
    return { ok: true, value: undefined };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false };
  }
  return { ok: true, value: Math.floor(parsed) };
}

// The reason a step cannot be left, undefined when the step is fine.
export function stepError(step: GoalStep, form: GoalForm): 'empty' | 'badLimit' | undefined {
  if (step === 'objective' || step === 'review') {
    if (form.objective.trim().length === 0) {
      return 'empty';
    }
  }
  if (step === 'limits' || step === 'review') {
    const limits = [form.tokens, form.requests, form.minutes].map(parseLimit);
    if (limits.some((limit) => !limit.ok)) {
      return 'badLimit';
    }
  }
  return undefined;
}
