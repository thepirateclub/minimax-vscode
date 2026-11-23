import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { QueueBar } from '../../src/ui/webview/components/QueueBar';
import { STRINGS } from '../../src/ui/webview/strings';
import type { UiQueuedMessage } from '../../src/ui/protocol';

const noop = (): void => undefined;

function render(items: UiQueuedMessage[]): string {
  return renderToStaticMarkup(
    createElement(QueueBar, {
      items,
      onSend: noop,
      onSendAll: noop,
      onRemove: noop
    }) as ReactElement
  );
}

describe('the queue of the chat', () => {
  it('shows nothing when the queue is empty', () => {
    expect(render([])).toBe('');
  });

  it('shows every message with its state', () => {
    const markup = render([
      { id: 'q1', text: 'the first message', state: 'waiting' },
      { id: 'q2', text: 'the second message', state: 'sending' },
      { id: 'q3', text: 'the third message', state: 'done' },
      { id: 'q4', text: 'the fourth message', state: 'error', error: 'the server is down' }
    ]);
    expect(markup).toContain('queue-waiting');
    expect(markup).toContain('queue-sending');
    expect(markup).toContain('queue-done');
    expect(markup).toContain('queue-error');
    expect(markup).toContain('the first message');
    // The button that sends everything.
    expect(markup).toContain(STRINGS.queueSendAll);
  });

  it('does not let a message that goes out be removed', () => {
    const markup = render([{ id: 'q1', text: 'the message', state: 'sending' }]);
    expect(markup).toContain('disabled');
  });

  it('lets the reader remove a message that waits', () => {
    const markup = render([{ id: 'q1', text: 'the message', state: 'waiting' }]);
    expect(markup).not.toContain('disabled');
    expect(markup).toContain(STRINGS.queueRemove);
  });
});
