import { execFile, spawn, type ChildProcess, type ExecFileException } from 'node:child_process';

// The timeout and the stop of a command killed only the shell: a server or
// a watcher started by the command lived on after the timeout and after the
// editor closed. The whole tree goes: taskkill /T on Windows, the process
// group on POSIX (the shell is started detached, it leads its own group).

export function killTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process is already gone.
    }
  }
}

// The options of a shell that leads its own group of processes on POSIX.
export const TREE_OPTIONS = process.platform === 'win32' ? {} : { detached: true };

export interface TreeGuard {
  timedOut: () => boolean;
  dispose: () => void;
}

// Kills the tree of the child on the timeout and on the stop of the turn.
// The tree is walked while the shell is alive: on Windows the children of a
// dead shell cannot be found anymore.
export function guardTree(child: ChildProcess, timeoutMs: number, signal?: AbortSignal): TreeGuard {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    killTree(child.pid);
  }, timeoutMs);
  const onAbort = (): void => killTree(child.pid);
  signal?.addEventListener('abort', onAbort, { once: true });
  const dispose = (): void => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  child.once('exit', dispose);
  return { timedOut: () => expired, dispose };
}

// The shell of a POSIX command that leads its own group. Only `spawn` makes
// the child a group leader: `exec` and `execFile` drop `detached` without a
// word, the kill of the group failed with ESRCH, only the shell died and a
// child of the command held its output open, the turn hung. The answer has
// the shape of the callback of `exec`.
export function spawnShell(
  script: string,
  options: { cwd: string; maxBuffer: number },
  done: (error: ExecFileException | null, stdout: string, stderr: string) => void
): ChildProcess {
  const child = spawn('/bin/sh', ['-c', script], { cwd: options.cwd, detached: true, windowsHide: true });
  let stdout = '';
  let stderr = '';
  const take = (current: string, chunk: Buffer): string =>
    current.length >= options.maxBuffer ? current : (current + chunk.toString('utf8')).slice(0, options.maxBuffer);
  child.stdout.on('data', (chunk: Buffer) => {
    stdout = take(stdout, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = take(stderr, chunk);
  });
  let finished = false;
  const finish = (error: ExecFileException | null): void => {
    if (!finished) {
      finished = true;
      done(error, stdout, stderr);
    }
  };
  child.on('error', (error) => finish(error));
  child.on('close', (code, signal) => {
    if (code === 0) {
      finish(null);
      return;
    }
    const error: ExecFileException = new Error(
      'Command failed: ' + (signal ? 'killed by ' + signal : 'exit code ' + String(code))
    );
    if (code !== null) {
      error.code = code;
    }
    if (signal !== null) {
      error.signal = signal;
    }
    error.killed = signal !== null;
    finish(error);
  });
  return child;
}
