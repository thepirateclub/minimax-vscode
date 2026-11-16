import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
  const root = await mkdtemp(join(tmpdir(), 'mm-git-extra-'));
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

describe('the new actions of git', () => {
  it('keeps the merge and the tag behind the confirmation of the reader', () => {
    const entries = createGitTools();
    const merge = entries.find((item) => item.name === 'git_merge');
    const tag = entries.find((item) => item.name === 'git_tag');
    expect(merge?.approval).toBe('always');
    expect(merge?.sideEffect).toBe(true);
    expect(tag?.approval).toBe('always');
    expect(tag?.sideEffect).toBe(true);
  });

  it('merges a branch into the current one', async () => {
    const root = await makeRepo();
    await git(root, 'checkout', '-b', 'feature/x');
    await writeFile(join(root, 'second.ts'), 'const b = 2;\n', 'utf8');
    await git(root, 'add', 'second.ts');
    await git(root, 'commit', '-m', 'feat: second file');
    await git(root, 'checkout', '-');
    const result = await tool('git_merge').execute(
      { branch: 'feature/x' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('feature/x');
    expect(await git(root, 'branch', '--merged')).toContain('feature/x');
  });

  it('refuses a branch that starts with a dash', async () => {
    const root = await makeRepo();
    const result = await tool('git_merge').execute(
      { branch: '--upload-pack=evil' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('dash');
  });

  it('creates a tag on the commit', async () => {
    const root = await makeRepo();
    const result = await tool('git_tag').execute(
      { name: '1.2.0', message: 'the release of the version' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(await git(root, 'tag', '--list')).toContain('1.2.0');
    // A tag with a message is an annotated one.
    expect(await git(root, 'cat-file', '-t', '1.2.0')).toContain('tag');
  });

  it('refuses a tag that starts with a dash', async () => {
    const root = await makeRepo();
    const result = await tool('git_tag').execute(
      { name: '--upload-pack=evil' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('dash');
  });

  it('gives the names of the changed files', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'app.ts'), 'const a = 2;\n', 'utf8');
    const result = await tool('git_diff').execute(
      { name_only: true },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('app.ts');
    expect(result.content).not.toContain('const a = 2;');
  });

  it('gives the summary of the change', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'app.ts'), 'const a = 2;\n', 'utf8');
    const result = await tool('git_diff').execute({ stat: true }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('app.ts');
    expect(result.content).toContain('1 file');
  });

  it('compares two commits', async () => {
    const root = await makeRepo();
    await writeFile(join(root, 'app.ts'), 'const a = 2;\n', 'utf8');
    await git(root, 'add', 'app.ts');
    await git(root, 'commit', '-m', 'feat: second commit');
    const result = await tool('git_diff').execute(
      { ref: 'HEAD~1', ref2: 'HEAD' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('const a = 2;');
  });

  it('refuses the second ref without the first one', async () => {
    const root = await makeRepo();
    const result = await tool('git_diff').execute({ ref2: 'HEAD' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ref2');
  });

  it('prints the journal in the short form', async () => {
    const root = await makeRepo();
    const result = await tool('git_log').execute(
      { format: 'oneline' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('feat: first commit');
    // The short form has no author.
    expect(result.content).not.toContain('Agent');
  });

  it('prints the journal in the short form with the flag', async () => {
    const root = await makeRepo();
    const result = await tool('git_log').execute(
      { oneline: true },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('feat: first commit');
    expect(result.content).not.toContain('Agent');
  });

  it('refuses an unknown format of the journal', async () => {
    const root = await makeRepo();
    const result = await tool('git_log').execute(
      { format: 'xml' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('format');
  });

  it('runs the command in the directory of the workspace', async () => {
    const root = await makeRepo();
    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'sub', 'inner.ts'), 'const c = 3;\n', 'utf8');
    const result = await tool('git_status').execute(
      { directory: 'sub' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('sub/inner.ts');
  });

  it('refuses a directory outside the workspace', async () => {
    const root = await makeRepo();
    const result = await tool('git_status').execute(
      { directory: '../outside' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('outside');
  });

  it('refuses a path outside the directory of the command', async () => {
    const root = await makeRepo();
    await mkdir(join(root, 'sub'), { recursive: true });
    const result = await tool('git_stage').execute(
      { paths: ['app.ts'], directory: 'sub' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('outside');
  });
});
