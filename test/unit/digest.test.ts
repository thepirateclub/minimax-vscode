import { describe, expect, it } from 'vitest';
import { AgentSession } from '../../src/agent/session';
import { renderMessages, withDigest } from '../../src/agent/digest';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';

// Every request answers a text, the request of the digest answers the digest.
function makeClient(): { client: MiniMaxClient; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const client: MiniMaxClient = {
    async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
      requests.push(request);
      const text = request.system?.startsWith('You compress') ? 'DIGEST ' + requests.length : 'answer ' + requests.length;
      yield { type: 'text_delta', text };
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, blocks: [{ type: 'text', text }] };
    }
  };
  return { client, requests };
}

function session(client: MiniMaxClient, summarize: boolean, digests: string[]): AgentSession {
  return new AgentSession({
    client,
    registry: new ToolRegistry(),
    model: 'MiniMax-M3',
    maxTokens: 1000,
    maxIterations: 3,
    mode: 'code',
    systemPrompt: 'the prompt',
    workspaceRoot: '/tmp/root',
    // Two messages per turn: the third turn cuts the first one.
    historyLimit: 4,
    contextThreshold: 50,
    autoApprove: [],
    logger: { info: () => undefined, error: () => undefined },
    onEvent: () => undefined,
    onApproval: () => undefined,
    summarize,
    onDigest: (digest: string) => digests.push(digest)
  } as never);
}

describe('the digest of the old turns', () => {
  it('compresses the cut turns and puts the digest into the next prompt', async () => {
    const { client, requests } = makeClient();
    const digests: string[] = [];
    const agent = session(client, true, digests);
    await agent.send('first request about the parser');
    await agent.send('second');
    await agent.send('third');
    expect(digests.length).toBeGreaterThan(0);
    const digestRequest = requests.find((request) => request.system?.startsWith('You compress'))!;
    expect(JSON.stringify(digestRequest.messages)).toContain('first request about the parser');
    const known = digests[digests.length - 1]!;
    const before = requests.length;
    await agent.send('fourth');
    // The request of the turn goes first, the digest of its own cut after it.
    expect(requests[before]!.system).toContain(known);
  });

  it('only cuts when the digest is off', async () => {
    const { client, requests } = makeClient();
    const digests: string[] = [];
    const agent = session(client, false, digests);
    for (const text of ['a', 'b', 'c', 'd']) {
      await agent.send(text);
    }
    expect(digests).toEqual([]);
    expect(requests.every((request) => !request.system?.startsWith('You compress'))).toBe(true);
  });

  it('renders the tool calls and cuts long results', () => {
    const text = renderMessages([
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'read_file', input: { path: 'a.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(2000) }] }
    ]);
    expect(text).toContain('tool call read_file {"path":"a.ts"}');
    expect(text.length).toBeLessThan(1000);
    expect(withDigest('p', undefined)).toBe('p');
    expect(withDigest('p', 'd')).toContain('digest');
  });
});
