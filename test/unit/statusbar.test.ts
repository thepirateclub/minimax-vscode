import { afterEach, describe, expect, it, vi } from 'vitest';

const item = { text: '', tooltip: '', command: '', show: vi.fn(), dispose: vi.fn() };
vi.mock('vscode', () => ({
  window: { createStatusBarItem: () => item },
  StatusBarAlignment: { Right: 2 }
}));
const { StatusBarController } = await import('../../src/ui/statusbar');

afterEach(() => vi.useRealTimers());

describe('the badge of the status bar', () => {
  it('names the state and the rest of the 5-hour window, a click opens the numbers', () => {
    vi.useFakeTimers();
    const bar = new StatusBarController();
    expect(item.command).toBe('minimax.showUsage');
    expect(item.text).toBe('$(sparkle) MiniMax');
    bar.setState('thinking');
    expect(item.text).toBe('$(sync~spin) MiniMax thinking');
    bar.setQuota({ remainingPercent: 76 } as never);
    bar.setState('idle');
    expect(item.text).toBe('$(sparkle) MiniMax (76%)');
    bar.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });

  it('names each reset once in the tooltip', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T12:00:00'));
    const bar = new StatusBarController();
    bar.setQuota({ remainingPercent: 50, resetsAt: Date.now() + 3_600_000, weeklyResetsAt: Date.now() + 86_400_000 } as never);
    const tooltip = String(item.tooltip);
    expect(tooltip.match(/The 5-hour window resets/g)).toHaveLength(1);
    expect(tooltip.match(/The weekly limit resets/g)).toHaveLength(1);
    bar.dispose();
  });
});
