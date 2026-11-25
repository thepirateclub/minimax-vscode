import { describe, expect, it } from 'vitest';
import { matchSkills, mentionedSkills, slashPrefix, typedSkill, type UiSkill } from '../../src/ui/skillMentions';

const SKILLS: UiSkill[] = [
  { name: 'pdf', description: 'Make a PDF', source: 'user', file: '/h/.claude/skills/pdf/SKILL.md' },
  { name: 'xlsx', description: 'Tables and pdf export', source: 'user', file: '/h/.claude/skills/xlsx/SKILL.md' },
  { name: 'review', description: 'Review the change', source: 'project', file: '/w/.minimax/skills/review/SKILL.md' }
];

// `/name` in the field calls a skill: the panel suggests the names, a pick,
// Tab or a full name with a space makes a chip, the host attaches the skill.
describe('the skills in the field', () => {
  it('opens the list after a slash at the start or after a space, not in a path', () => {
    expect(slashPrefix('/')).toBe('');
    expect(slashPrefix('fix it with /pd')).toBe('pd');
    expect(slashPrefix('src/ui')).toBeUndefined();
    expect(slashPrefix('/pdf now')).toBeUndefined();
  });

  it('suggests the names that start with the prefix first, then the ones that hold it', () => {
    expect(matchSkills(SKILLS, '').map((skill) => skill.name)).toEqual(['pdf', 'xlsx', 'review']);
    expect(matchSkills(SKILLS, 'pd').map((skill) => skill.name)).toEqual(['pdf', 'xlsx']);
    expect(matchSkills(SKILLS, 'zzz')).toEqual([]);
  });

  it('takes a name typed in full and closed with a space', () => {
    expect(typedSkill('use /pdf ', SKILLS)).toBe('pdf');
    expect(typedSkill('use /pd ', SKILLS)).toBeUndefined();
    expect(typedSkill('use /pdf', SKILLS)).toBeUndefined();
  });

  it('finds the skills a request calls and nothing else', () => {
    expect(mentionedSkills('/review the diff, then /pdf.', ['pdf', 'review'])).toEqual(['review', 'pdf']);
    expect(mentionedSkills('see src/pdf and /unknown', ['pdf'])).toEqual([]);
    expect(mentionedSkills('/pdf /pdf', ['pdf'])).toEqual(['pdf']);
  });
});
