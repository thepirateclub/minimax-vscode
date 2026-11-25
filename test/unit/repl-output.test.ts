import { describe, expect, it } from 'vitest';
import { parseReplOutput, replLanguage } from '../../src/ui/webview/replOutput';

// The card of the REPL shows the result like a terminal: the output, the
// stderr with its chip, the error of the block in red.
describe('the output of the REPL', () => {
  it('marks the stderr and keeps the output quiet', () => {
    expect(parseReplOutput('ok\n[stderr] careful')).toEqual([
      { kind: 'output', text: 'ok' },
      { kind: 'output', text: 'careful', stream: 'stderr' }
    ]);
  });

  it('paints the error and its trace red', () => {
    expect(parseReplOutput('before\n[error] Traceback:\n  File "<repl>"\nNameError: x\n')).toEqual([
      { kind: 'output', text: 'before' },
      { kind: 'error', text: 'Traceback:' },
      { kind: 'error', text: '  File "<repl>"' },
      { kind: 'error', text: 'NameError: x' }
    ]);
  });

  it('reads the note of an empty block as a note', () => {
    expect(parseReplOutput('[no output]')).toEqual([{ kind: 'note', text: 'no output' }]);
  });

  it('highlights the code in the language of the tool', () => {
    expect(replLanguage('repl_python')).toBe('python');
    expect(replLanguage('repl_node')).toBe('javascript');
  });
});

describe('the card of the REPL', () => {
  it('shows the code with colors and the output, not the json of the arguments', async () => {
    const { card } = await import('../helpers/toolCardFixture');
    const markup = card({
      name: 'repl_python',
      input: { code: 'x = 1\nprint(x)' },
      content: '1\n[stderr] careful'
    });
    expect(markup).toContain('repl-code');
    expect(markup).toContain('tok-');
    expect(markup).toContain('term-chip');
    expect(markup).not.toContain('tool-input');
  });
});
