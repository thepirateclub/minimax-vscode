import { describe, expect, it } from 'vitest';
import { MODELS, resolveBaseUrl } from '../../src/config/models';

describe('resolveBaseUrl', () => {
  it('resolves the global preset', () => {
    expect(resolveBaseUrl('global')).toBe('https://api.minimax.io/anthropic');
  });

  it('resolves the china preset', () => {
    expect(resolveBaseUrl('china')).toBe('https://api.minimaxi.com/anthropic');
  });

  it('prefers a custom url', () => {
    expect(resolveBaseUrl('auto', 'https://example.test/anthropic')).toBe('https://example.test/anthropic');
  });

  it('falls back to global for auto', () => {
    expect(resolveBaseUrl('auto')).toBe('https://api.minimax.io/anthropic');
  });
});

describe('MODELS', () => {
  it('exposes both flagship models', () => {
    expect(MODELS.map((m) => m.id)).toContain('MiniMax-M3.1-Flash');
    expect(MODELS.map((m) => m.id)).toContain('MiniMax-M3');
  });

  it('marks effort support only for M3.1-Flash', () => {
    const flash = MODELS.find((m) => m.id === 'MiniMax-M3.1-Flash');
    const m3 = MODELS.find((m) => m.id === 'MiniMax-M3');
    expect(flash?.supportsEffort).toBe(true);
    expect(m3?.supportsEffort).toBe(false);
    expect(flash?.thinkingAlwaysOn).toBe(true);
  });

  it('marks the reasoning control per model', () => {
    const flash = MODELS.find((m) => m.id === 'MiniMax-M3.1-Flash');
    const m3 = MODELS.find((m) => m.id === 'MiniMax-M3');
    expect(flash?.reasoning).toBe('depth');
    expect(m3?.reasoning).toBe('variants');
  });

  it('keeps a context window of one million for both models', () => {
    expect(MODELS.every((model) => model.contextWindow === 1_000_000)).toBe(true);
  });
});
