import type { ChildProcess } from 'node:child_process';
import { stripAnsi } from './commandOutput';

// The output of a long command while it runs: a build or the tests were
// silent for a minute, the card showed nothing until the exit. The chunks go
// to the journal of the action in batches, a chatty command must not flood
// the panel with a message per line. The final result of the tool replaces
// the live text.
export const LIVE_INTERVAL_MS = 250;
// One batch is bounded, the rest of a burst waits for the next one.
const MAX_BATCH_CHARS = 8000;

export class LiveOutput {
  private pending = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly emit: (text: string) => void,
    private readonly interval = LIVE_INTERVAL_MS
  ) {}

  push(chunk: string): void {
    this.pending += stripAnsi(chunk);
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.interval);
    }
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    // Only whole lines go: a half of a line would show and change later.
    const end = this.pending.lastIndexOf('\n');
    if (end === -1 && this.pending.length < MAX_BATCH_CHARS) {
      return;
    }
    const cut = end === -1 ? this.pending.length : end + 1;
    const batch = this.pending.slice(0, Math.min(cut, MAX_BATCH_CHARS));
    this.pending = this.pending.slice(batch.length);
    const text = batch.replace(/\r?\n$/, '');
    if (text.length > 0) {
      this.emit(text);
    }
    if (this.pending.includes('\n')) {
      this.timer = setTimeout(() => this.flush(), this.interval);
    }
  }

  // The command is over: the result of the tool says the rest.
  close(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending = '';
  }
}

// Both streams of the child go into one journal, as the reader sees them in
// a terminal.
export function watchOutput(child: ChildProcess, progress: ((line: string) => void) | undefined): LiveOutput | undefined {
  if (!progress) {
    return undefined;
  }
  const live = new LiveOutput(progress);
  child.stdout?.on('data', (chunk: Buffer | string) => live.push(String(chunk)));
  child.stderr?.on('data', (chunk: Buffer | string) => live.push(String(chunk)));
  return live;
}
