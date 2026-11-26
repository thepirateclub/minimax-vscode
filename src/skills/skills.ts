// The skills of the agent in the open format of the plugins of MiniMax and
// of Claude: a folder with SKILL.md, a front matter with the name and the
// description, the instructions in the body. MiniMax has no API that gives
// the skills of an account, the skills come from the folders on the disk:
// `npx skills add` links them into ~/.claude/skills, a plugin package keeps
// them under skills/ next to .minimax-plugin/plugin.json.

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export interface Skill {
  name: string;
  description: string;
  // The folder of the skill, its SKILL.md and the files it names.
  dir: string;
}

const MAX_DESCRIPTION = 300;

// The folders where the skills live, the project first: a skill of the
// project wins over a skill of the user with the same name.
export function skillRoots(workspaceRoot: string, home: string = homedir()): string[] {
  const roots: string[] = [];
  if (workspaceRoot) {
    roots.push(join(workspaceRoot, '.minimax', 'skills'), join(workspaceRoot, '.claude', 'skills'));
  }
  roots.push(join(home, '.minimax', 'skills'), join(home, '.claude', 'skills'), join(home, '.agents', 'skills'));
  return roots;
}

// The folders of the plugin packages: every folder under plugins/ with a
// .minimax-plugin/plugin.json.
export function pluginRoots(workspaceRoot: string, home: string = homedir()): string[] {
  const roots: string[] = [];
  if (workspaceRoot) {
    roots.push(join(workspaceRoot, '.minimax', 'plugins'));
  }
  roots.push(join(home, '.minimax', 'plugins'));
  return roots;
}

// The front matter of SKILL.md: `name:` and `description:` between two
// lines of `---`. A description may be quoted.
export function parseSkillFile(text: string): { name?: string; description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { body: text };
  }
  // A long description is often a YAML block (`description: >` with the
  // text on the indented lines below) or a plain value wrapped on several
  // lines: the indented lines belong to the field above, joined by spaces.
  const fields: Record<string, string> = {};
  let last = '';
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (field?.[1]) {
      last = field[1].toLowerCase();
      const value = (field[2] ?? '').trim();
      fields[last] = /^[>|][+-]?$/.test(value) ? '' : value;
    } else if (last && /^\s+\S/.test(line)) {
      fields[last] = ((fields[last] ?? '') + ' ' + line.trim()).trim();
    }
  }
  for (const key of Object.keys(fields)) {
    fields[key] = (fields[key] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return {
    ...(fields['name'] ? { name: fields['name'] } : {}),
    ...(fields['description'] ? { description: fields['description'] } : {}),
    body: match[2] ?? ''
  };
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readSkill(dir: string): Promise<Skill | undefined> {
  try {
    const parsed = parseSkillFile(await readFile(join(dir, 'SKILL.md'), 'utf8'));
    const name = parsed.name ?? basename(dir) ?? '';
    if (!name || !parsed.description) {
      return undefined;
    }
    return { name, description: parsed.description.slice(0, MAX_DESCRIPTION), dir };
  } catch {
    return undefined;
  }
}

async function skillsIn(root: string): Promise<Skill[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const name of names.sort()) {
    const skill = await readSkill(join(root, name));
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
}

// The skills a plugin package lists in its plugin.json, the skills folder
// of the package when the list is absent.
async function pluginSkills(pluginDir: string): Promise<Skill[]> {
  let listed: string[] | undefined;
  try {
    const manifest: unknown = JSON.parse(await readFile(join(pluginDir, '.minimax-plugin', 'plugin.json'), 'utf8'));
    const skills = (manifest as { skills?: unknown }).skills;
    if (Array.isArray(skills)) {
      listed = skills.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    return [];
  }
  if (listed === undefined) {
    return skillsIn(join(pluginDir, 'skills'));
  }
  const found: Skill[] = [];
  for (const entry of listed) {
    // An entry names the folder of the skill or its SKILL.md.
    const dir = join(pluginDir, entry.replace(/[\/]?SKILL\.md$/i, ''));
    const skill = (await readSkill(dir)) ?? (await readSkill(join(pluginDir, 'skills', entry)));
    if (skill) {
      found.push(skill);
    }
  }
  return found;
}

export async function discoverSkills(workspaceRoot: string, home: string = homedir()): Promise<Skill[]> {
  const byName = new Map<string, Skill>();
  const add = (skills: Skill[]) => {
    for (const skill of skills) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }
  };
  for (const root of skillRoots(workspaceRoot, home)) {
    add(await skillsIn(root));
  }
  for (const root of pluginRoots(workspaceRoot, home)) {
    let packages: string[] = [];
    try {
      packages = await readdir(root);
    } catch {
      continue;
    }
    for (const name of packages.sort()) {
      const dir = join(root, name);
      if (await isDir(dir)) {
        add(await pluginSkills(dir));
      }
    }
  }
  return [...byName.values()];
}

// The section of the prompt: the names and the descriptions only. The model
// reads the body of a skill with read_skill when the task needs it, the
// prompt stays short with many skills.
export function renderSkills(skills: readonly Skill[]): string {
  if (skills.length === 0) {
    return '';
  }
  return [
    'Skills (instructions for special tasks, call read_skill with the name before you do such a task):',
    ...skills.map((skill) => '- ' + skill.name + ': ' + skill.description)
  ].join('\n');
}

// The body of a skill and the files of its folder, the model reads them
// with read_file when the skill names them.
export async function readSkillText(skill: Skill): Promise<string> {
  const parsed = parseSkillFile(await readFile(join(skill.dir, 'SKILL.md'), 'utf8'));
  let files: string[] = [];
  try {
    files = (await readdir(skill.dir)).filter((name) => name !== 'SKILL.md').sort();
  } catch {
    files = [];
  }
  const lines = ['Skill ' + skill.name + ' (folder ' + skill.dir + ')', '', parsed.body.trim()];
  if (files.length > 0) {
    lines.push('', 'Files of the skill: ' + files.join(', '));
  }
  return lines.join('\n');
}
