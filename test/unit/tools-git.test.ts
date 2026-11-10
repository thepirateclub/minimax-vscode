import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createGitTools } from '../../src/tools/git';

const run = promisify(execFile);

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await run('git', ['-C', root, ...args], { windowsHide: true });
  return result.stdout;
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-git-'));
  await git(root, 'init');
  await git(root, 'config', 'user.email', 'agent@example.com');
  await git(root, 'config', 'user.name', 'Agent');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'app.ts'), 'const a = 1;\n', 'utf8');
  await git(root, 'add', 'app.ts');
  await git(root, 'commit', '-m', 'feat: first commit');
  return root;
}

function tool(name: string) {
  const entry = createGitTools().find((item) => item.name === name);
  if (!entry) {
    throw new Error('no tool ' + name);
  }
  return entry;
}

describe('the git tools', () => {
  it('keeps the reading tools safe and the writing tools visible only in code mode', () => {
    const entries = createGitTools();
    const status = entries.find((item) => item.name === 'git_status');
    const commit = entries.find((item) => item.name === 'git_commit');
    expect(status?.sideEffect).toBe(false);
    expect(status?.approval).toBe('never');
    expect(commit?.sideEffect).toBe(true);
    expect(commit?.approval).toBe('always');
  });

  it('reads the status of the repository', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'app.ts'), 'const a = 2;\n', 'utf8');
    const branch = (await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
    const result = await tool('git_status').execute({}, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain(branch);
    expect(result.content).toContain('app.ts');
  });

  it('returns the diff of the working tree', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'app.ts'), 'const a = 2;\n', 'utf8');
    const result = await tool('git_diff').execute({}, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('const a = 2;');
    expect(result.content).toContain('app.ts');
  });

  it('reads the history', async () => {
    const root = await makeRepo();
    const result = await tool('git_log').execute({}, makeContext(root));
    expect(result.content).toContain('feat: first commit');
  });

  it('stages a file and commits it', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'second.ts'), 'const b = 2;\n', 'utf8');
    const staged = await tool('git_stage').execute({ paths: ['second.ts'] }, makeContext(root));
    expect(staged.isError).toBeFalsy();
    const commit = await tool('git_commit').execute({ message: 'feat: second file' }, makeContext(root));
    expect(commit.isError).toBeFalsy();
    expect(commit.content).toContain('feat: second file');
    expect(await git(root, 'log', '-1', '--pretty=%s')).toContain('feat: second file');
  });

  it('refuses to commit when nothing is staged', async () => {
    const root = await makeRepo();
    const result = await tool('git_commit').execute({ message: 'feat: nothing' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('stage');
  });

  it('creates a branch and switches to it', async () => {
    const root = await makeRepo();
    const result = await tool('git_branch_create').execute({ name: 'feature/x' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('feature/x');
    expect((await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('feature/x');
  });

  it('switches back to an existing branch', async () => {
    const root = await makeRepo();
    const branch = (await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
    await tool('git_branch_create').execute({ name: 'feature/x' }, makeContext(root));
    const result = await tool('git_checkout').execute({ ref: branch }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect((await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(branch);
  });

  it('refuses a path outside the workspace', async () => {
    const root = await makeRepo();
    const result = await tool('git_stage').execute({ paths: ['../outside.ts'] }, makeContext(root));
    expect(result.isError).toBe(true);
  });

  it('reports that the workspace is not a repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-plain-'));
    const result = await tool('git_status').execute({}, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('not a git repository');
  });
});
