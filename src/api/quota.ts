import { mapHttpError, MiniMaxApiError } from './errors';

export interface QuotaSnapshot {
  remainingPercent: number | undefined;
  weeklyRemainingPercent: number | undefined;
  resetsInMs: number;
}

interface RemainsRow {
  model_name?: string;
  current_interval_remaining_percent?: number;
  current_weekly_remaining_percent?: number;
  remains_time?: number;
}

interface RemainsResponse {
  model_remains?: RemainsRow[];
  base_resp?: { status_code?: number; status_msg?: string };
}

// The messages endpoint lives under /anthropic, the quota endpoint at the API root.
export function quotaUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '');
  return root + '/v1/token_plan/remains';
}

export async function fetchQuota(options: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<QuotaSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(quotaUrl(options.baseUrl), {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + options.apiKey,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    throw await mapHttpError(response);
  }
  const payload = (await response.json()) as RemainsResponse;
  const row = pickRow(payload.model_remains ?? []);
  if (!row) {
    throw new MiniMaxApiError('MiniMax returned no quota data.', 200, undefined, true);
  }
  return {
    remainingPercent: percent(row.current_interval_remaining_percent),
    weeklyRemainingPercent: percent(row.current_weekly_remaining_percent),
    resetsInMs: row.remains_time ?? 0
  };
}

function pickRow(rows: RemainsRow[]): RemainsRow | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  return (
    rows.find((row) => row.model_name === 'general') ??
    rows.find((row) => (row.model_name ?? '').startsWith('MiniMax-M')) ??
    rows[0]
  );
}

function percent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
