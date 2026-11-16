import { MAX_HISTORY_MESSAGES, trimHistory } from '../api/history';
import type { AnthropicMessage } from '../api/types';
import type { GoalState, TodoItem } from '../agent/state';
import type { TurnAnchor } from '../agent/turns';
import type {
  QueuedMessage,
  UiDiffLine,
  UiMessage,
  UiSessionSummary,
  UiUsageTurn
} from '../ui/protocol';

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  // The project of the chat: the root of the workspace it belongs to. A chat
  // without a root is a chat of an older version, it is taken by the
  // project that opens it.
  workspaceRoot?: string;
  messages: AnthropicMessage[];
  uiMessages: UiMessage[];
  usage: UiUsageTurn[];
  // The anchors of the requests, the chat rolls back to one of them.
  turns?: TurnAnchor[];
  // The list of tasks of the session, the model writes it.
  todos?: TodoItem[];
  // The goal of the session, the user sets it.
  goal?: GoalState;
  // The queue of the messages of the chat, the reader wrote them while the
  // agent worked.
  queue?: QueuedMessage[];
}

// The state of the host. The type is structural, so the store stays testable
// without the editor.
export interface SessionStorage {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

// A long chat must not fill the state of the host, the oldest parts are cut.
export const MAX_STORED_SESSIONS = 50;
export const MAX_STORED_MESSAGES = 400;
export const MAX_STORED_HISTORY = MAX_HISTORY_MESSAGES;
export const MAX_STORED_MESSAGE_CHARS = 200_000;
export const MAX_STORED_DIFF_LINES = 600;
export const MAX_STORED_PROGRESS_LINES = 600;
// The journal is bounded by the characters too, the same way the content of
// a message is bounded.
export const MAX_STORED_PROGRESS_CHARS = MAX_STORED_MESSAGE_CHARS;
export const MAX_STORED_USAGE_TURNS = 24;
export const MAX_STORED_TURNS = 50;
export const MAX_STORED_TODOS = 200;
// The queue of a chat does not grow forever.
export const MAX_STORED_QUEUE = 30;
// The whole size of a chat is bounded too. A bound per message is not
// enough: a hundred messages of the bound each fill the state of the host,
// and the state of the host is written on every turn.
export const MAX_STORED_SESSION_CHARS = 2_000_000;

// The marker of the cut of a message. The reader has to know that the
// text is not whole, otherwise the answer looks like it ended there.
const MESSAGE_CUT = '... the message is cut ...';

// The text of a message is bounded by the characters. The head and the tail
// of the message survive, the marker stands in the middle of it.
function capText(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  if (text.length <= MAX_STORED_MESSAGE_CHARS) {
    return text;
  }
  const budget = MAX_STORED_MESSAGE_CHARS - MESSAGE_CUT.length;
  const half = Math.floor(budget / 2);
  return (
    text.slice(0, half) +
    MESSAGE_CUT +
    text.slice(text.length - (budget - half))
  );
}

// A long change would fill the state of the host, the middle of it is cut.
function capDiff(diff: { path: string; lines: UiDiffLine[] }): { path: string; lines: UiDiffLine[] } {
  if (diff.lines.length <= MAX_STORED_DIFF_LINES) {
    return diff;
  }
  const half = Math.floor(MAX_STORED_DIFF_LINES / 2);
  return {
    path: diff.path,
    lines: [
      ...diff.lines.slice(0, half),
      { type: 'context', text: '... the change is cut ...' },
      ...diff.lines.slice(-half)
    ]
  };
}

// The marker of the cut, it stands in the middle of the journal.
const PROGRESS_CUT = '... the journal is cut ...';

// A long journal of a sub-agent would fill the state of the host, the
// middle of it is cut. The bound of the lines and the bound of the
// characters hold it.
function capProgress(lines: string[]): string[] {
  return capProgressChars(capProgressLines(lines));
}

// The bound of the lines, the head and the tail of the journal survive.
function capProgressLines(lines: string[]): string[] {
  if (lines.length <= MAX_STORED_PROGRESS_LINES) {
    return lines;
  }
  const half = Math.floor(MAX_STORED_PROGRESS_LINES / 2);
  return [...lines.slice(0, half), PROGRESS_CUT, ...lines.slice(-half)];
}

// The bound of the characters. One very long line would fill the state of
// the host, the journal is cut the same way a change is cut: the first half,
// the marker, the last half.
function capProgressChars(lines: string[]): string[] {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  if (total <= MAX_STORED_PROGRESS_CHARS) {
    return lines;
  }
  const budget = Math.floor((MAX_STORED_PROGRESS_CHARS - PROGRESS_CUT.length) / 2);
  const head: string[] = [];
  let headChars = 0;
  for (const line of lines) {
    if (headChars + line.length > budget) {
      // The line is longer than its share, it is cut by itself.
      const room = budget - headChars;
      if (room > 0) {
        head.push(line.slice(0, room));
      }
      break;
    }
    head.push(line);
    headChars += line.length;
  }
  const tail: string[] = [];
  let tailChars = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    if (tailChars + line.length > budget) {
      const room = budget - tailChars;
      if (room > 0) {
        tail.unshift(line.slice(line.length - room));
      }
      break;
    }
    tail.unshift(line);
    tailChars += line.length;
  }
  return [...head, PROGRESS_CUT, ...tail];
}

