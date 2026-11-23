import type { AnthropicMessage } from '../../src/api/types';
import { type SessionStorage, type StoredSession } from '../../src/storage/sessions';
import type { UiMessage } from '../../src/ui/protocol';


export class FakeStorage implements SessionStorage {
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

export function userMessage(text: string): AnthropicMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

export function assistantMessage(text: string): AnthropicMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

export function uiMessage(index: number): UiMessage {
  return { id: 'm' + index, role: 'assistant', text: 'line ' + index };
}

export function session(id: string, updatedAt: number): StoredSession {
  return {
    id,
    title: id,
    updatedAt,
    messages: [userMessage('question')],
    uiMessages: [uiMessage(0)],
    usage: []
  };
}
