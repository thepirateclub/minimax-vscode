import type { UiDiffLine, UiMessage, UiToolCall } from './protocol';
import { describe } from './webview/components/toolDescriptions';

// The chat as Markdown: the reader keeps or shares it outside the editor.
// The module knows nothing of vscode, the host only asks where to save it.
export interface ChatExport {
  title: string;
  updatedAt: number;
  uiMessages: UiMessage[];
}

const DIFF_MARK: Record<UiDiffLine['type'], string> = { add: '+', remove: '-', context: ' ' };

// A fence longer than any run of backticks in the text, so a code block of
// the answer does not close the block of the export.
export function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenced(text: string, lang: string): string {
  const fence = fenceFor(text);
  return fence + lang + '\n' + text + '\n' + fence;
}

// The card of an action is one line in the words of its folded card: the
// export reads as the feed, not as a dump of the arguments.
export function toolLine(tool: UiToolCall): string {
  const view = describe(tool, true);
  const mark = tool.isError ? '✗' : '✓';
  const summary = view.summary.trim();
  return '- ' + mark + ' ' + view.title + (summary ? ' — ' + summary : '');
}

function diffBlock(tool: UiToolCall): string | undefined {
  const diff = tool.diff;
  if (!diff || diff.lines.length === 0) {
    return undefined;
  }
  const body = diff.lines.map((line) => DIFF_MARK[line.type] + line.text).join('\n');
  return fenced(body, 'diff');
}

// The thinking is folded as in the panel: a details block hides it.
function thinkingBlock(thinking: string): string {
  // A `</details>` inside the thought would close the block early.
  const text = thinking.trim().replace(/<\/details>/gi, '&lt;/details&gt;');
  return '<details>\n<summary>Thinking</summary>\n\n' + text + '\n\n</details>';
}

function messageBlocks(message: UiMessage): string[] {
  if (message.role === 'user') {
    return ['## User', (message.text ?? '').trim()];
  }
  if (message.role === 'assistant') {
    const parts: string[] = [];
    if (message.thinking?.trim()) {
      parts.push(thinkingBlock(message.thinking));
    }
    if (message.text?.trim()) {
      parts.push(message.text.trim());
    }
    return parts.length > 0 ? ['## Assistant', ...parts] : [];
  }
  if (message.role === 'tool' && message.tool) {
    const diff = diffBlock(message.tool);
    return diff ? [toolLine(message.tool), diff] : [toolLine(message.tool)];
  }
  if (message.role === 'notice' && message.text?.trim()) {
    return ['> ' + message.text.trim().replace(/\n/g, '\n> ')];
  }
  return [];
}

export function chatToMarkdown(chat: ChatExport): string {
  // An old chat can carry a line break in its title, the heading is one line.
  const title = chat.title.replace(/\s+/g, ' ').trim();
  const blocks = ['# ' + (title || 'Chat'), '_Exported ' + new Date(chat.updatedAt).toISOString() + '_'];
  // The last block is a list of actions, the next action joins it.
  let openList = false;
  for (const message of chat.uiMessages) {
    // An approval card is a question of a finished turn, not a part of it.
    if (message.approval) {
      continue;
    }
    const parts = messageBlocks(message);
    if (parts.length === 0) {
      continue;
    }
    // The actions in a row read as one list, not as lists apart.
    if (message.role === 'tool' && openList) {
      blocks[blocks.length - 1] += '\n' + parts[0];
      blocks.push(...parts.slice(1));
    } else {
      blocks.push(...parts);
    }
    openList = message.role === 'tool' && parts.length === 1;
  }
  return blocks.join('\n\n') + '\n';
}

// The name of the file is the title of the chat without the signs a file
// system refuses.
export function exportFileName(title: string): string {
  // Windows refuses a name that ends with a dot or a space, and the names of
  // its devices (CON, NUL, COM1 and so on) with any extension.
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(base) ? base + ' chat' : base;
  return (safe || 'chat') + '.md';
}
