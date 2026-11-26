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

  it('a stop while the prompt is built ends the turn before the request', async () => {
    const { client, requests } = makeClient();
    const events: Array<{ type: string; message?: string }> = [];
    let session: AgentSession | undefined;
    let stops = 1;
    session = new AgentSession({
      client,
      registry: new ToolRegistry(),
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 1000,
      maxIterations: 3,
      historyLimit: 50,
      contextThreshold: 50,
      mode: 'code',
      systemPrompt: 'p',
      workspaceRoot: '/tmp/root',
      autoApprove: [],
      logger: { info: () => undefined, error: () => undefined },
      onEvent: (event) => events.push(event as { type: string; message?: string }),
      onApproval: () => undefined,
      // The reader presses Stop while the context of the turn is read.
      contextProvider: async () => {
        if (stops-- > 0) {
          session?.stop();
        }
        return '';
      }
    });
    const signal = session.beginTurn();
    expect(await session.send('q')).toBe(-1);
    expect(signal.aborted).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events.some((event) => event.type === 'error' && /abort/i.test(event.message ?? ''))).toBe(true);
    // The next turn starts clean.
    session.beginTurn();
    await session.send('again');
    expect(requests).toHaveLength(1);
  });
});
