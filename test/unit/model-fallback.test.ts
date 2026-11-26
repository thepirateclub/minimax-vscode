import { describe, expect, it } from 'vitest';
import { Agent, type AgentEvent } from '../../src/agent/agent';
import { fallbackFor, fallbackNotice, isAvailabilityError, type FallbackModel } from '../../src/agent/fallback';
import { MiniMaxApiError } from '../../src/api/errors';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate } from '../../src/ui/approvals';

const NOT_IN_PLAN = new MiniMaxApiError('not in plan', 400, 2061, false);
const OVERLOAD = new MiniMaxApiError('overload', 200, 2066, true);
const SERVER = new MiniMaxApiError('server error', 502, undefined, true);
const BAD_KEY = new MiniMaxApiError('bad key', 401, 2049, false);
const NOT_M_PLAN = new MiniMaxApiError('not m plan', 401, 2057, false);
const PLAN_LIMIT = new MiniMaxApiError('plan limit', 429, 2062, false);

class ScriptedClient implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly script: Array<StreamEvent[] | Error>) {}
  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    const item = this.script.shift();
    if (item === undefined) {
      throw new Error('the script of the client is over');
    }
    if (item instanceof Error) {
      throw item;
    }
    yield* item;
  }
}

function text(value: string): StreamEvent[] {
  return [
    { type: 'text_delta', text: value },
    {
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
      blocks: [{ type: 'text', text: value }]
    }
  ];
}

const M3: FallbackModel = { model: 'MiniMax-M3', maxTokens: 65_536, thinking: 'adaptive' };

function run(client: ScriptedClient, fallback: FallbackModel | undefined, maxRetries = 1): { agent: Agent; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const agent = new Agent({
    client,
    registry: new ToolRegistry(),
    approval: new ApprovalGate({ autoApprove: [], request: async () => ({ approved: true, allowForSession: false }) }),
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations: 5,
    maxRetries,
    retryBaseDelayMs: 1,
    effort: 'max',
    ...(fallback ? { fallback } : {}),
    mode: 'code',
    systemPrompt: 'system',
    workspaceRoot: '/tmp/root',
    logger: { info: () => undefined, error: () => undefined },
    onEvent: (event) => events.push(event)
  });
  return { agent, events };
}

describe('the fallback model', () => {
  it('knows the availability errors and refuses the key and plan errors', () => {
    expect(isAvailabilityError(NOT_IN_PLAN)).toBe(true);
    expect(isAvailabilityError(OVERLOAD)).toBe(true);
    expect(isAvailabilityError(SERVER)).toBe(true);
    expect(isAvailabilityError(BAD_KEY)).toBe(false);
    expect(isAvailabilityError(NOT_M_PLAN)).toBe(false);
    expect(isAvailabilityError(PLAN_LIMIT)).toBe(false);
    expect(isAvailabilityError(new MiniMaxApiError('rate', 429, undefined, true))).toBe(false);
    expect(isAvailabilityError(new Error('x'))).toBe(false);
  });

  it('takes the reasoning of the fallback from the catalog', () => {
    const reasoning = { effort: 'high' as const, thinking: true };
    expect(fallbackFor('MiniMax-M3', 'MiniMax-M3.1-Flash', reasoning)).toEqual(M3);
    expect(fallbackFor('MiniMax-M3.1-Flash', 'MiniMax-M3', reasoning)).toEqual({
      model: 'MiniMax-M3.1-Flash', maxTokens: 65_536, effort: 'high'
    });
    expect(fallbackFor('MiniMax-M3', 'MiniMax-M3.1-Flash', { effort: 'high', thinking: false })?.thinking).toBeUndefined();
    expect(fallbackFor('', 'MiniMax-M3', reasoning)).toBeUndefined();
    expect(fallbackFor('MiniMax-M3', 'MiniMax-M3', reasoning)).toBeUndefined();
    expect(fallbackFor('nope', 'MiniMax-M3', reasoning)).toBeUndefined();
  });

  it('repeats the turn on the fallback model when the model is not in the plan', async () => {
    const client = new ScriptedClient([NOT_IN_PLAN, text('hi')]);
    const { agent, events } = run(client, M3);
    await agent.run('q', []);
    expect(client.requests.map((r) => r.model)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(client.requests[1]!.effort).toBeUndefined();
    expect(client.requests[1]!.thinking).toBe('adaptive');
    expect(events).toContainEqual({ type: 'model_fallback', from: 'MiniMax-M3.1-Flash', to: 'MiniMax-M3' });
    expect(fallbackNotice('MiniMax-M3.1-Flash', 'MiniMax-M3')).toContain('MiniMax-M3.1-Flash');
  });

  it('falls back only after the retries of an overload and a server error', async () => {
    const client = new ScriptedClient([OVERLOAD, SERVER, text('hi')]);
    const { agent, events } = run(client, M3, 1);
    await agent.run('q', []);
    expect(client.requests.map((r) => r.model)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(events.filter((e) => e.type === 'model_fallback')).toHaveLength(1);
  });

  it('does not fall back on the key or the plan limit', async () => {
    for (const error of [BAD_KEY, NOT_M_PLAN, PLAN_LIMIT]) {
      const client = new ScriptedClient([error, text('hi')]);
      const { agent, events } = run(client, M3);
      await expect(agent.run('q', [])).rejects.toBe(error);
      expect(client.requests).toHaveLength(1);
      expect(events.some((e) => e.type === 'model_fallback')).toBe(false);
    }
  });

  it('fails as before without the setting and when the fallback fails too', async () => {
    const off = new ScriptedClient([NOT_IN_PLAN]);
    await expect(run(off, undefined).agent.run('q', [])).rejects.toBe(NOT_IN_PLAN);
    const both = new ScriptedClient([NOT_IN_PLAN, NOT_IN_PLAN]);
    await expect(run(both, M3).agent.run('q', [])).rejects.toBe(NOT_IN_PLAN);
    expect(both.requests).toHaveLength(2);
  });
});
