import { describe, expect, it } from 'vitest';
import { tokenize, splitIdentifier } from '../../src/search/tokenize';
import { trigramScore, trigrams } from '../../src/search/trigram';
import { LexicalIndex } from '../../src/search/lexical';
import { chunkContent, cosineSimilarity, fuseRankings } from '../../src/search/semantic';

describe('tokenize', () => {
  it('keeps the whole word and its parts', () => {
    expect(tokenize('readFile')).toEqual(['readfile', 'read', 'file']);
  });

  it('splits a snake case word', () => {
    expect(tokenize('read_file')).toEqual(['read_file', 'read', 'file']);
  });

  it('drops the short words', () => {
    expect(tokenize('a b const')).toEqual(['const']);
  });

  it('splits the camel case inside a word', () => {
    expect(splitIdentifier('parseHTTPResponse')).toEqual(['parse', 'HTTP', 'Response']);
  });

  it('keeps the digits of an identifier', () => {
    expect(tokenize('base64')).toEqual(['base64', 'base']);
  });
});

describe('trigrams', () => {
  it('cuts the text into triples', () => {
    expect(trigrams('abcd')).toEqual(['abc', 'bcd']);
  });

  it('scores a full match as one', () => {
    expect(trigramScore('readfile', 'xx readFile xx')).toBe(1);
  });

  it('scores a miss as zero', () => {
    expect(trigramScore('readfile', 'nothing here')).toBe(0);
  });

  it('scores a partial match between zero and one', () => {
    const score = trigramScore('readfile', 'read files');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('LexicalIndex', () => {
  it('ranks the file that holds the term first', () => {
    const index = new LexicalIndex();
    index.addDocument(
      'src/read.ts',
      'export function readFile(path: string) { return path; }'
    );
    index.addDocument(
      'src/write.ts',
      'export function writeFile(path: string) { return path; }'
    );
    const ranked = index.rank('readFile');
    expect(ranked[0]?.path).toBe('src/read.ts');
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it('finds a term that is split inside the code', () => {
    const index = new LexicalIndex();
    index.addDocument('src/a.ts', 'const tokenBudget = computeBudget();');
    index.addDocument('src/b.ts', 'const other = 1;');
    expect(index.rank('tokenBudget')[0]?.path).toBe('src/a.ts');
  });

  it('returns nothing for an unknown term', () => {
    const index = new LexicalIndex();
    index.addDocument('src/a.ts', 'const value = 1;');
    expect(index.rank('zzznotthere')).toHaveLength(0);
  });

  it('drops a document that was removed', () => {
    const index = new LexicalIndex();
    index.addDocument('src/a.ts', 'const needle = 1;');
    expect(index.rank('needle')).toHaveLength(1);
    index.removeDocument('src/a.ts');
    expect(index.rank('needle')).toHaveLength(0);
    expect(index.size).toBe(0);
  });

  it('replaces the content of a document', () => {
    const index = new LexicalIndex();
    index.addDocument('src/a.ts', 'const needle = 1;');
    index.addDocument('src/a.ts', 'const other = 2;');
    expect(index.size).toBe(1);
    expect(index.rank('needle')).toHaveLength(0);
    expect(index.rank('other')).toHaveLength(1);
  });
});

describe('chunkContent', () => {
  it('splits the content into passages with line numbers', () => {
    const passages = chunkContent('a.ts', 'one\ntwo\nthree\nfour', { size: 8, overlap: 0 });
    expect(passages.length).toBeGreaterThan(1);
    expect(passages[0]?.path).toBe('a.ts');
    expect(passages[0]?.line).toBe(1);
  });

  it('keeps a single passage for a short file', () => {
    const passages = chunkContent('a.ts', 'short', { size: 100, overlap: 10 });
    expect(passages).toHaveLength(1);
  });
});

describe('cosineSimilarity', () => {
  it('is one for the same vector', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('is zero for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is minus one for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is zero for an empty vector', () => {
    expect(cosineSimilarity([], [1, 0])).toBe(0);
  });
});

describe('fuseRankings', () => {
  it('merges the ranks of two lists', () => {
    expect(fuseRankings([['a', 'b'], ['b', 'c']])).toEqual(['b', 'a', 'c']);
  });

  it('keeps a single list as it is', () => {
    expect(fuseRankings([['a', 'b']])).toEqual(['a', 'b']);
  });
});
