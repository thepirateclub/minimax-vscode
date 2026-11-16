import { exec } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolEntry } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

function resolveCwd(root: string, candidate: string | undefined): string {
  if (!candidate) {
    return root;
  }
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(resolve(root), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('cwd escapes the workspace root: ' + candidate);
  }
  return target;
}

// The git commands have tools of their own: the tools read the output of git
// in the code, the shell only guesses the format of the text. The model must
// not run git in the shell, the refusal names the tool it has to use.
const GIT_TOOLS: Record<string, string> = {
  status: 'git_status',
  diff: 'git_diff',
  log: 'git_log',
  show: 'git_show',
  branch: 'git_branch',
  blame: 'git_blame',
  merge: 'git_merge',
  tag: 'git_tag',
  add: 'git_stage',
  commit: 'git_commit',
  checkout: 'git_checkout',
  switch: 'git_checkout'
};

// The worktrees have their own tools, the action of the command tells
// which one has to serve it.
const WORKTREE_TOOLS: Record<string, string> = {
  'worktree list': 'git_worktree_list',
  'worktree add': 'git_worktree_add',
  'worktree remove': 'git_worktree_remove'
};

// The global flags of git that take a value.
const GIT_FLAGS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path'
]);

// The tool that has to serve the command, if the command is a git command
// that the tools cover.
export function gitToolFor(command: string): string | undefined {
  for (const segment of command.split(/&&|\|\||;|\||\r?\n/)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length < 2) {
      continue;
    }
    const first = tokens[0] ?? '';
    if (!/(^|[\\/])git(\.exe)?$/i.test(first)) {
      continue;
    }
    let index = 1;
    while (index < tokens.length) {
      const token = tokens[index] ?? '';
      if (!token.startsWith('-')) {
        break;
      }
      index += 1;
      if (GIT_FLAGS_WITH_VALUE.has(token)) {
        index += 1;
      }
    }
    const sub = tokens[index];
    if (sub === 'worktree') {
      const action = tokens[index + 1];
      return action === undefined ? undefined : WORKTREE_TOOLS[sub + ' ' + action];
    }
    if (sub !== undefined && GIT_TOOLS[sub] !== undefined) {
      return GIT_TOOLS[sub];
    }
  }
  return undefined;
}

export function createTerminalTools(): ToolEntry[] {
  const runTerminal: ToolEntry = {
    name: 'run_terminal',
    description:
      'Run a shell command in the workspace root and return its output. Use it for build, test and git commands.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace root.' },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
          description: 'Timeout in milliseconds, default 60000.'
        }
      },
      required: ['command']
    },
    async execute(input, ctx) {
      const command = String(input['command'] ?? '');
      if (command.trim().length === 0) {
        return { content: 'run_terminal failed: command must not be empty', isError: true };
      }
      const gitTool = gitToolFor(command);
      if (gitTool) {
        return {
          content:
            '[stderr] The git commands do not run in the shell, use the ' +
            gitTool +
            ' tool instead, it reads the output of git in the code.',
          isError: true
        };
      }
      const timeout = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(1000, Number(input['timeout_ms'] ?? DEFAULT_TIMEOUT_MS))
      );
      let cwd: string;
      try {
        cwd = resolveCwd(
          ctx.workspaceRoot,
          input['cwd'] === undefined ? undefined : String(input['cwd'])
        );
      } catch (error) {
        return {
          content: 'run_terminal failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
      return await new Promise((resolvePromise) => {
        exec(
          command,
          { cwd, timeout, maxBuffer: 10 * 1024 * 1024, signal: ctx.signal, windowsHide: true },
          (error, stdout, stderr) => {
            const parts: string[] = [];
            if (stdout.trim().length > 0) {
              parts.push(stdout.trim());
            }
            if (stderr.trim().length > 0) {
              parts.push('[stderr] ' + stderr.trim());
            }
            let text = parts.join('\n');
            if (text.length > MAX_OUTPUT_CHARS) {
              text = text.slice(0, MAX_OUTPUT_CHARS) + '\n[output truncated]';
            }
            if (error) {
              const code = typeof error.code === 'number' ? error.code : 1;
              const detail = text.length > 0 ? text : error.message;
              resolvePromise({
                content: 'Command failed with exit code ' + code + '\n' + detail,
                isError: true
              });
              return;
            }
            resolvePromise({ content: text.length > 0 ? text : '[no output]', isError: false });
          }
        );
      });
    }
  };
  return [runTerminal];
}
