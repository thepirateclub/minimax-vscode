import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTerminalTools } from '../../src/tools/terminal';
import type { ToolContext } from '../../src/tools/types';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The timeout killed only the shell: a process started by the command lived
// on. The whole tree goes now.
describe('the timeout of run_terminal', () => {
  it('stops the processes the command started', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-tree-'));
    await writeFile(
      join(root, 'spawn.js'),
      "const { spawn } = require('child_process');\n" +
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\n" +
        "require('fs').writeFileSync('pid', String(child.pid));\n" +
        'setInterval(() => {}, 1000);\n'
    );
    const tool = createTerminalTools().find((entry) => entry.name === 'run_terminal')!;
    const ctx = { workspaceRoot: root, signal: new AbortController().signal } as unknown as ToolContext;
    const result = await tool.execute({ command: 'node spawn.js', timeout_ms: 1500 }, ctx);
    expect(result.content).toContain('timed out');
    const pid = Number(await readFile(join(root, 'pid'), 'utf8'));
    for (let i = 0; i < 40 && alive(pid); i += 1) {
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(alive(pid)).toBe(false);
  }, 20000);
});
