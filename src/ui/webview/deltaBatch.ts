// The deltas of the answer come one by one. The panel redraws the answer
// for every one of them, and the redraw of the whole answer grows with
// the answer: the cost of the stream is quadratic. The deltas wait in a
// batch and go to the panel in one piece every few dozen milliseconds.

// How long the batch waits before it goes to the panel.
export const DELTA_BATCH_MS = 60;

export interface DeltaBatchOptions {
  // How long the batch waits. The tests use a small value.
  flushMs?: number;
  // The batch goes to the panel: the text of the answer and the text of
  // the thinking.
  onFlush: (text: string, thinking: string) => void;
  // The timer of the batch, the tests bring their own.
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class DeltaBatch {
  private text = '';
  private thinking = '';
  private handle: unknown;
  private readonly flushMs: number;
  private readonly onFlush: (text: string, thinking: string) => void;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(options: DeltaBatchOptions) {
    this.flushMs = options.flushMs ?? DELTA_BATCH_MS;
    this.onFlush = options.onFlush;
    this.schedule =
      options.schedule ??
      ((fn, ms) =>
        window.setTimeout(fn, ms) as unknown as unknown);
    this.cancel =
      options.cancel ??
      ((handle) => {
        window.clearTimeout(handle as number);
      });
  }

  // The text of the answer waits in the batch.
  pushText(delta: string): void {
    if (delta.length === 0) {
      return;
    }
    this.text += delta;
    this.arm();
  }

  // The text of the thinking waits in the batch.
  pushThinking(delta: string): void {
    if (delta.length === 0) {
      return;
    }
    this.thinking += delta;
    this.arm();
  }

  // The batch goes to the panel now, without waiting.
  flush(): void {
    this.disarm();
    const text = this.text;
    const thinking = this.thinking;
    this.text = '';
    this.thinking = '';
    if (text.length === 0 && thinking.length === 0) {
      return;
    }
    this.onFlush(text, thinking);
  }

  // The batch is dropped: the answer broke and the piece goes away.
  clear(): void {
    this.disarm();
    this.text = '';
    this.thinking = '';
  }

  // The text that waits in the batch.
  get pending(): string {
    return this.text + this.thinking;
  }

  private arm(): void {
    if (this.handle !== undefined) {
      return;
    }
    this.handle = this.schedule(() => {
      this.handle = undefined;
      this.flush();
    }, this.flushMs);
  }

  private disarm(): void {
    if (this.handle === undefined) {
      return;
    }
    this.cancel(this.handle);
    this.handle = undefined;
  }
}
