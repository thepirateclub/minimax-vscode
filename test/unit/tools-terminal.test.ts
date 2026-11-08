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

  it('runs in the workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "console.log(process.cwd())"' }, makeContext(root));
    expect(result.content.toLowerCase()).toContain(root.slice(0, 3).toLowerCase());
  });
});
