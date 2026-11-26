import { MiniMaxApiError } from '../api/errors';
import type { EffortLevel } from '../api/types';
import { findModel } from '../config/models';

// The model the request moves to when the chat model is not available.
export interface FallbackModel {
  model: string;
  maxTokens: number;
  effort?: EffortLevel;
  thinking?: 'adaptive';
}

// The codes of the key and of the plan limit: another model gets the same
// refusal, the fallback would only hide the real cause from the reader.
const NO_FALLBACK_CODES = new Set([2049, 2057, 2062]);

// The model is not available: not in the plan (2061), overloaded (2066) or
// the server fails (5xx). The retries are already spent when this is asked.
export function isAvailabilityError(error: unknown): boolean {
  if (!(error instanceof MiniMaxApiError)) {
    return false;
  }
  if (error.code !== undefined && NO_FALLBACK_CODES.has(error.code)) {
    return false;
  }
  return error.code === 2061 || error.code === 2066 || error.status >= 500;
}

// The catalog decides the reasoning of the fallback model: the effort only
// for a model that takes it, the adaptive thinking only for a model that
// thinks on request. An unknown model, or the chat model itself, is no
// fallback.
export function fallbackFor(
  fallbackId: string,
  chatModel: string,
  reasoning: { effort: EffortLevel; thinking: boolean }
): FallbackModel | undefined {
  const id = fallbackId.trim();
  if (id.length === 0 || id === chatModel) {
    return undefined;
  }
  const model = findModel(id);
  if (!model) {
    return undefined;
  }
  return {
    model: model.id,
    maxTokens: model.maxTokens,
    ...(model.supportsEffort ? { effort: reasoning.effort } : {}),
    ...(reasoning.thinking && !model.thinkingAlwaysOn ? { thinking: 'adaptive' as const } : {})
  };
}

export function fallbackNotice(from: string, to: string): string {
  return from + ' is not available, the turn goes on ' + to + '.';
}
