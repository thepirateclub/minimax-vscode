import { describe, expect, it } from 'vitest';
import { splitRestore } from '../../src/ui/webview/restoreInput';

describe('the restore of a request', () => {
  it('splits the text and the references to the files', () => {
    expect(splitRestore('look at @src/app.ts please', ['src/app.ts'])).toEqual([
      { kind: 'text', value: 'look at ' },
      { kind: 'mention', value: 'src/app.ts' },
      { kind: 'text', value: ' please' }
    ]);
  });

  it('keeps the order of the files', () => {
    const segments = splitRestore('@a.ts and @b.ts', ['a.ts', 'b.ts']);
    expect(segments.filter((item) => item.kind === 'mention').map((item) => item.value)).toEqual([
      'a.ts',
      'b.ts'
    ]);
  });

  it('takes the same file twice', () => {
    const segments = splitRestore('@a.ts then @a.ts', ['a.ts', 'a.ts']);
    expect(segments.filter((item) => item.kind === 'mention')).toHaveLength(2);
  });

  it('puts a file that is not in the text to the end', () => {
    const segments = splitRestore('plain text', ['a.ts']);
    expect(segments[segments.length - 1]).toEqual({ kind: 'mention', value: 'a.ts' });
  });

  it('leaves a request without files alone', () => {
    expect(splitRestore('just a question', [])).toEqual([
      { kind: 'text', value: 'just a question' }
    ]);
  });
});
