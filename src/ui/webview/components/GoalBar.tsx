import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { GoalState, GoalStatus } from '../../../agent/state';
import { formatCount } from '../../format';
import {
  GOAL_STEPS,
  nextStep,
  previousStep,
  stepError,
  type GoalForm,
  type GoalStep
} from '../goalWizard';
import {
  formatSeconds,
  goalFormValues,
  goalMatches,
  parseGoalForm,
  type GoalValues
} from '../goalForm';
import { IconClose, IconEdit } from '../icons';
import { STRINGS } from '../strings';

export type { GoalForm } from '../goalWizard';

export {
  formatSeconds,
  goalFormValues,
  goalMatches,
  parseGoalForm
} from '../goalForm';
export type { GoalValues } from '../goalForm';

// A request to open the wizard from outside, the command /goal sends it.
// The token tells a new request from the old one.
export interface GoalWizardRequest {
  token: number;
  objective: string;
}

const STEP_TITLE: Record<GoalStep, string> = {
  objective: STRINGS.goalStepObjective,
  limits: STRINGS.goalStepLimits,
  review: STRINGS.goalStepReview
};

// The form of a request: the objective of /goal over the values of the goal.
function requestedForm(goal: GoalState | undefined, objective: string): GoalForm {
  const form = goalFormValues(goal);
  return objective.length > 0 ? { ...form, objective } : form;
}

