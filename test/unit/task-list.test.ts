import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskList } from '../../src/ui/webview/components/TaskList';

const CSS = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
);

function render(todos: Array<{ content: string; status: string; priority: string }>): string {
  return renderToStaticMarkup(
    createElement(TaskList, {
      todos: todos as never
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

  it('shows nothing when the list is empty', () => {
    expect(render([])).toBe('');
  });

  it('has a rule for every class of the widget', () => {
    const markup = render([
      { content: 'Read the parser', status: 'completed', priority: 'high' }
    ]);
    const classes = Array.from(
      markup.matchAll(/class="([^"]*)"/g)
    ).flatMap((match) => (match[1] ?? '').split(/\s+/).filter(Boolean));
    for (const name of classes) {
      expect(CSS).toMatch(new RegExp('\\.' + name + '\\b'));
    }
  });
});
