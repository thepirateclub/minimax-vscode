import { describe, expect, it } from 'vitest';
import { appendNotice } from '../../src/ui/webview/notices';

describe('the notices of the panel', () => {
  it('adds a failure to the chat', () => {
    const messages = appendNotice([], 'Cannot open a.txt: the file does not exist.', 'n1');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('notice');
    expect(messages[0]?.text).toContain('the file does not exist');
  });

  it('keeps the same failure once', () => {
    const first = appendNotice([], 'Cannot open a.txt: the file does not exist.', 'n1');
    const second = appendNotice(first, 'Cannot open a.txt: the file does not exist.', 'n2');
    expect(second).toHaveLength(1);
  });

  it('shows another failure', () => {
    const first = appendNotice([], 'Cannot open a.txt: the file does not exist.', 'n1');
    const second = appendNotice(first, 'Cannot open b.txt: the file does not exist.', 'n2');
    expect(second).toHaveLength(2);
  });
});
