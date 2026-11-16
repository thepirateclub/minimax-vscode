import { isAbsolute, relative, resolve } from 'node:path';
import { repoRoot, runGit, type GitRunResult } from '../git/cli';
import { parseBlame, parseBranches, parseLog, parseStatus, parseWorktrees } from '../git/parse';
import type { ToolEntry, ToolExecutionResult } from './types';

const MAX_DIFF_CHARS = 30_000;
const MAX_LOG_LINES = 200;
const DEFAULT_LOG_LINES = 20;
const MAX_BLAME_LINES = 400;
const DEFAULT_CONTEXT_LINES = 3;

interface Repository {
  // The root of the repository, git works in it.
  root: string;
  // The root of the workspace, the paths of the model are relative to it.
  workspace: string;
}

function failure(message: string): ToolExecutionResult {
  return { content: message, isError: true };
}

function commandFailure(result: GitRunResult): ToolExecutionResult {
  const detail = (result.stderr || result.stdout).trim();
  return failure(detail.length > 0 ? detail : 'git failed with exit code ' + result.code);
}

// Git reads everything that starts with a dash as an option of the command.
// The ref of the model is a value, so the separator goes before it: git calls
// it --end-of-options, everything after it is a value and not an option.
// The plain -- cannot be used here, it would turn the ref of the diff into a
// path and the diff would come back empty.
const END_OF_OPTIONS = '--end-of-options';

