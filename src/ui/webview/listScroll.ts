// The scroll of the message list is a decision of its own, the component
// only reports what it sees. The reader follows the answer while the list
// stays at the bottom, a streamed text grows inside the same message, so
// the number of the messages alone does not tell that the list changed.

// How close to the bottom the list still counts as the bottom.
export const BOTTOM_GAP = 80;

export interface ListState {
  count: number;
  textLength: number;
  // The identity of the list: the ids of the first and of the last message.
  // The history can be replaced by another one of the same size and of the
  // same length of the text, and the count and the length do not see it.
  firstId?: string;
  lastId?: string;
}

export interface MeasurableMessage {
  id?: string;
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
  return {
    count: messages.length,
    textLength,
    firstId: messages[0]?.id,
    lastId: messages[messages.length - 1]?.id
  };
}

export function contentChanged(previous: ListState, next: ListState): boolean {
  return (
    next.count !== previous.count ||
    next.textLength !== previous.textLength ||
    next.firstId !== previous.firstId ||
    next.lastId !== previous.lastId
  );
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

// What the feed does when the content of the list changes.
export type FeedAction =
  // The feed goes to the end of the history.
  | 'bottom'
  // The feed keeps the place of the reader.
  | 'keep'
  // The reader is not at the end, the button of the end counts the new rows.
  | 'pending';

export function feedAction(
  previous: ListState,
  next: ListState,
  atBottom: boolean,
  followEnd: boolean
): FeedAction {
  // The chat was replaced or the request runs again: the feed shows the end
  // of the history and follows the new turn. The old place of the reader
  // does not matter here: the history under him has just been replaced.
  if (followEnd) {
    return 'bottom';
  }
  // Another chat was opened, the feed shows its end.
  if (next.count < previous.count) {
    return 'bottom';
  }
  // Nothing changed.
  if (!contentChanged(previous, next)) {
    return 'keep';
  }
  // The reader is at the end, the feed follows the content.
  return atBottom ? 'bottom' : 'pending';
}
