import { ToolEntry } from '../types';
import { runGit } from '../../git/cli';
import { commandFailure, checkRef, DIRECTORY_PROPERTY, END_OF_OPTIONS, failure, openRepository, pathList, runGitWithSeparator, toGitPath } from './common';

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
      unstage: { type: 'boolean', description: 'Take the files out of the index instead.' },
      directory: DIRECTORY_PROPERTY
    },
    required: ['paths']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    let paths: string[] = [];
    try {
      paths = pathList(input).map((item) => toGitPath(repository, item));
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
    const result = await runGit(repository.base, args, { signal: ctx.signal });
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
      amend: { type: 'boolean', description: 'Rewrite the last commit instead of making a new one.' },
      directory: DIRECTORY_PROPERTY
    },
    required: ['message']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const message = String(input['message'] ?? '');
    const amend = input['amend'] === true;
    if (!amend) {
      const staged = await runGit(repository.base, ['diff', '--cached', '--name-only'], {
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
    const result = await runGit(repository.base, args, { signal: ctx.signal });
    if (result.code !== 0) {
      return commandFailure(result);
    }
    const head = await runGit(repository.base, ['log', '-1', '--pretty=format:%h %s']);
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
      checkout: { type: 'boolean', description: 'Switch to the new branch, true by default.' },
      directory: DIRECTORY_PROPERTY
    },
    required: ['name']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
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
    const result = await runGitWithSeparator(repository.base, args, {
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
      ref: { type: 'string', description: 'The branch or the commit to switch to.' },
      directory: DIRECTORY_PROPERTY
    },
    required: ['ref']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const ref = String(input['ref'] ?? '').trim();
    if (ref.length === 0) {
      return failure('git_checkout failed: ref must not be empty');
    }
    const problem = checkRef(ref, 'git_checkout');
    if (problem) {
      return failure(problem);
    }
    const result = await runGitWithSeparator(
      repository.base,
      ['checkout', END_OF_OPTIONS, ref],
      { signal: ctx.signal }
    );
    if (result.code !== 0) {
      return commandFailure(result);
    }
    const head = await runGit(repository.base, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return { content: 'switched to ' + head.stdout.trim() };
  }
};

const gitMerge: ToolEntry = {
  name: 'git_merge',
  description:
    'Merge a branch or a commit into the current branch. The merge changes the files of the working tree, so the user confirms it. A conflict stops the merge and the tool names the files in conflict.',
  approval: 'always',
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: {
      branch: {
        type: 'string',
        description: 'The branch or the commit to merge into the current branch.'
      },
      no_ff: {
        type: 'boolean',
        description: 'Always make a merge commit, even when a fast forward is possible.'
      },
      no_commit: {
        type: 'boolean',
        description: 'Stop before the commit, the merge stays in the working tree.'
      },
      message: { type: 'string', description: 'The message of the merge commit.' },
      directory: DIRECTORY_PROPERTY
    },
    required: ['branch']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const branch = String(input['branch'] ?? '').trim();
    if (branch.length === 0) {
      return failure('git_merge failed: branch must not be empty');
    }
    const problem = checkRef(branch, 'git_merge');
    if (problem) {
      return failure(problem);
    }
    const args = ['merge'];
    if (input['no_ff'] === true) {
      args.push('--no-ff');
    }
    if (input['no_commit'] === true) {
      args.push('--no-commit');
    }
    const message = String(input['message'] ?? '').trim();
    if (message.length > 0) {
      args.push('-m', message);
    }
    // The separator goes before the branch, the branch of the model cannot
    // be read as an option of the merge.
    args.push(END_OF_OPTIONS, branch);
    const result = await runGitWithSeparator(repository.base, args, {
      signal: ctx.signal
    });
    if (result.code !== 0) {
      const detail = commandFailure(result);
      // The merge that stops on a conflict names the files, the model has
      // to know which ones it has to fix.
      const conflicts = await runGit(repository.base, ['diff', '--name-only', '--diff-filter=U'], {
        signal: ctx.signal
      });
      if (conflicts.code === 0 && conflicts.stdout.trim().length > 0) {
        return {
          content:
            detail.content +
            '\n[the files in conflict]\n' +
            conflicts.stdout.trim(),
          isError: true
        };
      }
      return detail;
    }
    return { content: 'merged ' + branch };
  }
};

const gitTag: ToolEntry = {
  name: 'git_tag',
  description:
    'Create a tag on a commit, a mark of a release. A tag with a message is an annotated tag, a tag without a message is a light one. The tag names a version of the project, for example 1.2.0.',
  approval: 'always',
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name of the tag, for example 1.2.0.' },
      message: { type: 'string', description: 'The message of the tag, it makes the tag annotated.' },
      ref: {
        type: 'string',
        description: 'The commit or the branch to tag, the current HEAD by default.'
      },
      force: {
        type: 'boolean',
        description: 'Move the tag to the commit when it exists already.'
      },
      directory: DIRECTORY_PROPERTY
    },
    required: ['name']
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const name = String(input['name'] ?? '').trim();
    if (name.length === 0) {
      return failure('git_tag failed: name must not be empty');
    }
    const nameProblem = checkRef(name, 'git_tag');
    if (nameProblem) {
      return failure(nameProblem);
    }
    const ref = String(input['ref'] ?? '').trim();
    const refProblem = checkRef(ref, 'git_tag');
    if (refProblem) {
      return failure(refProblem);
    }
    const message = String(input['message'] ?? '').trim();
    const args = ['tag'];
    if (message.length > 0) {
      args.push('-a', name, '-m', message);
    } else {
      args.push(name);
    }
    if (input['force'] === true) {
      args.push('--force');
    }
    if (ref.length > 0) {
      // The separator goes before the ref, the ref of the model cannot be
      // read as an option of the tag.
      args.push(END_OF_OPTIONS, ref);
    }
    const result = await runGitWithSeparator(repository.base, args, {
      signal: ctx.signal
    });
    if (result.code !== 0) {
      return commandFailure(result);
    }
    return {
      content:
        'created the tag ' +
        name +
        (ref.length > 0 ? ' on ' + ref : '') +
        (message.length > 0 ? '' : ' (a light tag)')
    };
  }
};

// The tools of this group, the entry point collects them.
export function gitWriteTools(): ToolEntry[] {
  return [gitStage, gitCommit, gitBranchCreate, gitCheckout, gitMerge, gitTag];
}
