import type { UiMessage } from './protocol';

// The panel gets the history in parts: a big chat in one message is slow
// to transfer and to draw. The host keeps the whole history, the panel
// asks for the older part when the reader wants it.
export const HISTORY_PAGE = 120;

// How many characters of the history go to the panel in one message. The
// bound of the messages is not enough: one long answer fills the message
// all by itself.
export const HISTORY_CHARS = 400_000;

// The size of a message of the chat: the text of the answer, the text of
// the thinking and the result of the tool.
export function messageChars(message: UiMessage): number {
  const tool = message.tool;
  return (
    (message.text?.length ?? 0) +
    (message.thinking?.length ?? 0) +
    (tool?.content?.length ?? 0) +
    (tool?.progress?.reduce((sum, line) => sum + line.length, 0) ?? 0)
  );
}

// The last part of the history before the end goes to the panel. The bound
// of the messages and the bound of the characters hold it. The newest
// message is always there, even when it is too big on its own.
export function takeHistory(
  messages: UiMessage[],
  end: number
): { messages: UiMessage[]; offset: number } {
  const stop = Math.max(0, Math.min(end, messages.length));
  // The oldest message the part may take, the bound of the messages.
  const limit = Math.max(0, stop - HISTORY_PAGE);
  let start = stop;
  let chars = 0;
  for (let index = stop - 1; index >= limit; index--) {
    const size = messageChars(messages[index]!);
    if (chars + size > HISTORY_CHARS && index < stop - 1) {
      break;
    }
    chars += size;
    start = index;
  }
  return { messages: messages.slice(start, stop), offset: start };
}

// The tail of the history: the panel opens the chat with it.
export function historyTail(messages: UiMessage[]): { messages: UiMessage[]; offset: number } {
  return takeHistory(messages, messages.length);
}

// The older part of the history: the messages before the ones the panel
// holds.
export function historyPage(
  messages: UiMessage[],
  offset: number
): { messages: UiMessage[]; offset: number } {
  return takeHistory(messages, offset);
}
