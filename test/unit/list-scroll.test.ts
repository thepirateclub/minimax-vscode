import { describe, expect, it } from 'vitest';
import {
  BOTTOM_GAP,
  contentChanged,
  feedAction,
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

describe('the repeat of the request', () => {
  it('puts the feed at the end of the history', () => {
    // The reader scrolled up and pressed the repeat: the feed shows the
    // end of the history and follows the new turn.
    const previous = measure([{ id: 'u1', text: 'the request' }]);
    const next = measure([
      { id: 'u1', text: 'the request' },
      { id: 'a1', text: 'the answer' }
    ]);
    expect(feedAction(previous, next, false, true)).toBe('bottom');
  });

  it('puts the feed at the end even when the reader was there', () => {
    const previous = measure([{ id: 'u1', text: 'the request' }]);
    const next = measure([
      { id: 'u1', text: 'the request' },
      { id: 'a1', text: 'the answer' }
    ]);
    expect(feedAction(previous, next, true, true)).toBe('bottom');
  });

  it('sees the history that was replaced by another one of the same size', () => {
    const previous = measure([{ id: 'u1', text: 'the request' }]);
    const next = measure([{ id: 'u2', text: 'the request' }]);
    // The count and the length of the text are the same, only the ids of
    // the messages differ: the history was replaced.
    expect(contentChanged(previous, next)).toBe(true);
    expect(feedAction(previous, next, false, true)).toBe('bottom');
  });

  it('keeps the place of the reader while the content grows above him', () => {
    const previous = measure([{ id: 'u1', text: 'a' }]);
    const next = measure([{ id: 'u1', text: 'ab' }]);
    expect(feedAction(previous, next, false, false)).toBe('pending');
    expect(feedAction(previous, next, true, false)).toBe('bottom');
  });

  it('does not move the feed when nothing changed', () => {
    const state = measure([{ id: 'u1', text: 'the request' }]);
    expect(feedAction(state, state, true, false)).toBe('keep');
  });
});
