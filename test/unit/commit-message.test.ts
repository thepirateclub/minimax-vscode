import { describe, expect, it } from 'vitest';
import {
  buildCommitPrompt,
  cleanCommitMessage,
  generateCommitMessage
} from '../../src/agent/commitMessage';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';

function fakeClient(text: string, usage = { inputTokens: 120, outputTokens: 30 }): {
  client: MiniMaxClient;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  const client: MiniMaxClient = {
    stream: (request: ChatRequest) => {
      requests.push(request);
      const events: StreamEvent[] = [
        { type: 'text_delta', text },
        { type: 'message_stop', stopReason: 'end_turn', usage, blocks: [] }
      ];
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    }
  };
  return { client, requests };
}

describe('commit message', () => {
  it('shows the model the files and the diff', () => {
    const prompt = buildCommitPrompt({
      files: [{ path: 'src/app.ts', status: 'M' }],
      diff: '@@ -1 +1 @@\n-old\n+new',
      recentSubjects: ['feat: the search']
    });
    expect(prompt).toContain('M src/app.ts');
    expect(prompt).toContain('+new');
    expect(prompt).toContain('feat: the search');
  });

  it('keeps the conventional line of the answer', () => {
    expect(cleanCommitMessage('feat: the panel of the agent')).toBe(
      'feat: the panel of the agent'
    );
    expect(cleanCommitMessage('Here is the message:\nfix: the crash')).toBe(
      'fix: the crash'
    );
    expect(cleanCommitMessage('```\nfix: the crash\n```')).toBe('fix: the crash');
    expect(cleanCommitMessage('"feat: the panel"')).toBe('feat: the panel');
    expect(cleanCommitMessage('fix: the crash.')).toBe('fix: the crash');
  });

  it('asks the model without the tools', async () => {
    const { client, requests } = fakeClient('feat: the panel of the agent');
    const result = await generateCommitMessage({
      client,
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 4096,
      effort: 'low',
      context: {
        files: [{ path: 'src/app.ts', status: 'M' }],
        diff: '@@ -1 +1 @@\n+new',
        recentSubjects: []
      }
    });
    expect(result.message).toBe('feat: the panel of the agent');
    expect(result.usage.outputTokens).toBe(30);
    expect(requests[0]?.tools).toBeUndefined();
    expect(requests[0]?.system).toContain('Conventional Commits');
  });
});
