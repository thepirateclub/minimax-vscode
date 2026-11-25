import { stat, unlink } from 'node:fs/promises';
import { resolveWorkspacePath } from '../paths';
import { formatBytes } from '../ui/format';
import type { ToolEntry } from './types';

// The tool of the deletion. One call deletes one file or a list of files.
export const DELETE_TOOL_NAME = 'delete_files';

// One call deletes several files, the list is bounded so a single request
// stays sane.
const MAX_DELETE_FILES = 50;

export interface DeleteTarget {
  // The path as the model gave it.
  path: string;
  // The absolute path in the workspace, absent when the path leaves it.
  target?: string;
  // The size of the file, absent when the disk did not answer.
  bytes?: number;
  // The path is a folder, the tool deletes files only.
  directory: boolean;
  // The file is not on the disk.
  missing: boolean;
  // The refusal of this path.
  error?: string;
}

export interface DeletePlan {
  files: DeleteTarget[];
  // The sum of the sizes of the files.
  totalBytes: number;
  // Every size of the plan is known.
  sizesKnown: boolean;
}

// The file of the card of the confirmation: the path and the size.
export interface DeleteCardFile {
  path: string;
  bytes?: number;
}

// The paths of the call: one file or a list of files.
export function collectDeletePaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const single = input['path'];
  if (typeof single === 'string' && single.trim().length > 0) {
    paths.push(single.trim());
  }
  const many = input['paths'];
  if (Array.isArray(many)) {
    for (const item of many) {
      if (typeof item !== 'string') {
        continue;
      }
      const path = item.trim();
      if (path.length > 0 && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }
  return paths.slice(0, MAX_DELETE_FILES);
}

// The plan of the deletion: what the files are, how big they are and which
// of them the tool has to refuse. The plan is built before the card of the
// confirmation, the reader sees the list of the files before he answers.
export async function planDelete(
  input: Record<string, unknown>,
  workspaceRoot: string
): Promise<DeletePlan> {
  const files: DeleteTarget[] = [];
  let totalBytes = 0;
  let sizesKnown = true;
  for (const path of collectDeletePaths(input)) {
    let target: string | undefined;
    let error: string | undefined;
    try {
      target = resolveWorkspacePath(workspaceRoot, path);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (target === undefined) {
      files.push({ path, directory: false, missing: false, error });
      continue;
    }
    let bytes: number | undefined;
    let directory = false;
    let missing = false;
    try {
      const info = await stat(target);
      directory = info.isDirectory();
      if (!directory) {
        bytes = info.size;
      }
    } catch {
      missing = true;
    }
    if (bytes === undefined) {
      sizesKnown = false;
    } else {
      totalBytes += bytes;
    }
    files.push({ path, target, bytes, directory, missing });
  }
  return { files, totalBytes, sizesKnown };
}

// The files of the card of the confirmation of a deletion.
export async function deleteCardFiles(
  input: Record<string, unknown>,
  workspaceRoot: string
): Promise<DeleteCardFile[]> {
  const plan = await planDelete(input, workspaceRoot);
  return plan.files.map((file) =>
    file.bytes === undefined ? { path: file.path } : { path: file.path, bytes: file.bytes }
  );
}

// The files of the card of the confirmation, empty for the other tools.
export async function approvalFiles(
  toolName: string,
  input: Record<string, unknown>,
  workspaceRoot: string
): Promise<DeleteCardFile[]> {
  if (toolName !== DELETE_TOOL_NAME) {
    return [];
  }
  return await deleteCardFiles(input, workspaceRoot);
}

export function createDeleteTools(): ToolEntry[] {
  const deleteFiles: ToolEntry = {
    name: DELETE_TOOL_NAME,
    description:
      'Delete one file or several files from the workspace. The user sees the list of the files with their size and confirms the deletion every time, no rule of the session covers it. The deletion is permanent, the files do not go to the trash. Directories are not deleted, delete the files inside them one by one. Never delete a file with a shell command, this tool is the only way.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file relative to the workspace root.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths of the files relative to the workspace root, deleted in one call.'
        }
      }
    },
    async execute(input, ctx) {
      if (collectDeletePaths(input).length === 0) {
        return { content: 'delete_files failed: no path given', isError: true };
      }
      const plan = await planDelete(input, ctx.workspaceRoot);
      const outside = plan.files.find((file) => file.error !== undefined);
      if (outside) {
        return {
          content: 'delete_files refused: ' + String(outside.error),
          isError: true
        };
      }
      const folder = plan.files.find((file) => file.directory);
      if (folder) {
        return {
          content:
            'delete_files refused: ' +
            folder.path +
            ' is a directory, the tool deletes files only. Delete the files inside it one by one.',
          isError: true
        };
      }
      const ghost = plan.files.find((file) => file.missing);
      if (ghost) {
        return {
          content: 'delete_files refused: ' + ghost.path + ' does not exist',
          isError: true
        };
      }
      const deleted: string[] = [];
      const failed: string[] = [];
      for (const file of plan.files) {
        try {
          await unlink(String(file.target));
          deleted.push(file.path);
        } catch (failure) {
          failed.push(
            file.path +
              ': ' +
              (failure instanceof Error ? failure.message : String(failure))
          );
        }
      }
      if (failed.length > 0) {
        return {
          content:
            'delete_files failed: ' +
            failed.join(', ') +
            (deleted.length > 0 ? '\nDeleted before the failure: ' + deleted.join(', ') : ''),
          isError: true
        };
      }
      const lines = plan.files.map(
        (file) =>
          '- ' +
          file.path +
          (file.bytes === undefined ? '' : ' (' + formatBytes(file.bytes) + ')')
      );
      const count = deleted.length;
      return {
        content:
          'Deleted ' +
          count +
          (count === 1 ? ' file, ' : ' files, ') +
          formatBytes(plan.totalBytes) +
          ' in total:\n' +
          lines.join('\n') +
          '\nThe deletion is permanent: the files do not go to the trash.',
        isError: false
      };
    }
  };
  return [deleteFiles];
}
