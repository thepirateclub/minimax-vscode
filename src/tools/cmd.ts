import { SCRATCH_REFUSAL, writesScratch } from './scratch';
import { exec, type ExecException } from 'node:child_process';
import { resolveWorkspacePath } from '../paths';
import { gitToolFor } from './terminal';
import { deleteToolFor } from './deleteCommand';
import type { ToolEntry } from './types';

export const CMD_DEFAULT_TIMEOUT_MS = 60_000;
export const CMD_MIN_TIMEOUT_MS = 1_000;
export const CMD_MAX_TIMEOUT_MS = 120_000;
export const CMD_MAX_OUTPUT_CHARS = 30_000;

export const CMD_PLATFORM_REFUSAL = 'the cmd tool works on Windows only';

// Платформа проверяется отдельной функцией: тест проверяет отказ без
// Windows, а инструмент на других системах отвечает тем же текстом.
export function isWindowsPlatform(platform: string): boolean {
  return platform === 'win32';
}

export function cmdPlatformRefusal(platform: string): string | undefined {
  return isWindowsPlatform(platform) ? undefined : CMD_PLATFORM_REFUSAL;
}

export function resolveCmdTimeout(value: unknown): number {
  const parsed = Number(value ?? CMD_DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return CMD_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(CMD_MAX_TIMEOUT_MS, Math.max(CMD_MIN_TIMEOUT_MS, Math.trunc(parsed)));
}

export function truncateCmdOutput(
  text: string,
  limit: number = CMD_MAX_OUTPUT_CHARS
): string {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + '\n[output truncated: ' + (text.length - limit) + ' characters cut]';
}

export function createCmdTools(): ToolEntry[] {
  const runCmd: ToolEntry = {
    name: 'run_cmd',
    description:
      'Run a command of the Windows command line (cmd.exe) in the workspace root and return its output. Use it for the commands of Windows that the shell of the terminal does not cover, for example the tooling of the registry or the service commands. The tool runs a command, so it asks for the confirmation of the user.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command of cmd.exe to execute.' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace root.' },
        timeout_ms: {
          type: 'integer',
          minimum: CMD_MIN_TIMEOUT_MS,
          maximum: CMD_MAX_TIMEOUT_MS,
          description: 'Timeout in milliseconds, default 60000.'
        }
      },
      required: ['command']
    },
    async execute(input, ctx) {
      const command = String(input['command'] ?? '');
      if (command.trim().length === 0) {
        return { content: 'run_cmd failed: command must not be empty', isError: true };
      }
      if (writesScratch(command)) {
        return { content: '[stderr] ' + SCRATCH_REFUSAL, isError: true };
      }
      // The delete commands have a tool of their own: the tool shows the
      // files to the reader before they go away.
      const deleteTool = deleteToolFor(command);
      if (deleteTool) {
        return {
          content:
            '[stderr] The delete commands do not run in the shell, use the ' +
            deleteTool +
            ' tool instead, it shows the files to the user before it deletes them.',
          isError: true
        };
      }
      // Команды git не идут в оболочку: у них есть свои инструменты.
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
      const refusal = cmdPlatformRefusal(process.platform);
      if (refusal) {
        return { content: 'run_cmd failed: ' + refusal, isError: true };
      }
      const timeout = resolveCmdTimeout(input['timeout_ms']);
      let cwd: string;
      try {
        const candidate =
          input['cwd'] === undefined ? undefined : String(input['cwd']);
        cwd = resolveWorkspacePath(ctx.workspaceRoot, candidate ?? '.');
      } catch (error) {
        return {
          content:
            'run_cmd failed: ' +
            (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
      return await new Promise((resolvePromise) => {
        // exec runs the command through `cmd.exe /d /s /c`, so the quoting
        // rules of the shell itself apply. execFile passes the command as
        // one argument and Node escapes the quotes for CreateProcess: the
        // shell receives backslashes and prints them, a command with quotes
        // came back corrupted (echo "a b" gave \"a b\").
        exec(
          command,
          {
            cwd,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            signal: ctx.signal,
            windowsHide: true
          },
          (error: ExecException | null, stdout: string, stderr: string) => {
            const parts: string[] = [];
            if (stdout.trim().length > 0) {
              parts.push(stdout.trim());
            }
            if (stderr.trim().length > 0) {
              parts.push('[stderr] ' + stderr.trim());
            }
            let text = parts.join('\n');
            if (text.length > CMD_MAX_OUTPUT_CHARS) {
              text = truncateCmdOutput(text);
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
            resolvePromise({
              content: text.length > 0 ? text : '[no output]',
              isError: false
            });
          }
        );
      });
    }
  };
  return [runCmd];
}
