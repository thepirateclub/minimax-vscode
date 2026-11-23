import { STRINGS } from './strings';
import { text } from './value';

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
  if (name === 'git_stage') {
    const paths = Array.isArray(input['paths'])
      ? input['paths'].filter((item): item is string => typeof item === 'string')
      : [];
    if (paths.length > 0) {
      const verb = input['unstage'] === true ? STRINGS.toolGitUnstage : STRINGS.toolGitStage;
      return verb + ' ' + paths.join(', ') + '?';
    }
  }
  if (name === 'git_commit') {
    const message = text(input['message']);
    if (message.length > 0) {
      return STRINGS.toolGitCommit + ' ' + message + '?';
    }
  }
  if (name === 'git_branch_create') {
    const branch = text(input['name']);
    if (branch.length > 0) {
      return STRINGS.toolGitBranchCreate + ' ' + branch + '?';
    }
  }
  if (name === 'git_checkout') {
    const ref = text(input['ref']);
    if (ref.length > 0) {
      return STRINGS.toolGitCheckout + ' ' + ref + '?';
    }
  }
  return STRINGS.approveTool + ' ' + name + '?';
}
