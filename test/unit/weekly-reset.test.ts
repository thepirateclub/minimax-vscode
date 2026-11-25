import { describe, expect, it } from 'vitest';
import { fetchQuota } from '../../src/api/quota';
import { formatCountdown } from '../../src/ui/format';
import { weeklyResetText } from '../../src/ui/usageRows';
import { quotaTitle, toUiQuota } from '../../src/ui/quotaMeter';

// The badge of the status bar names when the weekly limit starts again: the
// server sends the end of the week, the badge counts down to it.
describe('the reset of the weekly limit', () => {
  it('counts down in days, hours and minutes', () => {
    expect(formatCountdown(5 * 86_400_000 + 4 * 3_600_000 + 16 * 60_000 + 30_000)).toBe('5d 4h 16m');
    expect(formatCountdown(3 * 3_600_000 + 60_000)).toBe('3h 1m');
    expect(formatCountdown(59_000)).toBe('1m');
    expect(formatCountdown(-5)).toBe('0m');
  });

  it('takes the end of the week from the server', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          model_remains: [
            {
              model_name: 'general',
              current_interval_remaining_percent: 76,
              current_weekly_remaining_percent: 83,
              remains_time: 1000,
              end_time: 1795614818987,
              weekly_end_time: 1796049322027,
              weekly_remains_time: 447414169
            }
          ],
          base_resp: { status_code: 0 }
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const snapshot = await fetchQuota({ baseUrl: 'https://api.minimax.io/anthropic', apiKey: 'k', fetchImpl });
    expect(snapshot.weeklyResetsAt).toBe(1796049322027);
    expect(snapshot.resetsAt).toBe(1795614818987);
  });

  it('names the date and the time left in the badge and in the header', () => {
    const now = new Date(2026, 10, 25, 9, 0).getTime();
    const at = new Date(2026, 11, 1, 14, 35).getTime();
    expect(weeklyResetText(at, now)).toBe('1 Dec, 14:35 (in 6d 5h 35m)');
    const quota = toUiQuota({ remainingPercent: 76, weeklyRemainingPercent: 83, resetsInMs: 0, weeklyResetsAt: at }, now);
    expect(quotaTitle(quota, now)).toBe('5-hour window: 76% left\nWeek: 83% left, resets 1 Dec, 14:35 (in 6d 5h 35m)');
  });
});
