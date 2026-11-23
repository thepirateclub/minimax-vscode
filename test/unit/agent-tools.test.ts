import { describe, expect, it } from 'vitest';
import { Agent, type AgentEvent } from '../../src/agent/agent';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate } from '../../src/ui/approvals';
import { FakeClient, makeAgent, textResponse, toolResponse } from '../helpers/agentFixture';

describe('Agent', () => {
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
      // The budget holds while the answer streams and is over right after
      // the request, the tools of the request do not run then.
      budget: () => client.streamed === 0,
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
  it('stops in the middle of the answer when the budget of the goal is over', async () => {
    const client = new FakeClient([
      [
        { type: 'text_delta', text: 'the first part of the answer' },
        { type: 'tool_use_start', id: 'toolu_1', name: 'read_file' },
        { type: 'tool_use_delta', id: 'toolu_1', partialJson: '{"path":"a.ts"}' },
        {
          type: 'message_stop',
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5 },
          blocks: [
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.ts' } }
          ]
        }
      ]
    ]);
    const events: AgentEvent[] = [];
    let toolRuns = 0;
    let checks = 0;
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
      // The budget holds for the first two checks of the stream and is over
      // before the tool call of the answer is complete.
      budget: () => checks++ < 3,
      logger: { info: () => undefined, error: () => undefined },
      onEvent: (event) => events.push(event)
    });
    const result = await agent.run('read it', []);
    // The turn ends with the reason of the budget.
    expect(result.stopReason).toBe('goal_limit');
    const done = events.find(
      (event): event is Extract<AgentEvent, { type: 'done' }> => event.type === 'done'
    );
    expect(done?.stopReason).toBe('goal_limit');
    // The text that was streamed before the stop stays in the events.
    const texts = events
      .filter((event): event is Extract<AgentEvent, { type: 'assistant_text' }> =>
        event.type === 'assistant_text'
      )
      .map((event) => event.text);
    expect(texts).toEqual(['the first part of the answer']);
    // The tools of the request do not run.
    expect(toolRuns).toBe(0);
    // No call without a result goes into the history.
    const calls = result.messages
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'tool_use');
    expect(calls).toHaveLength(0);
  });
});
