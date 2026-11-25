import { describe, expect, it } from 'vitest';
import { applyDelta, assistantMachine, deltasOf } from '../../src/agent/assistant';
import type { AssistantMessageState } from '../../src/agent/assistant';
import type { AgentEvent } from '../../src/agent/types';
import type { StreamEvent } from '../../src/api/types';

// The stream of one turn through the machine: the events of the panel.
function feed(stream: StreamEvent[]): { state: AssistantMessageState; events: AgentEvent[] } {
  let state = assistantMachine.initial;
  const events: AgentEvent[] = [];
  for (const event of stream) {
    for (const delta of deltasOf(event)) {
      const result = applyDelta(state, delta);
      state = result.state;
      events.push(...result.events);
    }
  }
  return { state, events };
}

describe('the deltas of the stream', () => {
  it('reads the answer and the reasoning', () => {
    expect(deltasOf({ type: 'text_delta', text: 'a' })).toEqual([{ kind: 'answer', text: 'a' }]);
    expect(deltasOf({ type: 'thinking_delta', text: 'b' })).toEqual([{ kind: 'reasoning', text: 'b' }]);
  });

  it('makes no delta from an empty text or another event', () => {
    expect(deltasOf({ type: 'text_delta', text: '' })).toEqual([]);
    expect(deltasOf({ type: 'message_stop' } as StreamEvent)).toEqual([]);
  });
});

describe('the message of the assistant', () => {
  it('opens the message with the first delta only', () => {
    const { state, events } = feed([
      { type: 'text_delta', text: 'a' },
      { type: 'text_delta', text: 'b' }
    ]);
    expect(state).toBe('answer');
    expect(events).toEqual([
      { type: 'assistant_start' },
      { type: 'assistant_text', text: 'a' },
      { type: 'assistant_text', text: 'b' }
    ]);
  });

  it('the reasoning and the answer share one message', () => {
    const { state, events } = feed([
      { type: 'thinking_delta', text: 't' },
      { type: 'text_delta', text: 'a' }
    ]);
    expect(state).toBe('mixed');
    expect(events.filter((event) => event.type === 'assistant_start')).toHaveLength(1);
  });

  it('an empty delta opens no message', () => {
    expect(feed([{ type: 'text_delta', text: '' }])).toEqual({ state: 'empty', events: [] });
  });
});
