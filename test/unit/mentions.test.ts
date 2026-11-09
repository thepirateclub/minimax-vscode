import { describe, expect, it } from 'vitest';
import { extractMentionPaths } from '../../src/agent/mentions';

describe('mention extraction', () => {
  it('finds a file reference in the text', () => {
    expect(extractMentionPaths('look at @src/agent/agent.ts please')).toEqual([
      'src/agent/agent.ts'
    ]);
  });

  it('ignores an e-mail address', () => {
    expect(extractMentionPaths('write to user@example.com')).toEqual([]);
  });

  it('ignores a word without an extension', () => {
    expect(extractMentionPaths('ping @someone')).toEqual([]);
  });

  it('ignores a path that escapes the workspace', () => {
    expect(extractMentionPaths('read @../secret.txt')).toEqual([]);
  });

  it('keeps the order and drops duplicates', () => {
    expect(extractMentionPaths('@a.ts and @b.ts and @a.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('drops the trailing punctuation', () => {
    expect(extractMentionPaths('see @a.ts.')).toEqual(['a.ts']);
  });
});
