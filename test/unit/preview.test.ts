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

  it('returns nothing for run_terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    expect(await buildPreview('run_terminal', { command: 'ls' }, root)).toBeUndefined();
  });

  it('returns nothing for a tool without a path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    expect(await buildPreview('write_file', { content: 'x' }, root)).toBeUndefined();
  });
});
