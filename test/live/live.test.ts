import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent, type AgentEvent } from '../../src/agent/agent';
import { HttpMiniMaxClient } from '../../src/api/client';
import type { StreamEvent } from '../../src/api/types';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createFileTools } from '../../src/tools/fs';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate } from '../../src/ui/approvals';

function loadKey(): string | undefined {
  const fromEnv = process.env['MINIMAX_API_KEY'];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const file = join(process.cwd(), '.env.local');
  if (!existsSync(file)) {
    return undefined;
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^MINIMAX_API_KEY=(.*)$/.exec(line.trim());
    if (match && match[1] && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }
  return undefined;
}

const key = loadKey();
const baseUrl = 'https://api.minimax.io/anthropic';

describe.skipIf(!key)('live MiniMax API', () => {
  it('streams a completion', async () => {
    const client = new HttpMiniMaxClient({ baseUrl, apiKey: key as string });
    const events: StreamEvent[] = [];
    for await (const event of client.stream({
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 2048,
      system: 'You are a test helper.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word: ready' }] }],
      effort: 'low'
    })) {
      events.push(event);
    }
    const text = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => event.text)
      .join('');
    const stop = events.find((event) => event.type === 'message_stop');
    console.log('[live] answer: ' + text.trim());
    console.log('[live] usage: ' + JSON.stringify(stop?.usage));
    expect(text.length).toBeGreaterThan(0);
    expect(stop?.usage.outputTokens).toBeGreaterThan(0);
  }, 120000);

  it('runs a tool call round trip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-live-'));
    await writeFile(join(root, 'hello.txt'), 'live check\n', 'utf8');

    const registry = new ToolRegistry();
    for (const tool of createFileTools({ backups: new InMemoryBackupStore() })) {
      registry.register(tool);
    }

    const events: AgentEvent[] = [];
    const agent = new Agent({
      client: new HttpMiniMaxClient({ baseUrl, apiKey: key as string }),
      registry,
      approval: new ApprovalGate({
        autoApprove: [],
        request: async () => ({ approved: true, allowForSession: false })
      }),
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 4096,
      maxIterations: 5,
      effort: 'low',
      systemPrompt: 'You are a test helper. Use read_file to read files, then answer.',
      workspaceRoot: root,
      logger: { info: () => undefined, error: () => undefined },
      onEvent: (event) => events.push(event)
    });

    const result = await agent.run('Read hello.txt and tell me what it contains.', []);
    const toolEnd = events.find((event) => event.type === 'tool_end');
    const answer = events
      .filter((event) => event.type === 'assistant_text')
      .map((event) => event.text)
      .join('');
    console.log('[live] tool: ' + JSON.stringify(toolEnd));
    console.log('[live] answer: ' + answer.trim());
    expect(toolEnd?.type === 'tool_end' && toolEnd.content).toContain('live check');
    expect(result.stopReason).toBe('end_turn');
  }, 180000);
});
