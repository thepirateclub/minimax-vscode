import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration } from '../../src/ui/format';

describe('formatCount', () => {
  it('keeps small numbers as they are', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(999)).toBe('999');
  });

  it('shortens thousands', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1500)).toBe('1.5K');
    expect(formatCount(9999)).toBe('10K');
    expect(formatCount(757247)).toBe('757K');
  });

  it('shortens millions', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(1_234_567)).toBe('1.2M');
    expect(formatCount(12_400_000)).toBe('12M');
  });

  it('shortens billions', () => {
    expect(formatCount(1_000_000_000)).toBe('1B');
    expect(formatCount(2_500_000_000)).toBe('2.5B');
  });

  it('survives a broken value', () => {
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('formatDuration', () => {
  it('keeps the milliseconds short', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(350)).toBe('350ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('counts the seconds when the action is longer', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(1250)).toBe('1.3s');
    expect(formatDuration(12500)).toBe('12.5s');
    expect(formatDuration(59999)).toBe('60s');
  });

  it('counts the minutes when the action is long', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('survives a broken value', () => {
    expect(formatDuration(-5)).toBe('0ms');
  });
});
