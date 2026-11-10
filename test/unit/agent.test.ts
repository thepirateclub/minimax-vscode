import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent, type AgentEvent } from '../../src/agent/agent';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import type { AgentMode } from '../../src/config/models';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate, type ApprovalDecision, type ApprovalRequest } from '../../src/ui/approvals';

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

function textResponse(text: string, stopReason: 'end_turn' | 'tool_use' = 'end_turn'): StreamEvent[] {
  return [
    { type: 'text_delta', text },
    {
      type: 'message_stop',
      stopReason,
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [{ type: 'text', text }]
    }
  ];
}

function toolResponse(name: string, input: Record<string, unknown>): StreamEvent[] {
  const block = { type: 'tool_use' as const, id: 'toolu_1', name, input };
  return [
    { type: 'tool_use_start', id: 'toolu_1', name },
    {
      type: 'message_stop',
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [block]
    }
  ];
}

function makeAgent(
  client: FakeClient,
  decide: ApprovalDecision = { approved: true, allowForSession: false },
  mode: AgentMode = 'code',
  workspaceRoot = '/tmp/root'
): { agent: Agent; events: AgentEvent[]; requests: ApprovalRequest[] } {
  const events: AgentEvent[] = [];
  const requests: ApprovalRequest[] = [];
  const registry = new ToolRegistry();
  registry.register({
    name: 'read_file',
    description: 'read',
    approval: 'never',
    sideEffect: false,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'file content' })
  });
  registry.register({
    name: 'write_file',
    description: 'write',
    approval: 'always',
    sideEffect: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'written' })
  });
  const agent = new Agent({
    client,
    registry,
    approval: new ApprovalGate({
      autoApprove: [],
      request: async (request) => {
        requests.push(request);
        return decide;
      }
    }),
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations: 5,
    effort: 'max',
    mode,
    systemPrompt: 'system',
    workspaceRoot,
    logger: { info: () => undefined, error: () => undefined },
    onEvent: (event) => events.push(event)
  });
  return { agent, events, requests };
}

