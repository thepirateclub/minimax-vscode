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
