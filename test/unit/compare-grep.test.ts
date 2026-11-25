import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCompareTools, formatUnified } from '../../src/tools/compare';
import { diffLines } from '../../src/tools/diff';
import { createGrepTools, globToRegExp, grepText } from '../../src/tools/grep';
import { createExistsTools, nearNames } from '../../src/tools/exists';
import { missingFileHint } from '../../src/tools/repl/hints';
import type { ToolContext } from '../../src/tools/types';

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-grep-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'one\ntwo\nfunction loadAsync() {}\nfour\n', 'utf8');
  await writeFile(join(root, 'src', 'b.ts'), 'one\nTWO\nfunction loadAsync() {}\nfour\n', 'utf8');
  await writeFile(join(root, 'notes.md'), 'function loadAsync in the docs\n', 'utf8');
  return root;
}

const ctx = (root: string) => ({ workspaceRoot: root }) as unknown as ToolContext;

describe('the comparison of files and texts', () => {
  it('writes a unified diff with a hunk head and the size of the change', () => {
    const text = formatUnified(diffLines('a\nb\nc\n', 'a\nB\nc\n'), 'x.ts', 'y.ts');
    expect(text).toContain('--- x.ts\n+++ y.ts\n@@ -1 +1 @@');
    expect(text).toContain('-b\n+B');
    expect(text).toContain('+1 -1');
    expect(formatUnified(diffLines('a\n', 'a\n'), 'x', 'y')).toContain('identical');
  });

  it('compares two files and a file with a text', async () => {
    const root = await workspace();
    const [diffFiles, compare] = createCompareTools();
    const files = await diffFiles!.execute({ path_a: 'src/a.ts', path_b: 'src/b.ts' }, ctx(root));
    expect(files.content).toContain('-two\n+TWO');
    const mixed = await compare!.execute({ path_a: 'src/a.ts', text_b: 'one\ntwo\n' }, ctx(root));
    expect(mixed.content).toContain('-function loadAsync() {}');
    const outside = await diffFiles!.execute({ path_a: '../x', path_b: 'src/a.ts' }, ctx(root));
    expect(outside.isError).toBe(true);
  });
});

describe('grep', () => {
  it('reads a glob of a name and of a path', () => {
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('notes.md')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/deep/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('lib/a.ts')).toBe(false);
  });

  it('shows the matches with their neighbours and a gap between them', () => {
    const found = grepText('a\nhit\nb\nc\nd\ne\nhit\n', /hit/, 1, 10);
    expect(found.count).toBe(2);
    expect(found.lines).toEqual(['1-a', '2:hit', '3-b', '--', '6-e', '7:hit', '8-']);
  });

  it('searches the workspace with a pattern, a glob and the case', async () => {
    const root = await workspace();
    const [grep] = createGrepTools();
    const all = await grep!.execute({ pattern: 'function \\w+Async', context: 0 }, ctx(root));
    expect(all.content).toContain('src/a.ts\n3:function loadAsync() {}');
    expect(all.content).toContain('notes.md');
    const ts = await grep!.execute({ pattern: 'two', glob: '*.ts', ignore_case: true, context: 0 }, ctx(root));
    expect(ts.content).toContain('src/b.ts\n2:TWO');
    expect(ts.content).toContain('2 matches.');
    const bad = await grep!.execute({ pattern: '(' }, ctx(root));
    expect(bad.isError).toBe(true);
  });
});

// The model guessed the paths in the REPL and got a bare ENOENT.
describe('the hint of a missing file in the REPL', () => {
  it('names the root of the relative paths', () => {
    const hint = missingFileHint("Error: ENOENT: no such file or directory, open '/mnt/data/a.ts'", 'C:\\w');
    expect(hint).toContain('The file /mnt/data/a.ts does not exist.');
    expect(hint).toContain('workspace root C:\\w');
    expect(missingFileHint("FileNotFoundError: [Errno 2] No such file or directory: 'x.txt'", '/w')).toContain('x.txt');
    expect(missingFileHint('TypeError: x is not a function', '/w')).toBeUndefined();
  });
});

// The check of a path is a tool: a file, a folder or missing with the names
// that look like it.
describe('path_exists', () => {
  it('names a file, a folder and a missing path with its neighbours', async () => {
    const root = await workspace();
    const [exists] = createExistsTools();
    const result = await exists!.execute({ paths: ['src/a.ts', 'src', 'src/A.TS.bak', 'src/c.ts', 'gone/x.ts', '../out'] }, ctx(root));
    const lines = result.content.split('\n');
    expect(lines[0]).toMatch(/^src\/a\.ts: file, \d+ B, changed /);
    expect(lines[1]).toBe('src: folder, 2 entries');
    expect(lines[3]).toBe('src/c.ts: missing');
    expect(lines[4]).toBe('gone/x.ts: missing, its folder is missing too');
    expect(lines[5]).toMatch(/^\.\.\/out: refused/);
  });

  it('finds the names that look like the missing one', () => {
    expect(nearNames('Readme.md', ['README.md', 'src'])).toEqual(['README.md']);
    expect(nearNames('parser.ts', ['parser.test.ts', 'lexer.ts'])).toEqual(['parser.test.ts']);
  });
});
