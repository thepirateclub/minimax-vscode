import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCard } from '../../src/ui/webview/components/ToolCard';
import type { UiToolCall } from '../../src/ui/protocol';
import { readStyles } from '../helpers/styles';


export const CSS = readStyles();

interface Rule {
  selector: string;
  body: string;
}

// The style sheet is the only place where the dot gets its color, so the
// class of the dot and the selector of the rule have to meet. When the names
// drift apart the dot keeps the base color and every action looks the same.
export function rules(css: string): Rule[] {
  // A comment in front of a selector sticks to it and breaks the lookup.
  const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
  }
  return found;
}

export function ruleFor(css: string, selector: string): string | undefined {
  const matched = rules(css).filter((rule) =>
    rule.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector)
  );
  return matched[matched.length - 1]?.body;
}

export function property(body: string | undefined, name: string): string | undefined {
  const found = new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+);').exec(body ?? '');
  return found?.[1]?.trim();
}

// The dot of an action is painted by the style sheet, the class of the dot
// and the rule of the sheet have to meet.
export function dotClasses(markup: string): string[] {
  const match = /<span class="([^"]*tool-dot[^"]*)"/.exec(markup);
  return (match?.[1] ?? '').split(/\s+/).filter(Boolean);
}

// The summary is the short text next to the title of the card.
export function summaryOf(markup: string): string {
  const match = /<span class="tool-summary">([^<]*)<\/span>/.exec(markup);
  return match?.[1] ?? '';
}

// The title of the card names the action.
export function titleOf(markup: string): string {
  const match = /<span class="tool-title">([^<]*)<\/span>/.exec(markup);
  return match?.[1] ?? '';
}

// The size of the change sits in the header of the card.
export function addedOf(markup: string): string {
  const match = /<span class="tool-stat tool-stat-add">([^<]*)<\/span>/.exec(markup);
  return match?.[1] ?? '';
}

export function removedOf(markup: string): string {
  const match = /<span class="tool-stat tool-stat-remove">([^<]*)<\/span>/.exec(markup);
  return match?.[1] ?? '';
}

export function card(tool: Partial<UiToolCall>, collapsed = false): string {
  const full: UiToolCall = {
    id: 'tool-1',
    name: 'read_file',
    input: { path: 'src/app.ts' },
    content: '1: const a = 1;',
    ...tool
  };
  return renderToStaticMarkup(createElement(ToolCard, { tool: full, collapsed }));
}
