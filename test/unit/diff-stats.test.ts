import { describe, expect, it } from 'vitest';
import { diffStats } from '../../src/ui/webview/diffStats';
import type { UiDiffLine } from '../../src/ui/protocol';

function line(type: UiDiffLine['type'], text: string): UiDiffLine {
  return { type, text };
}

describe('the size of a change', () => {
  it('counts the added and the removed lines', () => {
    const stats = diffStats([
      line('context', 'keep'),
      line('remove', 'old'),
      line('add', 'new'),
      line('add', 'more')
    ]);
    expect(stats.added).toBe(2);
    expect(stats.removed).toBe(1);
  });

  it('counts nothing in an empty change', () => {
    expect(diffStats([])).toEqual({ added: 0, removed: 0 });
  });

  it('ignores the context lines', () => {
    const stats = diffStats([line('context', 'a'), line('context', 'b')]);
    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(0);
  });
});
