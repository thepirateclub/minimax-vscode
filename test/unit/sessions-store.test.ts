import { describe, expect, it } from 'vitest';
import type { AnthropicMessage } from '../../src/api/types';
import { trimHistory } from '../../src/api/history';
import {
  MAX_STORED_DIFF_LINES,
  MAX_STORED_MESSAGES,
  MAX_STORED_SESSIONS,
  MAX_STORED_TODOS,
  SessionStore,
  capSession,
  type SessionStorage,
  type StoredSession
} from '../../src/storage/sessions';
import type { UiMessage } from '../../src/ui/protocol';

class FakeStorage implements SessionStorage {
  readonly data = new Map<string, unknown>();
  failNextWrite = false;

  get<T>(key: string, defaultValue: T): T {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('the state of the host is full');
    }
    this.data.set(key, value);
  }
}

function userMessage(text: string): AnthropicMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function assistantMessage(text: string): AnthropicMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

function uiMessage(index: number): UiMessage {
  return { id: 'm' + index, role: 'assistant', text: 'line ' + index };
}

function session(id: string, updatedAt: number): StoredSession {
  return {
    id,
    title: id,
    updatedAt,
    messages: [userMessage('question')],
    uiMessages: [uiMessage(0)],
    usage: []
  };
}

describe('trimHistory', () => {
  it('keeps a short history as it is', () => {
    const messages = [userMessage('a'), assistantMessage('b')];
    expect(trimHistory(messages, 10)).toHaveLength(2);
  });

  it('cuts the oldest messages', () => {
    const messages = [userMessage('a'), assistantMessage('b'), userMessage('c')];
    expect(trimHistory(messages, 2)).toHaveLength(2);
  });

  it('drops a leading tool result whose tool call was cut away', () => {
    const messages: AnthropicMessage[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'body' }] },
      userMessage('next question')
    ];
    const kept = trimHistory(messages, 2);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.role).toBe('user');
    expect(kept[0]?.content[0]?.type).toBe('text');
  });

  it('drops a leading tool call whose result was cut away', () => {
    const messages: AnthropicMessage[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] },
      userMessage('next question')
    ];
    const kept = trimHistory(messages, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.role).toBe('user');
  });
});

describe('capSession', () => {
  it('keeps the last messages of a long chat', () => {
    const stored = capSession({
      ...session('s', 1),
      uiMessages: Array.from({ length: MAX_STORED_MESSAGES + 50 }, (_, index) => uiMessage(index))
    });
    expect(stored.uiMessages).toHaveLength(MAX_STORED_MESSAGES);
    expect(stored.uiMessages[0]?.text).toBe('line 50');
  });

  it('cuts a huge message', () => {
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [{ id: 'm', role: 'assistant', text: 'x'.repeat(300_000) }]
    });
    expect(stored.uiMessages[0]?.text?.length).toBe(200_000);
  });

  it('cuts a long change of a file', () => {
    const lines = Array.from({ length: 1200 }, (_, index) => ({
      type: 'add' as const,
      newLine: index + 1,
      text: 'line ' + index
    }));
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [
        {
          id: 'm',
          role: 'tool',
          tool: {
            id: 'm',
            name: 'write_file',
            input: {},
            diff: { path: 'note.txt', lines }
          }
        }
      ]
    });
    const diff = stored.uiMessages[0]?.tool?.diff;
    expect(diff?.lines.length).toBeLessThanOrEqual(MAX_STORED_DIFF_LINES + 1);
    expect(diff?.lines.some((line) => line.text.includes('cut'))).toBe(true);
  });

  it('keeps the list of tasks of a session', () => {
    const capped = capSession({
      id: 's-1',
      title: 'chat',
      updatedAt: 1,
      messages: [],
      uiMessages: [],
      usage: [],
      todos: [{ content: 'Read the parser', status: 'pending', priority: 'high' }]
    });
    expect(capped.todos).toEqual([
      { content: 'Read the parser', status: 'pending', priority: 'high' }
    ]);
  });

  it('cuts a list of tasks that is too long', () => {
    const todos = Array.from({ length: MAX_STORED_TODOS + 10 }, (_, index) => ({
      content: 'task ' + index,
      status: 'pending' as const,
      priority: 'medium' as const
    }));
    const capped = capSession({
      id: 's-1',
      title: 'chat',
      updatedAt: 1,
      messages: [],
      uiMessages: [],
      usage: [],
      todos
    });
    expect(capped.todos).toHaveLength(MAX_STORED_TODOS);
  });
});

describe('SessionStore', () => {
  it('saves a session and reads it back', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save(session('s1', 10));
    expect(store.get('s1')?.title).toBe('s1');
    expect(store.summaryList()).toHaveLength(1);
  });

  it('keeps at most fifty sessions', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    for (let i = 0; i < MAX_STORED_SESSIONS + 10; i++) {
      await store.save(session('s' + i, i));
    }
    expect(store.list()).toHaveLength(MAX_STORED_SESSIONS);
    expect(store.get('s0')).toBeUndefined();
  });

  it('survives a failing state of the host', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    storage.failNextWrite = true;
    const saved = await store.save(session('s1', 10));
    expect(saved).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  it('remembers the active session', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    store.setActiveId('s1');
    expect(store.activeId()).toBe('s1');
    store.setActiveId(undefined);
    expect(store.activeId()).toBeUndefined();
  });
});
