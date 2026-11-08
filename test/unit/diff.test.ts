import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/tools/diff';

describe('diffLines', () => {
  it('marks added lines', () => {
    const result = diffLines('a\nb\n', 'a\nb\nc\n');
    expect(result.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['c']);
  });

  it('marks removed lines', () => {
    const result = diffLines('a\nb\n', 'a\n');
    expect(result.filter((l) => l.type === 'remove').map((l) => l.text)).toEqual(['b']);
  });

  it('marks changed lines as remove plus add', () => {
    const result = diffLines('a\nb\n', 'a\nc\n');
    expect(result.filter((l) => l.type === 'remove').map((l) => l.text)).toEqual(['b']);
    expect(result.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['c']);
  });

  it('returns nothing for identical content', () => {
    expect(diffLines('same\n', 'same\n')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'new\n').filter((l) => l.type === 'add')).toHaveLength(1);
  });
});
