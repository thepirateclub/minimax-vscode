import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('returns nothing when there is no match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'x', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute({ query: 'zzz-not-there' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No matches');
  });
});
