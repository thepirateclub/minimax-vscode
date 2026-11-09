import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from '../../src/ui/webview/components/Composer';
import { UsageGraph } from '../../src/ui/webview/components/UsageGraph';
import { MODELS } from '../../src/config/models';
import type { ReactElement } from 'react';

// The layout of the panel is drawn with css, the markup cannot express it,
// so the tests read the rules of the stylesheet.
const css = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
);

function rule(selector: string): string {
  const index = css.indexOf(selector + ' {');
  if (index === -1) {
    return '';
  }
  const start = css.indexOf('{', index);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

const noop = (): void => undefined;

function renderComposer(busy: boolean): string {
  return renderToStaticMarkup(
    createElement(Composer, {
      busy,
      selections: [],
      focusToken: 0,
      suggestions: [],
      insert: undefined,
      onInsertHandled: noop,
      resetToken: 0,
      models: MODELS,
      model: MODELS[0]!.id,
      effort: 'max',
      mode: 'code',
      thinking: false,
      onModel: noop,
      onEffort: noop,
      onMode: noop,
      onThinking: noop,
      onSend: noop,
      onStop: noop,
      onPickFiles: noop,
      onRemoveSelection: noop,
      onSuggest: noop
    }) as ReactElement
  );
}

describe('panel layout', () => {
  it('sends with an icon instead of a text label', () => {
    const markup = renderComposer(false);
    expect(markup).toContain('composer-send');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('>Send<');
  });

  it('shows the stop icon while the agent works', () => {
    const markup = renderComposer(true);
    expect(markup).toContain('composer-send');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('>Stop<');
  });

  it('puts the send icon into the bottom right corner of the input field', () => {
    const markup = renderComposer(false);
    const wrapAt = markup.indexOf('composer-input-wrap');
    const sendAt = markup.indexOf('composer-send');
    const selectsAt = markup.indexOf('composer-selects');
    expect(wrapAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(wrapAt);
    expect(sendAt).toBeLessThan(selectsAt);
    const style = rule('.composer-send');
    expect(style).toMatch(/position:\s*absolute/);
    expect(style).toMatch(/bottom:\s*\d+px/);
    expect(style).toMatch(/right:\s*\d+px/);
    expect(style).toMatch(/background:\s*transparent/);
    expect(style).not.toMatch(/border-radius:\s*50%/);
  });

  it('stretches the graph but keeps the width of the steps', () => {
    const graph = rule('.usage-graph');
    expect(graph).toMatch(/flex:\s*1/);
    expect(graph).not.toMatch(/max-width/);
    const column = rule('.usage-column');
    expect(column).toMatch(/width:\s*\d+px/);
    expect(column).not.toMatch(/flex:\s*1 1 0/);
  });

  it('gives the prompt field more room', () => {
    const style = rule('.composer-input');
    const height = /min-height:\s*(\d+)px/.exec(style);
    expect(height).not.toBeNull();
    expect(Number(height?.[1] ?? 0)).toBeGreaterThanOrEqual(64);
  });

  it('draws one column per action of the session', () => {
    const markup = renderToStaticMarkup(
      UsageGraph({
        turns: [
          { input: 100, output: 20, cache: 0 },
          { input: 200, output: 40, cache: 10 },
          { input: 300, output: 60, cache: 0 }
        ]
      }) as ReactElement
    );
    expect(markup.match(/usage-column/g)?.length ?? 0).toBe(3);
  });
});