// The goal over the feed: the user sets it, the model only reads it and
// changes its status. The limits are the business of the user. Setting and
// editing go through a wizard of three steps: the objective, the limits and
// the review.
export function GoalBar({
  goal,
  request,
  onSet,
  onClear
}: {
  goal: GoalState | undefined;
  request?: GoalWizardRequest;
  onSet: (values: GoalValues) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(request !== undefined);
  const [step, setStep] = useState<GoalStep>('objective');
  const [form, setForm] = useState<GoalForm>(() =>
    requestedForm(goal, request?.objective ?? '')
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState<GoalValues | undefined>(undefined);

  // The wizard is filled from the goal when it opens. A form that keeps the
  // values of the moment of the mount shows empty fields while the limits
  // are already set, and the user edits a blank goal.
  const openEditor = (objective = ''): void => {
    setForm(requestedForm(goal, objective));
    setStep('objective');
    setError('');
    setPending(undefined);
    setEditing(true);
  };

  // The command /goal opens the wizard. The first request is taken by the
  // initial state, a later one by its new token.
  const seen = useRef(request?.token);
  const token = request?.token;
  useEffect(() => {
    if (request && request.token !== seen.current) {
      seen.current = request.token;
      openEditor(request.objective);
    }
    // The token alone decides, openEditor reads the goal of this render.
  }, [token]);

  // The wizard closes only when the host confirms the goal. A refused save
  // keeps the text of the user, otherwise the work of the user is lost.
  useEffect(() => {
    if (pending && goalMatches(pending, goal)) {
      setPending(undefined);
      setEditing(false);
    }
  }, [goal, pending]);

  const showError = (reason: 'empty' | 'badLimit'): void => {
    setError(reason === 'empty' ? STRINGS.goalEmpty : STRINGS.goalBadLimit);
  };

  const forward = (): void => {
    const reason = stepError(step, form);
    if (reason) {
      showError(reason);
      return;
    }
    setError('');
    if (step !== 'review') {
      setStep(nextStep(step));
      return;
    }
    const parsed = parseGoalForm(form);
    if (!parsed.values) {
      showError(parsed.error ?? 'empty');
      return;
    }
    setPending(parsed.values);
    onSet(parsed.values);
  };

  const back = (): void => {
    setError('');
    setStep(previousStep(step));
  };

  // Enter goes to the next step and saves on the last one, Shift+Enter
  // breaks the line of the objective, Escape drops the wizard.
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      forward();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
  };

  // Without a goal the widget takes no room: the goal is set from the
  // button in the bottom row of the input field.
  if (!goal && !editing) {
    return null;
  }

  if (editing) {
    const index = GOAL_STEPS.indexOf(step);
    const limit = (
      key: 'tokens' | 'requests' | 'minutes',
      label: string,
      placeholder: string,
      first: boolean
    ) => (
      <label className="goal-field">
        <span className="goal-field-label">{label}</span>
        <input
          className="goal-input"
          type="text"
          inputMode="numeric"
          autoFocus={first}
          value={form[key]}
          placeholder={placeholder}
          aria-label={placeholder}
          onKeyDown={onKey}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      </label>
    );
    const parsed = parseGoalForm(form).values;
    const shown = (value: number | undefined, text: (n: number) => string): string =>
      value === undefined ? STRINGS.goalNoLimit : text(value);
    return (
      <div className="goal-bar goal-wizard">
        <div className="goal-wizard-head">
          <span className="goal-wizard-title">
            {goal ? STRINGS.goalEditTitle : STRINGS.goalNewTitle}
          </span>
          <span className="goal-wizard-step">
            {STEP_TITLE[step]} · {index + 1}/{GOAL_STEPS.length}
          </span>
        </div>
        <div className="goal-wizard-dots" aria-hidden="true">
          {GOAL_STEPS.map((item, at) => (
            <span
              key={item}
              className={'goal-wizard-dot' + (at <= index ? ' goal-wizard-dot-done' : '')}
            />
          ))}
        </div>
        {step === 'objective' ? (
          <textarea
            className="goal-input goal-input-objective"
            rows={2}
            autoFocus
            value={form.objective}
            placeholder={STRINGS.goalObjectivePlaceholder}
            aria-label={STRINGS.goalObjective}
            onKeyDown={onKey}
            onChange={(event) => setForm({ ...form, objective: event.target.value })}
          />
        ) : step === 'limits' ? (
          <div className="goal-limits">
            {limit('tokens', STRINGS.goalTokens, STRINGS.goalTokenLimit, true)}
            {limit('requests', STRINGS.goalRequests, STRINGS.goalRequestLimit, false)}
            {limit('minutes', STRINGS.goalMinutes, STRINGS.goalMinuteLimit, false)}
          </div>
        ) : (
          // The review takes Enter too, the focus sits on the main button.
          <dl className="goal-review">
            <dt>{STRINGS.goalLabel}</dt>
            <dd>{parsed?.objective}</dd>
            <dt>{STRINGS.goalTokens}</dt>
            <dd>{shown(parsed?.tokenBudget, formatCount)}</dd>
            <dt>{STRINGS.goalRequests}</dt>
            <dd>{shown(parsed?.requestLimit, String)}</dd>
            <dt>{STRINGS.goalMinutes}</dt>
            <dd>{shown(parsed?.secondsLimit, formatSeconds)}</dd>
          </dl>
        )}
        <div className="goal-actions">
          <span className={error.length > 0 ? 'goal-error' : 'goal-hint'}>
            {error.length > 0 ? error : step === 'limits' ? STRINGS.goalLimitsHint : ''}
          </span>
          <button className="goal-button" onClick={() => setEditing(false)}>
            {STRINGS.goalCancel}
          </button>
          {index > 0 ? (
            <button className="goal-button" onClick={back}>
              {STRINGS.goalBack}
            </button>
          ) : null}
          <button
            className="goal-button goal-button-primary"
            autoFocus={step === 'review'}
            onClick={forward}
          >
            {step === 'review' ? STRINGS.goalSave : STRINGS.goalNext}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        'goal-bar' + (goal && goal.status !== 'active' ? ' goal-status-' + goal.status : '')
      }
    >
      <div className="goal-row">
        <span className="goal-label">{STRINGS.goalLabel}</span>
        <span className="goal-objective" title={goal?.objective}>
          {goal?.objective}
        </span>
        <button
          className="goal-icon-button"
          title={STRINGS.goalEdit}
          aria-label={STRINGS.goalEdit}
          onClick={() => openEditor()}
        >
          <IconEdit />
        </button>
        <button
          className="goal-icon-button"
          title={STRINGS.goalClear}
          aria-label={STRINGS.goalClear}
          onClick={onClear}
        >
          <IconClose />
        </button>
      </div>
      {goal ? <GoalMeta goal={goal} /> : null}
    </div>
  );
}

const STATUS_TEXT: Record<Exclude<GoalStatus, 'active'>, string> = {
  complete: STRINGS.goalComplete,
  blocked: STRINGS.goalBlocked
};

// The spend under the objective. A limit that is not set shows the spend
// alone: an infinity sign read like a broken number.
function GoalMeta({ goal }: { goal: GoalState }) {
  const spend = (used: string, limit: string | undefined, unit: string): string =>
    used + (limit === undefined ? '' : ' / ' + limit) + ' ' + unit;
  return (
    <div className="goal-meta">
      {goal.status !== 'active' ? (
        <span className="goal-status">{STATUS_TEXT[goal.status]}</span>
      ) : null}
      <span className="goal-spend">
        {spend(
          formatCount(goal.used.tokens),
          goal.tokenBudget === undefined ? undefined : formatCount(goal.tokenBudget),
          STRINGS.goalTokens
        )}
      </span>
      <span className="goal-spend">
        {spend(
          String(goal.used.requests),
          goal.requestLimit === undefined ? undefined : String(goal.requestLimit),
          STRINGS.goalRequests
        )}
      </span>
      <span className="goal-spend">
        {formatSeconds(goal.used.seconds) +
          (goal.secondsLimit === undefined ? '' : ' / ' + formatSeconds(goal.secondsLimit))}
      </span>
    </div>
  );
}
