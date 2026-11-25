import { describe, expect, it } from 'vitest';
import { planTurn, PLANNER_PROMPT, withPlan } from '../../src/agent/planner';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';

function client(text: string, seen: ChatRequest[]): MiniMaxClient {
  return {
    async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
      seen.push(request);
      yield { type: 'thinking_delta', text: 'hmm' };
      yield { type: 'text_delta', text };
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 40, outputTokens: 9 }, blocks: [] };
    }
  };
}

// A stronger model plans, the model of the chat does the work.
describe('the planner', () => {
  it('asks the planner model without tools and gives the plan with the spend', async () => {
    const seen: ChatRequest[] = [];
    const result = await planTurn({
      client: client(' 1. Read src/a.ts\n2. Edit it ', seen),
      model: 'MiniMax-M3',
      context: 'Repository map:\na.ts: run',
      request: 'rename run',
      thinking: 'adaptive'
    });
    expect(result).toEqual({ plan: '1. Read src/a.ts\n2. Edit it', usage: { inputTokens: 40, outputTokens: 9 } });
    expect(seen[0]!.model).toBe('MiniMax-M3');
    expect(seen[0]!.tools).toBeUndefined();
    expect(seen[0]!.thinking).toBe('adaptive');
    expect(seen[0]!.system).toBe(PLANNER_PROMPT + '\n\nRepository map:\na.ts: run');
  });

  it('gives no plan for a question', async () => {
    const result = await planTurn({ client: client('NO PLAN.', []), model: 'm', context: '', request: 'what is x?' });
    expect(result.plan).toBe('');
  });

  it('puts the plan after the words of the reader and leaves a request without a plan as it is', () => {
    expect(withPlan('do it', '', 'm')).toBe('do it');
    const text = withPlan('do it', '1. step', 'MiniMax-M3');
    expect(text.startsWith('do it\n\nPlan from the planner model (MiniMax-M3):\n1. step')).toBe(true);
  });
});
