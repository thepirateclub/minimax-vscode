import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMentionPaths, readMentionedFiles } from '../../src/agent/mentions';

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

describe('mention attachments', () => {
  it('reads the files named by the chips', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-mentions-'));
    await writeFile(join(root, 'a.ts'), 'alpha', 'utf8');
    await writeFile(join(root, 'b.ts'), 'beta', 'utf8');
    const files = await readMentionedFiles(root, 'plain text', ['a.ts', 'b.ts']);
    expect(files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(files[0]?.content).toBe('alpha');
  });

  it('reads a file only once when the text and the chip agree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-mentions-'));
    await writeFile(join(root, 'a.ts'), 'alpha', 'utf8');
    const files = await readMentionedFiles(root, 'look at @a.ts', ['a.ts']);
    expect(files.map((file) => file.path)).toEqual(['a.ts']);
  });

  it('skips a chip that points outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-mentions-'));
    const files = await readMentionedFiles(root, 'plain', ['../secret.ts']);
    expect(files).toHaveLength(0);
  });
});
