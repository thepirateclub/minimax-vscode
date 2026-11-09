import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The module of the git panel talks to the editor, the parser of the names
// does not need it.
vi.mock('vscode', () => ({
  extensions: { getExtension: () => undefined }
}));

// The real git is not called, the answers of the commands are known.
vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    if (args.includes('ls-files')) {
      callback(null, 'src-new.ts\n', '');
      return;
    }
    if (args.includes('name-status')) {
      callback(null, 'M\tsrc/app.ts\n', '');
      return;
    }
    if (args.includes('log')) {
      callback(null, 'feat: the panel\n', '');
      return;
    }
    callback(null, '', '');
  }
}));

import {
  collectStagedChanges,
  formatNewFile,
  parseNameStatus,
  parsePaths
} from '../../src/git/scm';

describe('git names', () => {
  it('reads the status of every changed file', () => {
    const output = ['M\tsrc/app.ts', 'A\tsrc/new.ts', 'D\tsrc/old.ts'].join('\n');
    expect(parseNameStatus(output)).toEqual([
      { status: 'M', path: 'src/app.ts' },
      { status: 'A', path: 'src/new.ts' },
      { status: 'D', path: 'src/old.ts' }
    ]);
  });

  it('takes the new path of a rename', () => {
    const output = 'R100\tsrc/old.ts\tsrc/new.ts';
    expect(parseNameStatus(output)).toEqual([{ status: 'R', path: 'src/new.ts' }]);
  });

  it('skips the empty lines', () => {
    expect(parseNameStatus('\n\n')).toEqual([]);
  });

  it('reads the paths of the new files', () => {
    expect(parsePaths('src/a.ts\nsrc/b.ts\n\n')).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('the new files', () => {
  it('look like a diff of their own', () => {
    const block = formatNewFile('src/new.ts', 'export const a = 1;\n');
    expect(block).toContain('+++ b/src/new.ts');
    expect(block).toContain('+export const a = 1;');
  });

  it('reach the model, a diff does not keep them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-git-'));
    await writeFile(join(root, 'src-new.ts'), 'export const a = 1;\n', 'utf8');
    const changes = await collectStagedChanges(root);
    expect(changes.files).toContainEqual({ status: 'A', path: 'src-new.ts' });
    expect(changes.diff).toContain('src-new.ts');
    expect(changes.diff).toContain('export const a = 1;');
  });
});
