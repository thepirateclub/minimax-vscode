import { describe, expect, it, vi } from 'vitest';
import { AgentSession, type SessionOptions } from '../../src/agent/session';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';
import type { UiApproval } from '../../src/ui/protocol';

class FakeClient implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(private readonly responses: StreamEvent[][]) {}

  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) {
      throw new Error('no scripted response left');
    }
    for (const event of response) {
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
      usage: { inputTokens: 1, outputTokens: 1 },
      blocks: [{ type: 'text', text }]
    }
  ];
}

function toolResponse(name: string, input: Record<string, unknown>): StreamEvent[] {
  return [
    { type: 'tool_use_start', id: 'toolu_1', name },
    {
      type: 'message_stop',
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
      blocks: [{ type: 'tool_use', id: 'toolu_1', name, input }]
    }
  ];
}

function makeSession(
  responses: StreamEvent[][] = [textResponse('ok')],
  autoApprove: string[] = [],
  contextProvider?: () => Promise<string>,
  depth?: number
): {
  session: AgentSession;
  events: unknown[];
  approvals: UiApproval[];
  client: FakeClient;
  registry: ToolRegistry;
} {
  const registry = new ToolRegistry();
  const events: unknown[] = [];
  const approvals: UiApproval[] = [];
  const client = new FakeClient(responses);
  const options: SessionOptions = {
    client,
    registry,
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations: 5,
    historyLimit: 120,
    contextThreshold: 50,
    effort: 'max',
    mode: 'code',
    systemPrompt: 'system',
    workspaceRoot: '/tmp/root',
    logger: { info: () => undefined, error: () => undefined },
    autoApprove,
    contextProvider,
    depth,
    onEvent: (event) => events.push(event),
    onApproval: (approval) => approvals.push(approval)
  };
  return { session: new AgentSession(options), events, approvals, client, registry };
}

describe('AgentSession', () => {
  it('adds the state of the repository to the prompt of every turn', async () => {
    const { session, client } = makeSession(
      [textResponse('ok'), textResponse('ok')],
      [],
      async () => 'Repository:\n- Branch main'
    );
    await session.send('hello');
    await session.send('again');
    expect(client.requests[0]?.system).toContain('Branch main');
    expect(client.requests[1]?.system).toContain('Branch main');
  });

  it('appends the user message and the assistant answer to the history', async () => {
    const { session } = makeSession();
    await session.send('hello');
    const history = session.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[1]?.role).toBe('assistant');
  });

  it('sends the prompt to the model unchanged', async () => {
    const { session, client } = makeSession();
    await session.send('look at src/a.ts');
    const block = client.requests[0]?.messages[0]?.content[0];
    expect(block?.type === 'text' && block.text).toBe('look at src/a.ts');
  });

  it('continues a restored history', async () => {
    const { session, client } = makeSession();
    session.setHistory([
      { role: 'user', content: [{ type: 'text', text: 'old question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] }
    ]);
    await session.send('next question');
    expect(session.getHistory()).toHaveLength(4);
    const sent = client.requests[0]?.messages ?? [];
    expect(sent[0]?.role).toBe('user');
    expect(sent[1]?.role).toBe('assistant');
  });

  it('asks the UI for an approval and runs the tool after approve', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'write_file',
      description: 'write',
      approval: 'always',
      sideEffect: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'written' })
    });
    const approvals: UiApproval[] = [];
    const events: unknown[] = [];
    const session = new AgentSession({
      client: new FakeClient([toolResponse('write_file', { path: 'a.ts' }), textResponse('done')]),
      registry,
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: 5,
      historyLimit: 120,
      contextThreshold: 50,
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      logger: { info: () => undefined, error: () => undefined },
      autoApprove: [],
      onEvent: (event) => events.push(event),
      onApproval: (approval) => approvals.push(approval)
    });

    const running = session.send('write it');
    await vi.waitFor(() => expect(approvals).toHaveLength(1));
    expect(approvals[0]?.name).toBe('write_file');
    session.approve(approvals[0]!.id, false);
    await running;

    const history = session.getHistory();
    const toolResult = history
      .flatMap((message) => message.content)
      .find((block) => block.type === 'tool_result');
    expect(toolResult?.type === 'tool_result' && toolResult.content).toBe('written');
  });

  it('runs an auto approved tool without asking the UI', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'write_file',
      description: 'write',
      approval: 'always',
      sideEffect: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'written' })
    });
    const approvals: UiApproval[] = [];
    const session = new AgentSession({
      client: new FakeClient([toolResponse('write_file', { path: 'a.ts' }), textResponse('done')]),
      registry,
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: 5,
      historyLimit: 120,
      contextThreshold: 50,
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      logger: { info: () => undefined, error: () => undefined },
      autoApprove: ['write_file'],
      onEvent: () => undefined,
      onApproval: (approval) => approvals.push(approval)
    });

    await session.send('write it');
    expect(approvals).toHaveLength(0);
  });

  it('tells the place of the request in the history', async () => {
    const { session } = makeSession([textResponse('ok')]);
    const place = await session.send('hello');
    expect(place).toBe(0);
  });

  it('applies a new auto approve list to the running gate', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'write_file',
      description: 'write',
      approval: 'always',
      sideEffect: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'written' })
    });
    const approvals: UiApproval[] = [];
    const session = new AgentSession({
      client: new FakeClient([toolResponse('write_file', { path: 'a.ts' }), textResponse('done')]),
      registry,
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: 5,
      historyLimit: 120,
      contextThreshold: 50,
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      logger: { info: () => undefined, error: () => undefined },
      autoApprove: [],
      onEvent: () => undefined,
      onApproval: (approval) => approvals.push(approval)
    });

    session.setAutoApprove(['write_file']);
    await session.send('write it');
    expect(approvals).toHaveLength(0);
  });

  it('gives the depth of the agent to the tool', async () => {
    const depths: Array<number | undefined> = [];
    const { session, registry } = makeSession(
      [toolResponse('probe', {}), textResponse('done')],
      [],
      undefined,
      1
    );
    registry.register({
      name: 'probe',
      description: 'probe',
      approval: 'never',
      sideEffect: false,
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, ctx) => {
        depths.push(ctx.depth);
        return { content: 'probed' };
      }
    });

    await session.send('probe it');
    expect(depths).toEqual([1]);
  });

  it('gives no depth to the tool of the main agent', async () => {
    const depths: Array<number | undefined> = [];
    const { session, registry } = makeSession([
      toolResponse('probe', {}),
      textResponse('done')
    ]);
    registry.register({
      name: 'probe',
      description: 'probe',
      approval: 'never',
      sideEffect: false,
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, ctx) => {
        depths.push(ctx.depth);
        return { content: 'probed' };
      }
    });

    await session.send('probe it');
    expect(depths).toEqual([undefined]);
  });
});
