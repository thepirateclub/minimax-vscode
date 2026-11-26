import { describe, expect, it } from 'vitest';
import { deleteToolFor } from '../../src/tools/deleteCommand';
import { alwaysConfirms, destroysGitWork, ruleAllows } from '../../src/ui/approvalScope';
import { ApprovalGate } from '../../src/ui/approvals';
import type { ToolEntry } from '../../src/tools/types';

describe('the guard of the deletion in the shell', () => {
  it('sees rm behind a wrapper, a variable and the flags of git', () => {
    for (const command of ['env rm -rf .', 'command rm a', 'sudo -E rm a', 'VAR=1 rm a', 'git -C sub rm -rf .', 'nohup rm a', 'ri a.txt']) {
      expect(deleteToolFor(command), command).toBe('delete_files');
    }
    for (const command of ['env npm test', 'git -C sub status', 'echo rm']) {
      expect(deleteToolFor(command), command).toBeUndefined();
    }
  });
});

describe('the git commands that throw work away', () => {
  it('are found', () => {
    for (const command of [
      'git clean -fdx', 'git reset --hard HEAD~1', 'git push --force', 'git push -f origin main',
      'git push origin +main', 'git stash drop', 'git stash clear', 'git branch -D old',
      'git checkout -- .', 'git restore src/a.ts', 'git -C sub reset --hard', 'npm test && git clean -f'
    ]) {
      expect(destroysGitWork(command), command).toBe(true);
    }
    for (const command of ['git clean -n', 'git reset HEAD a.ts', 'git push', 'git stash', 'git branch -d merged', 'npm test']) {
      expect(destroysGitWork(command), command).toBe(false);
    }
  });

  it('always ask: a bare rule of the terminal does not cover them', async () => {
    expect(alwaysConfirms('run_terminal', { command: 'git reset --hard' })).toBe(true);
    expect(alwaysConfirms('run_terminal', { command: 'npm test' })).toBe(false);
    expect(ruleAllows('run_terminal', 'run_terminal', { command: 'git reset --hard' })).toBe(true);
    let asked = 0;
    const gate = new ApprovalGate({
      autoApprove: ['run_terminal'],
      request: async () => {
        asked += 1;
        return { approved: true, allowForSession: false };
      }
    } as unknown as ConstructorParameters<typeof ApprovalGate>[0]);
    const entry = { name: 'run_terminal', approval: 'always' } as unknown as ToolEntry;
    await gate.approve(entry, { command: 'npm test' });
    expect(asked).toBe(0);
    await gate.approve(entry, { command: 'git reset --hard' });
    expect(asked).toBe(1);
  });
});

describe('the rewrites of history and the removal of a worktree', () => {
  it('asks every time', () => {
    expect(destroysGitWork('git push origin :feature')).toBe(true);
    expect(destroysGitWork('git rebase main')).toBe(true);
    expect(destroysGitWork('git commit --amend --no-edit')).toBe(true);
    expect(destroysGitWork('git commit -m fix')).toBe(false);
    expect(destroysGitWork('git push origin feature')).toBe(false);
    expect(alwaysConfirms('git_worktree_remove', { path: 'wt' })).toBe(true);
  });
});
