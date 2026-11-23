import type { ToolEntry } from './types';
import { gitReadTools } from './git/read';
import { gitWriteTools } from './git/write';
import { gitWorktreesTools } from './git/worktrees';

// The tools of git: the reading ones, the writing ones and the worktrees.
// They live in modules of their own, the file of the entry point only
// collects them.
export function createGitTools(): ToolEntry[] {
  return [...gitReadTools(), ...gitWriteTools(), ...gitWorktreesTools()];
}
