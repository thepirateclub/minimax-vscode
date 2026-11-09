// The token spend of the extension lives apart from the chats, the status
// bar shows the numbers of the last day and the share of the cached context.

export interface UsageRecord {
  at: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface UsageSummary {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  // Every token the plan counted, the cached context included.
  total: number;
  calls: number;
  // The share of the input that the server took from the cache.
  cacheHitPercent: number;
}

// The window of the daily numbers.
export const USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
// The records of a month are enough for the cache hit rate.
const MAX_AGE_MS = 30 * USAGE_WINDOW_MS;
const MAX_RECORDS = 2000;

export interface UsageStorage {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export class UsageLedger {
  private static readonly KEY = 'minimax.usage';

  constructor(private readonly storage: UsageStorage) {}

  records(): UsageRecord[] {
    const raw = this.storage.get<UsageRecord[]>(UsageLedger.KEY, []);
    return Array.isArray(raw) ? raw : [];
  }

  add(record: UsageRecord): void {
    const now = Date.now();
    const kept = [...this.records(), record]
      .filter((item) => item.at >= now - MAX_AGE_MS)
      .slice(-MAX_RECORDS);
    this.write(kept);
  }

  summary(from: number, to: number = Date.now()): UsageSummary {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    let calls = 0;
    for (const record of this.records()) {
      if (record.at < from || record.at > to) {
        continue;
      }
      input += record.input;
      output += record.output;
      cacheRead += record.cacheRead;
      cacheCreation += record.cacheCreation;
      calls += 1;
    }
    const denominator = input + cacheRead;
    return {
      input,
      output,
      cacheRead,
      cacheCreation,
      total: input + output + cacheRead + cacheCreation,
      calls,
      cacheHitPercent:
        denominator === 0 ? 0 : Math.round((cacheRead / denominator) * 100)
    };
  }

  // The numbers of the last day, the window the user asked for.
  lastDay(now: number = Date.now()): UsageSummary {
    return this.summary(now - USAGE_WINDOW_MS, now);
  }

  // A write that fails must not break the turn, the numbers stay in memory.
  private write(records: UsageRecord[]): void {
    try {
      void Promise.resolve(this.storage.update(UsageLedger.KEY, records)).catch(
        () => undefined
      );
    } catch {
      // The host refused the write.
    }
  }
}