// A ref with a dash is read as an option of the command, for example
// --output=<file> of the diff writes a file. The ref of the model is a
// commit, a tag or a branch, it never starts with a dash.
function checkRef(ref: string, tool: string): string | undefined {
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
async function runGitWithSeparator(
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

async function openRepository(workspaceRoot: string): Promise<Repository | undefined> {
  const root = await repoRoot(workspaceRoot);
  if (!root) {
    return undefined;
  }
  return { root, workspace: workspaceRoot };
}

// The path of the model is relative to the workspace, git wants it relative
// to the repository.
function toRepoPath(repository: Repository, candidate: string): string {
  const absolute = isAbsolute(candidate) ? candidate : resolve(repository.workspace, candidate);
  const rel = relative(repository.root, absolute);
  if (rel.length === 0) {
    return '.';
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('the path is outside the repository: ' + candidate);
  }
  return rel.split(/[\\/]/).join('/');
}

// The path of the model is relative to the workspace, a worktree lives
// inside it.
function toWorkspacePath(workspace: string, candidate: string): string {
  const absolute = isAbsolute(candidate) ? candidate : resolve(workspace, candidate);
  const rel = relative(resolve(workspace), absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('the path is outside the workspace: ' + candidate);
  }
  return absolute;
}

// The path of a worktree as the reader knows it, relative to the workspace
// when the worktree lives inside it.
function displayPath(workspace: string, absolute: string): string {
  const rel = relative(workspace, absolute);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    return absolute;
  }
  return rel.split(/[\\/]/).join('/');
}

function pathList(input: Record<string, unknown>): string[] {
  const many = input['paths'];
  if (!Array.isArray(many)) {
    return [];
  }
  return many.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function limitText(text: string): string {
  if (text.length <= MAX_DIFF_CHARS) {
    return text;
  }
  return text.slice(0, MAX_DIFF_CHARS) + '\n[the diff is cut, it is too long]';
}

export function createGitTools(): ToolEntry[] {
  const gitStatus: ToolEntry = {
    name: 'git_status',
    description:
      'Show the state of the repository: the branch, the upstream and the changed files. Use it before a change to know what the tree holds.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {}
    },
    async execute(_input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const result = await runGit(
        repository.root,
        ['status', '--porcelain=v1', '-b', '--untracked-files=all'],
        { signal: ctx.signal }
      );
      if (result.code !== 0) {
        return commandFailure(result);
      }
      const status = parseStatus(result.stdout);
      const lines: string[] = ['branch: ' + (status.detached ? 'HEAD (detached)' : status.branch)];
      if (status.upstream.length > 0) {
        let upstream = 'upstream: ' + status.upstream;
        if (status.ahead > 0) {
          upstream += ', ahead ' + status.ahead;
        }
        if (status.behind > 0) {
          upstream += ', behind ' + status.behind;
        }
        lines.push(upstream);
      }
      for (const file of status.files) {
        lines.push(file.staged + file.unstaged + ' ' + file.path);
      }
      if (status.files.length === 0) {
        lines.push('the working tree is clean');
      }
      return { content: lines.join('\n') };
    }
  };

  const gitDiff: ToolEntry = {
    name: 'git_diff',
    description:
      'Show the changes of the repository as a diff. By default the changes of the working tree, staged=true shows the index, ref compares the tree with a commit or a branch.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show the staged changes instead of the working tree.' },
        ref: { type: 'string', description: 'Compare the tree with this commit or branch.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Files to show, relative to the workspace root.' },
        context_lines: { type: 'integer', minimum: 0, maximum: 20, description: 'Lines of context around a change, default 3.' }
      }
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const context = Math.min(20, Math.max(0, Number(input['context_lines'] ?? DEFAULT_CONTEXT_LINES)));
      const args = ['diff', '--no-color', '-U' + String(context)];
      if (input['staged'] === true) {
        args.push('--cached');
      }
      const ref = typeof input['ref'] === 'string' ? input['ref'].trim() : '';
      if (ref.length > 0) {
        const problem = checkRef(ref, 'git_diff');
        if (problem) {
          return failure(problem);
        }
        // The separator goes before the ref, the ref of the model cannot be
        // read as an option of the diff.
        args.push(END_OF_OPTIONS, ref);
      }
      let paths: string[] = [];
      try {
        paths = pathList(input).map((item) => toRepoPath(repository, item));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      if (paths.length > 0) {
        args.push('--', ...paths);
      }
      const result = await runGitWithSeparator(repository.root, args, {
        signal: ctx.signal
      });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      if (result.stdout.trim().length === 0) {
        return { content: 'no changes' };
      }
      return { content: limitText(result.stdout) };
    }
  };

  const gitLog: ToolEntry = {
    name: 'git_log',
    description:
      'Show the commits of the repository, the newest first. Filter them by a path or by a text of the message.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES, description: 'How many commits to show, default 20.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Only the commits that touch these files.' },
        grep: { type: 'string', description: 'Only the commits whose message holds this text.' }
      }
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const limit = Math.min(
        MAX_LOG_LINES,
        Math.max(1, Number(input['limit'] ?? DEFAULT_LOG_LINES))
      );
      const args = [
        'log',
        '-n',
        String(limit),
        '--date=short',
        '--pretty=format:%h%x09%an%x09%ad%x09%s'
      ];
      const grep = input['grep'];
      if (typeof grep === 'string' && grep.length > 0) {
        args.push('--grep', grep);
      }
      let paths: string[] = [];
      try {
        paths = pathList(input).map((item) => toRepoPath(repository, item));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      if (paths.length > 0) {
        args.push('--', ...paths);
      }
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      if (result.stdout.trim().length === 0) {
        return { content: 'no commits' };
      }
      return {
        content: parseLog(result.stdout)
          .map((commit) => commit.hash + ' ' + commit.date + ' ' + commit.author + ' ' + commit.subject)
          .join('\n')
      };
    }
  };

  const gitShow: ToolEntry = {
    name: 'git_show',
    description:
      'Show one commit with its changes. The ref is a commit hash, a tag or a branch.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The commit, the tag or the branch to show.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Only these files of the commit.' }
      },
      required: ['ref']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const ref = String(input['ref'] ?? '').trim();
      if (ref.length === 0) {
        return failure('git_show failed: ref must not be empty');
      }
      const problem = checkRef(ref, 'git_show');
      if (problem) {
        return failure(problem);
      }
      // The separator goes before the ref, the ref of the model cannot be
      // read as an option of the show.
      const args = [
        'show',
        '--no-color',
        '--date=short',
        '--pretty=format:%h %ad %an %s',
        END_OF_OPTIONS,
        ref
      ];
      let paths: string[] = [];
      try {
        paths = pathList(input).map((item) => toRepoPath(repository, item));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      if (paths.length > 0) {
        args.push('--', ...paths);
      }
      const result = await runGitWithSeparator(repository.root, args, {
        signal: ctx.signal
      });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      return { content: limitText(result.stdout) };
    }
  };

  const gitBranch: ToolEntry = {
    name: 'git_branch',
    description:
      'List the branches of the repository and mark the current one.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Show the remote branches too.' }
      }
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const args = [
        'branch',
        '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)'
      ];
      if (input['all'] === true) {
        args.push('--all');
      }
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      const branches = parseBranches(result.stdout);
      if (branches.length === 0) {
        return { content: 'no branches' };
      }
      return {
        content: branches
          .map((branch) => {
            const mark = branch.current ? '*' : ' ';
            const upstream = branch.upstream.length > 0 ? ' ' + branch.upstream + branch.track : '';
            return mark + ' ' + branch.name + upstream;
          })
          .join('\n')
      };
    }
  };

  const gitBlame: ToolEntry = {
    name: 'git_blame',
    description:
      'Show who changed every line of a file and the commit of every line.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file to blame, relative to the workspace root.' },
        start_line: { type: 'integer', minimum: 1, description: 'The first line of the range.' },
        end_line: { type: 'integer', minimum: 1, description: 'The last line of the range.' }
      },
      required: ['path']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      let target: string;
      try {
        target = toRepoPath(repository, String(input['path'] ?? ''));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      const args = ['blame', '--porcelain'];
      const start = Number(input['start_line']);
      const end = Number(input['end_line']);
      if (Number.isFinite(start) && start >= 1 && Number.isFinite(end) && end >= start) {
        args.push('-L', String(Math.floor(start)) + ',' + String(Math.floor(end)));
      }
      args.push('--', target);
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      const lines = parseBlame(result.stdout).slice(0, MAX_BLAME_LINES);
      return {
        content: lines
          .map((line) => line.commit + ' ' + line.line + ' ' + line.author + ' ' + line.text)
          .join('\n')
      };
    }
  };

  const gitStage: ToolEntry = {
    name: 'git_stage',
    description:
      'Stage the files for the next commit. The paths are relative to the workspace root. Set unstage=true to take the files out of the index.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'The files to stage.' },
        unstage: { type: 'boolean', description: 'Take the files out of the index instead.' }
      },
      required: ['paths']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      let paths: string[] = [];
      try {
        paths = pathList(input).map((item) => toRepoPath(repository, item));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      if (paths.length === 0) {
        return failure('git_stage failed: paths must not be empty');
      }
      const unstage = input['unstage'] === true;
      const args = unstage
        ? ['reset', '-q', 'HEAD', '--', ...paths]
        : ['add', '--', ...paths];
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      return { content: (unstage ? 'unstaged: ' : 'staged: ') + paths.join(', ') };
    }
  };

  const gitCommit: ToolEntry = {
    name: 'git_commit',
    description:
      'Commit the staged files with the given message. The commit covers the index only, stage the files with git_stage first.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message of the commit.' },
        amend: { type: 'boolean', description: 'Rewrite the last commit instead of making a new one.' }
      },
      required: ['message']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const message = String(input['message'] ?? '');
      const amend = input['amend'] === true;
      if (!amend) {
        const staged = await runGit(repository.root, ['diff', '--cached', '--name-only'], {
          signal: ctx.signal
        });
        if (staged.code === 0 && staged.stdout.trim().length === 0) {
          return failure(
            'Nothing is staged to commit. Stage the files with git_stage before the commit.'
          );
        }
      }
      const args = ['commit'];
      if (amend) {
        args.push('--amend');
        if (message.trim().length === 0) {
          args.push('--no-edit');
        } else {
          args.push('-m', message);
        }
      } else {
        args.push('-m', message);
      }
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      const head = await runGit(repository.root, ['log', '-1', '--pretty=format:%h %s']);
      return { content: 'committed ' + head.stdout.trim() };
    }
  };

  const gitBranchCreate: ToolEntry = {
    name: 'git_branch_create',
    description:
      'Create a branch and switch to it. The base is the commit or the branch it starts from, the current HEAD by default.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the new branch.' },
        base: { type: 'string', description: 'The commit or the branch the new branch starts from.' },
        checkout: { type: 'boolean', description: 'Switch to the new branch, true by default.' }
      },
      required: ['name']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const name = String(input['name'] ?? '').trim();
      if (name.length === 0) {
        return failure('git_branch_create failed: name must not be empty');
      }
      const nameProblem = checkRef(name, 'git_branch_create');
      if (nameProblem) {
        return failure(nameProblem);
      }
      const base = String(input['base'] ?? '').trim();
      const baseProblem = checkRef(base, 'git_branch_create');
      if (baseProblem) {
        return failure(baseProblem);
      }
      const checkout = input['checkout'] !== false;
      // The separator of git goes before the base, the base of the model
      // cannot be read as an option of the command.
      const args = checkout ? ['checkout', '-b', name] : ['branch', '--', name];
      if (base.length > 0) {
        args.push(END_OF_OPTIONS, base);
      }
      const result = await runGitWithSeparator(repository.root, args, {
        signal: ctx.signal
      });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      return {
        content: 'created branch ' + name + (checkout ? ' and switched to it' : '')
      };
    }
  };

  const gitCheckout: ToolEntry = {
    name: 'git_checkout',
    description:
      'Switch to another branch or to a commit.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The branch or the commit to switch to.' }
      },
      required: ['ref']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const ref = String(input['ref'] ?? '').trim();
      if (ref.length === 0) {
        return failure('git_checkout failed: ref must not be empty');
      }
      const problem = checkRef(ref, 'git_checkout');
      if (problem) {
        return failure(problem);
      }
      const result = await runGitWithSeparator(
        repository.root,
        ['checkout', END_OF_OPTIONS, ref],
        { signal: ctx.signal }
      );
      if (result.code !== 0) {
        return commandFailure(result);
      }
      const head = await runGit(repository.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      return { content: 'switched to ' + head.stdout.trim() };
    }
  };

  const gitWorktreeList: ToolEntry = {
    name: 'git_worktree_list',
    description:
      'List the worktrees of the repository: the folder of every worktree, its branch and its commit. A worktree is a second folder of the same repository with a branch of its own.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {}
    },
    async execute(_input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const result = await runGit(
        repository.root,
        ['worktree', 'list', '--porcelain'],
        { signal: ctx.signal }
      );
      if (result.code !== 0) {
        return commandFailure(result);
      }
      const worktrees = parseWorktrees(result.stdout);
      if (worktrees.length === 0) {
        return { content: 'no worktrees' };
      }
      const lines = worktrees.map((worktree) => {
        const branch = worktree.detached
          ? 'HEAD (detached)'
          : worktree.branch.length > 0
            ? worktree.branch
            : 'no branch';
        const head = worktree.head.slice(0, 7);
        return displayPath(repository.workspace, worktree.path) + '  ' + branch + '  ' + head;
      });
      return { content: lines.join('\n') };
    }
  };

  const gitWorktreeAdd: ToolEntry = {
    name: 'git_worktree_add',
    description:
      'Add a worktree: a second folder of the repository with a branch of its own. The path is relative to the workspace root. The branch is created when it does not exist yet, the base is the commit the new branch starts from.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The folder of the worktree, relative to the workspace root.'
        },
        branch: { type: 'string', description: 'The branch of the worktree.' },
        base: {
          type: 'string',
          description: 'The commit or the branch the new branch starts from.'
        }
      },
      required: ['path']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const raw = String(input['path'] ?? '').trim();
      if (raw.length === 0) {
        return failure('git_worktree_add failed: path must not be empty');
      }
      let target: string;
      try {
        target = toWorkspacePath(repository.workspace, raw);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      const branch = String(input['branch'] ?? '').trim();
      const base = String(input['base'] ?? '').trim();
      const args = ['worktree', 'add'];
      if (branch.length > 0) {
        const known = await runGit(repository.root, [
          'show-ref',
          '--verify',
          '--quiet',
          'refs/heads/' + branch
        ]);
        if (known.code === 0) {
          // The branch exists, git checks it out in the new folder.
          args.push(target, branch);
        } else {
          args.push('-b', branch, target);
          if (base.length > 0) {
            args.push(base);
          }
        }
      } else {
        args.push('--detach', target);
        if (base.length > 0) {
          args.push(base);
        }
      }
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        return commandFailure(result);
      }
      return {
        content:
          'added the worktree ' +
          displayPath(repository.workspace, target) +
          (branch.length > 0 ? ' on the branch ' + branch : '')
      };
    }
  };

  const gitWorktreeRemove: ToolEntry = {
    name: 'git_worktree_remove',
    description:
      'Remove a worktree: its folder goes away, the branch it holds stays in the repository and can be checked out again.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The folder of the worktree, relative to the workspace root.'
        },
        force: {
          type: 'boolean',
          description: 'Remove it even when it holds changes.'
        }
      },
      required: ['path']
    },
    async execute(input, ctx) {
      const repository = await openRepository(ctx.workspaceRoot);
      if (!repository) {
        return failure('Not a git repository: ' + ctx.workspaceRoot);
      }
      const raw = String(input['path'] ?? '').trim();
      if (raw.length === 0) {
        return failure('git_worktree_remove failed: path must not be empty');
      }
      let target: string;
      try {
        target = toWorkspacePath(repository.workspace, raw);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      const args = ['worktree', 'remove'];
      if (input['force'] === true) {
        args.push('--force');
      }
      args.push(target);
      const result = await runGit(repository.root, args, { signal: ctx.signal });
      if (result.code !== 0) {
        // The folder is gone, the record of the worktree is stale.
        const pruned = await runGit(repository.root, ['worktree', 'prune'], {
          signal: ctx.signal
        });
        if (pruned.code === 0) {
          return {
            content:
              'the folder of the worktree was gone, the stale record is pruned'
          };
        }
        return commandFailure(result);
      }
      return {
        content: 'removed the worktree ' + displayPath(repository.workspace, target)
      };
    }
  };

  return [
    gitStatus,
    gitDiff,
    gitLog,
    gitShow,
    gitBranch,
    gitBlame,
    gitStage,
    gitCommit,
    gitBranchCreate,
    gitCheckout,
    gitWorktreeList,
    gitWorktreeAdd,
    gitWorktreeRemove
  ];
}
