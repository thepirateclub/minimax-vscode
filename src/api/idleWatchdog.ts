// The watchdog of a quiet stream. A connection that hangs without data and
// without a close waits forever, the agent sees no error and never repeats
// the request. The watchdog cuts the read after a quiet period.

// The error of a stream that stayed quiet. The message tells the reader
// that the server did not answer, not that the network broke.
export class IdleTimeoutError extends Error {
  constructor() {
    super('MiniMax stopped sending data and the connection stayed open.');
    this.name = 'IdleTimeoutError';
  }
}

export class IdleWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expired = false;
  // The promise that never resolves on its own: it rejects when the stream
  // stays quiet for too long.
  private readonly expiry: Promise<never>;
  private rejectExpiry: ((reason: Error) => void) | undefined;

  constructor(private readonly timeoutMs: number) {
    this.expiry = new Promise<never>((_resolve, reject) => {
      this.rejectExpiry = reject;
    });
    // The quiet period can end while no read waits: the rejection must not
    // surface as an unhandled one, the next race still gets it.
    this.expiry.catch(() => undefined);
  }

  // The read waits for the data. The promise of the watchdog wins when the
  // stream stays quiet for too long.
  race<T>(work: Promise<T>): Promise<T> {
    return Promise.race([work, this.expiry]);
  }

  // The timer starts over: the stream spoke, it is alive.
  kick(): void {
    if (this.expired) {
      return;
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.expired = true;
      this.rejectExpiry?.(new IdleTimeoutError());
    }, this.timeoutMs);
    // The timer must not hold the process of the extension host.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
