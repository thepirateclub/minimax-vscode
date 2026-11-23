import { describe, expect, it } from 'vitest';
import {
  buildCmdArgs,
  cmdPlatformRefusal,
  createCmdTools,
  isWindowsPlatform,
  resolveCmdTimeout,
  truncateCmdOutput
} from '../../src/tools/cmd';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

describe('run_cmd', () => {
  it('runs the command through cmd /c and nothing else', () => {
    expect(buildCmdArgs('dir')).toEqual(['/c', 'dir']);
    expect(buildCmdArgs('echo hi && dir')).toEqual(['/c', 'echo hi && dir']);
  });

  it('knows the platform of the tool', () => {
    expect(isWindowsPlatform('win32')).toBe(true);
    expect(isWindowsPlatform('linux')).toBe(false);
    expect(cmdPlatformRefusal('win32')).toBeUndefined();
    expect(cmdPlatformRefusal('darwin')).toBe('the cmd tool works on Windows only');
  });

  it('keeps the timeout inside the allowed range', () => {
    expect(resolveCmdTimeout(undefined)).toBe(60000);
    expect(resolveCmdTimeout(10000)).toBe(10000);
    expect(resolveCmdTimeout(1)).toBe(1000);
    expect(resolveCmdTimeout(999999)).toBe(120000);
    expect(resolveCmdTimeout('not a number')).toBe(60000);
  });

  it('cuts the long output with an honest marker', () => {
    expect(truncateCmdOutput('short')).toBe('short');
    const long = truncateCmdOutput('x'.repeat(30), 10);
    expect(long).toContain('output truncated');
    expect(long).toContain('20 characters cut');
  });

  it('refuses a git command that has its own tool', async () => {
    const tool = createCmdTools().find((entry) => entry.name === 'run_cmd');
    const result = await tool!.execute({ command: 'git status' }, makeContext(process.cwd()));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('git_status');
  });

  it('refuses an empty command', async () => {
    const tool = createCmdTools().find((entry) => entry.name === 'run_cmd');
    const result = await tool!.execute({ command: '  ' }, makeContext(process.cwd()));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('command must not be empty');
  });

  it('marks the tool as a tool with a side effect', () => {
    const tool = createCmdTools().find((entry) => entry.name === 'run_cmd');
    expect(tool!.approval).toBe('always');
    expect(tool!.sideEffect).toBe(true);
  });

  it.runIf(process.platform === 'win32')('runs a command on Windows', async () => {
    const tool = createCmdTools().find((entry) => entry.name === 'run_cmd');
    const result = await tool!.execute({ command: 'echo hello' }, makeContext(process.cwd()));
    expect(result.content).toContain('hello');
    expect(result.isError).toBeFalsy();
  });
});


describe('the live run_cmd', () => {
  it('runs the command of the windows shell and returns the output', async () => {
    if (!isWindowsPlatform(process.platform)) {
      return;
    }
    const cmd = createCmdTools().find((item) => item.name === 'run_cmd');
    if (!cmd) {
      throw new Error('no tool run_cmd');
    }
    const result = await cmd.execute(
      { command: 'echo hello-from-cmd' },
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        logger: { info: () => undefined, error: () => undefined }
      }
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('hello-from-cmd');
  });

  it('refuses a git command, the git tools do that work', async () => {
    const cmd = createCmdTools().find((item) => item.name === 'run_cmd');
    if (!cmd) {
      throw new Error('no tool run_cmd');
    }
    const result = await cmd.execute(
      { command: 'git status' },
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        logger: { info: () => undefined, error: () => undefined }
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('git_status');
  });
});
