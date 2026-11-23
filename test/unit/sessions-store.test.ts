import { describe, expect, it } from 'vitest';
import type { AnthropicMessage } from '../../src/api/types';
import { trimHistory } from '../../src/api/history';
import { MAX_STORED_DIFF_LINES, MAX_STORED_HISTORY, MAX_STORED_HISTORY_CHARS, MAX_STORED_MESSAGE_CHARS, MAX_STORED_MESSAGES, MAX_STORED_PROGRESS_CHARS, MAX_STORED_PROGRESS_LINES, MAX_STORED_SESSION_CHARS, MAX_STORED_TODOS, capSession } from '../../src/storage/sessions';
import type { UiMessage } from '../../src/ui/protocol';
import { userMessage, assistantMessage, uiMessage, session } from '../helpers/sessionsFixture';

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

  it('keeps the history the setting asks for', () => {
    const messages = Array.from({ length: 400 }, (_, index) =>
      index % 2 === 0 ? userMessage('q' + index) : assistantMessage('a' + index)
    );
    // The panel allows a thousand messages, the stored chat follows the
    // setting instead of the old bound of a hundred and twenty.
    const stored = capSession({ ...session('s', 1), messages }, 400);
    expect(stored.messages).toHaveLength(400);
  });

  it('cuts the stored history to the default when the setting says nothing', () => {
    const messages = Array.from({ length: MAX_STORED_HISTORY + 50 }, (_, index) =>
      index % 2 === 0 ? userMessage('q' + index) : assistantMessage('a' + index)
    );
    const stored = capSession({ ...session('s', 1), messages });
    expect(stored.messages).toHaveLength(MAX_STORED_HISTORY);
  });

  it('bounds the stored history by the characters', () => {
    const messages = Array.from({ length: 40 }, () => userMessage('x'.repeat(200_000)));
    const stored = capSession({ ...session('s', 1), messages }, 1000);
    const chars = stored.messages.reduce((sum, message) => {
      const block = message.content[0];
      return sum + (block?.type === 'text' ? block.text.length : 0);
    }, 0);
    expect(chars).toBeLessThanOrEqual(MAX_STORED_HISTORY_CHARS);
    expect(stored.messages.length).toBeLessThan(messages.length);
  });

  it('cuts a huge message', () => {
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [{ id: 'm', role: 'assistant', text: 'x'.repeat(300_000) }]
    });
    expect(stored.uiMessages[0]?.text?.length).toBe(200_000);
    // The reader has to know that the text is not whole.
    expect(stored.uiMessages[0]?.text).toContain('the message is cut');
  });

  it('keeps the head and the tail of a cut message', () => {
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [{ id: 'm', role: 'assistant', text: 'HEAD' + 'x'.repeat(300_000) + 'TAIL' }]
    });
    const text = stored.uiMessages[0]?.text ?? '';
    expect(text.startsWith('HEAD')).toBe(true);
    expect(text.endsWith('TAIL')).toBe(true);
  });

  it('cuts a chat that is too long as a whole', () => {
    // Every message is inside the bound per message, the chat as a whole
    // is not: the state of the host must not grow without a bound.
    const messages: UiMessage[] = Array.from({ length: 40 }, (_, index) => ({
      id: 'm' + index,
      role: 'assistant',
      text: 'y'.repeat(100_000)
    }));
    const stored = capSession({ ...session('s', 1), uiMessages: messages });
    const total = stored.uiMessages.reduce(
      (sum, message) => sum + (message.text?.length ?? 0),
      0
    );
    expect(total).toBeLessThanOrEqual(MAX_STORED_SESSION_CHARS);
    // The newest messages are the ones that survive.
    expect(stored.uiMessages.at(-1)?.id).toBe('m39');
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

  it('cuts a long journal of a sub-agent', () => {
    const lines = Array.from({ length: 1200 }, (_, index) => '+ line ' + index);
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [
        {
          id: 'm',
          role: 'tool',
          tool: {
            id: 'm',
            name: 'task',
            input: {},
            content: 'done',
            progress: lines
          }
        }
      ]
    });
    const progress = stored.uiMessages[0]?.tool?.progress ?? [];
    expect(progress.length).toBeLessThanOrEqual(MAX_STORED_PROGRESS_LINES + 1);
    // The marker stands in the middle of the journal.
    expect(progress[Math.floor(progress.length / 2)]).toBe(
      '... the journal is cut ...'
    );
    // The head and the tail of the journal survive.
    expect(progress[0]).toBe('+ line 0');
    expect(progress[progress.length - 1]).toBe('+ line 1199');
  });

  it('cuts a journal that is long in characters', () => {
    const lines = ['x'.repeat(150_000), 'y'.repeat(150_000)];
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [
        {
          id: 'm',
          role: 'tool',
          tool: {
            id: 'm',
            name: 'task',
            input: {},
            content: 'done',
            progress: lines
          }
        }
      ]
    });
    const progress = stored.uiMessages[0]?.tool?.progress ?? [];
    const total = progress.reduce((sum, line) => sum + line.length, 0);
    // The journal is bounded by the characters, the way the content of a
    // message is bounded.
    expect(MAX_STORED_PROGRESS_CHARS).toBe(MAX_STORED_MESSAGE_CHARS);
    expect(total).toBeLessThanOrEqual(MAX_STORED_MESSAGE_CHARS);
    expect(progress.some((line) => line.includes('the journal is cut'))).toBe(true);
  });

  it('cuts one very long line of the journal', () => {
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [
        {
          id: 'm',
          role: 'tool',
          tool: {
            id: 'm',
            name: 'task',
            input: {},
            content: 'done',
            progress: ['x'.repeat(300_000)]
          }
        }
      ]
    });
    const progress = stored.uiMessages[0]?.tool?.progress ?? [];
    const total = progress.reduce((sum, line) => sum + line.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_STORED_MESSAGE_CHARS);
    expect(progress.some((line) => line.includes('the journal is cut'))).toBe(true);
  });

  it('keeps a short journal of a sub-agent as it is', () => {
    const lines = ['read_file src/app.ts', 'search_code parser 3 matches'];
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [
        {
          id: 'm',
          role: 'tool',
          tool: {
            id: 'm',
            name: 'task',
            input: {},
            content: 'done',
            progress: lines
          }
        }
      ]
    });
    expect(stored.uiMessages[0]?.tool?.progress).toEqual(lines);
  });

  it('keeps a card without a journal as it is', () => {
    const stored = capSession({
      ...session('s', 1),
      uiMessages: [
        {
          id: 'm',
          role: 'tool',
          tool: { id: 'm', name: 'write_file', input: {}, content: 'done' }
        }
      ]
    });
    expect(stored.uiMessages[0]?.tool?.content).toBe('done');
    expect(stored.uiMessages[0]?.tool?.progress).toBeUndefined();
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

  it('keeps the goal of a session', () => {
    const capped = capSession({
      id: 's-1',
      title: 'chat',
      updatedAt: 1,
      messages: [],
      uiMessages: [],
      usage: [],
      goal: {
        objective: 'Rewrite the parser',
        tokenBudget: 12000,
        status: 'active',
        used: { tokens: 4300, requests: 2, seconds: 65 }
      }
    });
    expect(capped.goal?.objective).toBe('Rewrite the parser');
    expect(capped.goal?.used.tokens).toBe(4300);
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
