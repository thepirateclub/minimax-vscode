import { ToolEntry } from '../types';
import { runGit } from '../../git/cli';
import { parseBlame, parseBranches, parseLog, parseStatus } from '../../git/parse';
import { commandFailure, checkRef, DEFAULT_CONTEXT_LINES, DEFAULT_LOG_LINES, DIRECTORY_PROPERTY, END_OF_OPTIONS, failure, limitText, LOG_FORMATS, MAX_BLAME_LINES, MAX_LOG_LINES, openRepository, pathList, runGitWithSeparator, toGitPath } from './common';

const gitStatus: ToolEntry = {
  name: 'git_status',
  description:
    'Show the state of the repository: the branch, the upstream and the changed files. Use it before a change to know what the tree holds.',
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
    'Show the changes of the repository as a diff. By default the changes of the working tree, staged=true shows the index, ref compares the tree with a commit or a branch, ref and ref2 compare two commits. stat gives the summary of the change, name_only gives the names of the changed files.',
  approval: 'never',
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Show the staged changes instead of the working tree.' },
      cached: { type: 'boolean', description: 'The same as staged.' },
      ref: { type: 'string', description: 'Compare the tree with this commit or branch.' },
      ref2: { type: 'string', description: 'Compare this commit or branch with ref.' },
      stat: { type: 'boolean', description: 'Show the summary of the change instead of the lines.' },
      name_only: { type: 'boolean', description: 'Show only the names of the changed files.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Files to show, relative to the workspace root.' },
      context_lines: { type: 'integer', minimum: 0, maximum: 20, description: 'Lines of context around a change, default 3.' },
      directory: DIRECTORY_PROPERTY
    }
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const context = Math.min(20, Math.max(0, Number(input['context_lines'] ?? DEFAULT_CONTEXT_LINES)));
    const args = ['diff', '--no-color', '-U' + String(context)];
    if (input['staged'] === true || input['cached'] === true) {
      args.push('--cached');
    }
    if (input['stat'] === true) {
      args.push('--stat');
    }
    if (input['name_only'] === true) {
      args.push('--name-only');
    }
    const ref = typeof input['ref'] === 'string' ? input['ref'].trim() : '';
    const ref2 = typeof input['ref2'] === 'string' ? input['ref2'].trim() : '';
    if (ref.length > 0) {
      const problem = checkRef(ref, 'git_diff');
      if (problem) {
        return failure(problem);
      }
      // The separator goes before the ref, the ref of the model cannot be
      // read as an option of the diff.
      args.push(END_OF_OPTIONS, ref);
    }
    if (ref2.length > 0) {
      const problem = checkRef(ref2, 'git_diff');
      if (problem) {
        return failure(problem);
      }
      if (ref.length === 0) {
        return failure('git_diff failed: ref2 needs ref');
      }
      args.push(ref2);
    }
    let paths: string[] = [];
    try {
      paths = pathList(input).map((item) => toGitPath(repository, item));
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    if (paths.length > 0) {
      args.push('--', ...paths);
    }
    const result = await runGitWithSeparator(repository.base, args, {
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
    'Show the commits of the repository, the newest first. Filter them by a path or by a text of the message. The format picks the shape of a line: oneline is the short hash and the subject, short adds the author, medium adds the date, full shows the whole hash and the mail of the author.',
  approval: 'never',
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES, description: 'How many commits to show, default 20.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Only the commits that touch these files.' },
      grep: { type: 'string', description: 'Only the commits whose message holds this text.' },
      format: {
        type: 'string',
        enum: ['oneline', 'short', 'medium', 'full'],
        description: 'The shape of a line of the journal.'
      },
      oneline: {
        type: 'boolean',
        description: 'The same as format=oneline: the short hash and the subject.'
      },
      directory: DIRECTORY_PROPERTY
    }
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const limit = Math.min(
      MAX_LOG_LINES,
      Math.max(1, Number(input['limit'] ?? DEFAULT_LOG_LINES))
    );
    const requested = String(input['format'] ?? '').trim().toLowerCase();
    const format = input['oneline'] === true ? 'oneline' : requested;
    const args = ['log', '-n', String(limit)];
    let pretty: string | undefined;
    if (format.length > 0) {
      pretty = LOG_FORMATS[format];
      if (!pretty) {
        return failure(
          'git_log failed: the format must be oneline, short, medium or full'
        );
      }
    }
    if (pretty) {
      if (pretty.includes('%ad')) {
        args.push('--date=short');
      }
      args.push('--pretty=format:' + pretty);
    } else {
      args.push('--date=short', '--pretty=format:%h%x09%an%x09%ad%x09%s');
    }
    const grep = input['grep'];
    if (typeof grep === 'string' && grep.length > 0) {
      args.push('--grep', grep);
    }
    let paths: string[] = [];
    try {
      paths = pathList(input).map((item) => toGitPath(repository, item));
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    if (paths.length > 0) {
      args.push('--', ...paths);
    }
    const result = await runGit(repository.base, args, { signal: ctx.signal });
    if (result.code !== 0) {
      return commandFailure(result);
    }
    if (result.stdout.trim().length === 0) {
      return { content: 'no commits' };
    }
    if (pretty) {
      // The format is the choice of the model, the lines go as they are.
      return { content: result.stdout.trim() };
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
    'Show one commit with its changes. The ref is a commit hash, a tag or a branch. stat gives the summary of the change instead of the lines.',
  approval: 'never',
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'The commit, the tag or the branch to show.' },
      stat: { type: 'boolean', description: 'Show the summary of the change instead of the lines.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Only these files of the commit.' },
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
      return failure('git_show failed: ref must not be empty');
    }
    const problem = checkRef(ref, 'git_show');
    if (problem) {
      return failure(problem);
    }
    // The separator goes before the ref, the ref of the model cannot be
    // read as an option of the show.
    const args = ['show', '--no-color', '--date=short'];
    if (input['stat'] === true) {
      args.push('--stat');
    } else {
      args.push('--pretty=format:%h %ad %an %s');
    }
    args.push(END_OF_OPTIONS, ref);
    let paths: string[] = [];
    try {
      paths = pathList(input).map((item) => toGitPath(repository, item));
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    if (paths.length > 0) {
      args.push('--', ...paths);
    }
    const result = await runGitWithSeparator(repository.base, args, {
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
      all: { type: 'boolean', description: 'Show the remote branches too.' },
      directory: DIRECTORY_PROPERTY
    }
  },
  async execute(input, ctx) {
    const opened = await openRepository(ctx.workspaceRoot, input);
    if (!opened.ok) {
      return failure(opened.error);
    }
    const repository = opened.repository;
    const args = [
      'branch',
      '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)'
    ];
    if (input['all'] === true) {
      args.push('--all');
    }
    const result = await runGit(repository.base, args, { signal: ctx.signal });
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
      end_line: { type: 'integer', minimum: 1, description: 'The last line of the range.' },
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
    let target: string;
    try {
      target = toGitPath(repository, String(input['path'] ?? ''));
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
    const result = await runGit(repository.base, args, { signal: ctx.signal });
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

// The tools of this group, the entry point collects them.
export function gitReadTools(): ToolEntry[] {
  return [gitStatus, gitDiff, gitLog, gitShow, gitBranch, gitBlame];
}
