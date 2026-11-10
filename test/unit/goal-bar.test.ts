import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GoalBar,
  formatDuration,
  formatTokens,
  goalFormValues,
  goalMatches,
  parseGoalForm
} from '../../src/ui/webview/components/GoalBar';
import { STRINGS } from '../../src/ui/webview/strings';
import type { GoalState } from '../../src/agent/state';

const CSS = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
);

const GOAL: GoalState = {
  objective: 'Rewrite the parser',
  tokenBudget: 12000,
  requestLimit: 10,
  status: 'active',
  used: { tokens: 4300, requests: 2, seconds: 0 }
};

function render(goal?: GoalState): string {
  return renderToStaticMarkup(
    createElement(GoalBar, {
      goal,
      onSet: () => undefined,
      onClear: () => undefined
    })
  );
}

describe('the widget of the goal', () => {
  it('shows the goal and the spend', () => {
    const markup = render(GOAL);
    expect(markup).toContain('Rewrite the parser');
    expect(markup).toContain('4.3k');
    expect(markup).toContain('12k');
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

  it('offers to set the goal when there is none', () => {
    const markup = render(undefined);
    expect(markup).toContain(STRINGS.goalSet);
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
  it('writes a big count of tokens in thousands', () => {
    expect(formatTokens(430)).toBe('430');
    expect(formatTokens(4300)).toBe('4.3k');
    expect(formatTokens(12000)).toBe('12k');
    expect(formatTokens(120000)).toBe('120k');
  });

  it('writes the time in minutes and seconds', () => {
    expect(formatDuration(20)).toBe('20s');
    expect(formatDuration(80)).toBe('1m 20s');
    expect(formatDuration(300)).toBe('5m');
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
