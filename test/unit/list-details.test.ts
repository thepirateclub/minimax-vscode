import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { posixScript } from '../../src/tools/commandOutput';
import { createExploreTools } from '../../src/tools/explore';
import { formatBytes, formatTime } from '../../src/tools/listing';
import type { ToolContext } from '../../src/tools/types';

// The model asked the shell for `Get-ChildItem a, b -ErrorAction
// SilentlyContinue | Select-Object FullName, Length, LastWriteTime`: one
// shell, the colors of the terminal in the answer. list_files does it with
// Node on every system.
async function shots(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-list-'));
  await mkdir(join(root, 'app', 'shots'), { recursive: true });
  await writeFile(join(root, 'app', 'shots', '01-title.png'), Buffer.alloc(2048));
  await writeFile(join(root, 'app', 'shots', '02-play.png'), Buffer.alloc(100));
  await writeFile(join(root, 'app', 'shots', 'notes.txt'), 'x');
  await utimes(join(root, 'app', 'shots', '02-play.png'), new Date(2026, 10, 24, 18, 51, 27), new Date(2026, 10, 24, 18, 51, 27));
  return root;
}

function listTool() {
  const tool = createExploreTools({ search: undefined as never }).find((entry) => entry.name === 'list_files');
  return tool!;
}

describe('list_files with the details', () => {
  it('lists several folders with the size and the time, a missing one is named', async () => {
    const root = await shots();
    const result = await listTool().execute(
      { paths: ['app/shots', 'native/shots'], details: true, glob: '*.png', sort: 'size' },
      { workspaceRoot: root } as unknown as ToolContext
    );
    const lines = result.content.split('\n');
    expect(lines[0]).toMatch(/^app\/shots\/01-title\.png\s+2\.0 KB\s+\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(lines[1]).toMatch(/^app\/shots\/02-play\.png\s+100 B\s+2026-11-24 18:51:27$/);
    expect(result.content).not.toContain('notes.txt');
    expect(lines[lines.length - 1]).toBe('native/shots: missing');
  });

  it('formats the sizes and the local time', () => {
    expect(formatBytes(390649)).toBe('381.5 KB');
    expect(formatBytes(2000817)).toBe('1.9 MB');
    expect(formatTime(new Date(2026, 0, 3, 7, 5, 9))).toBe('2026-01-03 07:05:09');
  });
});

describe('the exit code on Linux and macOS', () => {
  it('turns pipefail on where the shell has it', () => {
    expect(posixScript('make | tail -n 20')).toBe('(set -o pipefail) 2>/dev/null && set -o pipefail\nmake | tail -n 20');
  });
});
