import { describe, expect, it, vi } from 'vitest';
import { fetchQuota, quotaUrl } from '../../src/api/quota';

const BASE_URL = 'https://api.minimax.io/anthropic';

function quotaResponse(modelRemains: unknown[]): Response {
  return new Response(
    JSON.stringify({
      model_remains: modelRemains,
      base_resp: { status_code: 0, status_msg: 'success' }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchImpl = vi.fn(async () => response.clone());
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

describe('quota', () => {
  it('builds the quota url from the api root', () => {
    expect(quotaUrl(BASE_URL)).toBe('https://api.minimax.io/v1/token_plan/remains');
    expect(quotaUrl(BASE_URL + '/')).toBe('https://api.minimax.io/v1/token_plan/remains');
    expect(quotaUrl('https://api.minimaxi.com/anthropic')).toBe(
      'https://api.minimaxi.com/v1/token_plan/remains'
    );
  });

  it('reads the remaining percent of the 5-hour window', async () => {
    const fetchImpl = stubFetch(
      quotaResponse([
        {
          model_name: 'general',
          current_interval_remaining_percent: 97,
          current_weekly_remaining_percent: 99,
          remains_time: 7556954
        }
      ])
    );
    const snapshot = await fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' });
    expect(snapshot.remainingPercent).toBe(97);
    expect(snapshot.weeklyRemainingPercent).toBe(99);
    expect(snapshot.resetsInMs).toBe(7556954);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.minimax.io/v1/token_plan/remains'
    );
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer key');
  });

  it('falls back to the model row when there is no general row', async () => {
    stubFetch(
      quotaResponse([{ model_name: 'MiniMax-M3', current_interval_remaining_percent: 40 }])
    );
    const snapshot = await fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' });
    expect(snapshot.remainingPercent).toBe(40);
  });

  it('prefers the general row over a model row', async () => {
    stubFetch(
      quotaResponse([
        { model_name: 'MiniMax-M3', current_interval_remaining_percent: 40 },
        { model_name: 'general', current_interval_remaining_percent: 90 }
      ])
    );
    const snapshot = await fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' });
    expect(snapshot.remainingPercent).toBe(90);
  });

  it('clamps the percent into the 0..100 range', async () => {
    stubFetch(
      quotaResponse([{ model_name: 'general', current_interval_remaining_percent: 140 }])
    );
    const snapshot = await fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' });
    expect(snapshot.remainingPercent).toBe(100);
  });

  it('reports a missing percent instead of a zero', async () => {
    stubFetch(quotaResponse([{ model_name: 'general' }]));
    const snapshot = await fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' });
    expect(snapshot.remainingPercent).toBeUndefined();
  });

  it('fails when the api answers with an error', async () => {
    stubFetch(
      new Response(JSON.stringify({ base_resp: { status_code: 2049, status_msg: 'invalid api key' } }), {
        status: 401
      })
    );
    await expect(fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' })).rejects.toThrow(
      /Invalid MiniMax API key/
    );
  });

  it('fails when the api returns no quota rows', async () => {
    stubFetch(quotaResponse([]));
    await expect(fetchQuota({ baseUrl: BASE_URL, apiKey: 'key' })).rejects.toThrow(
      /no quota data/
    );
  });
});
