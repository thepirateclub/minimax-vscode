import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentEvent } from '../../src/agent/agent';
import { FakeClient, makeAgent, textResponse, toolResponse } from '../helpers/agentFixture';

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
  it('lets the model read the file after every edit of it', async () => {
    // Three cycles of a write and a read of the same file with the same
    // arguments, then one more read. Every write changed the file, so the
    // reads are not a loop: the fourth one is the call the guard used to
    // refuse.
    const cycle = [
      toolResponse('write_file', { path: 'a.ts' }),
      toolResponse('read_file', { path: 'a.ts' })
    ];
    const client = new FakeClient([
      ...cycle,
      ...cycle,
      ...cycle,
      toolResponse('read_file', { path: 'a.ts' }),
      textResponse('done')
    ]);
    const { agent, events } = makeAgent(client, undefined, 'code', '/tmp/root', 12);
    await agent.run('edit and check the file', []);
    const ends = events.filter(
      (event): event is Extract<AgentEvent, { type: 'tool_end' }> => event.type === 'tool_end'
    );
    // Every call ran: three writes and four reads, no refusal among them.
    expect(ends).toHaveLength(7);
    expect(ends.some((event) => event.content.includes('repeated'))).toBe(false);
    expect(ends.at(-1)?.isError).toBe(false);
  });
  it('still refuses a loop of identical writes', async () => {
    // A write that worked does not make the next identical write sensible:
    // the counters of the tools with a side effect survive the reset.
    const client = new FakeClient([
      toolResponse('write_file', { path: 'a.ts' }),
      toolResponse('write_file', { path: 'a.ts' }),
      toolResponse('write_file', { path: 'a.ts' }),
      toolResponse('write_file', { path: 'a.ts' }),
      textResponse('done')
    ]);
    const { agent, events } = makeAgent(client, undefined, 'code', '/tmp/root', 12);
    await agent.run('write the same file again and again', []);
    const ends = events.filter(
      (event): event is Extract<AgentEvent, { type: 'tool_end' }> => event.type === 'tool_end'
    );
    expect(ends).toHaveLength(4);
    expect(ends[3]?.isError).toBe(true);
    expect(ends[3]?.content).toContain('repeated');
  });
  it('shows the refusal of a repeated identical call in the panel', async () => {
    const client = new FakeClient([
      toolResponse('read_file', { path: 'a.ts' }),
      toolResponse('read_file', { path: 'a.ts' }),
      toolResponse('read_file', { path: 'a.ts' }),
      toolResponse('read_file', { path: 'a.ts' }),
      textResponse('done')
    ]);
    const { agent, events } = makeAgent(client);
    await agent.run('read it', []);
    const starts = events.filter((event) => event.type === 'tool_start');
    const ends = events.filter(
      (event): event is Extract<AgentEvent, { type: 'tool_end' }> => event.type === 'tool_end'
    );
    // The refusal has a card of its own, the reader sees the reason.
    expect(starts).toHaveLength(4);
    expect(ends[3]?.isError).toBe(true);
    expect(ends[3]?.content).toContain('repeated');
  });
  it('shows the refusal of an unknown tool in the panel', async () => {
    const client = new FakeClient([
      toolResponse('no_such_tool', { path: 'a.ts' }),
      textResponse('done')
    ]);
    const { agent, events } = makeAgent(client);
    await agent.run('call it', []);
    const starts = events.filter((event) => event.type === 'tool_start');
    const ends = events.filter(
      (event): event is Extract<AgentEvent, { type: 'tool_end' }> => event.type === 'tool_end'
    );
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.isError).toBe(true);
    expect(ends[0]?.content).toContain('Unknown tool');
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
});
