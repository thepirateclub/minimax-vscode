import { useEffect, useState } from 'react';
import type { GoalState } from '../../../agent/state';
import { STRINGS } from '../strings';

export interface GoalValues {
  objective: string;
  tokenBudget?: number;
  requestLimit?: number;
  secondsLimit?: number;
}

// The text of the form of the limits.
export interface GoalForm {
  objective: string;
  tokens: string;
  requests: string;
  minutes: string;
}

// A big count of tokens is written in thousands, the panel is narrow.
export function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  const thousands = value / 1000;
  const text = thousands >= 100 ? String(Math.round(thousands)) : thousands.toFixed(1);
  return text.replace(/\.0$/, '') + 'k';
}

// The time of the goal is written in minutes and seconds.
export function formatDuration(seconds: number): string {
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

// The form is filled from the goal when it opens.
export function goalFormValues(goal: GoalState | undefined): GoalForm {
  return {
    objective: goal?.objective ?? '',
    tokens: goal?.tokenBudget === undefined ? '' : String(goal.tokenBudget),
    requests: goal?.requestLimit === undefined ? '' : String(goal.requestLimit),
    minutes:
      goal?.secondsLimit === undefined ? '' : String(Math.round(goal.secondsLimit / 60))
  };
}

// An empty field means "without a limit". A field with a wrong number is
// an error, it never takes the limit away.
function parseLimit(text: string): { ok: true; value?: number } | { ok: false } {
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
      objective: form.objective.trim(),
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

// The goal over the feed: the user sets it, the model only reads it and
// changes its status. The limits are the business of the user.
export function GoalBar({
  goal,
  onSet,
  onClear
}: {
  goal: GoalState | undefined;
  onSet: (values: GoalValues) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<GoalForm>({
    objective: '',
    tokens: '',
    requests: '',
    minutes: ''
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState<GoalValues | undefined>(undefined);

  // The form is filled from the goal when it opens. A form that keeps the
  // values of the moment of the mount shows empty fields while the limits
  // are already set, and the user edits a blank goal.
  const openEditor = (): void => {
    setForm(goalFormValues(goal));
    setError('');
    setPending(undefined);
    setEditing(true);
  };

  // The form closes only when the host confirms the goal. A refused save
  // keeps the text of the user, otherwise the work of the user is lost.
  useEffect(() => {
    if (pending && goalMatches(pending, goal)) {
      setPending(undefined);
      setEditing(false);
    }
  }, [goal, pending]);

  const submit = (): void => {
    const parsed = parseGoalForm(form);
    if (!parsed.values) {
      setError(parsed.error === 'empty' ? STRINGS.goalEmpty : STRINGS.goalBadLimit);
      return;
    }
    setError('');
    setPending(parsed.values);
    onSet(parsed.values);
  };

  // Without a goal the widget still stands above the feed, otherwise the
  // user has no way to set a goal at all.
  if (!goal && !editing) {
    return (
      <div className="goal-bar">
        <button className="goal-button" onClick={openEditor}>
          {STRINGS.goalSet}
        </button>
      </div>
    );
  }

  return (
    <div className="goal-bar">
      {editing ? (
        <div className="goal-form">
          <input
            className="goal-input"
            type="text"
            value={form.objective}
            placeholder={STRINGS.goalObjective}
            aria-label={STRINGS.goalObjective}
            onChange={(event) => setForm({ ...form, objective: event.target.value })}
          />
          <input
            className="goal-input"
            type="text"
            value={form.tokens}
            placeholder={STRINGS.goalTokenLimit}
            aria-label={STRINGS.goalTokenLimit}
            onChange={(event) => setForm({ ...form, tokens: event.target.value })}
          />
          <input
            className="goal-input"
            type="text"
            value={form.requests}
            placeholder={STRINGS.goalRequestLimit}
            aria-label={STRINGS.goalRequestLimit}
            onChange={(event) => setForm({ ...form, requests: event.target.value })}
          />
          <input
            className="goal-input"
            type="text"
            value={form.minutes}
            placeholder={STRINGS.goalMinuteLimit}
            aria-label={STRINGS.goalMinuteLimit}
            onChange={(event) => setForm({ ...form, minutes: event.target.value })}
          />
          <button className="goal-button" onClick={submit}>
            {STRINGS.goalSave}
          </button>
          <button className="goal-button" onClick={() => setEditing(false)}>
            {STRINGS.goalCancel}
          </button>
          {error.length > 0 ? <span className="goal-error">{error}</span> : null}
        </div>
      ) : (
        <div className="goal-row">
          <span className="goal-objective">{goal?.objective}</span>
          <span className="goal-spend">
            {formatTokens(goal?.used.tokens ?? 0)}/
            {goal && goal.tokenBudget !== undefined ? formatTokens(goal.tokenBudget) : '∞'} tokens
          </span>
          <span className="goal-spend">
            {goal?.used.requests ?? 0}/
            {goal && goal.requestLimit !== undefined ? goal.requestLimit : '∞'} requests
          </span>
          <span className="goal-spend">
            {formatDuration(goal?.used.seconds ?? 0)}/
            {goal && goal.secondsLimit !== undefined ? formatDuration(goal.secondsLimit) : '∞'}
          </span>
          {goal && goal.status !== 'active' ? (
            <span className="goal-status">{goal.status}</span>
          ) : null}
          <button className="goal-button" onClick={openEditor}>
            {STRINGS.goalEdit}
          </button>
          <button className="goal-button" onClick={onClear}>
            {STRINGS.goalClear}
          </button>
        </div>
      )}
    </div>
  );
}
