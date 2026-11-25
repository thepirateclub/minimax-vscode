import { describe, expect, it } from 'vitest';
import { formatWorkspaceProblems, mentionsProblems } from '../../src/agent/problems';

// `@problems` in the request sends the Problems of the editor to the agent.
describe('the problems of the workspace', () => {
  it('sees the mention as a word and nothing else', () => {
    expect(mentionsProblems('fix @problems')).toBe(true);
    expect(mentionsProblems('@Problems, please')).toBe(true);
    expect(mentionsProblems('see @problems.ts')).toBe(false);
    expect(mentionsProblems('mail me@problems')).toBe(false);
    expect(mentionsProblems('no problems here')).toBe(false);
  });

  it('lists the errors first and drops the hints', () => {
    const text = formatWorkspaceProblems([
      { path: 'src/b.ts', diagnostics: [{ severity: 1, line: 4, message: 'unused x', source: 'ts' }] },
      {
        path: 'src/a.ts',
        diagnostics: [
          { severity: 3, line: 0, message: 'hint' },
          { severity: 0, line: 9, message: "Cannot find\n  name 'y'.", source: 'ts' }
        ]
      }
    ]);
    expect(text).toBe(
      "Problems of the workspace (2):\n- src/a.ts:10 error [ts]: Cannot find name 'y'.\n- src/b.ts:5 warning [ts]: unused x"
    );
  });

  it('says there are none rather than nothing', () => {
    expect(formatWorkspaceProblems([])).toContain('none');
  });

  it('caps a long list and counts the rest', () => {
    const diagnostics = Array.from({ length: 60 }, (_, i) => ({ severity: 0, line: i, message: 'e' }));
    const text = formatWorkspaceProblems([{ path: 'a.ts', diagnostics }]);
    expect(text.split('\n').length).toBe(52);
    expect(text).toContain('... and 10 more');
  });
});
