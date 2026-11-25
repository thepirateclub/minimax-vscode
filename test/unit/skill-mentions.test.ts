import { describe, expect, it } from 'vitest';
import { matchSkills, mentionedSkills, slashPrefix, typedSkill, type UiSkill } from '../../src/ui/skillMentions';
import { SKILL_CHIP_MARK } from '../../src/ui/webview/components/composerField';

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

// The chip of a skill is one object in the visible text, so the field does
// not read it as a typed name again: that loop froze the editor window.
describe('a skill chip in the visible text', () => {
  it('is not a typed skill and not a slash', () => {
    const skills = [{ name: 'review', description: 'Review', source: 'user' as const, file: 'x' }];
    expect(typedSkill(SKILL_CHIP_MARK + ' ', skills)).toBeUndefined();
    expect(slashPrefix('text ' + SKILL_CHIP_MARK + ' ')).toBeUndefined();
  });
});
