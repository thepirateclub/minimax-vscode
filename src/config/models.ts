export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type BaseUrlPreset = 'auto' | 'global' | 'china';

export interface ModelInfo {
  id: string;
  label: string;
  supportsEffort: boolean;
  thinkingAlwaysOn: boolean;
  contextWindow: number;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'MiniMax-M3.1-Flash',
    label: 'MiniMax M3.1 Flash (1M, multimodal, tunable thinking)',
    supportsEffort: true,
    thinkingAlwaysOn: true,
    contextWindow: 1_000_000
  },
  {
    id: 'MiniMax-M3',
    label: 'MiniMax M3 (1M, multimodal, adaptive thinking)',
    supportsEffort: false,
    thinkingAlwaysOn: false,
    contextWindow: 1_000_000
  }
];

export const GLOBAL_BASE_URL = 'https://api.minimax.io/anthropic';
export const CHINA_BASE_URL = 'https://api.minimaxi.com/anthropic';

export function resolveBaseUrl(preset: BaseUrlPreset, custom?: string): string {
  if (custom && custom.trim().length > 0) {
    return custom.trim().replace(/\/+$/, '');
  }
  if (preset === 'china') {
    return CHINA_BASE_URL;
  }
  return GLOBAL_BASE_URL;
}
