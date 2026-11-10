import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectSearch } from '../../src/search/project';
import { createExploreTools } from '../../src/tools/explore';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

describe('explore tools', () => {
  it('lists files and skips node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'x', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'list_files');
    const result = await tool!.execute({}, makeContext(root));
    expect(result.content).toContain('src/a.ts');
    expect(result.content).not.toContain('node_modules');
  });

  it('finds matches with file and line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'const needle = 1;\n', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute({ query: 'needle' }, makeContext(root));
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('const needle');
  });

  it('searches through the index of the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'a.ts'),
      'export function readFile() { return 1; }\n',
      'utf8'
    );
    await writeFile(
      join(root, 'src', 'b.ts'),
      'export function writeFile() { return 2; }\n',
      'utf8'
    );
    const search = new ProjectSearch(root);
    const tool = createExploreTools({ search: () => search }).find(
      (t) => t.name === 'search_code'
    );
    const result = await tool!.execute({ query: 'readFile' }, makeContext(root));
    expect(result.content).toContain('src/a.ts');
    expect(result.content).toContain('readFile');
    expect(result.content.split('\n')[0]).toContain('src/a.ts');
  });

  it('finds a cut word with the fuzzy match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'a.ts'),
      'export function readFile() { return 1; }\n',
      'utf8'
    );
    const search = new ProjectSearch(root);
    const tool = createExploreTools({ search: () => search }).find(
      (t) => t.name === 'search_code'
    );
    const result = await tool!.execute({ query: 'eadFil' }, makeContext(root));
    expect(result.content).toContain('src/a.ts');
  });

  it('returns nothing when there is no match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'x', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute({ query: 'zzz-not-there' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No matches');
  });

  it('searches several words in one file, like findstr does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'js', 'data'), { recursive: true });
    await writeFile(
      join(root, 'js', 'data', 'units.js'),
      'const unit = {\n  hp: 10,\n  atk: 20,\n  spd: 30\n};\n',
      'utf8'
    );
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute(
      {
        query: 'hp:',
        patterns: ['hp:', 'atk:', 'spd:'],
        ignore_case: true,
        path: 'js/data/units.js'
      },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('js/data/units.js:2');
    expect(result.content).toContain('js/data/units.js:3');
    expect(result.content).toContain('js/data/units.js:4');
  });

  it('searches a hidden folder that the model named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, '.worktrees', 'kuznets-a19', 'js', 'data'), { recursive: true });
    await writeFile(
      join(root, '.worktrees', 'kuznets-a19', 'js', 'data', 'units.js'),
      'hp: 10\n',
      'utf8'
    );
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute(
      { query: 'hp:', path: '.worktrees/kuznets-a19/js/data/units.js' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('hp: 10');
  });

  it('ignores the case when it is asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'const HP = 1;\n', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const strict = await tool!.execute({ query: 'hp' }, makeContext(root));
    expect(strict.content).toContain('No matches');
    const loose = await tool!.execute({ query: 'hp', ignore_case: true }, makeContext(root));
    expect(loose.content).toContain('const HP');
  });

  it('reports a path that does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute(
      { query: 'hp', path: 'nope/units.js' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('does not exist');
  });
});
