import { describe, expect, it } from 'vitest';
import { DeltaBatch } from '../../src/ui/webview/deltaBatch';

describe('the batch of the deltas', () => {
  it('waits and gives the whole text at once', () => {
    const flushed: Array<[string, string]> = [];
    const timers: Array<() => void> = [];
    const batch = new DeltaBatch({
      flushMs: 60,
      onFlush: (text, thinking) => flushed.push([text, thinking]),
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      cancel: () => undefined
    });

    batch.pushText('Hel');
    batch.pushText('lo');
    // Nothing went to the panel yet: the batch waits.
    expect(flushed).toHaveLength(0);
    expect(batch.pending).toBe('Hello');

    // The timer fires, the text goes at once.
    timers[0]!();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.[0]).toBe('Hello');
  });

  it('goes to the panel at once when the turn asks for it', () => {
    const flushed: string[] = [];
    const batch = new DeltaBatch({
      flushMs: 60,
      onFlush: (text) => flushed.push(text),
      schedule: () => 1,
      cancel: () => undefined
    });
    batch.pushText('part');
    batch.flush();
    expect(flushed).toEqual(['part']);
    // The batch is empty, a second flush does nothing.
    batch.flush();
    expect(flushed).toEqual(['part']);
  });

  it('drops the text of a broken answer', () => {
    const flushed: string[] = [];
    const batch = new DeltaBatch({
      flushMs: 60,
      onFlush: (text) => flushed.push(text),
      schedule: () => 1,
      cancel: () => undefined
    });
    batch.pushText('the piece of the broken answer');
    batch.clear();
    batch.flush();
    expect(flushed).toEqual([]);
    expect(batch.pending).toBe('');
  });

  it('keeps the text of the thinking apart from the answer', () => {
    const flushed: Array<[string, string]> = [];
    const batch = new DeltaBatch({
      flushMs: 60,
      onFlush: (text, thinking) => flushed.push([text, thinking]),
      schedule: () => 1,
      cancel: () => undefined
    });
    batch.pushThinking('the model thinks');
    batch.pushText('the answer');
    batch.flush();
    expect(flushed[0]?.[0]).toBe('the answer');
    expect(flushed[0]?.[1]).toBe('the model thinks');
  });
});
