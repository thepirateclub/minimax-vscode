import { MAX_HISTORY_MESSAGES, trimHistory } from '../api/history';
import type { AnthropicMessage } from '../api/types';
import type { GoalState, TodoItem } from '../agent/state';
import type { TurnAnchor } from '../agent/turns';
import type { UiDiffLine, UiMessage, UiUsageTurn } from '../ui/protocol';

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: AnthropicMessage[];
  uiMessages: UiMessage[];
  usage: UiUsageTurn[];
  // The anchors of the requests, the chat rolls back to one of them.
  turns?: TurnAnchor[];
  // The list of tasks of the session, the model writes it.
  todos?: TodoItem[];
  // The goal of the session, the user sets it.
  goal?: GoalState;
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
export const MAX_STORED_USAGE_TURNS = 24;
export const MAX_STORED_TURNS = 50;
export const MAX_STORED_TODOS = 200;

function capText(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return text.length > MAX_STORED_MESSAGE_CHARS
    ? text.slice(text.length - MAX_STORED_MESSAGE_CHARS)
    : text;
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

// A long journal of a sub-agent would fill the state of the host, the
// middle of it is cut.
function capProgress(lines: string[]): string[] {
  if (lines.length <= MAX_STORED_PROGRESS_LINES) {
    return lines;
  }
  const half = Math.floor(MAX_STORED_PROGRESS_LINES / 2);
  return [
    ...lines.slice(0, half),
    '... the journal is cut ...',
    ...lines.slice(-half)
  ];
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

export function capSession(session: StoredSession): StoredSession {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messages: trimHistory(session.messages, MAX_STORED_HISTORY),
    uiMessages: session.uiMessages.slice(-MAX_STORED_MESSAGES).map(capMessage),
    usage: session.usage.slice(-MAX_STORED_USAGE_TURNS),
    turns: (session.turns ?? []).slice(-MAX_STORED_TURNS),
    todos: (session.todos ?? []).slice(-MAX_STORED_TODOS),
    goal: session.goal
  };
}

export class SessionStore {
  private static readonly KEY = 'minimax.sessions';
  private static readonly ACTIVE_KEY = 'minimax.activeSession';

  constructor(private readonly storage: SessionStorage) {}

  list(): StoredSession[] {
    return [...this.storage.get<StoredSession[]>(SessionStore.KEY, [])].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  get(id: string): StoredSession | undefined {
    return this.list().find((session) => session.id === id);
  }

  summaryList(): Array<{ id: string; title: string; updatedAt: number }> {
    return this.list().map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt
    }));
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

  // A write without a caller must not throw, the host can refuse it.
  private write(key: string, value: unknown): void {
    try {
      void Promise.resolve(this.storage.update(key, value)).catch(() => undefined);
    } catch {
      // The host refused the write, the chat stays in memory.
    }
  }
}
