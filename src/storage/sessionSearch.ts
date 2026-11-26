import type { UiMessage } from '../ui/protocol';

// The search of the saved chats: every word of the query must stand in the
// title or in the text of the chat, the case does not count. The snippet
// shows the place of the first word in the text, the reader sees why the
// chat was found.
export interface SessionHit {
  id: string;
  snippet?: string;
}

const MAX_HITS = 50;
const SNIPPET_SIDE = 40;

export function searchSessions(
  sessions: ReadonlyArray<{ id: string; title: string; uiMessages: readonly UiMessage[] }>,
  query: string
): SessionHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }
  const hits: SessionHit[] = [];
  for (const session of sessions) {
    const title = session.title.toLowerCase();
    const texts = session.uiMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => message.text ?? '')
      .filter((text) => text.length > 0);
    const lower = texts.map((text) => text.toLowerCase());
    if (!words.every((word) => title.includes(word) || lower.some((text) => text.includes(word)))) {
      continue;
    }
    hits.push({ id: session.id, ...snippetOf(texts, lower, words) });
    if (hits.length >= MAX_HITS) {
      break;
    }
  }
  return hits;
}

function snippetOf(texts: string[], lower: string[], words: string[]): { snippet?: string } {
  for (const word of words) {
    for (let i = 0; i < texts.length; i++) {
      const at = lower[i]!.indexOf(word);
      if (at === -1) {
        continue;
      }
      const start = Math.max(0, at - SNIPPET_SIDE);
      const end = Math.min(texts[i]!.length, at + word.length + SNIPPET_SIDE);
      const body = texts[i]!.slice(start, end).replace(/\s+/g, ' ').trim();
      return { snippet: (start > 0 ? '…' : '') + body + (end < texts[i]!.length ? '…' : '') };
    }
  }
  return {};
}
