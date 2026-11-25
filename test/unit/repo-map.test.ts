import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRepoMap, declarationsOf, renderRepoMap } from '../../src/search/repoMap';
import { ProjectSearch } from '../../src/search/project';

// The map of the project tells the model where a thing lives before it
// searches: the files and the names they declare, within a budget.
describe('the repo map', () => {
  it('takes the top-level names of the languages', () => {
    expect(
      declarationsOf(
        'import x from "y";\nexport function run() {}\nexport class Agent {}\nconst inner = 1;\nexport type Mode = string;'
      )
    ).toEqual(['run', 'Agent', 'Mode']);
    expect(declarationsOf('def main():\n    def inner(): pass\nclass Tool:\n')).toEqual(['main', 'Tool']);
    expect(declarationsOf('func (s *Server) Start() {}\nfunc main() {}')).toEqual(['Start', 'main']);
  });

  it('puts the files the others import first when the budget is short', () => {
    const files = new Map([
      ['src/leaf.ts', 'export function leaf() {}'],
      ['src/core.ts', 'export function core() {}'],
      ['src/a.ts', "import { core } from './core';\nexport const a = 1;"],
      ['src/b.ts', "import { core } from './core';\nexport const b = 1;"]
    ]);
    const map = buildRepoMap(files, 50);
    expect(map).toContain('src/core.ts: core');
    expect(map).not.toContain('src/leaf.ts');
    expect(map).toMatch(/\.\.\. and \d+ more files/);
  });

  it('stays inside the budget and skips files without names', () => {
    const files = new Map<string, string>();
    for (let i = 0; i < 400; i++) {
      files.set('src/f' + i + '.ts', 'export function name' + i + '() {}');
    }
    files.set('src/empty.ts', 'const x = 1;');
    const map = buildRepoMap(files);
    expect(map.length).toBeLessThan(4200);
    expect(map).not.toContain('empty.ts');
  });

  it('is a section of the prompt only when it has lines', () => {
    expect(renderRepoMap('')).toBe('');
    expect(renderRepoMap('a.ts: x')).toBe('Repository map (files and their top-level names):\na.ts: x');
  });

  it('comes from the index of the project and follows a changed file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-map-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'tool.ts'), 'export function readTool() {}', 'utf8');
    await writeFile(join(root, 'notes.md'), '# export function nope', 'utf8');
    const search = new ProjectSearch(root);
    expect(await search.repoMap()).toBe('src/tool.ts: readTool');
    await writeFile(join(root, 'src', 'tool.ts'), 'export function writeTool() {}', 'utf8');
    search.invalidate('src/tool.ts');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await search.repoMap()).toBe('src/tool.ts: writeTool');
  });
});
