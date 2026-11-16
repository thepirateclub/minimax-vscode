import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskList } from '../../src/ui/webview/components/TaskList';
import { STRINGS } from '../../src/ui/webview/strings';

const CSS = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
);

function render(todos: Array<{ content: string; status: string; priority: string }>): string {
  return renderToStaticMarkup(
    createElement(TaskList, {
      todos: todos as never,
      onClear: () => undefined
    })
  );
}

describe('the widget of the list of tasks', () => {
  it('shows how many tasks are done', () => {
    const markup = render([
      { content: 'Read the parser', status: 'completed', priority: 'high' },
      { content: 'Add tests', status: 'pending', priority: 'medium' }
    ]);
    expect(markup).toContain('task-count');
    expect(markup).toContain('1/2');
  });

  it('shows every task with its state', () => {
    const markup = render([
      { content: 'Read the parser', status: 'in_progress', priority: 'high' }
    ]);
    expect(markup).toContain('Read the parser');
    expect(markup).toContain('task-in_progress');
  });

  it('offers to clear the list with an icon button', () => {
    const markup = render([{ content: 'Read the parser', status: 'pending', priority: 'high' }]);
    expect(markup).toContain('task-clear');
    expect(markup).toContain('aria-label="' + STRINGS.taskClear + '"');
    // The toggle and the clear button are siblings, a button in a button is
    // not valid markup.
    expect(markup).not.toMatch(/<button[^>]*task-head[^>]*>(?:(?!<\/button>).)*<button/);
  });

  it('shows nothing when the list is empty', () => {
    expect(render([])).toBe('');
  });

  it('gives every state and the priority its class', () => {
    const markup = render([
      { content: 'Read the parser', status: 'pending', priority: 'very_high' },
      { content: 'Add tests', status: 'in_progress', priority: 'high' },
      { content: 'Ship it', status: 'completed', priority: 'medium' },
      { content: 'Rest', status: 'pending', priority: 'low' }
    ]);
    expect(markup).toContain('task-pending');
    expect(markup).toContain('task-in_progress');
    expect(markup).toContain('task-completed');
    // Every priority has its own class, a class without a rule is a dead end.
    expect(markup).toContain('task-priority-very_high');
    expect(markup).toContain('task-priority-high');
    expect(markup).toContain('task-priority-medium');
    expect(markup).toContain('task-priority-low');
  });

  it('shows the priority as an arrow, the word stays in the hint', () => {
    const markup = render([
      { content: 'Read the parser', status: 'pending', priority: 'high' },
      { content: 'Add tests', status: 'pending', priority: 'medium' },
      { content: 'Ship it', status: 'pending', priority: 'low' },
      { content: 'Ship it now', status: 'pending', priority: 'very_high' }
    ]);
    // The arrow of jira is an icon, a word on every row is noise.
    expect(markup).toContain('<svg');
    expect(markup).toContain('title="' + STRINGS.taskPriorityHigh + '"');
    expect(markup).toContain('title="' + STRINGS.taskPriorityMedium + '"');
    expect(markup).toContain('title="' + STRINGS.taskPriorityLow + '"');
    expect(markup).toContain('title="' + STRINGS.taskPriorityVeryHigh + '"');
    // The word of the priority is not printed on the row.
    expect(markup).not.toContain('>' + STRINGS.taskPriorityHigh + '<');
  });

  it('does not paint the priority with the accent', () => {
    // The accent means interaction and the active state only, the arrows
    // take the colors of the theme.
    for (const name of [
      'task-priority-low',
      'task-priority-medium',
      'task-priority-high',
      'task-priority-very_high'
    ]) {
      const body = new RegExp('\\.' + name + ' \\{([^}]*)\\}').exec(CSS)?.[1] ?? '';
      expect(body, name).not.toContain('--accent');
    }
  });

  it('has a rule for every class of the widget', () => {
    const markup = render([
      { content: 'Read the parser', status: 'completed', priority: 'high' },
      { content: 'Add tests', status: 'pending', priority: 'medium' },
      { content: 'Ship it', status: 'in_progress', priority: 'low' }
    ]);
    const classes = Array.from(
      markup.matchAll(/class="([^"]*)"/g)
    ).flatMap((match) => (match[1] ?? '').split(/\s+/).filter(Boolean));
    for (const name of classes) {
      expect(CSS).toMatch(new RegExp('\\.' + name + '\\b'));
    }
  });
});
