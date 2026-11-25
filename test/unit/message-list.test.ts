import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageList } from '../../src/ui/webview/components/MessageList';
import type { UiMessage } from '../../src/ui/protocol';
import { readStyles } from '../helpers/styles';

const CSS = readStyles();

function render(messages: UiMessage[], olderMessages = 0): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      messages,
      olderMessages,
      onLoadOlder: () => undefined,
      collapseTools: false,
      collapseCode: false,
      showToolSteps: true,
      onApprove: () => undefined,
      onReject: () => undefined,
      onOpenFile: () => undefined,
      onRetry: () => undefined,
      onRewind: () => undefined,
      followEnd: false,
      onFollowEnd: () => undefined
    })
  );
}

describe('the older part of the chat', () => {
  it('offers the messages the host keeps', () => {
    const markup = render([{ id: 'a1', role: 'assistant', text: 'the answer' }], 42);
    expect(markup).toContain('Show earlier messages');
    expect(markup).toContain('(42)');
  });

  it('hides the button when the whole chat is on the panel', () => {
    const markup = render([{ id: 'a1', role: 'assistant', text: 'the answer' }]);
    expect(markup).not.toContain('Show earlier messages');
  });

  it('counts the messages the panel holds and does not draw yet', () => {
    const messages: UiMessage[] = [];
    for (let index = 0; index < 130; index++) {
      messages.push({ id: 'a' + index, role: 'assistant', text: 'the answer' });
    }
    const markup = render(messages);
    // The panel draws the last page of the chat, ten messages wait.
    expect(markup).toContain('(10)');
  });
});

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
  it('offers to repeat the request of the user when the turn failed', () => {
    const markup = render([
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'n1', role: 'notice', text: 'The request failed.', kind: 'error' }
    ]);
    expect(markup).toContain('message-retry');
    expect(markup).toContain('Repeat the request');
  });

  it('shows only one of the two buttons at a time', () => {
    const failed = render([
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'n1', role: 'notice', text: 'The request failed.', kind: 'error' }
    ]);
    // The request goes back, or it runs again, never both at once.
    expect(failed).toContain('Repeat the request');
    expect(failed).not.toContain('Go back to this point');
    const worked = render([
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'a1', role: 'assistant', text: 'the answer' }
    ]);
    expect(worked).toContain('Go back to this point');
    expect(worked).not.toContain('Repeat the request');
  });

  it('puts the button of the repeat where the arrow that goes back stands', () => {
    const markup = render([
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'n1', role: 'notice', text: 'The request failed.', kind: 'error' }
    ]);
    const row = markup.indexOf('user-row');
    const button = markup.indexOf('message-retry');
    const bubble = markup.indexOf('user-bubble');
    expect(row).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(row);
    expect(bubble).toBeGreaterThan(button);
  });

  it('keeps the button of the repeat away while the turn works', () => {
    const markup = render([
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'a1', role: 'assistant', text: 'the answer' }
    ]);
    expect(markup).not.toContain('Repeat the request');
  });

  it('offers to go back to the request of the user', () => {
    const markup = render([{ id: 'u1', role: 'user', text: 'the question' }]);
    expect(markup).toContain('Go back to this point');
  });

  it('puts the arrow that goes back on the left of the message', () => {
    const markup = render([{ id: 'u1', role: 'user', text: 'the question' }]);
    const row = markup.indexOf('user-row');
    const arrow = markup.indexOf('message-rewind');
    const bubble = markup.indexOf('user-bubble');
    expect(row).toBeGreaterThan(-1);
    expect(arrow).toBeGreaterThan(row);
    expect(bubble).toBeGreaterThan(arrow);
  });

  it('gives the buttons only to the messages of the user', () => {
    const markup = render([{ id: 'a1', role: 'assistant', text: 'the answer' }]);
    expect(markup).not.toContain('message-action');
    expect(markup).not.toContain('Go back to this point');
    expect(markup).not.toContain('Repeat the request');
  });

  it('shows the time of the step in the last message', () => {
    const markup = render([
      { id: 'a1', role: 'assistant', text: 'the answer', elapsedMs: 12500 }
    ]);
    expect(markup).toContain('12.5s');
  });

  it('has a rule for the classes of the actions', () => {
    expect(CSS).toMatch(/\.message-actions\s*\{/);
    expect(CSS).toMatch(/\.turn-plate\s*\{/);
    expect(CSS).toMatch(/\.turn-plate-stamp\s*\{/);
    expect(CSS).toMatch(/\.tool-stamp\s*,\s*\.message-time\s*\{/);
    expect(CSS).toMatch(/\.user-stack\s*\{/);
    expect(CSS).toMatch(/\.user-row\s*\{/);
    // The two buttons share one rule, they stand in a list.
    expect(CSS).toMatch(/\.message-rewind\s*,\s*\.message-retry\s*\{/);
    expect(CSS).toMatch(/\.message-rewind:hover\s*,\s*\.message-retry:hover\s*\{/);
  });

  // The reader finds when every action was done and how long the task ran.
  it('names the moments of the request, the actions and the end of the turn', () => {
    const at = new Date().setHours(9, 5, 0, 0);
    const markup = render([
      { id: 'u1', role: 'user', text: 'the question', at },
      { id: 't1', role: 'tool', tool: { id: 't1', name: 'git_status', input: {} }, at: at + 1000 },
      { id: 'a1', role: 'assistant', text: 'done', at: at + 2000, elapsedMs: 135_000, endedAt: at + 135_000 }
    ]);
    expect(markup).toContain('message-time');
    expect(markup).toContain('09:05');
    expect(markup).toContain('turn-plate');
    expect(markup).toContain('Done in 2m 15s');
    expect(markup).toContain('09:07');
  });

  it('keeps the kinds of the notices apart', () => {
    expect(CSS).toMatch(/\.message-notice\.notice-info\s*\{/);
    expect(CSS).toMatch(/\.message-notice\.notice-warn\s*\{/);
  });
});
