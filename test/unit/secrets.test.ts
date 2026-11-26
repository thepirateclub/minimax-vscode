import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
const { clearApiKey, getApiKey, setApiKey } = await import('../../src/config/secrets');

function storage() {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key: string) => map.get(key),
    store: async (key: string, value: string) => void map.set(key, value),
    delete: async (key: string) => void map.delete(key),
    keys: async () => [...map.keys()],
    onDidChange: () => ({ dispose: () => undefined })
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('the key of the M Plan', () => {
  it('lives in the secret storage, trimmed', async () => {
    const secrets = storage();
    await setApiKey(secrets as never, '  sk-key  ');
    expect(secrets.map.get('minimax.apiKey')).toBe('sk-key');
    expect(await getApiKey(secrets as never)).toBe('sk-key');
    await clearApiKey(secrets as never);
    expect(secrets.map.size).toBe(0);
  });

  it('falls back to the environment, the stored key wins', async () => {
    vi.stubEnv('MINIMAX_API_KEY', ' sk-env ');
    const secrets = storage();
    expect(await getApiKey(secrets as never)).toBe('sk-env');
    await setApiKey(secrets as never, 'sk-stored');
    expect(await getApiKey(secrets as never)).toBe('sk-stored');
  });

  it('treats a blank key as no key', async () => {
    vi.stubEnv('MINIMAX_API_KEY', '   ');
    const secrets = storage();
    await secrets.store('minimax.apiKey', '  ');
    expect(await getApiKey(secrets as never)).toBeUndefined();
  });
});
