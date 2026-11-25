// The limits of the M Plan in the header of the panel: the share left of
// the 5-hour window and of the week. The status bar shows the same numbers,
// the panel draws them as two bars: the reader sees the limit while the
// agent works, without a click on the badge.

import type { QuotaSnapshot } from '../api/quota';
import { formatDuration } from './format';

export interface UiQuota {
  // The share left in percent, absent when the server did not send it.
  fiveHour?: number;
  weekly?: number;
  // When the 5-hour window starts again.
  resetsAt?: number;
}

export type MeterLevel = 'ok' | 'warn' | 'low';

export function toUiQuota(snapshot: QuotaSnapshot, now: number = Date.now()): UiQuota {
  const quota: UiQuota = {};
  if (snapshot.remainingPercent !== undefined) {
    quota.fiveHour = clamp(snapshot.remainingPercent);
  }
  if (snapshot.weeklyRemainingPercent !== undefined) {
    quota.weekly = clamp(snapshot.weeklyRemainingPercent);
  }
  if (snapshot.resetsInMs > 0) {
    quota.resetsAt = now + snapshot.resetsInMs;
  }
  return quota;
}

// A quarter left asks for attention, a tenth is the end of the window.
export function meterLevel(percent: number): MeterLevel {
  if (percent <= 10) {
    return 'low';
  }
  return percent <= 25 ? 'warn' : 'ok';
}

export function quotaTitle(quota: UiQuota, now: number = Date.now()): string {
  const lines: string[] = [];
  if (quota.fiveHour !== undefined) {
    const reset =
      quota.resetsAt !== undefined && quota.resetsAt > now
        ? ', resets in ' + formatDuration(quota.resetsAt - now).replace(/ \d+s$/, '')
        : '';
    lines.push('5-hour window: ' + Math.round(quota.fiveHour) + '% left' + reset);
  }
  if (quota.weekly !== undefined) {
    lines.push('Week: ' + Math.round(quota.weekly) + '% left');
  }
  return lines.join('\n');
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
