import type { UiToolCall } from '../protocol';

// The preview of a folded section of the chat: one line that says what the
// section holds, so the reader knows what he opens before he opens it.

// How many words of the reasoning the preview takes. The reasoning is a long
// text, the preview is one line of the chat.
export const PREVIEW_WORDS = 50;
// The bound of the characters of the preview: a long word is cut earlier
// than the bound of the words, the line has to fit the panel of the editor.
export const PREVIEW_CHARS = 240;

// The preview of the reasoning: the first words of it in one line, with the
// ellipsis when the text did not fit.
export function thinkingPreview(text: string): string {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    if (kept.length >= PREVIEW_WORDS) {
      break;
    }
    const next = length + (kept.length > 0 ? 1 : 0) + word.length;
    if (next > PREVIEW_CHARS) {
      break;
    }
    kept.push(word);
    length = next;
  }
  const cut = kept.length < words.length;
  return kept.join(' ') + (cut ? '…' : '');
}

// The preview of the actions: the last action of the group, the name of the
// tool and the object of it.
export function actionPreview(tool: UiToolCall): string {
  const target = toolTarget(tool);
  return target.length > 0 ? tool.name + ' ' + target : tool.name;
}

// The object of the action: the file, the command, the query of the tool.
export function toolTarget(tool: UiToolCall): string {
  const input = tool.input ?? {};
  for (const key of ['path', 'command', 'query', 'ref', 'branch', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  const patterns = input['patterns'];
  if (Array.isArray(patterns) && patterns.length > 0) {
    return patterns.map((item) => String(item)).join(' ');
  }
  return '';
}
