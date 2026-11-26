import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdleTimeoutError, IdleWatchdog } from '../../src/api/idleWatchdog';

afterEach(() => vi.useRealTimers());

describe('the watchdog of a quiet stream', () => {
  it('cuts the read after the quiet period', async () => {
    vi.useFakeTimers();
    const dog = new IdleWatchdog(1000);
    dog.kick();
    const read = dog.race(new Promise<string>(() => undefined));
    const caught = read.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toBeInstanceOf(IdleTimeoutError);
  });

  it('starts over on every chunk and lets a living stream finish', async () => {
    vi.useFakeTimers();
    const dog = new IdleWatchdog(1000);
    dog.kick();
    await vi.advanceTimersByTimeAsync(900);
    dog.kick();
    await vi.advanceTimersByTimeAsync(900);
    await expect(dog.race(Promise.resolve('chunk'))).resolves.toBe('chunk');
    dog.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(dog.race(Promise.resolve('after stop'))).resolves.toBe('after stop');
  });

  it('stays expired once it fired', async () => {
    vi.useFakeTimers();
    const dog = new IdleWatchdog(10);
    dog.kick();
    await vi.advanceTimersByTimeAsync(10);
    dog.kick();
    await expect(dog.race(new Promise<string>(() => undefined))).rejects.toBeInstanceOf(IdleTimeoutError);
  });
});
