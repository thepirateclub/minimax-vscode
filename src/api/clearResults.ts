import type { AnthropicMessage, AnthropicToolUseBlock } from './types';

// The old results of the tools fill the window of the model, and the model
// has moved on from them: a file read ten calls ago is read again when it is
// needed. The request keeps the last results whole and puts a short stub in
// place of the older long ones. Anthropic measured the clearing of the tool
// results as competitive with a summary of the history. MiniMax has no
// prompt cache, so the stub breaks nothing and saves the tokens at once.
//
// The history of the session stays whole: the rewind, the retry and the
// saved chat work from it, only the copy of the request is cleared.

// The results of the last calls stay whole, the model works with them.
export const KEEP_RECENT_RESULTS = 8;
// A short result costs less than the stub would save.
const MIN_CLEARED_CHARS = 600;

function clearable(block: { is_error?: boolean; content: string }): boolean {
  return block.is_error !== true && block.content.length >= MIN_CLEARED_CHARS;
}

export function clearOldToolResults(messages: readonly AnthropicMessage[]): AnthropicMessage[] {
  const calls = new Map<string, AnthropicToolUseBlock>();
  let total = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        calls.set(block.id, block);
      } else if (block.type === 'tool_result' && clearable(block)) {
        total++;
      }
    }
  }
  const clearBefore = total - KEEP_RECENT_RESULTS;
  if (clearBefore <= 0) {
    return [...messages];
  }
  let seen = 0;
  return messages.map((message) => {
    let changed = false;
    const content = message.content.map((block) => {
      if (block.type !== 'tool_result') {
        return block;
      }
      // An error stays: the model learns from the failure, and it is short.
      // Only the results that can be cleared are counted: the last eight
      // are eight long ones, the short ones never took their place.
      if (!clearable(block) || seen++ >= clearBefore) {
        return block;
      }
      changed = true;
      return { ...block, content: stub(calls.get(block.tool_use_id), block.content.length) };
    });
    return changed ? { ...message, content } : message;
  });
}

function stub(call: AnthropicToolUseBlock | undefined, length: number): string {
  const name = call ? call.name + target(call.input) : 'the tool';
  return (
    '[The old result of ' +
    name +
    ' is cleared, ' +
    length +
    ' characters. Call the tool again if you need it, and keep what you found with note_write before it is cleared.]'
  );
}

// The object of the call: the file, the command or the query.
function target(input: Record<string, unknown>): string {
  for (const key of ['path', 'command', 'query', 'ref']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return ' ' + value.trim().slice(0, 120);
    }
  }
  return '';
}
