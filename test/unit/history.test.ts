import { describe, expect, it } from 'vitest';
import { balanceHistory, fitHistory, trimHistory } from '../../src/api/history';
import type { AnthropicMessage } from '../../src/api/types';

function userMessage(text: string): AnthropicMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

describe('trimHistory', () => {
  it('keeps the last messages', () => {
    const messages = [1, 2, 3, 4].map((n) => userMessage('m' + n));
    expect(trimHistory(messages, 2)).toHaveLength(2);
  });

  it('keeps a short history as it is', () => {
    const messages = [userMessage('a')];
    expect(trimHistory(messages, 10)).toHaveLength(1);
  });
});

describe('fitHistory', () => {
  const long = Array.from({ length: 6 }, () => userMessage('x'.repeat(400)));

  it('cuts the history when it does not fit into the window', () => {
    const kept = fitHistory(long, 100, 1000, 50);
    expect(kept.length).toBeLessThan(long.length);
  });

  it('keeps more of the history with a higher threshold', () => {
    const low = fitHistory(long, 100, 1000, 10);
    const high = fitHistory(long, 100, 1000, 90);
    expect(high.length).toBeGreaterThan(low.length);
  });

  it('keeps a history that fits the share of the window', () => {
    // 600k characters are about 150k tokens, that is 15% of a window of a
    // million. The share of 50% allows them, the budget is not divided by
    // four a second time.
    const big = Array.from({ length: 20 }, () => userMessage('x'.repeat(30_000)));
    expect(fitHistory(big, 1000, 1_000_000, 50)).toHaveLength(20);
  });

  it('cuts the history that overflows the share of the window', () => {
    // 750k tokens against a share of 50% of the same window.
    const huge = Array.from({ length: 25 }, () => userMessage('x'.repeat(120_000)));
    const kept = fitHistory(huge, 1000, 1_000_000, 50);
    expect(kept.length).toBeLessThan(huge.length);
    expect(kept.length).toBeGreaterThan(2);
  });

  it('respects the limit of the messages', () => {
    expect(fitHistory(long, 2, 1_000_000, 90)).toHaveLength(2);
  });

  it('keeps the same result as the default threshold', () => {
    const withDefault = fitHistory(long, 100, 1000);
    expect(withDefault).toEqual(fitHistory(long, 100, 1000, 50));
  });
});

describe('balanceHistory', () => {
  function call(id: string): AnthropicMessage {
    return {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'read_file', input: {} }]
    };
  }

  function result(id: string): AnthropicMessage {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'output' }]
    };
  }

  it('keeps a history that answers every call', () => {
    const messages = [userMessage('a'), call('t1'), result('t1')];
    expect(balanceHistory(messages)).toEqual(messages);
  });

  it('drops a call that nobody answered', () => {
    const messages: AnthropicMessage[] = [
      userMessage('a'),
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: {} }
        ]
      }
    ];
    const balanced = balanceHistory(messages);
    expect(balanced).toHaveLength(2);
    expect(balanced[1]?.content[0]?.type).toBe('thinking');
  });

  it('drops a result that answers nothing', () => {
    const balanced = balanceHistory([result('t1'), userMessage('b')]);
    expect(balanced).toHaveLength(1);
    expect(balanced[0]?.content[0]?.type).toBe('text');
  });

  it('keeps the text of a message whose result answers nothing', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'output' },
          { type: 'text', text: 'next question' }
        ]
      }
    ];
    const balanced = balanceHistory(messages);
    expect(balanced).toHaveLength(1);
    expect(balanced[0]?.content).toHaveLength(1);
    expect(balanced[0]?.content[0]?.type).toBe('text');
  });

  it('drops a message that is empty after the repair', () => {
    const balanced = balanceHistory([userMessage('a'), call('t1')]);
    expect(balanced).toHaveLength(1);
    expect(balanced[0]?.role).toBe('user');
  });
});
