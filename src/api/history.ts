import type { AnthropicMessage } from './types';

// A long chat must not grow without a bound, the oldest turns are cut.
export const MAX_HISTORY_MESSAGES = 120;

// The default share of the context window the history may take.
export const DEFAULT_CONTEXT_THRESHOLD = 50;

// The first message of a cut history must not refer to a tool call that is
// gone, otherwise the next request is invalid.
function isUnbalanced(message: AnthropicMessage): boolean {
  if (message.role === 'user') {
    return message.content[0]?.type === 'tool_result';
  }
  return message.content[message.content.length - 1]?.type === 'tool_use';
}

export function trimHistory(messages: AnthropicMessage[], limit: number): AnthropicMessage[] {
  if (messages.length <= limit) {
    return messages;
  }
  const kept = messages.slice(messages.length - limit);
  while (kept.length > 0 && isUnbalanced(kept[0]!)) {
    kept.shift();
  }
  return kept;
}

// About four characters per token, the estimate is rough but it keeps the
// request inside the context window of the model.
export function estimateTokens(messages: AnthropicMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') {
        chars += block.text.length;
      } else if (block.type === 'thinking') {
        chars += block.thinking.length;
      } else if (block.type === 'tool_use') {
        chars += JSON.stringify(block.input).length;
      } else {
        chars += block.content.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

// The history has to fit into the context window of the model, the threshold
// is the share of the window the history may take, the rest stays free for
// the answer of the model.
export function fitHistory(
  messages: AnthropicMessage[],
  limit: number,
  contextWindow: number,
  threshold: number = DEFAULT_CONTEXT_THRESHOLD
): AnthropicMessage[] {
  const share = Math.max(1, Math.min(100, threshold)) / 100;
  const budget = Math.floor((contextWindow * share) / 4);
  let kept = trimHistory(messages, limit);
  while (kept.length > 2 && estimateTokens(kept) > budget) {
    const next = kept.slice(1);
    if (isUnbalanced(next[0]!)) {
      break;
    }
    kept = next;
  }
  return kept;
}
