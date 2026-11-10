import { describe, expect, it } from 'vitest';
import { findRequestIndex, turnOfMessage } from '../../src/agent/turns';
import type { AnthropicMessage } from '../../src/api/types';
import type { UiMessage } from '../../src/ui/protocol';

const history: AnthropicMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'first question' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'the first answer' }] },
  { role: 'user', content: [{ type: 'text', text: 'second question' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'the second answer' }] }
];

describe('the anchors of the requests', () => {
  it('finds the request in the history', () => {
    expect(findRequestIndex(history, 'second question')).toBe(2);
    expect(findRequestIndex(history, 'first question')).toBe(0);
  });

  it('does not find a request that is not there', () => {
    expect(findRequestIndex(history, 'third question')).toBe(-1);
  });

  it('trusts the place of the turn when it still holds', () => {
    expect(findRequestIndex(history, 'second question', 2)).toBe(2);
    // The history lost the old messages, the place of the turn moved.
    expect(findRequestIndex(history, 'second question', 0)).toBe(2);
  });

  it('takes the request that stands before a message', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'first question' },
      { id: 'a1', role: 'assistant', text: 'the first answer' },
      { id: 'u2', role: 'user', text: 'second question' }
    ];
    const turns = [
      { uiId: 'u1', text: 'first question', historyIndex: 0, mentions: [], selections: [] },
      { uiId: 'u2', text: 'second question', historyIndex: 2, mentions: [], selections: [] }
    ];
    expect(turnOfMessage(turns, messages, 'u1')?.text).toBe('first question');
    expect(turnOfMessage(turns, messages, 'a1')?.text).toBe('first question');
    expect(turnOfMessage(turns, messages, 'u2')?.text).toBe('second question');
  });

  it('knows nothing about a message that is not in the chat', () => {
    expect(turnOfMessage([], [], 'u1')).toBeUndefined();
  });
});
