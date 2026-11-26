import type { AnthropicMessage } from '../api/types';
import type { GoalState, TodoItem } from '../agent/state';
import type { TurnAnchor } from '../agent/turns';
import type {
  QueuedMessage,
  UiMessage,
  UiSessionSummary,
  UiUsageTurn
} from '../ui/protocol';
import { capSession, MAX_STORED_SESSIONS } from './caps';

export * from './caps';

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  // The project of the chat: the root of the workspace it belongs to. A chat
  // without a root is a chat of an older version, it is taken by the
  // project that opens it.
  workspaceRoot?: string;
  messages: AnthropicMessage[];
  // The digest of the old turns the cut of the history threw away.
  digest?: string;
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
  // list of every project. The list comes back, the write of the state of the
  // host is late, the caller must not wait for it.
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
  async save(session: StoredSession, historyLimit?: number): Promise<boolean> {
    const capped = capSession(session, historyLimit);
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
