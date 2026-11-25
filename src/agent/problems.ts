// The reader sends the Problems of the editor to the agent with `@problems`
// in the request: the errors and the warnings of the language servers over
// the workspace, the way Continue and Cline attach them. The agent layer does
// not know the editor, the host reads the diagnostics and passes them here.

import type { RawDiagnostic } from '../tools/diagnostics';

const MAX_PROBLEMS = 50;
const PROBLEMS_MENTION = /(?:^|\s)@problems(?=$|[\s,;:!?]|\.(?:\s|$))/i;

export function mentionsProblems(text: string): boolean {
  return PROBLEMS_MENTION.test(text);
}

export interface FileDiagnostics {
  // The path relative to the workspace.
  path: string;
  diagnostics: RawDiagnostic[];
}

// One line per problem, the errors first, the information and the hints
// dropped: they are noise for a fix. An empty list says so, the model must
// not think the block was lost.
export function formatWorkspaceProblems(files: readonly FileDiagnostics[]): string {
  const rows = files.flatMap((file) =>
    file.diagnostics
      .filter((item) => item.severity === 0 || item.severity === 1)
      .map((item) => ({ path: file.path, ...item }))
  );
  rows.sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line);
  if (rows.length === 0) {
    return 'Problems of the workspace: none, the editor reports no errors and no warnings.';
  }
  const shown = rows.slice(0, MAX_PROBLEMS).map(
    (row) =>
      '- ' + row.path + ':' + (row.line + 1) + ' ' + (row.severity === 0 ? 'error' : 'warning') +
      (row.source ? ' [' + row.source + ']' : '') + ': ' + row.message.replace(/\s+/g, ' ').trim()
  );
  if (rows.length > MAX_PROBLEMS) {
    shown.push('... and ' + (rows.length - MAX_PROBLEMS) + ' more');
  }
  return 'Problems of the workspace (' + rows.length + '):\n' + shown.join('\n');
}
