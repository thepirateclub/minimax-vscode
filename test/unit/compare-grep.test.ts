import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCompareTools, formatUnified } from '../../src/tools/compare';
import { diffLines } from '../../src/tools/diff';
import { createGrepTools, globToRegExp, grepText } from '../../src/tools/grep';
import { createExistsTools, nearNames } from '../../src/tools/exists';
import { isScratchPath, writesScratch } from '../../src/tools/scratch';
import { cutMiddle, dropExitEcho, splitLeadingCd, stripAnsi, tailLines } from '../../src/tools/commandOutput';
import { parseTerminalOutput } from '../../src/ui/webview/terminalOutput';
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

// The script of the model: cut a method out of a web and a native file,
// count random() in it, compare the bodies. Tools do it now.
describe('the functions of two languages', () => {
  async function versions(): Promise<string> {
    const root = await workspace();
    await writeFile(
      join(root, 'src', 'Game.ts'),
      'class Game {\n  private dropLoot(): void {\n    const a = random()\n    const b = random()\n  }\n\n  equip(id: string): void {\n    this.save()\n  }\n}\n',
      'utf8'
    );
    await writeFile(
      join(root, 'src', 'Game.kt'),
      'class Game {\n    private fun dropLoot() {\n        val a = random()\n    }\n\n    fun equip(id: String) {\n        save()\n    }\n}\n',
      'utf8'
    );
    return root;
  }

  it('counts the matches inside one function of a file', async () => {
    const root = await versions();
    const [grep] = createGrepTools();
    const web = await grep!.execute({ pattern: 'random\\(\\)', path: 'src/Game.ts', symbol: 'dropLoot', count_only: true }, ctx(root));
    expect(web.content).toContain('src/Game.ts: 2');
    const native = await grep!.execute({ pattern: 'random\\(\\)', path: 'src/Game.kt', symbol: 'dropLoot', context: 0 }, ctx(root));
    expect(native.content).toContain('3:        val a = random()');
    const none = await grep!.execute({ pattern: 'x', path: 'src/Game.kt', symbol: 'nothing' }, ctx(root));
    expect(none.isError).toBe(true);
  });

  it('compares the same method of a web and of a native file', async () => {
    const root = await versions();
    const [, compare] = createCompareTools();
    const result = await compare!.execute(
      { path_a: 'src/Game.ts', symbol_a: 'equip', path_b: 'src/Game.kt', symbol_b: 'equip' },
      ctx(root)
    );
    expect(result.content).toContain('--- src/Game.ts#equip');
    expect(result.content).toContain('+        save()');
  });
});

describe('the scratch folders of the project', () => {
  it('knows a scratch path and a write into it', () => {
    expect(isScratchPath('temp/final.txt')).toBe(true);
    expect(isScratchPath('./tmp/a')).toBe(true);
    expect(isScratchPath('src/temp/a.ts')).toBe(false);
    expect(writesScratch("fs.writeFileSync('temp/ach.txt', x)")).toBe(true);
    expect(writesScratch('node a.js > temp/out.txt')).toBe(true);
    expect(writesScratch("open('tmp/x.txt', 'w')")).toBe(true);
    expect(writesScratch('Get-Content a | Out-File temp\\b.txt')).toBe(true);
    expect(writesScratch("fs.readFileSync('temp/a.txt')")).toBe(false);
    expect(writesScratch('npm test')).toBe(false);
  });
});

// The model wrapped a command in `cd app; ... | Select-Object -Last 20;
// "EXIT=$LASTEXITCODE"`: the tool does all of it now.
describe('the output of a command for the model', () => {
  it('moves a leading cd into cwd and drops the hand-made exit code', () => {
    expect(splitLeadingCd('cd app; npm run check')).toEqual({ cwd: 'app', command: 'npm run check' });
    expect(splitLeadingCd('cd "my app" && npm test')).toEqual({ cwd: 'my app', command: 'npm test' });
    expect(splitLeadingCd('npm test')).toBeUndefined();
    expect(dropExitEcho('npm run check 2>&1; "EXIT_CHECK=$LASTEXITCODE"')).toBe('npm run check 2>&1');
    expect(dropExitEcho('npm test; echo $?')).toBe('npm test');
    expect(dropExitEcho('npm test')).toBe('npm test');
  });

  it('removes the colors, keeps the tail and cuts the middle', () => {
    expect(stripAnsi('\u001b[31;1mnpm notice\u001b[0m')).toBe('npm notice');
    expect(tailLines('a\nb\nc\nd', 2)).toBe('[2 earlier lines are cut]\nc\nd');
    const cut = cutMiddle('h'.repeat(50) + 't'.repeat(50), 40);
    expect(cut.startsWith('hhhhhhhh')).toBe(true);
    expect(cut.endsWith('t'.repeat(32))).toBe(true);
  });

  it('does not print the exit code twice in the card', () => {
    const lines = parseTerminalOutput('npm test', 'ok\n[exit code 0]');
    expect(lines.map((line) => line.text)).toEqual(['npm test', 'ok']);
  });
});
