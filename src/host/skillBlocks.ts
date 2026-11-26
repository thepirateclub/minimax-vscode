import { readCommandText } from '../skills/commands';
import { discoverSkills, readSkillText } from '../skills/skills';
import { mentionedSkills } from '../ui/skillMentions';

// The blocks of the request for every `/name` it calls: a skill brings its
// instructions and the list of its files, a command of the reader is the
// request itself and the words of the reader fill it.
export async function calledSkillBlocks(root: string, text: string): Promise<string[]> {
  const skills = await discoverSkills(root).catch(() => []);
  const called = mentionedSkills(text, skills.map((skill) => skill.name));
  const blocks: string[] = [];
  for (const name of called) {
    const skill = skills.find((item) => item.name === name);
    if (skill?.command) {
      blocks.push('Run the command /' + name + ':\n' + (await readCommandText(skill, text, called)));
    } else if (skill) {
      blocks.push('Use the skill ' + name + ' for this request:\n' + (await readSkillText(skill)));
    }
  }
  return blocks;
}
