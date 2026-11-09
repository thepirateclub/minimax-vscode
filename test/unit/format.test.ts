import { describe, expect, it } from 'vitest';
import { formatCount } from '../../src/ui/format';

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
