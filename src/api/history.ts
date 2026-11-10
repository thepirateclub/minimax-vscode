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

// The calls of an assistant message.
function toolUseIds(message: AnthropicMessage): string[] {
  return message.content.flatMap((block) => (block.type === 'tool_use' ? [block.id] : []));
}

// The calls that a user message answers.
function toolResultIds(message: AnthropicMessage): string[] {
  return message.content.flatMap((block) =>
    block.type === 'tool_result' ? [block.tool_use_id] : []
  );
}

// The API wants every call of a tool to be answered by its result and every
// result to stand right behind the call it answers. A history that breaks
// the rule is refused: "tool call result does not follow tool call".
// The repair drops the parts that break the rule, a message that is empty
// after it goes away.
export function balanceHistory(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'user') {
      const previous = out[out.length - 1];
      const answered = new Set(
        previous?.role === 'assistant' ? toolUseIds(previous) : []
      );
      const content = message.content.filter(
        (block) => block.type !== 'tool_result' || answered.has(block.tool_use_id)
      );
      if (content.length === 0) {
        continue;
      }
      // The message stays as it is when nothing had to be dropped, the
      // place of a request in the history does not move then.
      out.push(
        content.length === message.content.length ? message : { role: 'user', content }
      );
      continue;
    }
    const next = messages[index + 1];
    const answered = new Set(next?.role === 'user' ? toolResultIds(next) : []);
    const content = message.content.filter(
      (block) => block.type !== 'tool_use' || answered.has(block.id)
    );
    if (content.length === 0) {
      continue;
    }
    out.push(
      content.length === message.content.length ? message : { role: 'assistant', content }
    );
  }
  return out;
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
