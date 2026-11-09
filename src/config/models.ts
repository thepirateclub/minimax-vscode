export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type BaseUrlPreset = 'auto' | 'global' | 'china';

// Plan mode is read-only: the agent investigates and answers with a plan.
export type AgentMode = 'plan' | 'code';

export const AGENT_MODES: AgentMode[] = ['plan', 'code'];

// How the reasoning of a model is controlled.
// 'depth' - the model takes levels of the reasoning depth.
// 'variants' - the model thinks or does not, the server picks the depth.
export type ReasoningControl = 'depth' | 'variants';

export interface ModelInfo {
  id: string;
  label: string;
  // A short name for the compact selector under the prompt.
  shortLabel: string;
  supportsEffort: boolean;
  thinkingAlwaysOn: boolean;
  reasoning: ReasoningControl;
  contextWindow: number;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'MiniMax-M3.1-Flash',
    label: 'MiniMax M3.1 Flash (1M, multimodal, tunable thinking)',
    shortLabel: 'M3.1 Flash',
    supportsEffort: true,
    thinkingAlwaysOn: true,
    reasoning: 'depth',
    contextWindow: 1_000_000
  },
  {
    id: 'MiniMax-M3',
    label: 'MiniMax M3 (1M, multimodal, adaptive thinking)',
    shortLabel: 'M3',
    supportsEffort: false,
    thinkingAlwaysOn: false,
    reasoning: 'variants',
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

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}
