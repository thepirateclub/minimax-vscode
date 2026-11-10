import { describe, expect, it } from 'vitest';
import { parseTerminalOutput } from '../../src/ui/webview/terminalOutput';

describe('the output of a command', () => {
  it('puts the command on the first line', () => {
    const lines = parseTerminalOutput('dir tmp-demo.txt', 'Volume in drive H has no label.');
    expect(lines[0]).toEqual({ kind: 'command', text: 'dir tmp-demo.txt' });
    expect(lines[1]).toEqual({ kind: 'output', text: 'Volume in drive H has no label.' });
  });

  it('drops the wrapper of a failure, the card shows the exit code', () => {
    const lines = parseTerminalOutput(
      'bad',
      'Command failed with exit code 255\n[stderr] not recognized'
    );
    // The tool wraps the failure with the exit code, the header of the card
    // shows it. The transcript keeps the output of the command itself.
    expect(lines[1]?.kind).toBe('error');
    expect(lines[1]?.text).toBe('not recognized');
    expect(lines.some((line) => line.text.includes('exit code'))).toBe(false);
  });

  it('keeps a line of the output that looks like a wrapper', () => {
    const lines = parseTerminalOutput('ok', 'done\nCommand failed with exit code 2');
    expect(lines[1]?.kind).toBe('output');
    expect(lines[2]?.text).toBe('Command failed with exit code 2');
  });

  it('marks the stderr of a command', () => {
    const lines = parseTerminalOutput('bad', '[stderr] something went wrong');
    expect(lines[1]?.kind).toBe('error');
    expect(lines[1]?.text).toBe('something went wrong');
  });

  it('keeps a note of the tool', () => {
    const lines = parseTerminalOutput('bad', '[no output]');
    expect(lines[1]?.kind).toBe('note');
  });
});
