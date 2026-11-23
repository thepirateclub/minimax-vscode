import type { UiSessionSummary } from '../protocol';

// The chats of the project are shown by default. The chats of the other
// projects stay in the list, they are not deleted: the reader opens them
// with the switch of every chat. A chat of an older version does not know
// its project, it belongs to the project of the panel.
export function visibleSessions(
  sessions: UiSessionSummary[],
  workspaceRoot: string,
  all: boolean
): UiSessionSummary[] {
  if (all) {
    return sessions;
  }
  return sessions.filter(
    (session) => !session.workspaceRoot || session.workspaceRoot === workspaceRoot
  );
}
