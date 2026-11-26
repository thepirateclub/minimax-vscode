import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWorkspacePath } from '../../src/paths';

// A cloned repository may carry a link to a file outside: the lexical check
// alone let read_file and write_file follow it.
describe('resolveWorkspacePath', () => {
  const top = mkdtempSync(join(tmpdir(), 'mm-paths-'));
  const root = join(top, 'ws');
  const outside = join(top, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'x');
  // A junction needs no rights on Windows and is a plain link elsewhere.
  symlinkSync(outside, join(root, 'link'), 'junction');

  it('refuses a path that leaves through a link, also for a new file', () => {
    expect(() => resolveWorkspacePath(root, 'link/secret.txt')).toThrow(/through a link/);
    expect(() => resolveWorkspacePath(root, 'link/new/file.txt')).toThrow(/through a link/);
  });

  it('keeps the plain rules', () => {
    expect(resolveWorkspacePath(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'));
    expect(() => resolveWorkspacePath(root, '../outside/secret.txt')).toThrow(/escapes/);
    expect(resolveWorkspacePath(root, '..config')).toBe(join(root, '..config'));
  });
});
