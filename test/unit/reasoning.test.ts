import { describe, expect, it } from 'vitest';
import {
  currentReasoning,
  reasoningControl,
  reasoningOptions
} from '../../src/ui/webview/reasoning';

describe('reasoning control', () => {
  it('gives the depth levels to M3.1 Flash', () => {
    expect(reasoningControl('MiniMax-M3.1-Flash')).toBe('depth');
    expect(reasoningOptions('MiniMax-M3.1-Flash')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ]);
  });

  it('gives two variants to M3', () => {
    expect(reasoningControl('MiniMax-M3')).toBe('variants');
    expect(reasoningOptions('MiniMax-M3')).toEqual(['off', 'adaptive']);
  });

  it('falls back to the depth for an unknown model', () => {
    expect(reasoningControl('MiniMax-M2')).toBe('depth');
  });

  it('shows the depth of M3.1 Flash', () => {
    expect(currentReasoning('MiniMax-M3.1-Flash', 'high', false)).toBe('high');
  });

  it('shows the variant of M3', () => {
    expect(currentReasoning('MiniMax-M3', 'high', false)).toBe('off');
    expect(currentReasoning('MiniMax-M3', 'high', true)).toBe('adaptive');
  });
});
