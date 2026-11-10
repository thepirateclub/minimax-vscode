import { useState } from 'react';
import type { GoalState } from '../../../agent/state';
import { STRINGS } from '../strings';

export interface GoalValues {
  objective: string;
  tokenBudget?: number;
  requestLimit?: number;
  secondsLimit?: number;
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
  const [objective, setObjective] = useState('');
  const [tokens, setTokens] = useState('');
  const [requests, setRequests] = useState('');
  const [minutes, setMinutes] = useState('');

  // The form is filled from the goal when it opens. A form that keeps the
  // values of the moment of the mount shows empty fields while the limits
  // are already set, and the user edits a blank goal.
  const openEditor = (): void => {
    setObjective(goal?.objective ?? '');
    setTokens(goal?.tokenBudget === undefined ? '' : String(goal.tokenBudget));
    setRequests(goal?.requestLimit === undefined ? '' : String(goal.requestLimit));
    setMinutes(
      goal?.secondsLimit === undefined ? '' : String(Math.round(goal.secondsLimit / 60))
    );
    setEditing(true);
  };

  const number = (value: string): number | undefined => {
    const parsed = Number(value.trim());
    return value.trim().length > 0 && Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : undefined;
  };

  const submit = (): void => {
    const tokenBudget = number(tokens);
    const requestLimit = number(requests);
    const minuteLimit = number(minutes);
    onSet({
      objective: objective.trim(),
      tokenBudget,
      requestLimit,
      secondsLimit: minuteLimit === undefined ? undefined : minuteLimit * 60
    });
    setEditing(false);
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
            value={objective}
            placeholder={STRINGS.goalObjective}
            onChange={(event) => setObjective(event.target.value)}
          />
          <input
            className="goal-input"
            value={tokens}
            placeholder={STRINGS.goalTokenLimit}
            onChange={(event) => setTokens(event.target.value)}
          />
          <input
            className="goal-input"
            value={requests}
            placeholder={STRINGS.goalRequestLimit}
            onChange={(event) => setRequests(event.target.value)}
          />
          <input
            className="goal-input"
            value={minutes}
            placeholder={STRINGS.goalMinuteLimit}
            onChange={(event) => setMinutes(event.target.value)}
          />
          <button className="goal-button" onClick={submit}>
            {STRINGS.goalSave}
          </button>
          <button className="goal-button" onClick={() => setEditing(false)}>
            {STRINGS.goalCancel}
          </button>
        </div>
      ) : (
        <div className="goal-row">
          <span className="goal-objective">{goal?.objective}</span>
          <span className="goal-spend">
            {goal?.used.tokens ?? 0}/{goal?.tokenBudget ?? '∞'}
          </span>
          <span className="goal-spend">
            {goal?.used.requests ?? 0}/{goal?.requestLimit ?? '∞'}
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
