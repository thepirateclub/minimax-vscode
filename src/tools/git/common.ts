import type { ToolExecutionResult } from '../types';
import { runGit, repoRoot, GitRunResult } from '../../git/cli';
import { isAbsolute, relative, resolve } from 'node:path';

export const MAX_DIFF_CHARS = 30_000;
export const MAX_LOG_LINES = 200;
export const DEFAULT_LOG_LINES = 20;
export const MAX_BLAME_LINES = 400;
export const DEFAULT_CONTEXT_LINES = 3;

export interface Repository {
  // The root of the repository, git works in it.
  root: string;
  // The root of the workspace, the paths of the model are relative to it.
  workspace: string;
  // The directory of the command, it is the -C of git.
  base: string;
}

export type Opened = { ok: true; repository: Repository } | { ok: false; error: string };

export function failure(message: string): ToolExecutionResult {
  return { content: message, isError: true };
}

export function commandFailure(result: GitRunResult): ToolExecutionResult {
  const detail = (result.stderr || result.stdout).trim();
  return failure(detail.length > 0 ? detail : 'git failed with exit code ' + result.code);
}

// Git reads everything that starts with a dash as an option of the command.
// The ref of the model is a value, so the separator goes before it: git calls
// it --end-of-options, everything after it is a value and not an option.
// The plain -- cannot be used here, it would turn the ref of the diff into a
// path and the diff would come back empty.
export const END_OF_OPTIONS = '--end-of-options';

// A ref with a dash is read as an option of the command, for example
// --output=<file> of the diff writes a file. The ref of the model is a
// commit, a tag or a branch, it never starts with a dash.
export function checkRef(ref: string, tool: string): string | undefined {
  if (ref.length === 0) {
    return undefined;
  }
  if (ref.startsWith('-')) {
    return tool + ' failed: the ref must not start with a dash';
  }
  if (/[\s\u0000-\u001f]/.test(ref)) {
    return tool + ' failed: the ref must not hold spaces';
  }
  return undefined;
}

// Git older than 2.24 does not know the separator. The check of the ref is
// the wall for it, the ref of the model cannot be an option anyway.
export async function runGitWithSeparator(
  root: string,
  args: string[],
  options: { signal?: AbortSignal }
): Promise<GitRunResult> {
  const result = await runGit(root, args, options);
  if (result.code !== 0 && /unknown option .*end-of-options/i.test(result.stderr)) {
    return await runGit(
      root,
      args.filter((item) => item !== END_OF_OPTIONS),
      options
    );
  }
  return result;
}

// The directory of the command. It is the -C of git: the command runs there
// and the paths of the model are read relative to it. The directory stays
// inside the workspace, the model does not walk out of it.
export function resolveBase(workspaceRoot: string, candidate: unknown): string {
  if (candidate === undefined || candidate === null) {
    return workspaceRoot;
  }
  const raw = String(candidate).trim();
  if (raw.length === 0) {
    return workspaceRoot;
  }
  const absolute = isAbsolute(raw) ? raw : resolve(workspaceRoot, raw);
  const rel = relative(resolve(workspaceRoot), absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('the directory is outside the workspace: ' + raw);
  }
  return absolute;
}

export async function openRepository(
  workspaceRoot: string,
  input: Record<string, unknown>
): Promise<Opened> {
  let base: string;
  try {
    base = resolveBase(workspaceRoot, input['directory']);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  const root = await repoRoot(base);
  if (!root) {
    return { ok: false, error: 'Not a git repository: ' + workspaceRoot };
  }
  return { ok: true, repository: { root, workspace: workspaceRoot, base } };
}

// The path of the model is relative to the workspace, git reads it relative
// to the directory of the command.
export function toGitPath(repository: Repository, candidate: string): string {
  const absolute = isAbsolute(candidate)
    ? candidate
    : resolve(repository.workspace, candidate);
  const rel = relative(repository.base, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      'the path is outside the directory of the command: ' + candidate
    );
  }
  if (rel.length === 0) {
    return '.';
  }
  return rel.split(/[\\/]/).join('/');
}

// The path of the model is relative to the workspace, a worktree lives
// inside it.
export function toWorkspacePath(workspace: string, candidate: string): string {
  const absolute = isAbsolute(candidate) ? candidate : resolve(workspace, candidate);
  const rel = relative(resolve(workspace), absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('the path is outside the workspace: ' + candidate);
  }
  return absolute;
}

// The path of a worktree as the reader knows it, relative to the workspace
// when the worktree lives inside it.
export function displayPath(workspace: string, absolute: string): string {
  const rel = relative(workspace, absolute);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    return absolute;
  }
  return rel.split(/[\\/]/).join('/');
}

export function pathList(input: Record<string, unknown>): string[] {
  const many = input['paths'];
  if (!Array.isArray(many)) {
    return [];
  }
  return many.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  );
}

export function limitText(text: string): string {
  if (text.length <= MAX_DIFF_CHARS) {
    return text;
  }
  return text.slice(0, MAX_DIFF_CHARS) + '\n[the diff is cut, it is too long]';
}

// The directory of the command is the same argument in every tool, the
// description of it is written once.
export const DIRECTORY_PROPERTY = {
  type: 'string',
  description:
    'The directory of the workspace to run the command in, the same as the -C of git. The path is relative to the workspace root.'
};

// The formats of the lines of the journal. The model picks the short one
// when it only needs the subjects of the commits.
export const LOG_FORMATS: Record<string, string> = {
  oneline: '%h %s',
  short: '%h %an %s',
  medium: '%h %an %ad %s',
  full: '%H %an <%ae> %ad %s'
};