function capMessage(message: UiMessage): UiMessage {
  return {
    ...message,
    text: capText(message.text),
    thinking: capText(message.thinking),
    tool: message.tool
      ? {
          ...message.tool,
          content: capText(message.tool.content),
          diff: message.tool.diff ? capDiff(message.tool.diff) : undefined,
          progress: message.tool.progress
            ? capProgress(message.tool.progress)
            : undefined
        }
      : undefined
  };
}

// The size of a message of the chat: the text of the answer, the text of
// the thinking and the result of the tool.
function messageChars(message: UiMessage): number {
  const tool = message.tool;
  return (
    (message.text?.length ?? 0) +
    (message.thinking?.length ?? 0) +
    (tool?.content?.length ?? 0) +
    (tool?.progress?.reduce((sum, line) => sum + line.length, 0) ?? 0)
  );
}

// The whole chat is bounded by the characters. The oldest messages go away
// first, the newest ones are the ones the reader needs.
function capSessionSize(messages: UiMessage[]): UiMessage[] {
  let total = 0;
  for (const message of messages) {
    total += messageChars(message);
  }
  if (total <= MAX_STORED_SESSION_CHARS) {
    return messages;
  }
  const kept: UiMessage[] = [];
  let size = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const chars = messageChars(message);
    if (size + chars > MAX_STORED_SESSION_CHARS && kept.length > 0) {
      break;
    }
    size += chars;
    kept.unshift(message);
  }
  return kept;
}

export function capSession(session: StoredSession): StoredSession {
  const uiMessages = capSessionSize(
    session.uiMessages.slice(-MAX_STORED_MESSAGES).map(capMessage)
  );
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    workspaceRoot: session.workspaceRoot,
    messages: trimHistory(session.messages, MAX_STORED_HISTORY),
    uiMessages,
    usage: session.usage.slice(-MAX_STORED_USAGE_TURNS),
    turns: (session.turns ?? []).slice(-MAX_STORED_TURNS),
    todos: (session.todos ?? []).slice(-MAX_STORED_TODOS),
    goal: session.goal,
    queue: (session.queue ?? []).slice(-MAX_STORED_QUEUE)
  };
}

// The name of the project: the last part of the path of its root.
export function projectLabel(root: string | undefined): string {
  if (!root) {
    return '';
  }
  const parts = root.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? root;
}

export class SessionStore {
  private static readonly KEY = 'minimax.sessions';
  private static readonly ACTIVE_KEY = 'minimax.activeSession';
  // The chat that was open in every project. The key of the map is the root
  // of the workspace.
  private static readonly ACTIVE_BY_ROOT_KEY = 'minimax.activeSessionsByRoot';

