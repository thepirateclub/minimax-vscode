import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageList } from '../../src/ui/webview/components/MessageList';
import type { UiMessage } from '../../src/ui/protocol';

function render(messages: UiMessage[]): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      messages,
      collapseTools: false,
      collapseCode: false,
      onApprove: () => undefined,
      onReject: () => undefined,
      onOpenFile: () => undefined
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
});
