import { repoRoot, runGit } from './cli';
import { parseStatus, type GitStatus } from './parse';

export interface RepositoryState {
  // The root of the repository, it may differ from the workspace root.
  root: string;
  status: GitStatus;
  lastCommit: string;
}

// The state of the repository that holds the workspace. It is undefined when
// the workspace is not a part of a repository.
export async function readRepositoryState(
  workspaceRoot: string
): Promise<RepositoryState | undefined> {
  const root = await repoRoot(workspaceRoot);
  if (!root) {
    return undefined;
  }
  const status = await runGit(root, ['status', '--porcelain=v1', '-b', '--untracked-files=all']);
  if (status.code !== 0) {
    return undefined;
  }
  const log = await runGit(root, ['log', '-1', '--pretty=format:%h %s']);
  return {
    root,
    status: parseStatus(status.stdout),
    lastCommit: log.code === 0 ? log.stdout.trim() : ''
  };
}

// The short lines of the state, they go into the prompt of the model.
export function summarizeState(state: RepositoryState): string[] {
  const status = state.status;
  const lines: string[] = [];
  const branch = status.detached ? 'HEAD (detached)' : status.branch;
  let head = 'Branch: ' + branch;
  if (status.upstream.length > 0) {
    head += ', upstream ' + status.upstream;
    if (status.ahead > 0) {
      head += ', ahead ' + status.ahead;
    }
    if (status.behind > 0) {
      head += ', behind ' + status.behind;
    }
  }
  lines.push(head);
  const staged = status.files.filter((file) => file.staged !== ' ' && file.staged !== '?').length;
  const modified = status.files.filter((file) => file.unstaged !== ' ' && file.unstaged !== '?').length;
  const untracked = status.files.filter((file) => file.unstaged === '?').length;
  const parts: string[] = [];
  if (staged > 0) {
    parts.push(staged + ' staged');
  }
  if (modified > 0) {
    parts.push(modified + ' modified');
  }
  if (untracked > 0) {
    parts.push(untracked + ' untracked');
  }
  lines.push('Changes: ' + (parts.length > 0 ? parts.join(', ') : 'clean'));
  if (state.lastCommit.length > 0) {
    lines.push('Last commit: ' + state.lastCommit);
  }
  return lines;
}
