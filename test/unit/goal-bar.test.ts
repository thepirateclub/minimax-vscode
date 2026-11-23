import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GoalBar
} from '../../src/ui/webview/components/GoalBar';
import {
  formatSeconds,
  goalFormValues,
  goalMatches,
  parseGoalForm
} from '../../src/ui/webview/goalForm';
import { STRINGS } from '../../src/ui/webview/strings';
import type { GoalState } from '../../src/agent/state';
import { readStyles } from '../helpers/styles';

const CSS = readStyles();

const GOAL: GoalState = {
  objective: 'Rewrite the parser',
  tokenBudget: 12000,
  requestLimit: 10,
  status: 'active',
  used: { tokens: 4300, requests: 2, seconds: 0 }
};

function render(goal?: GoalState, request?: { token: number; objective: string }): string {
  return renderToStaticMarkup(
    createElement(GoalBar, {
      goal,
      request,
      onSet: () => undefined,
      onClear: () => undefined
    })
  );
}

describe('the widget of the goal', () => {
  it('shows the goal and the spend', () => {
    const markup = render(GOAL);
    expect(markup).toContain('Rewrite the parser');
    // One rule of rounding for the whole panel: the header writes 184K.
    expect(markup).toContain('4.3K');
    expect(markup).toContain('12K');
  });

  it('writes no infinity for a limit that is not set', () => {
    const markup = render({ ...GOAL, tokenBudget: undefined, requestLimit: undefined });
    expect(markup).not.toContain('∞');
    expect(markup).toContain('4.3K');
  });

  it('names the status in the words of the interface', () => {
    expect(render({ ...GOAL, status: 'complete' })).toContain(STRINGS.goalComplete);
    expect(render({ ...GOAL, status: 'blocked' })).toContain(STRINGS.goalBlocked);
    expect(render({ ...GOAL, status: 'blocked' })).toContain('goal-status-blocked');
  });

  it('keeps the objective on its own row, the buttons are icons', () => {
    const markup = render(GOAL);
    // The objective had no room next to the spend and the buttons, its
    // width fell to zero and the Clear button ran out of the panel.
    expect(markup.indexOf('goal-objective')).toBeLessThan(markup.indexOf('goal-meta'));
    expect(markup).toContain('aria-label="' + STRINGS.goalEdit + '"');
    expect(markup).toContain('aria-label="' + STRINGS.goalClear + '"');
    expect(markup).not.toContain('>' + STRINGS.goalClear + '<');
  });

  it('shows the limit of the time', () => {
    const markup = render({
      ...GOAL,
      secondsLimit: 300,
      used: { tokens: 4300, requests: 2, seconds: 80 }
    });
    expect(markup).toContain('1m 20s');
    expect(markup).toContain('5m');
  });

  it('takes no room over the feed when there is no goal', () => {
    // The goal is set from the button in the bottom row of the input field.
    expect(render(undefined)).toBe('');
  });

  it('has a rule for every class of the widget', () => {
    const markup = render(GOAL);
    const classes = Array.from(
      markup.matchAll(/class="([^"]*)"/g)
    ).flatMap((match) => (match[1] ?? '').split(/\s+/).filter(Boolean));
    for (const name of classes) {
      expect(CSS).toMatch(new RegExp('\\.' + name + '\\b'));
    }
  });
});

describe('the numbers of the goal', () => {
  it('writes the time in minutes and seconds', () => {
    expect(formatSeconds(20)).toBe('20s');
    expect(formatSeconds(80)).toBe('1m 20s');
    expect(formatSeconds(300)).toBe('5m');
  });
});

describe('the form of the limits', () => {
  it('is filled from the goal', () => {
    const form = goalFormValues(GOAL);
    expect(form.objective).toBe('Rewrite the parser');
    expect(form.tokens).toBe('12000');
    expect(form.requests).toBe('10');
    expect(form.minutes).toBe('');
  });

  it('reads an empty field as a limit that is not set', () => {
    const parsed = parseGoalForm({
      objective: 'Rewrite the parser',
      tokens: '',
      requests: '',
      minutes: ''
    });
    expect(parsed.error).toBeUndefined();
    expect(parsed.values?.tokenBudget).toBeUndefined();
    expect(parsed.values?.secondsLimit).toBeUndefined();
  });

  it('refuses a limit that is not a number and does not take the limit away', () => {
    const parsed = parseGoalForm({
      objective: 'Rewrite the parser',
      tokens: '5,000',
      requests: '',
      minutes: ''
    });
    expect(parsed.error).toBe('badLimit');
    expect(parsed.values).toBeUndefined();
  });

  it('refuses an empty objective', () => {
    const parsed = parseGoalForm({
      objective: '  ',
      tokens: '100',
      requests: '',
      minutes: ''
    });
    expect(parsed.error).toBe('empty');
  });

  it('turns the minutes into seconds', () => {
    const parsed = parseGoalForm({
      objective: 'Rewrite the parser',
      tokens: '100',
      requests: '3',
      minutes: '5'
    });
    expect(parsed.values?.secondsLimit).toBe(300);
    expect(parsed.values?.requestLimit).toBe(3);
  });
});

describe('the confirmation of the goal', () => {
  it('recognises the goal the host confirmed', () => {
    const values = {
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 10,
      secondsLimit: 300
    };
    expect(goalMatches(values, { ...GOAL, secondsLimit: 300 })).toBe(true);
    expect(goalMatches(values, GOAL)).toBe(false);
    expect(goalMatches(values, undefined)).toBe(false);
  });
});

describe('the wizard of the goal', () => {
  it('opens on the first step with the objective of /goal', () => {
    const markup = render(undefined, { token: 1, objective: 'Ship the parser' });
    expect(markup).toContain('goal-wizard');
    expect(markup).toContain(STRINGS.goalNewTitle);
    expect(markup).toContain(STRINGS.goalStepObjective + ' · 1/3');
    expect(markup).toContain('Ship the parser');
    // The first step has no way back, the main button goes forward.
    expect(markup).not.toContain('>' + STRINGS.goalBack + '<');
    expect(markup).toContain('goal-button-primary">' + STRINGS.goalNext + '<');
  });

  it('edits the goal that is set, the title says so', () => {
    const markup = render(GOAL, { token: 1, objective: '' });
    expect(markup).toContain(STRINGS.goalEditTitle);
    expect(markup).toContain('Rewrite the parser');
  });

  it('marks the steps that are passed', () => {
    const markup = render(undefined, { token: 1, objective: '' });
    expect(markup.match(/goal-wizard-dot-done/g)).toHaveLength(1);
    expect(markup.match(/class="goal-wizard-dot[ "]/g)).toHaveLength(3);
  });

  it('has a rule for every class of the wizard', () => {
    const markup = render(GOAL, { token: 1, objective: '' });
    const classes = Array.from(markup.matchAll(/class="([^"]*)"/g)).flatMap((match) =>
      (match[1] ?? '').split(/\s+/).filter(Boolean)
    );
    for (const name of classes) {
      expect(CSS).toMatch(new RegExp('\\.' + name + '\\b'));
    }
  });
});

describe('the defaults of a goal', () => {
  it('starts a new goal without limits', () => {
    expect(goalFormValues(undefined)).toEqual({ objective: '', tokens: '', requests: '', minutes: '' });
  });

  it('keeps an objective of the wizard on one line', () => {
    const parsed = parseGoalForm({ objective: 'Ship\nthe parser', tokens: '', requests: '', minutes: '' });
    expect(parsed.values?.objective).toBe('Ship the parser');
  });
});
