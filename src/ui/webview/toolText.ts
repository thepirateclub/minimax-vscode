import { STRINGS } from './strings';

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

// The arguments are shown as a short list, not as a json dump.
export function formatInput(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const shown = text(value);
    if (shown.length === 0) {
      continue;
    }
    lines.push(key + ': ' + (shown.length > 200 ? shown.slice(0, 200) + '…' : shown));
  }
  return lines.join('\n');
}

// The question of an approval names the action in the words of the card of
// the action, not the name of the tool: "Write src/app.ts?", not
// "Run write_file?".
export function approvalTitle(name: string, input: Record<string, unknown>): string {
  const path = text(input['path']);
  if (name === 'write_file' && path.length > 0) {
    return STRINGS.toolWrite + ' ' + path + '?';
  }
  if (name === 'edit_file' && path.length > 0) {
    return STRINGS.toolEdit + ' ' + path + '?';
  }
  if (name === 'run_terminal') {
    return STRINGS.approveCommand;
  }
  return STRINGS.approveTool + ' ' + name + '?';
}
