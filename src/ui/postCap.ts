import type { ExtToWeb, UiMessage } from './protocol';

// The volume of one message to the panel is bounded: a big message is slow
// to transfer and to draw, the panel draws it in one go.
export const MAX_POST_CHARS = 200_000;

// The marker of the cut. The reader has to know that the text is not
// whole, otherwise the result looks like it ended there.
export const POST_CUT = '... the result is cut ...';

// The text is cut in the middle: the head and the tail survive.
export function capText(text: string, limit?: number): string;
export function capText(text: string | undefined, limit?: number): string | undefined;
export function capText(text: string | undefined, limit: number = MAX_POST_CHARS): string | undefined {
  if (text === undefined || text.length <= limit) {
    return text;
  }
  const budget = limit - POST_CUT.length;
  const half = Math.floor(budget / 2);
  return text.slice(0, half) + POST_CUT + text.slice(text.length - (budget - half));
}

// One message of the chat: the text of the answer, the text of the
// thinking and the result of the tool.
export function capMessage(message: UiMessage): UiMessage {
  return {
    ...message,
    text: capText(message.text),
    thinking: capText(message.thinking),
    tool: message.tool
      ? {
          ...message.tool,
          content: capText(message.tool.content)
        }
      : undefined
  };
}

// The message goes to the panel in this form: the big texts are cut. The
// history is not cut here, the host sends it in parts.
export function capPost(message: ExtToWeb): ExtToWeb {
  if (message.type === 'tool_end') {
    return { ...message, content: capText(message.content) };
  }
  if (message.type === 'init') {
    return {
      ...message,
      state: {
        ...message.state,
        messages: message.state.messages.map(capMessage)
      }
    };
  }
  if (message.type === 'session_loaded' || message.type === 'history_older') {
    return { ...message, messages: message.messages.map(capMessage) };
  }
  return message;
}
