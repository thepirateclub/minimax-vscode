import { describe, expect, it } from 'vitest';
import {
  HISTORY_CHARS,
  HISTORY_PAGE,
  historyPage,
  historyTail
} from '../../src/ui/historyPage';
import type { UiMessage } from '../../src/ui/protocol';

function chat(count: number, size = 0): UiMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 'm' + index,
    role: 'assistant',
    text: 'x'.repeat(size)
  }));
}

describe('the history of the panel', () => {
  it('gives the tail of the chat to the panel', () => {
    const tail = historyTail(chat(500));
    expect(tail.messages).toHaveLength(HISTORY_PAGE);
    expect(tail.offset).toBe(500 - HISTORY_PAGE);
    expect(tail.messages.at(-1)?.id).toBe('m499');
  });

  it('keeps the whole chat when it is short', () => {
    const tail = historyTail(chat(10));
    expect(tail.messages).toHaveLength(10);
    expect(tail.offset).toBe(0);
  });

  it('gives the older part of the chat on demand', () => {
    const page = historyPage(chat(500), 380);
    expect(page.messages).toHaveLength(HISTORY_PAGE);
    expect(page.offset).toBe(260);
    expect(page.messages[0]?.id).toBe('m260');
  });

  it('gives the older part of the chat in pages', () => {
    const chat500 = chat(500);
    const first = historyPage(chat500, 260);
    expect(first.messages).toHaveLength(HISTORY_PAGE);
    expect(first.offset).toBe(140);
    const second = historyPage(chat500, first.offset);
    expect(second.messages).toHaveLength(HISTORY_PAGE);
    expect(second.offset).toBe(20);
    const third = historyPage(chat500, second.offset);
    expect(third.messages).toHaveLength(20);
    expect(third.offset).toBe(0);
    // The older part is over, there is nothing left to ask for.
    const again = historyPage(chat500, third.offset);
    expect(again.messages).toHaveLength(0);
    expect(again.offset).toBe(0);
  });

  it('cuts the volume of one message', () => {
    const tail = historyTail(chat(10, 100_000));
    // The bound of the characters holds the message, four of them fit:
    // the fifth one would make it bigger than the bound.
    expect(tail.messages).toHaveLength(4);
    expect(tail.offset).toBe(6);
    expect(tail.messages[0]?.id).toBe('m6');
  });

  it('keeps the newest message even when it is too big on its own', () => {
    const tail = historyTail(chat(1, HISTORY_CHARS * 2));
    expect(tail.messages).toHaveLength(1);
    expect(tail.offset).toBe(0);
  });

  it('counts the result of a tool in the size of a message', () => {
    const list: UiMessage[] = [
      { id: 't1', role: 'tool', tool: { id: 't1', name: 'read', input: {}, content: 'x'.repeat(100_000) } },
      { id: 't2', role: 'tool', tool: { id: 't2', name: 'read', input: {}, content: 'x'.repeat(100_000) } },
      { id: 't3', role: 'tool', tool: { id: 't3', name: 'read', input: {}, content: 'x'.repeat(100_000) } }
    ];
    const tail = historyTail(list);
    expect(tail.messages).toHaveLength(3);
    expect(tail.offset).toBe(0);
  });
});
