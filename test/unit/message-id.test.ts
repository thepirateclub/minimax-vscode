import { describe, expect, it } from 'vitest';
import { messageId } from '../../src/ui/webview/messageId';

describe('the ids of the rows of the panel', () => {
  it('tells two rows of one millisecond apart', () => {
    const first = messageId('notice');
    const second = messageId('notice');
    expect(first.startsWith('notice-')).toBe(true);
    expect(second.startsWith('notice-')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('keeps the prefix of the row', () => {
    expect(messageId('error')).toMatch(/^error-/);
    expect(messageId('assistant')).toMatch(/^assistant-/);
  });
});
