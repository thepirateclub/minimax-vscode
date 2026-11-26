import type { UiMessage } from '../protocol';

// The command that ran before a message. The header of a code block can be
// named after the command whose output it quotes.
export interface CommandHint {
  // The command line as the agent ran it.
  command: string;
  // The output of the command.
  output: string;
}

// The tool that runs a command in the terminal.
const TERMINAL_TOOL = 'run_terminal';

// The hint of the command for every message of the chat: the command that
// ran before it. The message of the command itself has no hint yet.
export function commandHints(messages: UiMessage[]): Array<CommandHint | undefined> {
  const hints: Array<CommandHint | undefined> = [];
  let last: CommandHint | undefined;
  for (const message of messages) {
    hints.push(last);
    const hint = hintOf(message);
    if (hint) {
      last = hint;
    }
  }
  return hints;
}

// The hint of a card keeps its object while the card does not change: the
// row of a message is memoized, a fresh object on every flush of the stream
// drew every row again.
const hintCache = new WeakMap<object, CommandHint>();

export function hintOf(message: UiMessage): CommandHint | undefined {
  const tool = message.tool;
  if (message.role !== 'tool' || !tool || tool.name !== TERMINAL_TOOL) {
    return undefined;
  }
  const cached = hintCache.get(tool);
  if (cached) {
    return cached;
  }
  const made = makeHint(tool);
  if (made) {
    hintCache.set(tool, made);
  }
  return made;
}

function makeHint(tool: NonNullable<UiMessage['tool']>): CommandHint | undefined {
  const command = tool.input['command'];
  if (typeof command !== 'string' || command.trim().length === 0) {
    return undefined;
  }
  return { command: command.trim(), output: tool.content ?? '' };
}
