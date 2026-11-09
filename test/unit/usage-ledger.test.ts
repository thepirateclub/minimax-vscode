import { describe, expect, it } from 'vitest';
import { UsageLedger } from '../../src/storage/usage';

class MemoryStorage {
  private readonly data = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

const DAY = 24 * 60 * 60 * 1000;

describe('usage ledger', () => {
  it('sums the tokens of the last day', () => {
    const storage = new MemoryStorage();
    const ledger = new UsageLedger(storage);
    const now = Date.now();
    ledger.add({ at: now - 1000, input: 100, output: 20, cacheRead: 50, cacheCreation: 10 });
    ledger.add({ at: now - 2000, input: 300, output: 30, cacheRead: 0, cacheCreation: 0 });
    const summary = ledger.lastDay(now);
    expect(summary.input).toBe(400);
    expect(summary.output).toBe(50);
    expect(summary.cacheRead).toBe(50);
    expect(summary.cacheCreation).toBe(10);
    expect(summary.total).toBe(510);
    expect(summary.calls).toBe(2);
  });

  it('ignores the records outside of the window', () => {
    const storage = new MemoryStorage();
    const ledger = new UsageLedger(storage);
    const now = Date.now();
    ledger.add({ at: now - 1000, input: 100, output: 20, cacheRead: 0, cacheCreation: 0 });
    ledger.add({ at: now - 2 * DAY, input: 900, output: 90, cacheRead: 0, cacheCreation: 0 });
    const summary = ledger.lastDay(now);
    expect(summary.input).toBe(100);
    expect(summary.calls).toBe(1);
  });

  it('counts the share of the cached context', () => {
    const storage = new MemoryStorage();
    const ledger = new UsageLedger(storage);
    const now = Date.now();
    ledger.add({ at: now - 1000, input: 100, output: 20, cacheRead: 300, cacheCreation: 0 });
    const summary = ledger.lastDay(now);
    expect(summary.cacheHitPercent).toBe(75);
  });

  it('keeps the ledger small', () => {
    const storage = new MemoryStorage();
    const ledger = new UsageLedger(storage);
    const now = Date.now();
    ledger.add({ at: now - 40 * DAY, input: 10, output: 1, cacheRead: 0, cacheCreation: 0 });
    ledger.add({ at: now - 1000, input: 20, output: 2, cacheRead: 0, cacheCreation: 0 });
    expect(ledger.records().length).toBe(1);
  });

  it('survives a broken storage', () => {
    const storage = new MemoryStorage();
    storage.update = () => {
      throw new Error('the host refused the write');
    };
    const ledger = new UsageLedger(storage);
    expect(() =>
      ledger.add({ at: Date.now(), input: 1, output: 1, cacheRead: 0, cacheCreation: 0 })
    ).not.toThrow();
  });
});
