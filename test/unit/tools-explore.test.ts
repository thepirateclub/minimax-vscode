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
});
