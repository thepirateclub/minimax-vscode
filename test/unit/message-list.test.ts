import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageList } from '../../src/ui/webview/components/MessageList';
import type { UiMessage } from '../../src/ui/protocol';

const CSS = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
);

function render(messages: UiMessage[]): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      messages,
      collapseTools: false,
      collapseCode: false,
      onApprove: () => undefined,
      onReject: () => undefined,
      onOpenFile: () => undefined,
      onRewind: () => undefined
    })
  );
}

describe('the notices of the panel', () => {
  it('shows a failure as a notice and not as the answer of the model', () => {
    const markup = render([
      {
        id: 'notice-1',
        role: 'notice',
        text: 'Cannot open demo-diff.txt: the file does not exist.'
      }
    ]);
    expect(markup).toContain('message-notice');
    expect(markup).toContain('the file does not exist');
    expect(markup).not.toContain('assistant-body');
  });

  it('has a rule for the class of the notice', () => {
    const markup = render([
      {
        id: 'notice-1',
        role: 'notice',
        text: 'Cannot open demo-diff.txt: the file does not exist.'
      }
    ]);
    // A class without a rule is a dead end, the bar has to be painted.
    expect(markup).not.toContain('notice-text');
    expect(CSS).toMatch(/\.message-notice\s*\{[^}]*border-left/);
  });
});

describe('the actions of a message', () => {
  it('offers to repeat the request of the user', () => {
    const markup = render([{ id: 'u1', role: 'user', text: 'the question' }]);
    expect(markup).toContain('message-actions');
    expect(markup).toContain('message-action');
    expect(markup).toContain('Repeat the request');
  });

  it('offers to go back to the answer of the model', () => {
    const markup = render([{ id: 'a1', role: 'assistant', text: 'the answer' }]);
    expect(markup).toContain('Go back to this point');
  });

  it('shows the time of the step in the last message', () => {
    const markup = render([
      { id: 'a1', role: 'assistant', text: 'the answer', elapsedMs: 12500 }
    ]);
    expect(markup).toContain('12.5s');
  });

  it('has a rule for the classes of the actions', () => {
    expect(CSS).toMatch(/\.message-actions\s*\{/);
    expect(CSS).toMatch(/\.message-action\s*\{/);
    expect(CSS).toMatch(/\.message-elapsed\s*\{/);
  });

  it('keeps the kinds of the notices apart', () => {
    expect(CSS).toMatch(/\.message-notice\.notice-info\s*\{/);
    expect(CSS).toMatch(/\.message-notice\.notice-warn\s*\{/);
  });
});
