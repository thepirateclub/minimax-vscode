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
export function groupToolSteps(messages: UiMessage[]): FeedItem[] {
  const items: FeedItem[] = [];
  let step: ToolStep | undefined;
  let counter = 0;
  for (const message of messages) {
    // A new request of the reader starts a new step.
    if (message.role === 'user') {
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
