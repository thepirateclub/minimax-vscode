import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from '../../src/ui/webview/components/Composer';
import { Header } from '../../src/ui/webview/components/Header';
import { UsageGraph } from '../../src/ui/webview/components/UsageGraph';
import { MODELS } from '../../src/config/models';
import { STRINGS } from '../../src/ui/webview/strings';
import type { UiQueuedMessage } from '../../src/ui/protocol';
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

function renderComposer(
  busy: boolean,
  goalMode = false,
  retryStatus?: { attempt: number; total: number; delayMs: number },
  queue?: UiQueuedMessage[]
): string {
  return renderToStaticMarkup(
    createElement(Composer, {
      busy,
      selections: [],
      focusToken: 0,
      suggestions: [],
      insert: undefined,
      restore: undefined,
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
      onSuggest: noop,
      goalMode,
      onGoalMode: noop,
      retryStatus,
      queue
    }) as ReactElement
  );
}

function renderHeader(version: string): string {
  return renderToStaticMarkup(
    createElement(Header, {
      tab: 'chat',
      onTab: noop,
      state: 'idle',
      tokens: 0,
      usage: [],
      hasApiKey: true,
      sessions: [],
      activeSessionId: undefined,
      workspaceRoot: 'C:/projects/minimax-vscode',
      workspaceLabel: 'minimax-vscode',
      onSelectSession: noop,
      onDeleteSession: noop,
      onNewChat: noop,
      version
    }) as ReactElement
  );
}

describe('panel layout', () => {
  it('shows the version of the panel', () => {
    const markup = renderHeader('0.1.0');
    expect(markup).toContain('v0.1.0');
    const style = rule('.version');
    expect(style).toMatch(/color:\s*var\(--muted\)/);
    expect(style).toMatch(/font-size:\s*var\(--fs-xs\)/);
  });

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

  it('keeps the controls inside the input field, the model on the left', () => {
    const markup = renderComposer(false);
    const wrapAt = markup.indexOf('composer-input-wrap');
    const inputAt = markup.indexOf('composer-input"');
    const toolbarAt = markup.indexOf('composer-toolbar"');
    const startAt = markup.indexOf('composer-toolbar-start');
    const modelAt = markup.indexOf('composer-model');
    const endAt = markup.indexOf('composer-toolbar-end');
    expect(wrapAt).toBeGreaterThan(-1);
    // The toolbar is the last row of the field, under the text.
    expect(toolbarAt).toBeGreaterThan(inputAt);
    expect(startAt).toBeGreaterThan(toolbarAt);
    expect(modelAt).toBeGreaterThan(startAt);
    expect(modelAt).toBeLessThan(endAt);
    // No row of selects under the field any more.
    expect(markup).not.toContain('composer-selects');
  });

  it('puts the microphone right before the send button', () => {
    for (const busy of [false, true]) {
      const markup = renderComposer(busy);
      const reasoningAt = markup.indexOf('composer-reasoning');
      const micAt = markup.indexOf('composer-mic');
      const sendAt = markup.indexOf('composer-send');
      expect(micAt).toBeGreaterThan(reasoningAt);
      expect(sendAt).toBeGreaterThan(micAt);
    }
    // The microphone is an icon button of the field, like the paperclip.
    expect(rule('.composer-mic')).toMatch(/color:\s*var\(--muted\)/);
    // A running recording is red and pulses, the reader sees that the panel listens.
    expect(rule('.composer-mic.recording')).toMatch(/color:\s*var\(--err\)/);
  });

  it('puts the reasoning switch right before the send button', () => {
    for (const busy of [false, true]) {
      const markup = renderComposer(busy);
      const endAt = markup.indexOf('composer-toolbar-end');
      const reasoningAt = markup.indexOf('composer-reasoning');
      const sendAt = markup.indexOf('composer-send');
      expect(reasoningAt).toBeGreaterThan(endAt);
      expect(sendAt).toBeGreaterThan(reasoningAt);
    }
    // The switch inside the field is a quiet text, not a framed control.
    expect(rule('.composer-toolbar .icon-select-trigger')).toMatch(/border-color:\s*transparent/);
    // Its menu opens to the left, the right edge of the panel is near.
    expect(rule('.icon-select.align-end .icon-select-menu')).toMatch(/right:\s*0/);
  });

  it('lets the selects shrink in a narrow panel instead of overlapping', () => {
    // Without min-width 0 the model select keeps its full width and its
    // label runs over the reasoning switch.
    expect(rule('.composer-toolbar .icon-select')).toMatch(/min-width:\s*0/);
    expect(rule('.composer-toolbar-start')).toMatch(/flex:\s*1 1 auto/);
    // The icon never shrinks, the label takes the ellipsis.
    expect(rule('.composer-toolbar .icon-select-trigger .icon')).toMatch(/flex:\s*0 0 auto/);
  });

  it('puts the goal button into the bottom row of the field', () => {
    const markup = renderComposer(false);
    const toolbarAt = markup.indexOf('composer-toolbar-start');
    const goalAt = markup.indexOf('composer-goal');
    expect(goalAt).toBeGreaterThan(toolbarAt);
    expect(markup.indexOf('composer-toolbar-end')).toBeGreaterThan(goalAt);
    expect(markup).toContain('aria-label="' + STRINGS.goalModeOn + '"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it('turns the field into the field of the goal', () => {
    const markup = renderComposer(false, true);
    expect(markup).toContain('data-placeholder="' + STRINGS.goalPlaceholder + '"');
    expect(markup).toContain('composer-input-wrap goal-mode');
    expect(markup).toContain('aria-pressed="true"');
    // The frame of the field and the pressed button say the mode.
    expect(rule('.composer-input-wrap.goal-mode')).toMatch(/border-color:\s*var\(--accent\)/);
    expect(rule('.composer-goal.active')).toMatch(/color:\s*var\(--accent\)/);
  });

  it('shows the attempt while the connection is lost', () => {
    const markup = renderComposer(true, false, { attempt: 2, total: 5, delayMs: 2000 });
    expect(markup).toContain('composer-status');
    expect(markup).toContain(STRINGS.retryConnecting);
    // The reader knows how many attempts are left.
    expect(markup).toContain('2');
    expect(markup).toContain('5');
    // Without a lost connection the bar is not there.
    expect(renderComposer(true)).not.toContain('composer-status');
  });

  it('puts the queue over the field of the request', () => {
    const markup = renderComposer(true, false, undefined, [
      { id: 'q1', text: 'a message of the queue', state: 'waiting' }
    ]);
    const queueAt = markup.indexOf('queue-bar');
    const inputAt = markup.indexOf('composer-input-wrap');
    expect(queueAt).toBeGreaterThan(-1);
    // The queue stands over the field, the reader sees it at once.
    expect(queueAt).toBeLessThan(inputAt);
    expect(markup).toContain('a message of the queue');
  });

  it('keeps the send button while the agent works', () => {
    const markup = renderComposer(true);
    // The turn can be stopped and the next request can be written, it
    // waits in the queue.
    expect(markup).toContain('composer-send stop');
    expect(markup.match(/composer-send/g)?.length ?? 0).toBe(2);
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
