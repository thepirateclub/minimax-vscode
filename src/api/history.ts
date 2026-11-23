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

// The characters of one message, the estimate of the tokens counts them.
function messageChars(message: AnthropicMessage): number {
  let chars = 0;
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
  return chars;
}

function charsOf(messages: AnthropicMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += messageChars(message);
  }
  return chars;
}

// The limit of the messages and the budget of the characters. The stored
// history of every chat lives in the state of the host, so a huge chat has
// a second bound on top of the count of its messages.
export function trimHistory(
  messages: AnthropicMessage[],
  limit: number,
  maxChars: number = Number.POSITIVE_INFINITY
): AnthropicMessage[] {
  const overLimit = messages.length > limit;
  if (!overLimit && !Number.isFinite(maxChars)) {
    return messages;
  }
  const kept = overLimit ? messages.slice(messages.length - limit) : [...messages];
  let chars = charsOf(kept);
  let head = 0;
  while (
    head < kept.length &&
    (isUnbalanced(kept[head]!) || (kept.length - head > 2 && chars > maxChars))
  ) {
    chars -= messageChars(kept[head]!);
    head += 1;
  }
  return head === 0 ? kept : kept.slice(head);
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
  return Math.ceil(charsOf(messages) / 4);
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
  // The share is a part of the window in tokens, and the estimate of the
  // history is tokens too: the budget is not divided a second time.
  const budgetChars = Math.floor(contextWindow * share) * 4;
  const kept = trimHistory(messages, limit);
  let chars = charsOf(kept);
  let head = 0;
  while (kept.length - head > 2 && chars > budgetChars) {
    if (isUnbalanced(kept[head + 1]!)) {
      break;
    }
    chars -= messageChars(kept[head]!);
    head += 1;
  }
  return head === 0 ? kept : kept.slice(head);
}
