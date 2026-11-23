import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTerminalTools } from '../../src/tools/terminal';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

describe('run_terminal', () => {
  it('runs the powershell syntax on windows', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute(
      { command: 'Write-Output ("ps" + $PSVersionTable.PSVersion.Major)' },
      makeContext(root)
    );
    // The model is told the shell is powershell, the syntax it writes has
    // to work: cmd.exe would take this line for noise.
    expect(result.isError).toBeFalsy();
    expect(result.content.trim()).toMatch(/^ps\d+$/);
  });

  it('captures stdout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "console.log(42)"' }, makeContext(root));
    expect(result.content).toContain('42');
    expect(result.isError).toBeFalsy();
  });

  it('reports a non zero exit code as an error result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "process.exit(3)"' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('3');
  });

  it('refuses a git command that has its own tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'git status' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('git_status');
  });

  it('refuses a git command behind another command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'cd sub && git log -5' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('git_log');
  });

  it('runs a git command that has no tool of its own', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'git --version' }, makeContext(root));
    expect(result.isError).toBeFalsy();
  });

  it('runs in the workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "console.log(process.cwd())"' }, makeContext(root));
    expect(result.content.toLowerCase()).toContain(root.slice(0, 3).toLowerCase());
  });

  it('refuses a git worktree command that has its own tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'git worktree list' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('git_worktree_list');
  });

  it('refuses a git worktree add behind another command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute(
      { command: 'cd sub && git worktree add wt' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('git_worktree_add');
  });

  it('runs a git worktree command that has no tool of its own', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'git worktree prune' }, makeContext(root));
    // The command runs in the shell, the refusal of the panel does not
    // come. The folder is not a repository, so git complains.
    expect(result.content).not.toContain('use the');
  });
});
