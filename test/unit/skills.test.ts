import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSkills, parseSkillFile, renderSkills } from '../../src/skills/skills';
import { createSkillTools } from '../../src/tools/skills';

async function skill(root: string, name: string, description: string, body = 'Do it well.'): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), '---\nname: ' + name + '\ndescription: "' + description + '"\n---\n' + body, 'utf8');
}

// The skills of MiniMax and of Claude come as folders with SKILL.md: the
// project, the user and the plugin packages give them.
describe('the skills', () => {
  it('reads the front matter of SKILL.md', () => {
    expect(parseSkillFile('---\nname: pdf\ndescription: \'Make a PDF\'\n---\nBody')).toEqual({
      name: 'pdf',
      description: 'Make a PDF',
      body: 'Body'
    });
    expect(parseSkillFile('no front matter')).toEqual({ body: 'no front matter' });
  });

  it('finds the skills of the project, the user and the plugins, the project wins', async () => {
    const work = await mkdtemp(join(tmpdir(), 'mm-ws-'));
    const home = await mkdtemp(join(tmpdir(), 'mm-home-'));
    await skill(join(work, '.minimax', 'skills'), 'pdf', 'the pdf of the project');
    await skill(join(home, '.claude', 'skills'), 'pdf', 'the pdf of the user');
    await skill(join(home, '.claude', 'skills'), 'xlsx', 'tables');
    const plugin = join(home, '.minimax', 'plugins', 'research');
    await mkdir(join(plugin, '.minimax-plugin'), { recursive: true });
    await writeFile(join(plugin, '.minimax-plugin', 'plugin.json'), JSON.stringify({ skills: ['skills/search'] }), 'utf8');
    await skill(join(plugin, 'skills'), 'search', 'search the web');
    await mkdir(join(home, '.claude', 'skills', 'broken'), { recursive: true });
    const found = await discoverSkills(work, home);
    expect(found.map((item) => [item.name, item.description])).toEqual([
      ['pdf', 'the pdf of the project'],
      ['xlsx', 'tables'],
      ['search', 'search the web']
    ]);
    expect(renderSkills(found)).toContain('- xlsx: tables');
    expect(renderSkills([])).toBe('');
  });

  it('reads a skill and its files, and nothing out of its folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mm-home-'));
    const root = join(home, '.claude', 'skills');
    await skill(root, 'pdf', 'pdf', 'Run make.py.');
    await writeFile(join(root, 'pdf', 'make.py'), 'print(1)', 'utf8');
    const [tool] = createSkillTools({ skills: async () => discoverSkills('', home) });
    const ctx = { workspaceRoot: '', signal: new AbortController().signal, logger: { info: () => undefined, error: () => undefined } };
    const body = await tool!.execute({ name: 'pdf' }, ctx);
    expect(body.content).toContain('Run make.py.');
    expect(body.content).toContain('Files of the skill: make.py');
    expect((await tool!.execute({ name: 'pdf', file: 'make.py' }, ctx)).content).toBe('print(1)');
    expect((await tool!.execute({ name: 'pdf', file: '../../x' }, ctx)).isError).toBe(true);
    expect((await tool!.execute({ name: 'nope' }, ctx)).content).toContain('The skills: pdf');
  });
});

describe('a description in a YAML block', () => {
  it('reads the folded lines and not the marker', () => {
    const text = '---\nname: gif\ndescription: >\n  Cute stickers\n  from photos.\n---\nBody';
    expect(parseSkillFile(text).description).toBe('Cute stickers from photos.');
    expect(parseSkillFile('---\nname: a\ndescription: |-\n  One\n---\n').description).toBe('One');
  });
});
