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
  // The limit of the answer of one request, the thinking tokens count into it.
  // The server accepts far more, the catalog keeps a value that fits a code answer.
  maxTokens: number;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'MiniMax-M3.1-Flash',
    label: 'MiniMax M3.1 Flash (1M, multimodal, tunable thinking)',
    shortLabel: 'M3.1 Flash',
    supportsEffort: true,
    thinkingAlwaysOn: true,
    reasoning: 'depth',
    contextWindow: 1_000_000,
    maxTokens: 65_536
  },
  {
    id: 'MiniMax-M3',
    label: 'MiniMax M3 (1M, multimodal, adaptive thinking)',
    shortLabel: 'M3',
    supportsEffort: false,
    thinkingAlwaysOn: false,
    reasoning: 'variants',
    contextWindow: 1_000_000,
    maxTokens: 65_536
  }
];

export const GLOBAL_BASE_URL = 'https://api.minimax.io/anthropic';
export const CHINA_BASE_URL = 'https://api.minimaxi.com/anthropic';

// The key of the user goes to this address with the header Authorization, so
// the address is checked before it is used.
export const OFFICIAL_BASE_URL_HOSTS = ['api.minimax.io', 'api.minimaxi.com'];

export interface BaseUrlCheck {
  ok: boolean;
  // Why the address was refused.
  reason?: string;
  // The host of the address, it holds the key.
  host?: string;
}

// Only https is accepted: the key must not go to the network in the clear.
export function checkBaseUrl(value: string): BaseUrlCheck {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'the address is empty' };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'the address is not a valid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'only https is allowed' };
  }
  if (url.hostname.length === 0) {
    return { ok: false, reason: 'the address has no host' };
  }
  return { ok: true, host: url.hostname };
}

// The address of MiniMax itself, the key may go to another host only with the
// consent of the user.
export function isOfficialBaseUrlHost(host: string): boolean {
  return OFFICIAL_BASE_URL_HOSTS.includes(host.toLowerCase());
}

export function resolveBaseUrl(preset: BaseUrlPreset, custom?: string): string {
  if (custom && custom.trim().length > 0 && checkBaseUrl(custom).ok) {
    return custom.trim().replace(/\/+$/, '');
  }
  // The address was not trusted, the official endpoint of the region is used.
  if (preset === 'china') {
    return CHINA_BASE_URL;
  }
  return GLOBAL_BASE_URL;
}

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}
