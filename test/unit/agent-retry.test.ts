import { describe, expect, it } from 'vitest';
import { Agent, type AgentEvent, retryDelay } from '../../src/agent/agent';
import { MiniMaxApiError } from '../../src/api/errors';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate } from '../../src/ui/approvals';

const LOST = new MiniMaxApiError(
  'The connection to MiniMax was lost.',
  0,
  undefined,
  true
);
const FATAL = new MiniMaxApiError('Invalid MiniMax API key.', 401, 2057, false);

// A stream that breaks in the middle: the events came, then the connection
// died.
class BrokenStream extends MiniMaxApiError {
  constructor(readonly events: StreamEvent[]) {
    super('The connection to MiniMax was lost.', 0, undefined, true);
    this.name = 'BrokenStream';
  }
}

class ScriptedClient implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];

  constructor(private readonly script: Array<StreamEvent[] | Error>) {}

  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    const item = this.script.shift();
    if (item === undefined) {
      throw new Error('the script of the client is over');
    }
    if (item instanceof BrokenStream) {
      for (const event of item.events) {
        yield event;
      }
      throw item;
    }
    if (item instanceof Error) {
      throw item;
    }
    for (const event of item) {
      yield event;
    }
  }
}

function textResponse(text: string): StreamEvent[] {
  return [
    { type: 'text_delta', text },
    {
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [{ type: 'text', text }]
    }
  ];
}

function makeAgent(
  client: ScriptedClient,
  maxRetries: number
): { agent: Agent; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const registry = new ToolRegistry();
  const agent = new Agent({
    client,
    registry,
    approval: new ApprovalGate({
      autoApprove: [],
      request: async () => ({ approved: true, allowForSession: false })
    }),
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations: 5,
    maxRetries,
    // The base of the pause is a millisecond, the test does not wait.
    retryBaseDelayMs: 1,
    effort: 'max',
    mode: 'code',
    systemPrompt: 'system',
    workspaceRoot: '/tmp/root',
    logger: { info: () => undefined, error: () => undefined },
    onEvent: (event) => events.push(event)
  });
  return { agent, events };
}

function retriesOf(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'retrying' }>> {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: 'retrying' }> => event.type === 'retrying'
  );
}

describe('the repeats of a lost connection', () => {
  it('grows the pause between the attempts', () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    expect(retryDelay(3)).toBe(8000);
    // The pause does not grow forever.
    expect(retryDelay(20)).toBe(30000);
  });

  it('repeats the request when the connection is lost', async () => {
    const client = new ScriptedClient([LOST, textResponse('hello')]);
    const { agent, events } = makeAgent(client, 5);
    const result = await agent.run('hi', []);
    // The whole request goes out again, not only the broken part.
    expect(client.requests).toHaveLength(2);
    expect(result.stopReason).toBe('end_turn');
    const retries = retriesOf(events);
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ attempt: 1, total: 5 });
  });

  it('tells the panel how many attempts are left', async () => {
    const client = new ScriptedClient([LOST, LOST, textResponse('hello')]);
    const { agent, events } = makeAgent(client, 5);
    await agent.run('hi', []);
    const retries = retriesOf(events);
    expect(retries.map((retry) => retry.attempt)).toEqual([1, 2]);
    expect(retries.every((retry) => retry.total === 5)).toBe(true);
  });

  it('drops the piece of the answer that broke in the middle', async () => {
    const client = new ScriptedClient([
      new BrokenStream([{ type: 'text_delta', text: 'Hel' }]),
      textResponse('Hello')
    ]);
    const { agent, events } = makeAgent(client, 5);
    const result = await agent.run('hi', []);
    // The piece of the broken answer is not in the answer.
    expect(events.some((event) => event.type === 'assistant_reset')).toBe(true);
    const answer = result.messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.content)
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');
    expect(answer).toBe('Hello');
  });

  it('keeps the answer that came when the stream broke', async () => {
    const client = new ScriptedClient([
      new BrokenStream([{ type: 'text_delta', text: 'Hel' }]),
      textResponse('Hello')
    ]);
    const { agent, events } = makeAgent(client, 5);
    await agent.run('hi', []);
    const resets = events.filter(
      (event): event is Extract<AgentEvent, { type: 'assistant_reset' }> =>
        event.type === 'assistant_reset'
    );
    expect(resets).toHaveLength(1);
  });

  it('stops at the limit of the attempts', async () => {
    const client = new ScriptedClient([LOST, LOST, LOST]);
    const { agent, events } = makeAgent(client, 2);
    await expect(agent.run('hi', [])).rejects.toThrow('The connection to MiniMax was lost.');
    // The first attempt and two repeats, no more.
    expect(client.requests).toHaveLength(3);
    expect(retriesOf(events)).toHaveLength(2);
    // The reader sees the failure, a silent stop is a defect.
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  it('does not repeat when the repeats are off', async () => {
    const client = new ScriptedClient([LOST, textResponse('hello')]);
    const { agent, events } = makeAgent(client, 0);
    await expect(agent.run('hi', [])).rejects.toThrow('The connection to MiniMax was lost.');
    expect(client.requests).toHaveLength(1);
    expect(retriesOf(events)).toHaveLength(0);
  });

  it('does not repeat a failure that will not pass', async () => {
    const client = new ScriptedClient([FATAL, textResponse('hello')]);
    const { agent, events } = makeAgent(client, 5);
    await expect(agent.run('hi', [])).rejects.toThrow('Invalid MiniMax API key.');
    expect(client.requests).toHaveLength(1);
    expect(retriesOf(events)).toHaveLength(0);
  });
});
