import { MAX_HISTORY_MESSAGES, trimHistory } from '../api/history';
import type { UiDiffLine, UiMessage } from '../ui/protocol';
import type { StoredSession } from './sessions';

// A long chat must not fill the state of the host, the oldest parts are cut.
export const MAX_STORED_SESSIONS = 50;
export const MAX_STORED_MESSAGES = 400;
// The default of the stored history, the setting of the panel overrides it.
export const MAX_STORED_HISTORY = MAX_HISTORY_MESSAGES;
// The setting of the panel allows more messages, the characters stay bounded:
// the state of the host holds the history of every chat.
export const MAX_STORED_HISTORY_CHARS = 2_000_000;
// The bounds of the setting, a chat may not ask for more than it offers.
const MIN_HISTORY_MESSAGES = 10;
const MAX_HISTORY_SETTING = 1000;
export const MAX_STORED_MESSAGE_CHARS = 200_000;
export const MAX_STORED_DIFF_LINES = 600;
export const MAX_STORED_PROGRESS_LINES = 600;
// The journal is bounded by the characters too, the same way the content of
// a message is bounded.
export const MAX_STORED_PROGRESS_CHARS = MAX_STORED_MESSAGE_CHARS;
export const MAX_STORED_USAGE_TURNS = 24;
export const MAX_STORED_TURNS = 50;
export const MAX_STORED_TODOS = 200;
// The queue of a chat does not grow forever.
export const MAX_STORED_QUEUE = 30;
// The whole size of a chat is bounded too. A bound per message is not
// enough: a hundred messages of the bound each fill the state of the host,
// and the state of the host is written on every turn.
export const MAX_STORED_SESSION_CHARS = 2_000_000;

// The marker of the cut of a message. The reader has to know that the
// text is not whole, otherwise the answer looks like it ended there.
const MESSAGE_CUT = '... the message is cut ...';

// The text of a message is bounded by the characters. The head and the tail
// of the message survive, the marker stands in the middle of it.
function capText(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  if (text.length <= MAX_STORED_MESSAGE_CHARS) {
    return text;
  }
  const budget = MAX_STORED_MESSAGE_CHARS - MESSAGE_CUT.length;
  const half = Math.floor(budget / 2);
  return (
    text.slice(0, half) +
    MESSAGE_CUT +
    text.slice(text.length - (budget - half))
  );
}

// A long change would fill the state of the host, the middle of it is cut.
function capDiff(diff: { path: string; lines: UiDiffLine[] }): { path: string; lines: UiDiffLine[] } {
  if (diff.lines.length <= MAX_STORED_DIFF_LINES) {
    return diff;
  }
  const half = Math.floor(MAX_STORED_DIFF_LINES / 2);
  return {
    path: diff.path,
    lines: [
      ...diff.lines.slice(0, half),
      { type: 'context', text: '... the change is cut ...' },
      ...diff.lines.slice(-half)
    ]
  };
}

// The marker of the cut, it stands in the middle of the journal.
const PROGRESS_CUT = '... the journal is cut ...';

// A long journal of a sub-agent would fill the state of the host, the
// middle of it is cut. The bound of the lines and the bound of the
// characters hold it.
function capProgress(lines: string[]): string[] {
  return capProgressChars(capProgressLines(lines));
}

// The bound of the lines, the head and the tail of the journal survive.
function capProgressLines(lines: string[]): string[] {
  if (lines.length <= MAX_STORED_PROGRESS_LINES) {
    return lines;
  }
  const half = Math.floor(MAX_STORED_PROGRESS_LINES / 2);
  return [...lines.slice(0, half), PROGRESS_CUT, ...lines.slice(-half)];
}

// The bound of the characters. One very long line would fill the state of
// the host, the journal is cut the same way a change is cut: the first half,
// the marker, the last half.
function capProgressChars(lines: string[]): string[] {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  if (total <= MAX_STORED_PROGRESS_CHARS) {
    return lines;
  }
  const budget = Math.floor((MAX_STORED_PROGRESS_CHARS - PROGRESS_CUT.length) / 2);
  const head: string[] = [];
  let headChars = 0;
  for (const line of lines) {
    if (headChars + line.length > budget) {
      // The line is longer than its share, it is cut by itself.
      const room = budget - headChars;
      if (room > 0) {
        head.push(line.slice(0, room));
      }
      break;
    }
    head.push(line);
    headChars += line.length;
  }
  const tail: string[] = [];
  let tailChars = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    if (tailChars + line.length > budget) {
      const room = budget - tailChars;
      if (room > 0) {
        tail.unshift(line.slice(line.length - room));
      }
      break;
    }
    tail.unshift(line);
    tailChars += line.length;
  }
  return [...head, PROGRESS_CUT, ...tail];
}

function capMessage(message: UiMessage): UiMessage {
  return {
    ...message,
    text: capText(message.text),
    thinking: capText(message.thinking),
    tool: message.tool
      ? {
          ...message.tool,
          content: capText(message.tool.content),
          diff: message.tool.diff ? capDiff(message.tool.diff) : undefined,
          progress: message.tool.progress
            ? capProgress(message.tool.progress)
            : undefined
        }
      : undefined
  };
}

// The size of a message of the chat: the text of the answer, the text of
// the thinking and the result of the tool.
function messageChars(message: UiMessage): number {
  const tool = message.tool;
  return (
    (message.text?.length ?? 0) +
    (message.thinking?.length ?? 0) +
    (tool?.content?.length ?? 0) +
    (tool?.progress?.reduce((sum, line) => sum + line.length, 0) ?? 0)
  );
}

// The whole chat is bounded by the characters. The oldest messages go away
// first, the newest ones are the ones the reader needs.
function capSessionSize(messages: UiMessage[]): UiMessage[] {
  let total = 0;
  for (const message of messages) {
    total += messageChars(message);
  }
  if (total <= MAX_STORED_SESSION_CHARS) {
    return messages;
  }
  const kept: UiMessage[] = [];
  let size = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const chars = messageChars(message);
    if (size + chars > MAX_STORED_SESSION_CHARS && kept.length > 0) {
      break;
    }
    size += chars;
    kept.unshift(message);
  }
  return kept;
}

// The limit of the history comes from the setting of the panel: the user who
// raised it expects the whole chat after a reload, not the first hundred
// messages of it.
export function capSession(
  session: StoredSession,
  historyLimit: number = MAX_STORED_HISTORY
): StoredSession {
  const limit = Math.max(
    MIN_HISTORY_MESSAGES,
    Math.min(Number.isFinite(historyLimit) ? Math.floor(historyLimit) : MAX_STORED_HISTORY, MAX_HISTORY_SETTING)
  );
  const uiMessages = capSessionSize(
    session.uiMessages.slice(-MAX_STORED_MESSAGES).map(capMessage)
  );
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    workspaceRoot: session.workspaceRoot,
    messages: trimHistory(session.messages, limit, MAX_STORED_HISTORY_CHARS),
    uiMessages,
    usage: session.usage.slice(-MAX_STORED_USAGE_TURNS),
    turns: (session.turns ?? []).slice(-MAX_STORED_TURNS),
    todos: (session.todos ?? []).slice(-MAX_STORED_TODOS),
    goal: session.goal,
    queue: (session.queue ?? []).slice(-MAX_STORED_QUEUE)
  };
}
