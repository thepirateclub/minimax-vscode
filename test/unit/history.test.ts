import { describe, expect, it } from 'vitest';
import { fitHistory, trimHistory } from '../../src/api/history';
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
  const short = Array.from({ length: 6 }, () => userMessage('x'.repeat(40)));

  it('cuts the history when it does not fit into the window', () => {
    const kept = fitHistory(long, 100, 1000, 50);
    expect(kept.length).toBeLessThan(long.length);
  });

  it('keeps more of the history with a higher threshold', () => {
    const low = fitHistory(short, 100, 1000, 10);
    const high = fitHistory(short, 100, 1000, 90);
    expect(high.length).toBeGreaterThan(low.length);
  });

  it('respects the limit of the messages', () => {
    expect(fitHistory(long, 2, 1_000_000, 90)).toHaveLength(2);
  });

  it('keeps the same result as the default threshold', () => {
    const withDefault = fitHistory(long, 100, 1000);
    expect(withDefault).toEqual(fitHistory(long, 100, 1000, 50));
  });
});
