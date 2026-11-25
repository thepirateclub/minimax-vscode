import type { StreamEvent } from '../api/types';
import type { AgentEvent } from './types';

// The step of the process: the events of the panel and the state that comes
// next.
export interface AssistantStep {
  events: AgentEvent[];
  state: AssistantState;
}

// The delta of the answer: the answer of the model or its reasoning. The
// delta knows the event of the panel and how it joins the message.
export abstract class Delta {
  constructor(readonly text: string) {}

  // The event of the panel for this delta.
  abstract event(): AgentEvent;

  // The state of the message when this delta joins the given one.
  abstract joined(state: AssistantState): AssistantState;
}

// The answer of the model.
export class AnswerDelta extends Delta {
  override event(): AgentEvent {
    return { type: 'assistant_text', text: this.text };
  }

  override joined(state: AssistantState): AssistantState {
    return state.withAnswer();
  }
}

// The reasoning of the model.
export class ReasoningDelta extends Delta {
  override event(): AgentEvent {
    return { type: 'assistant_thinking', text: this.text };
  }

  override joined(state: AssistantState): AssistantState {
    return state.withReasoning();
  }
}

// The state of the message of the assistant in the panel. The state knows
// what it does with a delta and which state comes next: the conditions live
// in the states and not in the process.
export abstract class AssistantState {
  // A delta of the answer: the events of the panel and the state that comes
  // next.
  apply(delta: Delta): AssistantStep {
    return { events: this.events(delta), state: delta.joined(this) };
  }

  // The events of the panel for a delta of the opened message.
  protected events(delta: Delta): AgentEvent[] {
    return [delta.event()];
  }

  // The state of the message when the answer joins it.
  abstract withAnswer(): AssistantState;

  // The state of the message when the reasoning joins it.
  abstract withReasoning(): AssistantState;
}

// The message of the turn is not created yet.
export class IdleState extends AssistantState {
  protected override events(delta: Delta): AgentEvent[] {
    // The message of the assistant starts with the first delta of the turn:
    // the text of the next answer goes to its own bubble.
    return [{ type: 'assistant_start' }, delta.event()];
  }

  override withAnswer(): AssistantState {
    return new AnswerState();
  }

  override withReasoning(): AssistantState {
    return new ReasoningState();
  }
}

// The message holds the answer.
export class AnswerState extends AssistantState {
  override withAnswer(): AssistantState {
    return this;
  }

  override withReasoning(): AssistantState {
    return new MixedState();
  }
}

// The message holds the reasoning.
export class ReasoningState extends AssistantState {
  override withAnswer(): AssistantState {
    return new MixedState();
  }

  override withReasoning(): AssistantState {
    return this;
  }
}

// The message holds the reasoning and the answer.
export class MixedState extends AssistantState {
  override withAnswer(): AssistantState {
    return this;
  }

  override withReasoning(): AssistantState {
    return this;
  }
}

// The factory of the deltas: the stream comes as a union of events, the
// machine works with the objects. Only the answer and the reasoning reach
// the panel, a delta without text is no delta at all.
export function deltaOf(event: StreamEvent): Delta | null {
  switch (event.type) {
    case 'text_delta':
      return event.text ? new AnswerDelta(event.text) : null;
    case 'thinking_delta':
      return event.text ? new ReasoningDelta(event.text) : null;
    default:
      return null;
  }
}
