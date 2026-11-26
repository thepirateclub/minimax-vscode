import type { UiSessionSummary } from '../protocol';

export interface SessionSearch {
  query: string;
  hits: Array<{ id: string; snippet?: string }>;
}

export interface FoundSession {
  session: UiSessionSummary;
  snippet?: string;
}

// The list of the menu for the query of the reader. The titles are known to
// the panel and filter at once; the text of the chats lives in the host, its
// answer adds the chats found by the text with a snippet. An answer to an
// older query is not used: the reader has typed on since.
export function filterSessions(
  sessions: readonly UiSessionSummary[],
  query: string,
  search: SessionSearch | undefined
): FoundSession[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return sessions.map((session) => ({ session }));
  }
  const hits = search && search.query === query ? new Map(search.hits.map((hit) => [hit.id, hit.snippet])) : undefined;
  const found: FoundSession[] = [];
  for (const session of sessions) {
    const title = session.title.toLowerCase();
    const byTitle = words.every((word) => title.includes(word));
    if (hits?.has(session.id)) {
      const snippet = hits.get(session.id);
      found.push(byTitle || snippet === undefined ? { session } : { session, snippet });
    } else if (byTitle) {
      found.push({ session });
    }
  }
  return found;
}
