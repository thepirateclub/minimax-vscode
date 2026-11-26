import { execFile, type ChildProcess } from 'node:child_process';

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
