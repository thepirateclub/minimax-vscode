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
    // The same arithmetic as the write itself: replace_all replaces every
    // occurrence and keeps the dollars literal, a single replace takes the
    // first occurrence and expands the dollar patterns. The reader approves
    // this diff, it must be the diff that lands on the disk.
    newText =
      oldString.length === 0
        ? oldText
        : input['replace_all'] === true
          ? oldText.split(oldString).join(newString)
          : oldText.replace(oldString, newString);
  }

  return { path, lines: diffLines(oldText, newText) };
}
