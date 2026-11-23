import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPreview } from '../../src/tools/preview';

describe('buildPreview', () => {
  it('builds a diff for write_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8');
    const preview = await buildPreview('write_file', { path: 'a.txt', content: 'new\n' }, root);
    expect(preview?.path).toBe('a.txt');
    expect(preview?.lines.some((line) => line.type === 'add')).toBe(true);
  });

  it('builds a diff for edit_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8');
    const preview = await buildPreview(
      'edit_file',
      { path: 'a.txt', old_string: 'old', new_string: 'new' },
      root
    );
    expect(preview?.lines.some((line) => line.type === 'remove')).toBe(true);
  });

  it('shows every replaced place for replace_all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one two one two one\n', 'utf8');
    const preview = await buildPreview(
      'edit_file',
      { path: 'a.txt', old_string: 'one', new_string: 'zero', replace_all: true },
      root
    );
    // The preview has to repeat the arithmetic of the write: every place,
    // not only the first one.
    const added = preview?.lines.filter((line) => line.type === 'add') ?? [];
    expect(added.some((line) => line.text.includes('zero two zero'))).toBe(true);
    expect(added.some((line) => line.text.includes('one two'))).toBe(false);
  });

  it('keeps the dollars literal for replace_all, as the write does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'x a y a z\n', 'utf8');
    const preview = await buildPreview(
      'edit_file',
      { path: 'a.txt', old_string: 'a', new_string: '$&b', replace_all: true },
      root
    );
    const added = preview?.lines.filter((line) => line.type === 'add') ?? [];
    // split/join treats the dollars as letters, the disk holds the same.
    expect(added.some((line) => line.text.includes('x $&b y $&b z'))).toBe(true);
  });

  it('returns nothing for run_terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    expect(await buildPreview('run_terminal', { command: 'ls' }, root)).toBeUndefined();
  });

  it('returns nothing for a tool without a path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    expect(await buildPreview('write_file', { content: 'x' }, root)).toBeUndefined();
  });
});
