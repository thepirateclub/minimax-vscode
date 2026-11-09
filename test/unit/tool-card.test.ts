import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCard } from '../../src/ui/webview/components/ToolCard';
import type { UiToolCall } from '../../src/ui/protocol';

const CSS = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
);

interface Rule {
  selector: string;
  body: string;
}

// The style sheet is the only place where the dot gets its color, so the
// class of the dot and the selector of the rule have to meet. When the names
// drift apart the dot keeps the base color and every action looks the same.
function rules(css: string): Rule[] {
  // A comment in front of a selector sticks to it and breaks the lookup.
  const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
  }
  return found;
}

function ruleFor(css: string, selector: string): string | undefined {
  const matched = rules(css).filter((rule) =>
    rule.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector)
  );
  return matched[matched.length - 1]?.body;
}

function property(body: string | undefined, name: string): string | undefined {
  const found = new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+);').exec(body ?? '');
  return found?.[1]?.trim();
}

// The dot of an action is painted by the style sheet, the class of the dot
// and the rule of the sheet have to meet.
function dotClasses(markup: string): string[] {
  const match = /<span class="([^"]*tool-dot[^"]*)"/.exec(markup);
  return (match?.[1] ?? '').split(/\s+/).filter(Boolean);
}

function card(tool: Partial<UiToolCall>): string {
  const full: UiToolCall = {
    id: 'tool-1',
    name: 'read_file',
    input: { path: 'src/app.ts' },
    content: '1: const a = 1;',
    ...tool
  };
  return renderToStaticMarkup(createElement(ToolCard, { tool: full }));
}

describe('the dot of an action', () => {
  it('paints a finished action green', () => {
    const classes = dotClasses(card({}));
    expect(classes).toContain('tool-dot-done');
    const body = ruleFor(CSS, '.tool-dot.tool-dot-done');
    expect(body).toBeDefined();
    expect(property(body, 'background')).toContain('testing-iconPassed');
  });

  it('paints a failed action red', () => {
    const classes = dotClasses(card({ isError: true }));
    expect(classes).toContain('tool-dot-failed');
    const body = ruleFor(CSS, '.tool-dot.tool-dot-failed');
    expect(body).toBeDefined();
    expect(property(body, 'background')).toContain('testing-iconFailed');
  });

  it('blinks a running action with the gray of the base dot', () => {
    const classes = dotClasses(card({ running: true }));
    expect(classes).toContain('tool-dot-running');
    const body = ruleFor(CSS, '.tool-dot.tool-dot-running');
    expect(body).toBeDefined();
    expect(property(body, 'background')).toBe('var(--muted)');
    expect(property(body, 'animation')).toContain('mm-pulse');
  });

  it('keeps a finished result steady', () => {
    for (const state of ['done', 'failed']) {
      const body = ruleFor(CSS, '.tool-dot.tool-dot-' + state);
      expect(body).toBeDefined();
      expect(property(body, 'animation')).toBeUndefined();
    }
  });

  it('paints only the base dot gray', () => {
    const base = ruleFor(CSS, '.tool-dot');
    expect(property(base, 'background')).toBe('var(--muted)');
    for (const state of ['done', 'failed']) {
      const body = ruleFor(CSS, '.tool-dot.tool-dot-' + state);
      expect(property(body, 'background')).not.toBe('var(--muted)');
    }
  });
});
