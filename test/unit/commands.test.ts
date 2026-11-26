import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { argumentsOf, discoverCommands, expandCommand } from '../../src/skills/commands';
import { discoverSkills, renderSkills } from '../../src/skills/skills';
import { calledSkillBlocks } from '../../src/host/skillBlocks';

function project(): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'cmd-root-'));
  const home = mkdtempSync(join(tmpdir(), 'cmd-home-'));
  mkdirSync(join(root, '.minimax', 'commands'), { recursive: true });
  mkdirSync(join(home, '.minimax', 'commands'), { recursive: true });
  writeFileSync(join(root, '.minimax', 'commands', 'review.md'), '---\ndescription: Review the change\n---\nReview $ARGUMENTS for bugs.');
  writeFileSync(join(home, '.minimax', 'commands', 'review.md'), 'The user review, loses to the project.');
  writeFileSync(join(home, '.minimax', 'commands', 'tests.md'), '# Write the tests\nCover the module with tests.');
  writeFileSync(join(home, '.minimax', 'commands', 'bad name.md'), 'skipped');
  return { root, home };
}

describe('the commands of the reader', () => {
  it('come from the project first and then the user', async () => {
    const { root, home } = project();
    const commands = await discoverCommands(root, home);
    expect(commands.map((command) => command.name + ': ' + command.description)).toEqual([
      'review: Review the change',
      'tests: Write the tests'
    ]);
  });

  it('fill the template with the words of the request', () => {
    expect(expandCommand('Review $ARGUMENTS now', 'src/a.ts')).toBe('Review src/a.ts now');
    expect(expandCommand('Cover with tests.', 'the parser')).toBe('Cover with tests.\n\nArguments: the parser');
    expect(expandCommand('Cover with tests.', '')).toBe('Cover with tests.');
    expect(argumentsOf('/review src/a.ts please', ['review'])).toBe('src/a.ts please');
  });

  it('stay out of the skills of the prompt and come with the request', async () => {
    const { root, home } = project();
    const skills = await discoverSkills(root, home);
    expect(skills.some((skill) => skill.name === 'review')).toBe(true);
    expect(renderSkills(skills)).toBe('');
    const blocks = await calledSkillBlocks(root, '/review src/a.ts');
    expect(blocks).toEqual(['Run the command /review:\nReview src/a.ts for bugs.']);
  });
});
