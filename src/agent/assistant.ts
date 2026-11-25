import type { StreamEvent } from '../api/types';
import type { AgentEvent } from './types';
import { defineMachine, step } from '../fsm/machine';

// The message of the assistant in the panel as a state machine. The
// message starts empty, the answer and the reasoning join it. The first
// delta of a turn opens the message (`assistant_start`): the text of the
// next answer goes to its own bubble.

export type AssistantMessageState = 'empty' | 'answer' | 'reasoning' | 'mixed';
export type DeltaKind = 'answer' | 'reasoning';

export const assistantMachine = defineMachine<AssistantMessageState, DeltaKind>('assistant message', 'empty', [
  { from: 'empty', on: 'answer', to: 'answer' },
  { from: 'empty', on: 'reasoning', to: 'reasoning' },
  { from: 'answer', on: 'answer', to: 'answer' },
  { from: 'answer', on: 'reasoning', to: 'mixed' },
  { from: 'reasoning', on: 'reasoning', to: 'reasoning' },
  { from: 'reasoning', on: 'answer', to: 'mixed' },
  { from: 'mixed', on: 'answer', to: 'mixed' },
  { from: 'mixed', on: 'reasoning', to: 'mixed' }
]);

export interface AssistantDelta {
  kind: DeltaKind;
  text: string;
}

// The deltas of a stream event: the answer and the reasoning reach the
// panel, a delta without text is none. A list, so the caller walks it and
// checks nothing.
export function deltasOf(event: StreamEvent): AssistantDelta[] {
  if (event.type === 'text_delta' && event.text) {
    return [{ kind: 'answer', text: event.text }];
  }
  if (event.type === 'thinking_delta' && event.text) {
    return [{ kind: 'reasoning', text: event.text }];
  }
  return [];
}

function deltaEvent(delta: AssistantDelta): AgentEvent {
  return delta.kind === 'answer'
    ? { type: 'assistant_text', text: delta.text }
    : { type: 'assistant_thinking', text: delta.text };
}

// One delta: the state after it and the events of the panel. The table
// covers every pair, the step always goes.
export function applyDelta(
  state: AssistantMessageState,
  delta: AssistantDelta
): { state: AssistantMessageState; events: AgentEvent[] } {
  const next = step(assistantMachine, state, delta.kind);
  const events: AgentEvent[] = state === 'empty' ? [{ type: 'assistant_start' }, deltaEvent(delta)] : [deltaEvent(delta)];
  return { state: next.state, events };
}
