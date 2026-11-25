import { describe, expect, it } from 'vitest';
import { meterLevel, quotaTitle, toUiQuota } from '../../src/ui/quotaMeter';

// The header shows what is left of the 5-hour window and of the week.
describe('the meter of the limits', () => {
  it('takes the snapshot of the server for the panel', () => {
    expect(toUiQuota({ remainingPercent: 72.4, weeklyRemainingPercent: 140, resetsInMs: 60_000 }, 1000)).toEqual({
      fiveHour: 72.4,
      weekly: 100,
      resetsAt: 61_000
    });
    expect(toUiQuota({ remainingPercent: undefined, weeklyRemainingPercent: undefined, resetsInMs: 0 })).toEqual({});
  });

  it('warns at a quarter and calls a tenth low', () => {
    expect(meterLevel(60)).toBe('ok');
    expect(meterLevel(25)).toBe('warn');
    expect(meterLevel(10)).toBe('low');
  });

  it('names both windows and the reset in the tooltip', () => {
    const now = 0;
    expect(quotaTitle({ fiveHour: 72.4, weekly: 40, resetsAt: 72 * 60_000 + 5000 }, now)).toBe(
      '5-hour window: 72% left, resets in 1h 12m\nWeek: 40% left'
    );
    expect(quotaTitle({ fiveHour: 50, resetsAt: 125_000 }, now)).toBe('5-hour window: 50% left, resets in 2m');
  });
});