  constructor(private readonly storage: SessionStorage) {}

  list(): StoredSession[] {
    return [...this.storage.get<StoredSession[]>(SessionStore.KEY, [])].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  get(id: string): StoredSession | undefined {
    return this.list().find((session) => session.id === id);
  }

  summaryList(): UiSessionSummary[] {
    return this.list().map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      workspaceRoot: session.workspaceRoot,
      workspaceLabel: projectLabel(session.workspaceRoot)
    }));
  }

  // The chats of one project, the newest first.
  chatsOf(root: string): StoredSession[] {
    return this.list().filter((session) => session.workspaceRoot === root);
  }

  // The chats of an older version do not know their project. The project
  // that opens them takes them, otherwise the same chat would stand in the
  // list of every project. The list comes back, the write of the state of
  // the host is late, the caller must not wait for it.
  claimUnbound(root: string): StoredSession[] {
    const list = this.list();
    let changed = false;
    const next = list.map((session) => {
      if (session.workspaceRoot === undefined) {
        changed = true;
        return { ...session, workspaceRoot: root };
      }
      return session;
    });
    if (changed) {
      this.write(SessionStore.KEY, next);
    }
    return next;
  }

  // A write that fails must not break the turn, the chat stays in memory.
  async save(session: StoredSession): Promise<boolean> {
    const capped = capSession(session);
    const rest = this.list().filter((item) => item.id !== capped.id);
    const all = [capped, ...rest]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_STORED_SESSIONS);
    try {
      await this.storage.update(SessionStore.KEY, all);
      return true;
    } catch {
      return false;
    }
  }

  remove(id: string): void {
    this.write(
      SessionStore.KEY,
      this.list().filter((item) => item.id !== id)
    );
  }

  activeId(): string | undefined {
    return this.storage.get<string | undefined>(SessionStore.ACTIVE_KEY, undefined);
  }

  setActiveId(id: string | undefined): void {
    this.write(SessionStore.ACTIVE_KEY, id);
  }

  // The chat that was open in the project of the root.
  activeIdFor(root: string): string | undefined {
    const map = this.activeByRoot();
    const id = map[root];
    if (id) {
      return id;
    }
    // The chats of an older version keep one id for the whole state of the
    // host, the project that opens them takes it.
    const legacy = this.activeId();
    if (!legacy) {
      return undefined;
    }
    const session = this.get(legacy);
    return session && session.workspaceRoot === undefined ? legacy : undefined;
  }

  setActiveIdFor(root: string, id: string | undefined): void {
    const map = this.activeByRoot();
    if (id === undefined) {
      delete map[root];
    } else {
      map[root] = id;
    }
    this.write(SessionStore.ACTIVE_BY_ROOT_KEY, map);
    // The old key keeps the chat of the current project, an old version of
    // the extension reads it.
    this.write(SessionStore.ACTIVE_KEY, id);
  }

  // A deleted chat is not active in any project.
  clearActiveId(id: string): void {
    const map = this.activeByRoot();
    let changed = false;
    for (const [root, active] of Object.entries(map)) {
      if (active === id) {
        delete map[root];
        changed = true;
      }
    }
    if (changed) {
      this.write(SessionStore.ACTIVE_BY_ROOT_KEY, map);
    }
    if (this.activeId() === id) {
      this.write(SessionStore.ACTIVE_KEY, undefined);
    }
  }

  private activeByRoot(): Record<string, string> {
    return this.storage.get<Record<string, string>>(SessionStore.ACTIVE_BY_ROOT_KEY, {});
  }

  // A write without a caller must not throw, the host can refuse it.
  private write(key: string, value: unknown): void {
    try {
      void Promise.resolve(this.storage.update(key, value)).catch(() => undefined);
    } catch {
      // The host refused the write, the chat stays in memory.
    }
  }
}
