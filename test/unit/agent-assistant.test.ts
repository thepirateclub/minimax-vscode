import { describe, expect, it } from 'vitest';
import {
  AnswerDelta,
  AnswerState,
  deltaOf,
  IdleState,
  MixedState,
  ReasoningDelta,
  ReasoningState,
} from '../../src/agent/assistant';
import type { AssistantState } from '../../src/agent/assistant';
import type { AgentEvent } from '../../src/agent/types';
import type { StreamEvent } from '../../src/api/types';

// The process of the agent: the state changes by the result of the step, the
// events of the step go to the panel.
class Process {
  readonly events: AgentEvent[] = [];
  private state: AssistantState = new IdleState();

  feed(event: StreamEvent): void {
    const delta = deltaOf(event);
    if (!delta) {
      return;
    }
    const step = this.state.apply(delta);
    this.state = step.state;
    for (const item of step.events) {
      this.events.push(item);
    }
  }

  turn(): void {
    this.state = new IdleState();
  }
}

describe('the factory of the deltas', () => {
  it('makes a delta of the answer and a delta of the reasoning', () => {
    expect(deltaOf({ type: 'text_delta', text: 'a' })).toBeInstanceOf(AnswerDelta);
    expect(deltaOf({ type: 'thinking_delta', text: 'b' })).toBeInstanceOf(ReasoningDelta);
  });

  it('makes no delta from a delta without text', () => {
    expect(deltaOf({ type: 'text_delta', text: '' })).toBeNull();
    expect(deltaOf({ type: 'thinking_delta', text: '' })).toBeNull();
  });

  it('makes no delta from the other events of the stream', () => {
    expect(deltaOf({ type: 'message_start', usage: { inputTokens: 1, outputTokens: 0 } })).toBeNull();
    expect(deltaOf({ type: 'tool_use_start', id: 't1', name: 'list_files' })).toBeNull();
    expect(deltaOf({ type: 'tool_use_delta', id: 't1', partialJson: '{}' })).toBeNull();
    expect(deltaOf({ type: 'stream_error', message: 'broken' })).toBeNull();
    expect(
      deltaOf({
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        blocks: []
      })
    ).toBeNull();
  });
});

describe('the events of the deltas', () => {
  it('the answer goes to its own event and the reasoning to its own', () => {
    expect(new AnswerDelta('a').event()).toEqual({ type: 'assistant_text', text: 'a' });
    expect(new ReasoningDelta('b').event()).toEqual({ type: 'assistant_thinking', text: 'b' });
  });
});

describe('the states of the message of the assistant', () => {
  it('the idle state opens the message with the first delta', () => {
    const step = new IdleState().apply(new AnswerDelta('a'));
    expect(step.events).toEqual([
      { type: 'assistant_start' },
      { type: 'assistant_text', text: 'a' }
    ]);
    expect(step.state).toBeInstanceOf(AnswerState);
  });

  it('the reasoning opens the message of the reasoning', () => {
    const step = new IdleState().apply(new ReasoningDelta('b'));
    expect(step.events).toEqual([
      { type: 'assistant_start' },
      { type: 'assistant_thinking', text: 'b' }
    ]);
    expect(step.state).toBeInstanceOf(ReasoningState);
  });

  it('the opened message takes the delta without a new start', () => {
    const step = new AnswerState().apply(new AnswerDelta('c'));
    expect(step.events).toEqual([{ type: 'assistant_text', text: 'c' }]);
    expect(step.state).toBeInstanceOf(AnswerState);
  });

  it('the reasoning and the answer share one message', () => {
    expect(new AnswerState().apply(new ReasoningDelta('d')).state).toBeInstanceOf(MixedState);
    expect(new ReasoningState().apply(new AnswerDelta('e')).state).toBeInstanceOf(MixedState);
    expect(new MixedState().apply(new AnswerDelta('f')).state).toBeInstanceOf(MixedState);
    expect(new MixedState().apply(new ReasoningDelta('g')).state).toBeInstanceOf(MixedState);
  });

  it('the reasoning alone keeps the reasoning', () => {
    const step = new ReasoningState().apply(new ReasoningDelta('h'));
    expect(step.events).toEqual([{ type: 'assistant_thinking', text: 'h' }]);
    expect(step.state).toBeInstanceOf(ReasoningState);
  });
});

describe('the process of the message of the assistant', () => {
  it('opens the message with the first delta of the turn', () => {
    const machine = new Process();
    machine.feed({ type: 'text_delta', text: 'a' });
    expect(machine.events).toEqual([
      { type: 'assistant_start' },
      { type: 'assistant_text', text: 'a' }
    ]);
  });

  it('does not open a second message in the same turn', () => {
    const machine = new Process();
    machine.feed({ type: 'text_delta', text: 'a' });
    machine.feed({ type: 'text_delta', text: 'b' });
    expect(machine.events.filter((event) => event.type === 'assistant_start')).toHaveLength(1);
  });

  it('opens a new message in the next turn', () => {
    const machine = new Process();
    machine.feed({ type: 'text_delta', text: 'a' });
    machine.turn();
    machine.feed({ type: 'text_delta', text: 'b' });
    expect(machine.events.filter((event) => event.type === 'assistant_start')).toHaveLength(2);
  });

  it('shows nothing for a delta without text', () => {
    const machine = new Process();
    machine.feed({ type: 'text_delta', text: '' });
    machine.feed({ type: 'thinking_delta', text: '' });
    expect(machine.events).toEqual([]);
  });

  it('sends the reasoning and the answer to their own events', () => {
    const machine = new Process();
    machine.feed({ type: 'thinking_delta', text: 'thinking' });
    machine.feed({ type: 'text_delta', text: 'answer' });
    expect(machine.events).toEqual([
      { type: 'assistant_start' },
      { type: 'assistant_thinking', text: 'thinking' },
      { type: 'assistant_text', text: 'answer' }
    ]);
  });
});
