import { describe, expect, it } from 'vitest';
import { searchSessions } from '../../src/storage/sessionSearch';
import { filterSessions } from '../../src/ui/webview/sessionFilter';
import type { UiMessage, UiSessionSummary } from '../../src/ui/protocol';

const chat = (id: string, title: string, ...texts: string[]) => ({
  id,
  title,
  uiMessages: texts.map((text, index): UiMessage => ({ id: id + index, role: index % 2 ? 'assistant' : 'user', text }))
});

describe('the search of the saved chats', () => {
  const chats = [
    chat('a', 'Fix the parser', 'the SSE parser drops the last event', 'Fixed in parser.ts'),
    chat('b', 'Voice input', 'the microphone of PreSonus is not found'),
    chat('c', 'Release', 'bump the version')
  ];

  it('finds every word in the title or the text, the case does not count', () => {
    expect(searchSessions(chats, 'presonus').map((hit) => hit.id)).toEqual(['b']);
    expect(searchSessions(chats, 'parser event').map((hit) => hit.id)).toEqual(['a']);
    expect(searchSessions(chats, 'parser microphone')).toEqual([]);
    expect(searchSessions(chats, '   ')).toEqual([]);
  });

  it('shows the place of the word in the text', () => {
    expect(searchSessions(chats, 'microphone')[0]!.snippet).toBe('the microphone of PreSonus is not found');
  });
});

describe('the list of the menu for a query', () => {
  const list: UiSessionSummary[] = [
    { id: 'a', title: 'Fix the parser', updatedAt: 1 },
    { id: 'b', title: 'Voice input', updatedAt: 2 }
  ];

  it('filters the titles at once and adds the text hits of the same query', () => {
    expect(filterSessions(list, '', undefined).map((found) => found.session.id)).toEqual(['a', 'b']);
    expect(filterSessions(list, 'voice', undefined).map((found) => found.session.id)).toEqual(['b']);
    const search = { query: 'presonus', hits: [{ id: 'b', snippet: 'PreSonus mic' }] };
    expect(filterSessions(list, 'presonus', search)).toEqual([{ session: list[1], snippet: 'PreSonus mic' }]);
    // The answer to an older query is not used.
    expect(filterSessions(list, 'presonu', search)).toEqual([]);
  });
});
