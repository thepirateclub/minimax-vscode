import type { UiMessage } from '../protocol';

export interface ToolStep {
  // The id of the step, it is the id of the first card of it.
  id: string;
  // The cards of the step.
  tools: UiMessage[];
}

export type FeedItem =
  | { kind: 'message'; message: UiMessage }
  | { kind: 'steps'; step: ToolStep };

// The actions of the agent are grouped by step: a step is the work of one
// request of the reader. The cards of the step stand under one header, the
// header stays visible when the step is folded.
//
// The group ends at the thought or at the answer of the model: the actions
// that follow a thought are the next step of the work, not the tail of the
// step before it. The order of the chat reads as actions, thought, actions.
export function groupToolSteps(messages: UiMessage[]): FeedItem[] {
  const items: FeedItem[] = [];
  let step: ToolStep | undefined;
  let counter = 0;
  for (const message of messages) {
    // A new request of the reader starts a new step.
    if (message.role === 'user') {
      step = undefined;
    }
    // The thought or the answer of the model closes the group of the
    // actions: the next actions stand under a new head.
    if (message.role === 'assistant' && !message.approval && speaks(message)) {
      step = undefined;
    }
    if (message.role === 'tool' && message.tool) {
      if (!step) {
        counter += 1;
        step = { id: 'step-' + counter, tools: [] };
        items.push({ kind: 'steps', step });
      }
      step.tools.push(message);
      continue;
    }
    items.push({ kind: 'message', message });
  }
  return items;
}

// The message of the model says something: it has a thought or an answer.
function speaks(message: UiMessage): boolean {
  return (message.text?.length ?? 0) > 0 || (message.thinking?.length ?? 0) > 0;
}
