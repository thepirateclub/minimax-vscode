import { applyEdit } from './editMatch';
import { readFile } from 'node:fs/promises';
import { diffLines } from './diff';
import { resolveWorkspacePath } from './fs';
import type { DiffPreview } from '../ui/approvals';

export async function buildPreview(
  toolName: string,
  input: Record<string, unknown>,
  workspaceRoot: string
): Promise<DiffPreview | undefined> {
  if (toolName !== 'write_file' && toolName !== 'edit_file') {
    return undefined;
  }
  const path = String(input['path'] ?? '');
  if (path.length === 0) {
    return undefined;
  }
  let oldText = '';
  try {
    oldText = await readFile(resolveWorkspacePath(workspaceRoot, path), 'utf8');
  } catch {
    oldText = '';
  }

  let newText: string;
  if (toolName === 'write_file') {
    newText = String(input['content'] ?? '');
  } else {
    const oldString = String(input['old_string'] ?? '');
    const newString = String(input['new_string'] ?? '');
    // The same arithmetic as the write itself (src/tools/editMatch.ts):
    // the reader approves this diff, it must be the diff that lands on the
    // disk. A failed edit changes nothing.
    const edit = applyEdit(oldText, oldString, newString, input['replace_all'] === true);
    newText = edit.ok ? edit.text : oldText;
  }

  return { path, lines: diffLines(oldText, newText) };
}
