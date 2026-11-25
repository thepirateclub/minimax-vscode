import type { UiChangedFile } from '../ui/protocol';
import type { ChangedFile } from '../tools/types';

// The path of a file is the same in both lists: the slashes and the leading
// './' do not make a difference.
export function fileKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

// The files the agent changed, the last status of a path wins: the agent
// wrote the file and deleted it later.
export function rememberChangedFiles(
  list: readonly ChangedFile[],
  changed: readonly ChangedFile[]
): ChangedFile[] {
  const result = [...list];
  for (const file of changed) {
    const key = fileKey(file.path);
    const index = result.findIndex((item) => fileKey(item.path) === key);
    if (index >= 0) {
      result[index] = { path: key, status: file.status };
    } else {
      result.push({ path: key, status: file.status });
    }
  }
  return result;
}

// The list of the panel: the files the agent changed come first, then the
// rest of the working tree. The agent knows the status of its own files
// better than the state of the repository: it created the file or changed
// it. The state of the repository does not see a file that lies in an
// ignored folder, and a file that is already committed is not a change of
// the working tree.
export function mergeChangedFiles(
  agent: readonly ChangedFile[],
  repo: readonly UiChangedFile[]
): UiChangedFile[] {
  const merged: UiChangedFile[] = [];
  const seen = new Set<string>();
  for (const file of agent) {
    const key = fileKey(file.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ path: key, status: file.status });
  }
  for (const file of repo) {
    const key = fileKey(file.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ path: key, status: file.status });
  }
  return merged;
}

// The files that went back to the state before the turn leave the list.
export function forgetChangedFiles(
  list: readonly ChangedFile[],
  paths: readonly string[]
): ChangedFile[] {
  const gone = new Set(paths.map(fileKey));
  return list.filter((file) => !gone.has(fileKey(file.path)));
}

// The reader closed the list: the files of that moment leave it, the list
// shows only what changes after. A closed file with a new status is a new
// change and comes back.
export function dismissKeys(files: readonly { path: string; status: string }[]): Set<string> {
  return new Set(files.map((file) => fileKey(file.path) + '|' + file.status));
}

export function withoutDismissed<T extends { path: string; status: string }>(
  files: readonly T[],
  dismissed: ReadonlySet<string>
): T[] {
  return files.filter((file) => !dismissed.has(fileKey(file.path) + '|' + file.status));
}
