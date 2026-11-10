import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInText, findInTree, matchLine } from '../../src/search/find';

describe('the search of findstr', () => {
  it('matches a line by any of the patterns', () => {
    expect(matchLine('  hp: 10', ['atk:', 'hp:'], false)).toBe(true);
    expect(matchLine('  hp: 10', ['atk:', 'def:'], false)).toBe(false);
  });

  it('ignores the case when it is asked', () => {
    expect(matchLine('HP: 10', ['hp:'], false)).toBe(false);
    expect(matchLine('HP: 10', ['hp:'], true)).toBe(true);
  });

  it('gives the number of the line and the text of the match', () => {
    const found = findInText('one\ntwo hp: 10\nthree', {
      patterns: ['hp:'],
      ignoreCase: false,
      limit: 10
    });
    expect(found).toEqual([{ line: 2, text: 'two hp: 10' }]);
  });

  it('searches a file that the model named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-find-'));
    await mkdir(join(root, 'js', 'data'), { recursive: true });
    await writeFile(
      join(root, 'js', 'data', 'units.js'),
      'const a = 1;\nconst unit = { hp: 10 };\n',
      'utf8'
    );
    const hits = await findInTree(root, {
      patterns: ['hp:'],
      ignoreCase: true,
      limit: 10,
      sub: 'js/data/units.js'
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('js/data/units.js');
    expect(hits[0]?.line).toBe(2);
  });

  it('searches a hidden folder that the model named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-find-'));
    await mkdir(join(root, '.worktrees', 'kuznets-a19', 'js', 'data'), { recursive: true });
    await writeFile(
      join(root, '.worktrees', 'kuznets-a19', 'js', 'data', 'units.js'),
      'hp: 10\natk: 20\nspd: 30\n',
      'utf8'
    );
    const hits = await findInTree(root, {
      patterns: ['hp:', 'atk:', 'spd:'],
      ignoreCase: true,
      limit: 10,
      sub: '.worktrees/kuznets-a19/js/data/units.js'
    });
    expect(hits).toHaveLength(3);
    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3]);
  });

  it('skips the hidden folders when the whole project is searched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-find-'));
    await mkdir(join(root, '.worktrees', 'wt'), { recursive: true });
    await writeFile(join(root, '.worktrees', 'wt', 'units.js'), 'hp: 10\n', 'utf8');
    await writeFile(join(root, 'app.ts'), 'const hp = 1;\n', 'utf8');
    const hits = await findInTree(root, {
      patterns: ['hp'],
      ignoreCase: true,
      limit: 10
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('app.ts');
  });

  it('reports a path that does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-find-'));
    await expect(
      findInTree(root, { patterns: ['hp'], ignoreCase: false, limit: 10, sub: 'nope.js' })
    ).rejects.toThrow('does not exist');
  });
});
