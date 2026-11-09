import { describe, expect, it } from 'vitest';
import {
  BOTTOM_GAP,
  contentChanged,
  isAtBottom,
  measure,
  shouldFollow
} from '../../src/ui/webview/listScroll';

describe('scroll of the message list', () => {
  it('treats a short gap as the bottom', () => {
    expect(BOTTOM_GAP).toBe(80);
    expect(isAtBottom(1000, 900, 100)).toBe(true);
    expect(isAtBottom(1000, 830, 100)).toBe(true);
    expect(isAtBottom(1000, 800, 100)).toBe(false);
  });

  it('follows the answer while the text of the last message grows', () => {
    const previous = measure([{ text: 'hello' }]);
    const next = measure([{ text: 'hello world' }]);
    expect(contentChanged(previous, next)).toBe(true);
    expect(shouldFollow(previous, next, true)).toBe(true);
  });

  it('keeps the place when the reader scrolled up', () => {
    const previous = measure([{ text: 'a' }]);
    const next = measure([{ text: 'ab' }]);
    expect(shouldFollow(previous, next, false)).toBe(false);
  });

  it('does not move when nothing changed', () => {
    const state = measure([{ text: 'same' }]);
    expect(contentChanged(state, state)).toBe(false);
    expect(shouldFollow(state, state, true)).toBe(false);
  });

  it('counts the growth of a tool output', () => {
    const previous = measure([{ tool: { content: 'a' } }]);
    const next = measure([{ tool: { content: 'ab' } }]);
    expect(contentChanged(previous, next)).toBe(true);
  });

  it('counts a new message', () => {
    const previous = measure([{ text: 'a' }]);
    const next = measure([{ text: 'a' }, { text: 'b' }]);
    expect(contentChanged(previous, next)).toBe(true);
    expect(shouldFollow(previous, next, true)).toBe(true);
  });
});
