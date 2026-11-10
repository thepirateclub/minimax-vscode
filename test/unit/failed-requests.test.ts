import { describe, expect, it } from 'vitest';
import { failedRequests } from '../../src/ui/webview/failedRequests';
import type { UiMessage } from '../../src/ui/protocol';

describe('failedRequests', () => {
  it('finds nothing in a clean chat', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'a1', role: 'assistant', text: 'the answer' }
    ];
    expect(failedRequests(messages).size).toBe(0);
  });

  it('marks the request that failed with a notice', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'n1', role: 'notice', text: 'The request failed.', kind: 'error' }
    ];
    expect([...failedRequests(messages)]).toEqual(['u1']);
  });

  it('marks the request when an action failed', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'the question' },
      {
        id: 't1',
        role: 'tool',
        tool: {
          id: 't1',
          name: 'read_file',
          input: {},
          content: 'the file does not exist',
          isError: true
        }
      }
    ];
    expect([...failedRequests(messages)]).toEqual(['u1']);
  });

  it('keeps a note and a warning away from the failure', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'n1', role: 'notice', text: 'The request was stopped.', kind: 'info' },
      { id: 'n2', role: 'notice', text: 'The agent is busy.', kind: 'warn' }
    ];
    expect(failedRequests(messages).size).toBe(0);
  });

  it('does not mark the next request', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'the question' },
      { id: 'n1', role: 'notice', text: 'The request failed.', kind: 'error' },
      { id: 'u2', role: 'user', text: 'the next question' },
      { id: 'a2', role: 'assistant', text: 'the answer' }
    ];
    const failed = failedRequests(messages);
    expect(failed.has('u1')).toBe(true);
    expect(failed.has('u2')).toBe(false);
  });
});
