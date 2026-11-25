import type { UiUsageTurn } from './protocol';

// One bar of the chart is one turn of the reader, and the bar grows with
// every request of the turn: the chart counted at the end of the turn only,
// a long turn of many tools stood still for minutes and the spend of a
// sub-agent never reached it.
export const MAX_USAGE_TURNS = 24;

export interface RequestUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export function addRequestUsage(
  turns: readonly UiUsageTurn[],
  usage: RequestUsage,
  newTurn: boolean
): UiUsageTurn[] {
  const cache = (usage.cacheReadTokens ?? 0) + (usage.cacheCreationTokens ?? 0);
  const last = turns[turns.length - 1];
  const next =
    newTurn || !last
      ? [...turns, { input: usage.inputTokens, output: usage.outputTokens, cache }]
      : [
          ...turns.slice(0, -1),
          { input: last.input + usage.inputTokens, output: last.output + usage.outputTokens, cache: last.cache + cache }
        ];
  return next.slice(-MAX_USAGE_TURNS);
}