describe('Agent', () => {
  it('sums the spend of every request of an action', async () => {
    const client = new FakeClient([toolResponse('read_file', {}), textResponse('done')]);
    const { agent, events } = makeAgent(client);
    await agent.run('hi', []);
    expect(client.requests).toHaveLength(2);
    const done = events.find(
      (event): event is Extract<AgentEvent, { type: 'done' }> => event.type === 'done'
    );
    expect(done?.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    });
  });

  it('returns assistant text without calling tools', async () => {
    const client = new FakeClient([textResponse('hello')]);
    const { agent, events } = makeAgent(client);
    const result = await agent.run('hi', []);
    expect(result.stopReason).toBe('end_turn');
    expect(result.messages).toHaveLength(2);
    expect(events.some((e) => e.type === 'assistant_text')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('starts an assistant message before the first delta', async () => {
    const client = new FakeClient([textResponse('hello')]);
    const { agent, events } = makeAgent(client);
    await agent.run('hi', []);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'assistant_start')).toHaveLength(1);
    expect(types.indexOf('assistant_start')).toBeLessThan(types.indexOf('assistant_text'));
  });

  it('starts a new assistant message for every model turn', async () => {
    const client = new FakeClient([toolResponse('read_file', { path: 'a.ts' }), textResponse('done')]);
    const { agent, events } = makeAgent(client);
    await agent.run('read it', []);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'assistant_start')).toHaveLength(1);
  });

  it('executes a tool and feeds the result back', async () => {
    const client = new FakeClient([toolResponse('read_file', { path: 'a.ts' }), textResponse('done')]);
    const { agent, events } = makeAgent(client);
    const result = await agent.run('read it', []);
    expect(client.requests).toHaveLength(2);
    const second = client.requests[1]!;
    const userMessage = second.messages[second.messages.length - 1]!;
    expect(userMessage.role).toBe('user');
    const block = userMessage.content[0]!;
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.content).toBe('file content');
    }
    expect(events.some((e) => e.type === 'tool_start')).toBe(true);
    expect(events.some((e) => e.type === 'tool_end')).toBe(true);
    expect(result.messages.length).toBeGreaterThan(2);
  });

  it('asks the gate for a tool that always needs approval', async () => {
    const client = new FakeClient([
      toolResponse('write_file', { path: 'a.ts', content: 'x' }),
      textResponse('ok')
    ]);
    const { agent, events, requests } = makeAgent(client, {
      approved: false,
      allowForSession: false
    });
    await agent.run('write it', []);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.toolName).toBe('write_file');
    const resolved = events.find((e) => e.type === 'approval_resolved');
    expect(resolved?.type === 'approval_resolved' && resolved.approved).toBe(false);
    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd?.type === 'tool_end' && toolEnd.isError).toBe(true);
  });

  it('carries the change of a written file in the result of the action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-agent-'));
    await writeFile(join(root, 'note.txt'), 'first line\n', 'utf8');
    const client = new FakeClient([
      toolResponse('write_file', { path: 'note.txt', content: 'first line\nsecond line\n' }),
      textResponse('done')
    ]);
    const { agent, events } = makeAgent(
      client,
      { approved: true, allowForSession: false },
      'code',
      root
    );
    await agent.run('write it', []);
    const end = events.find((event) => event.type === 'tool_end');
    expect(end?.type === 'tool_end' && end.diff?.path).toBe('note.txt');
    const added =
      end?.type === 'tool_end'
        ? end.diff?.lines.filter((line) => line.type === 'add').map((line) => line.text)
        : [];
    expect(added).toEqual(['second line']);
  });

  it('does not ask the gate for a tool that never needs approval', async () => {
    const client = new FakeClient([toolResponse('read_file', { path: 'a.ts' }), textResponse('done')]);
    const { agent, requests } = makeAgent(client);
    await agent.run('read it', []);
    expect(requests).toHaveLength(0);
  });

  it('keeps thinking blocks in the assistant message', async () => {
    const client = new FakeClient([
      [
        { type: 'thinking_delta', text: 'thinking hard' },
        {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
          blocks: [
            { type: 'thinking', thinking: 'thinking hard' },
            { type: 'text', text: 'answer' }
          ]
        }
      ]
    ]);
    const { agent } = makeAgent(client);
    const result = await agent.run('q', []);
    const assistant = result.messages[1]!;
    expect(assistant.content[0]?.type).toBe('thinking');
  });

  it('stops after maxIterations', async () => {
    const responses = Array.from({ length: 10 }, () => toolResponse('read_file', { path: 'a.ts' }));
    const client = new FakeClient(responses);
    const { agent } = makeAgent(client);
    const result = await agent.run('loop', []);
    expect(client.requests.length).toBe(5);
    expect(result.stopReason).toBe('max_iterations');
  });

  it('refuses to run the same tool call more than three times', async () => {
    const responses = Array.from({ length: 6 }, () => toolResponse('read_file', { path: 'a.ts' }));
    const client = new FakeClient(responses);
    const { agent } = makeAgent(client);
    const result = await agent.run('loop', []);
    const lastMessage = result.messages[result.messages.length - 1]!;
    const block = lastMessage.content[0]!;
    expect(block.type === 'tool_result' && block.is_error).toBe(true);
    expect(client.requests.length).toBe(5);
  });

  it('keeps the text of the request out of the message with the result of a tool call', async () => {
    const responses = Array.from({ length: 6 }, () => toolResponse('read_file', { path: 'a.ts' }));
    const first = makeAgent(new FakeClient(responses));
    const firstResult = await first.agent.run('loop', []);
    expect(firstResult.messages[firstResult.messages.length - 1]?.role).toBe('user');

    const client = new FakeClient([textResponse('ok')]);
    const second = makeAgent(client);
    await second.agent.run('again', firstResult.messages);
    const request = client.requests[0]!;
    const last = request.messages[request.messages.length - 1]!;
    expect(last.role).toBe('user');
    const types = last.content.map((block) => block.type);
    expect(types).toEqual(['text']);
    // The result of the tool call stays in the message that answers it.
    const before = request.messages[request.messages.length - 2]!;
    expect(before.content.map((block) => block.type)).toContain('tool_result');
  });

  it('repairs a history with a call that nobody answered', async () => {
    const client = new FakeClient([textResponse('ok')]);
    const { agent } = makeAgent(client);
    await agent.run('next question', [
      { role: 'user', content: [{ type: 'text', text: 'old question' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} }]
      }
    ]);
    const sent = client.requests[0]?.messages ?? [];
    const calls = sent
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'tool_use');
    expect(calls).toHaveLength(0);
  });

  it('passes the tool definitions to the model', async () => {
    const client = new FakeClient([textResponse('ok')]);
    const { agent } = makeAgent(client);
    await agent.run('hi', []);
    const names = client.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
  });

  it('hides the tools with a side effect in plan mode', async () => {
    const client = new FakeClient([textResponse('ok')]);
    const { agent } = makeAgent(client, { approved: true, allowForSession: false }, 'plan');
    await agent.run('plan it', []);
    const names = client.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
  });

  it('refuses to run a tool with a side effect in plan mode', async () => {
    const client = new FakeClient([
      toolResponse('write_file', { path: 'a.ts', content: 'x' }),
      textResponse('done')
    ]);
    const { agent, events, requests } = makeAgent(
      client,
      { approved: true, allowForSession: false },
      'plan'
    );
    await agent.run('write it', []);
    expect(requests).toHaveLength(0);
    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd?.type === 'tool_end' && toolEnd.content).toContain('plan mode');
    const second = client.requests[1]!;
    const last = second.messages[second.messages.length - 1]!;
    const block = last.content[0]!;
    expect(block.type === 'tool_result' && block.is_error).toBe(true);
  });

  it('carries the snapshot of the state of the tool to the event of the action', async () => {
    const client = new FakeClient([
      toolResponse('todo_write', { todos: [] }),
      textResponse('done')
    ]);
    const events: AgentEvent[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'todo_write',
      description: 'write the list of tasks',
      approval: 'never',
      sideEffect: false,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({
        content: 'The list of tasks has 1 items.',
        state: {
          kind: 'todos',
          todos: [{ content: 'Read the parser', status: 'pending', priority: 'high' }]
        }
      })
    });
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
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      logger: { info: () => undefined, error: () => undefined },
      onEvent: (event) => events.push(event)
    });
    await agent.run('make a plan', []);
    const end = events.find(
      (event): event is Extract<AgentEvent, { type: 'tool_end' }> =>
        event.type === 'tool_end'
    );
    expect(end?.state).toEqual({
      kind: 'todos',
      todos: [{ content: 'Read the parser', status: 'pending', priority: 'high' }]
    });
  });

  it('gives the depth of the agent to the tool', async () => {
    const client = new FakeClient([
      toolResponse('todo_write', { todos: [] }),
      textResponse('done')
    ]);
    const depths: Array<number | undefined> = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'todo_write',
      description: 'write the list of tasks',
      approval: 'never',
      sideEffect: false,
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, ctx) => {
        depths.push(ctx.depth);
        return { content: 'ok' };
      }
    });
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
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      depth: 1,
      logger: { info: () => undefined, error: () => undefined },
      onEvent: () => undefined
    });
    await agent.run('make a plan', []);
    expect(depths).toEqual([1]);
  });

  it('sends the spend of every request', async () => {
    const client = new FakeClient([toolResponse('read_file', {}), textResponse('done')]);
    const { agent, events } = makeAgent(client);
    await agent.run('hi', []);
    const spends = events.filter(
      (event): event is Extract<AgentEvent, { type: 'usage' }> => event.type === 'usage'
    );
    expect(spends).toHaveLength(2);
    expect(spends[0]?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(spends[1]?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('stops by the budget of the goal', async () => {
    const client = new FakeClient([toolResponse('read_file', { path: 'a.ts' })]);
    const events: AgentEvent[] = [];
    let toolRuns = 0;
    const registry = new ToolRegistry();
    registry.register({
      name: 'read_file',
      description: 'read',
      approval: 'never',
      sideEffect: false,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        toolRuns += 1;
        return { content: 'file content' };
      }
    });
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
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: '/tmp/root',
      budget: () => false,
      logger: { info: () => undefined, error: () => undefined },
      onEvent: (event) => events.push(event)
    });
    const result = await agent.run('read it', []);
    expect(result.stopReason).toBe('goal_limit');
    // The tools do not run, the model does not get another round of work.
    expect(client.requests).toHaveLength(1);
    expect(toolRuns).toBe(0);
    const done = events.find(
      (event): event is Extract<AgentEvent, { type: 'done' }> => event.type === 'done'
    );
    expect(done?.stopReason).toBe('goal_limit');
  });
});
