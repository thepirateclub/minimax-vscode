import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { readSkillText, type Skill } from '../skills/skills';
import type { ToolEntry } from './types';

export interface SkillToolOptions {
  // The skills of the project and of the user, the host finds them.
  skills: (workspaceRoot: string) => Promise<Skill[]>;
}

const MAX_FILE_CHARS = 60_000;

// The skill lives out of the workspace (~/.claude/skills), read_file does
// not reach it. read_skill reads the body and the files of the folder of
// the skill, and nothing out of that folder.
export function createSkillTools(options: SkillToolOptions): ToolEntry[] {
  const readSkill: ToolEntry = {
    name: 'read_skill',
    description:
      'Read a skill from the Skills section of the context: its instructions and the list of its files. Pass file to read one file of the skill folder (a script, a template, a reference).',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the skill.' },
        file: { type: 'string', description: 'A file of the skill folder, relative to it.' }
      },
      required: ['name']
    },
    async execute(input, ctx) {
      const name = String(input['name'] ?? '');
      const skills = await options.skills(ctx.workspaceRoot);
      const skill = skills.find((item) => item.name === name);
      if (!skill) {
        const known = skills.map((item) => item.name).join(', ');
        return { content: 'No skill named "' + name + '".' + (known ? ' The skills: ' + known + '.' : ''), isError: true };
      }
      const file = typeof input['file'] === 'string' ? input['file'] : '';
      if (file.length === 0) {
        return { content: await readSkillText(skill) };
      }
      const target = resolve(skill.dir, file);
      const inside = relative(skill.dir, target);
      if (inside.startsWith('..') || resolve(inside) === inside) {
        return { content: 'The file is out of the folder of the skill.', isError: true };
      }
      try {
        const text = await readFile(target, 'utf8');
        return {
          content: text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) + '\n[truncated]' : text
        };
      } catch {
        return { content: 'The skill has no file ' + file + '.', isError: true };
      }
    }
  };
  return [readSkill];
}
