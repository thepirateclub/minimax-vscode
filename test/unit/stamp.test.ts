import { describe, expect, it } from 'vitest';
import { formatDuration, formatStamp, fullStamp } from '../../src/ui/format';

// The feed tells when every action was done: the time for today, the date
// and the time for another day.
describe('formatStamp', () => {
  const now = new Date(2026, 10, 25, 18, 0).getTime();

  it('gives the time for today', () => {
    expect(formatStamp(new Date(2026, 10, 25, 9, 5).getTime(), now)).toBe('09:05');
  });

  it('gives the date and the time for another day of this year', () => {
    expect(formatStamp(new Date(2026, 10, 24, 23, 59).getTime(), now)).toBe('24 Nov, 23:59');
  });

  it('adds the year for another year', () => {
    expect(formatStamp(new Date(2025, 0, 3, 7, 0).getTime(), now)).toBe('3 Jan 2025, 07:00');
  });

  it('gives the full moment with the seconds for the tooltip', () => {
    expect(fullStamp(new Date(2026, 10, 25, 9, 5, 7).getTime())).toBe('2026-11-25 09:05:07');
  });
});

describe('formatDuration over an hour', () => {
  it('counts hours and minutes', () => {
    expect(formatDuration(95 * 60_000 + 20_000)).toBe('1h 35m');
  });
});
