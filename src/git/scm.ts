import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';

export interface GitChange {
  path: string;
  status: string;
}

export interface StagedChanges {
  root: string;
  files: GitChange[];
  diff: string;
  recentSubjects: string[];
  // The changes are not staged, the diff covers the working tree.
  unstaged: boolean;
}

// The part of the API of the git extension that the panel needs. The
// extension publishes no types, the shape is stable for years.
export interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

interface GitExports {
  getAPI(version: 1): {
    repositories: GitRepository[];
  };
}

// How much of the diff goes to the model.
const MAX_DIFF_CHARS = 24_000;
// How much of one new file goes to the model.
const MAX_NEW_FILE_CHARS = 4_000;
// How many new files are described.
const MAX_NEW_FILES = 20;

export async function gitRepositories(): Promise<GitRepository[]> {
  const extension = vscode.extensions.getExtension<GitExports>('vscode.git');
  if (!extension) {
    return [];
  }
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1).repositories ?? [];
  } catch {
    return [];
  }
}

// The message of the commit goes into the input box of the panel.
export function setCommitMessage(repository: GitRepository, message: string): void {
  repository.inputBox.value = message;
}

export function parseNameStatus(output: string): GitChange[] {
  const changes: GitChange[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const parts = line.split('\t');
    const status = (parts[0] ?? '').trim();
    // A rename carries the old path and the new one.
    const path = parts.length >= 3 ? parts[2] ?? '' : parts[1] ?? '';
    if (path.length === 0) {
      continue;
    }
    changes.push({ status: status.charAt(0), path });
  }
  return changes;
}

// The new files are not in any diff, the command of git lists them.
export function parsePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// A new file looks like a diff of its own, the model reads it as an addition.
export function formatNewFile(path: string, content: string): string {
  const body = content.slice(0, MAX_NEW_FILE_CHARS);
  const lines = body.split(/\r?\n/).map((line) => '+' + line);
  return [
    '--- /dev/null',
    '+++ b/' + path,
    '@@ -0,0 +1,' + lines.length + ' @@',
    ...lines
  ].join('\n');
}

export async function collectStagedChanges(root: string): Promise<StagedChanges> {
  const files = parseNameStatus(await git(root, ['diff', '--cached', '--name-status']));
  let diff = await git(root, ['diff', '--cached', '--no-color']);
  let unstaged = false;
  if (diff.trim().length === 0) {
    // Nothing is staged, the changes of the working tree describe the work.
    diff = await git(root, ['diff', 'HEAD', '--no-color']);
    unstaged = true;
  }
  const recentSubjects = (await git(root, ['log', '-10', '--pretty=format:%s']))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // A new file is not in the diff, a commit of a new feature has to mention it.
  const untracked = parsePaths(
    await git(root, ['ls-files', '--others', '--exclude-standard'])
  ).slice(0, MAX_NEW_FILES);
  const additions: string[] = [];
  for (const path of untracked) {
    const content = await readNewFile(root, path);
    if (content.length > 0) {
      additions.push(formatNewFile(path, content));
    }
  }
  const body = [diff.slice(0, MAX_DIFF_CHARS), ...additions]
    .filter((part) => part.length > 0)
    .join('\n');
  return {
    root,
    files: [...files, ...untracked.map((path) => ({ status: 'A', path }))],
    diff: body,
    recentSubjects,
    unstaged
  };
}

// The content of a new file, a binary one is left alone.
async function readNewFile(root: string, path: string): Promise<string> {
  try {
    const buffer = await readFile(join(root, path));
    if (buffer.includes(0)) {
      return '';
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

// A missing git or an empty repository must not throw at the caller.
export async function git(root: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve) => {
    execFile(
      'git',
      ['-C', root, ...args],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        resolve(error ? '' : stdout);
      }
    );
  });
}
