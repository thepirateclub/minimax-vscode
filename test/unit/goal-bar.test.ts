import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoalBar } from '../../src/ui/webview/components/GoalBar';
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
    expect(markup).toContain('4300');
    expect(markup).toContain('12000');
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
