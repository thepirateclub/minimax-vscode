import { isAbsolute, relative, resolve } from 'node:path';
import { repoRoot, runGit } from './cli';
import { parseStatus } from './parse';

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
}

// The mark of git is one letter. A file that is not in the index yet is
// a new one, the mark of the conflict counts as a change.
export function statusOf(staged: string, unstaged: string): ChangedFileStatus {
  const mark = staged !== ' ' && staged !== '?' ? staged : unstaged;
  if (mark === 'A' || mark === '?') {
    return 'added';
  }
  if (mark === 'D') {
    return 'deleted';
  }
  if (mark === 'R' || mark === 'C') {
    return 'renamed';
  }
  return 'modified';
}

// The path of git is relative to the root of the repository, the reader
// knows the path relative to the workspace root.
function toWorkspacePath(workspaceRoot: string, root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(resolve(workspaceRoot), absolute);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    return path.split(/[\\/]/).join('/');
  }
  return rel.split(/[\\/]/).join('/');
}

// The files that the last action changed. The source is the state of the
// repository, the same state that git_status reads.
export async function readChangedFiles(
  workspaceRoot: string
): Promise<ChangedFile[]> {
  const root = await repoRoot(workspaceRoot);
  if (!root) {
    return [];
  }
  const result = await runGit(root, ['status', '--porcelain=v1', '-uall']);
  if (result.code !== 0) {
    return [];
  }
  const status = parseStatus(result.stdout);
  const files: ChangedFile[] = [];
  for (const file of status.files) {
    files.push({
      path: toWorkspacePath(workspaceRoot, root, file.path),
      status: statusOf(file.staged, file.unstaged)
    });
  }
  return files;
}