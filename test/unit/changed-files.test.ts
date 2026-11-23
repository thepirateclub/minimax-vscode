import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readChangedFiles, statusOf } from '../../src/git/changes';

const run = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await run('git', ['-C', root, ...args], { windowsHide: true });
  return result.stdout;
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-changes-'));
  await git(root, 'init');
  await git(root, 'config', 'user.email', 'agent@example.com');
  await git(root, 'config', 'user.name', 'Agent');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'app.ts'), 'const a = 1;\n', 'utf8');
  await git(root, 'add', 'app.ts');
  await git(root, 'commit', '-m', 'feat: first commit');
  return root;
}

describe('the files of the working tree', () => {
  it('reads the mark of git as a status', () => {
    expect(statusOf('A', ' ')).toBe('added');
    expect(statusOf(' ', '?')).toBe('added');
    expect(statusOf(' ', 'M')).toBe('modified');
    expect(statusOf('M', ' ')).toBe('modified');
    expect(statusOf('D', ' ')).toBe('deleted');
    expect(statusOf('R', ' ')).toBe('renamed');
  });

  it('lists the files that the work changed', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'app.ts'), 'const a = 2;\n', 'utf8');
    await writeFile(join(root, 'new.ts'), 'const b = 2;\n', 'utf8');
    const files = await readChangedFiles(root);
    const app = files.find((file) => file.path === 'app.ts');
    const created = files.find((file) => file.path === 'new.ts');
    expect(app?.status).toBe('modified');
    expect(created?.status).toBe('added');
  });

  it('gives nothing when the workspace is not a repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-plain-'));
    expect(await readChangedFiles(root)).toEqual([]);
  });
});
