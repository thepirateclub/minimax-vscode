// The scroll of the message list is a decision of its own, the component
// only reports what it sees. The reader follows the answer while the list
// stays at the bottom, a streamed text grows inside the same message, so
// the number of the messages alone does not tell that the list changed.

// How close to the bottom the list still counts as the bottom.
export const BOTTOM_GAP = 80;

export interface ListState {
  count: number;
  textLength: number;
}

export interface MeasurableMessage {
  text?: string;
  tool?: { content?: string };
}

export function isAtBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  gap: number = BOTTOM_GAP
): boolean {
  return scrollHeight - scrollTop - clientHeight <= gap;
}

// The size of the content, a streamed answer and a running tool both grow
// without adding a message.
export function measure(messages: MeasurableMessage[]): ListState {
  let textLength = 0;
  for (const message of messages) {
    textLength += message.text?.length ?? 0;
    textLength += message.tool?.content?.length ?? 0;
  }
  return { count: messages.length, textLength };
}

export function contentChanged(previous: ListState, next: ListState): boolean {
  return next.count !== previous.count || next.textLength !== previous.textLength;
}

// The list follows the content only while the reader stays at the bottom.
export function shouldFollow(
  previous: ListState,
  next: ListState,
  atBottom: boolean
): boolean {
  if (!contentChanged(previous, next)) {
    return false;
  }
  return atBottom;
}
