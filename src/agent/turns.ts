import { balanceHistory } from '../api/history';
import type { AnthropicMessage } from '../api/types';
import type { UiMessage, UiSelection } from '../ui/protocol';

// The anchor of a request in the conversation. It tells where the request
// sits in the history of the model, so the chat can roll back to it and run
// it again.
export interface TurnAnchor {
  // The id of the message of the user.
  uiId: string;
  // The text of the request.
  text: string;
  // The place of the request in the history of the model.
  historyIndex: number;
  // The files of the request, a repeated request reads them again.
  mentions: string[];
  // The code of the editor that the request carried.
  selections: UiSelection[];
  // The moment the turn started, the rewind takes back the files the agent
  // changed since then. Absent in an anchor of an older version.
  startedAt?: number;
}

// The message of the user holds the text of the request, the messages of the
// tools hold the results and are not requests.
function isRequest(message: AnthropicMessage, text: string): boolean {
  if (message.role !== 'user') {
    return false;
  }
  // A message that carries the result of a tool call is not a request,
  // even when it holds the text of one.
  if (message.content.some((block) => block.type === 'tool_result')) {
    return false;
  }
  return message.content.some(
    (block) => block.type === 'text' && block.text.startsWith(text)
  );
}

// The cut of the history must not split a call of a tool from its result:
// the model would see a call without the answer and the API would refuse
// the request.
export function cutHistory(messages: AnthropicMessage[], cut: number): AnthropicMessage[] {
  const end = Math.max(0, Math.min(cut, messages.length));
  return balanceHistory(messages.slice(0, end));
}

// Where the request sits in the history. The place is known from the turn
// before, the history can lose the old messages and the place moves then.
export function findRequestIndex(
  history: AnthropicMessage[],
  text: string,
  hint?: number
): number {
  if (hint !== undefined && hint >= 0 && hint < history.length && isRequest(history[hint]!, text)) {
    return hint;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    if (isRequest(history[i]!, text)) {
      return i;
    }
  }
  return -1;
}

// The turn a message belongs to: the last request that stands before it.
export function turnOfMessage(
  turns: TurnAnchor[],
  messages: UiMessage[],
  targetId: string
): TurnAnchor | undefined {
  const index = messages.findIndex((message) => message.id === targetId);
  if (index === -1) {
    return undefined;
  }
  let found: TurnAnchor | undefined;
  let foundAt = -1;
  for (const turn of turns) {
    const at = messages.findIndex((message) => message.id === turn.uiId);
    if (at === -1 || at > index || at < foundAt) {
      continue;
    }
    found = turn;
    foundAt = at;
  }
  return found;
}
