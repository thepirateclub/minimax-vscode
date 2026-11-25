import { describe, expect, it } from 'vitest';
import { addRequestUsage, MAX_USAGE_TURNS } from '../../src/ui/usageTurns';

// The chart of the spend moves with every request, not at the end of the turn.
describe('the bar of a turn', () => {
  it('opens a bar on the first request of the turn and grows it on the next ones', () => {
    let turns = addRequestUsage([], { inputTokens: 100, outputTokens: 10 }, true);
    turns = addRequestUsage(turns, { inputTokens: 50, outputTokens: 5, cacheReadTokens: 7 }, false);
    expect(turns).toEqual([{ input: 150, output: 15, cache: 7 }]);
    turns = addRequestUsage(turns, { inputTokens: 1, outputTokens: 1 }, true);
    expect(turns.length).toBe(2);
  });

  it('keeps the last bars only', () => {
    let turns = addRequestUsage([], { inputTokens: 1, outputTokens: 1 }, true);
    for (let i = 0; i < MAX_USAGE_TURNS + 5; i++) {
      turns = addRequestUsage(turns, { inputTokens: 1, outputTokens: 1 }, true);
    }
    expect(turns.length).toBe(MAX_USAGE_TURNS);
  });
});
