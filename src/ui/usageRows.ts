// The numbers behind the badge of the status bar. The module has no
// dependency on the editor, the rows are built from plain numbers.

import type { QuotaSnapshot } from '../api/quota';
import type { UsageSummary } from '../storage/usage';
import { formatCount } from './format';

export interface UsageRow {
  label: string;
  value: string;
}

export function emptyUsageSummary(): UsageSummary {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    total: 0,
    calls: 0,
    cacheHitPercent: 0
  };
}

// The badge shows the rest of the plan, a click opens these numbers.
export function buildUsageRows(
  summary: UsageSummary | undefined,
  quota: QuotaSnapshot | undefined
): UsageRow[] {
  const spend = summary ?? emptyUsageSummary();
  const percent = (value: number | undefined): string =>
    value === undefined ? 'unknown' : value + '%';
  return [
    {
      label: 'Tokens spent in the last 24 hours',
      value: formatCount(spend.total)
    },
    { label: 'Left this week', value: percent(quota?.weeklyRemainingPercent) },
    {
      label: 'Left in the 5-hour window',
      value: percent(quota?.remainingPercent)
    },
    {
      label: 'Cache hit in the last 24 hours',
      value: spend.cacheHitPercent + '%'
    }
  ];
}
