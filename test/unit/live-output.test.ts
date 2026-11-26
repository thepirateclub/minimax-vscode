import { describe, expect, it, vi } from 'vitest';
import { LiveOutput } from '../../src/tools/liveOutput';
import { createTerminalTools } from '../../src/tools/terminal';
import { keepRecent, MAX_PROGRESS } from '../../src/ui/progressLog';

describe('the live output of a command', () => {
  it('sends whole lines in batches, without the colors', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const live = new LiveOutput((text) => sent.push(text), 250);
    live.push('\u001b[32mok\u001b[0m 1\nok ');
    live.push('2\npart');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(sent).toEqual(['ok 1\nok 2']);
    live.close();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(['ok 1\nok 2']);
    vi.useRealTimers();
  });

  it('keeps the tail of a long journal', () => {
    const lines = Array.from({ length: MAX_PROGRESS + 10 }, (_, i) => String(i));
    expect(keepRecent(lines)).toHaveLength(MAX_PROGRESS);
    expect(keepRecent(lines)[0]).toBe('10');
  });

  it('streams a real command into the journal of the action', async () => {
    const [tool] = createTerminalTools();
    const lines: string[] = [];
    const command = process.platform === 'win32'
      ? 'Write-Output first; Start-Sleep -Milliseconds 700; Write-Output second'
      : 'echo first; sleep 0.7; echo second';
    const result = await tool!.execute(
      { command },
      { workspaceRoot: process.cwd(), signal: new AbortController().signal, logger: console, progress: (line: string) => lines.push(line) } as never
    );
    expect(result.content).toContain('second');
    expect(lines[0]).toBe('first');
  }, 20_000);
});
