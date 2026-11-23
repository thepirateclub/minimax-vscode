import { describe, expect, it } from 'vitest';
import { AgentSession } from '../../src/agent/session';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';

function makeClient(): { client: MiniMaxClient; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const client: MiniMaxClient = {
    async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
      requests.push(request);
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        blocks: []
      };
    }
  };
  return { client, requests };
}

describe('the session of the agent', () => {
  it('gives the agent the options of the session', async () => {
    const { client, requests } = makeClient();
    const session = new AgentSession({
      client,
      registry: new ToolRegistry(),
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: 3,
      maxRetries: 4,
      effort: 'max',
      mode: 'code',
      systemPrompt: 'the prompt of the session',
      workspaceRoot: '/tmp/root',
      historyLimit: 50,
      contextThreshold: 50,
      autoApprove: [],
      logger: { info: () => undefined, error: () => undefined },
      onEvent: () => undefined,
      onApproval: () => undefined,
      contextProvider: async () => 'REPOSITORY: branch main'
    });
    await session.send('the question');
    const request = requests[0];
    expect(request?.model).toBe('MiniMax-M3.1-Flash');
    expect(request?.maxTokens).toBe(32000);
    expect(request?.effort).toBe('max');
    // The prompt of the session carries the state of the repository.
    expect(request?.system).toContain('the prompt of the session');
    expect(request?.system).toContain('REPOSITORY: branch main');
  });
});
