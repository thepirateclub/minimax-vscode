import { describe, expect, it } from 'vitest';
import { parseReadOutput } from '../../src/ui/webview/fileRead';

describe('the output of a read', () => {
  it('takes the numbers of the lines back', () => {
    const blocks = parseReadOutput('1: alpha\n2: beta', 'a.txt');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.path).toBe('a.txt');
    expect(blocks[0]?.lines.map((line) => line.number)).toEqual([1, 2]);
    expect(blocks[0]?.lines[0]?.text).toBe('alpha');
    expect(blocks[0]?.lines[1]?.text).toBe('beta');
  });

  it('splits the read of several files', () => {
    const blocks = parseReadOutput(
      '=== a.txt ===\n1: one\n\n=== b.txt ===\n1: two',
      'a.txt'
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.path).toBe('a.txt');
    expect(blocks[1]?.path).toBe('b.txt');
    expect(blocks[1]?.lines[0]?.text).toBe('two');
  });

  it('keeps a note of the tool', () => {
    const blocks = parseReadOutput('[empty file]', 'a.txt');
    expect(blocks[0]?.lines).toHaveLength(1);
    expect(blocks[0]?.lines[0]?.number).toBe(0);
    expect(blocks[0]?.lines[0]?.text).toBe('[empty file]');
  });

  it('keeps the text of a failure', () => {
    const blocks = parseReadOutput('read_file failed: no such file', 'a.txt');
    expect(blocks[0]?.lines[0]?.text).toBe('read_file failed: no such file');
  });
});
