import type { UiDiffLine, UiToolCall } from '../protocol';

// The chats of the old sessions keep the arguments of an edit, not its diff.
// The panel can still show what the edit did: the replaced lines are gone and
// the new ones are added.
export function editDiff(tool: UiToolCall): UiDiffLine[] | undefined {
  // A failed edit changed nothing, a diff of it would lie. A mass replace
  // touches more than one place, the arguments do not show that.
  if (
    tool.name !== 'edit_file' ||
    tool.isError === true ||
    tool.input['replace_all'] === true
  ) {
    return undefined;
  }
  const lines: UiDiffLine[] = [];
  for (const line of splitLines(text(tool.input['old_string']))) {
    lines.push({ type: 'remove', text: line });
  }
  for (const line of splitLines(text(tool.input['new_string']))) {
    lines.push({ type: 'add', text: line });
  }
  return lines.length > 0 ? lines : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// A text ends with a newline, the empty line after it is not a line.
function splitLines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
