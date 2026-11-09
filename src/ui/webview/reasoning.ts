import type { EffortLevel } from '../../api/types';
import { findModel, type ReasoningControl } from '../../config/models';

// The value of the reasoning control: a depth level or one of two variants.
export type ReasoningValue = EffortLevel | 'off' | 'adaptive';

export function reasoningControl(model: string): ReasoningControl {
  return findModel(model)?.reasoning ?? 'depth';
}

// M3.1 Flash takes the depth of the reasoning, M3 only thinks or not, the
// server picks the depth there.
export function reasoningOptions(model: string): ReasoningValue[] {
  if (reasoningControl(model) === 'variants') {
    return ['off', 'adaptive'];
  }
  return ['low', 'medium', 'high', 'xhigh', 'max'];
}

export function currentReasoning(
  model: string,
  effort: EffortLevel,
  thinking: boolean
): ReasoningValue {
  if (reasoningControl(model) === 'variants') {
    return thinking ? 'adaptive' : 'off';
  }
  return effort;
}
