import { ToolEntry } from '../types';
import { runGit } from '../../git/cli';
import { parseWorktrees } from '../../git/parse';
import { commandFailure, DIRECTORY_PROPERTY, failure, openRepository, toWorkspacePath, displayPath } from './common';

const gitWorktreeList: ToolEntry = {
  name: 'git_worktree_list',
  description:
    'List the worktrees of the repository: the folder of every worktree, its branch and its commit. A worktree is a second folder of the same repository with a branch of its own.',
  approval: 'never',
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: {
      directory: DIRECTORY_PROPERTY
    }
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const result = await runGit(
      repository.base,
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
      },
      directory: DIRECTORY_PROPERTY
    },
    required: ['path']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
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
      const known = await runGit(repository.base, [
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
    const result = await runGit(repository.base, args, { signal: ctx.signal });
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
      },
      directory: DIRECTORY_PROPERTY
    },
    required: ['path']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
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
    const result = await runGit(repository.base, args, { signal: ctx.signal });
    if (result.code !== 0) {
      // The folder is gone, the record of the worktree is stale.
      const pruned = await runGit(repository.base, ['worktree', 'prune'], {
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

// The tools of this group, the entry point collects them.
export function gitWorktreesTools(): ToolEntry[] {
  return [gitWorktreeList, gitWorktreeAdd, gitWorktreeRemove];
}
