import * as vscode from 'vscode';
import type { AnthropicMessage } from '../api/types';
import type { UiMessage } from '../ui/protocol';

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: AnthropicMessage[];
  uiMessages: UiMessage[];
}

export class SessionStore {
  private static readonly KEY = 'minimax.sessions';

  constructor(private readonly storage: vscode.Memento) {}

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

  save(session: StoredSession): void {
    const rest = this.list().filter((item) => item.id !== session.id);
    this.storage.update(SessionStore.KEY, [session, ...rest]);
  }

  remove(id: string): void {
    this.storage.update(
      SessionStore.KEY,
      this.list().filter((item) => item.id !== id)
    );
  }
}
