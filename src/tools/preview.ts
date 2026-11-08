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
    newText = oldString.length > 0 ? oldText.replace(oldString, newString) : oldText;
  }

  return { path, lines: diffLines(oldText, newText) };
}
