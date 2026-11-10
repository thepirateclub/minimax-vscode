import { execFile } from 'node:child_process';

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

// Git runs without a shell, the arguments reach it as they are. The model
// never builds a command line, so nothing can slip into it.
export async function runGit(
  root: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<GitRunResult> {
  return await new Promise<GitRunResult>((resolve) => {
    execFile(
      'git',
      ['-C', root, ...args],
      {
        maxBuffer: MAX_BUFFER,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = typeof error.code === 'number' ? error.code : 1;
        resolve({
          code,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: stderr && stderr.length > 0 ? stderr : error.message
        });
      }
    );
  });
}

// The root of the repository that holds the folder. It differs from the
// folder itself when the workspace is a part of a repository.
export async function repoRoot(root: string): Promise<string | undefined> {
  const result = await runGit(root, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    return undefined;
  }
  const top = result.stdout.trim();
  return top.length > 0 ? top : undefined;
}
