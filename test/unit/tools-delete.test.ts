import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createAllTools } from '../../src/tools/all';
import { createCmdTools } from '../../src/tools/cmd';
import { createDeleteTools, deleteCardFiles, planDelete } from '../../src/tools/delete';
import { ToolRegistry } from '../../src/tools/registry';
import { toolAllowedForRole } from '../../src/tools/task';
import { createTerminalTools } from '../../src/tools/terminal';
import { describerNames } from '../../src/ui/webview/components/toolDescriptions/table';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

function deleteTool() {
  const tool = createDeleteTools().find((entry) => entry.name === 'delete_files');
  if (!tool) {
    throw new Error('the tool delete_files is missing');
  }
  return tool;
}

async function makeRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'mm-del-'));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('delete_files', () => {
  it('is in the list of the tools of the extension', () => {
    const tools = createAllTools({
      backups: new InMemoryBackupStore(),
      search: () => undefined,
      spawn: async () => ({ content: 'the child did not run in the test' })
    });
    expect(tools.map((tool) => tool.name)).toContain('delete_files');
  });

  it('has a row in the table of the descriptions of the cards', () => {
    // A tool without a row falls to the generic card, the reader sees the
    // raw name of the tool instead of the action.
    expect(describerNames()).toContain('delete_files');
  });

  it('has a side effect, plan mode hides it', () => {
    const entry = deleteTool();
    const registry = new ToolRegistry();
    registry.register(entry);
    expect(entry.sideEffect).toBe(true);
    expect(registry.isAllowed(entry, 'plan')).toBe(false);
    expect(registry.isAllowed(entry, 'code')).toBe(true);
  });

  it('is available to the role that writes and not to the roles that read', () => {
    const entry = deleteTool();
    expect(toolAllowedForRole(entry, 'worker')).toBe(true);
    expect(toolAllowedForRole(entry, 'explore')).toBe(false);
    expect(toolAllowedForRole(entry, 'verifier')).toBe(false);
  });

  it('asks for the confirmation of the user', () => {
    // The deletion is never silent: the tool carries the policy of the
    // approval itself, the gate of the host reads it.
    expect(deleteTool().approval).toBe('always');
  });

  it('deletes one file', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    const result = await deleteTool().execute({ path: 'a.txt' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(await exists(join(root, 'a.txt'))).toBe(false);
  });

  it('deletes several files in one call', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'two\n', 'utf8');
    const result = await deleteTool().execute(
      { paths: ['a.txt', 'b.txt'] },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(await exists(join(root, 'a.txt'))).toBe(false);
    expect(await exists(join(root, 'b.txt'))).toBe(false);
    expect(result.content).toContain('2 files');
  });

  it('says that the deletion is permanent', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    const result = await deleteTool().execute({ path: 'a.txt' }, makeContext(root));
    // The files do not go to the trash, the reader has to know it.
    expect(result.content).toContain('permanent');
  });

  it('refuses a path outside the workspace and keeps the file', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'ws');
    await mkdir(root, { recursive: true });
    await writeFile(join(parent, 'evil.txt'), 'keep\n', 'utf8');
    const result = await deleteTool().execute({ path: '../evil.txt' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('workspace');
    expect(await exists(join(parent, 'evil.txt'))).toBe(true);
  });

  it('refuses a directory and keeps it', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'folder'), { recursive: true });
    await writeFile(join(root, 'folder', 'a.txt'), 'one\n', 'utf8');
    const result = await deleteTool().execute({ path: 'folder' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('directory');
    expect((await stat(join(root, 'folder'))).isDirectory()).toBe(true);
    expect(await exists(join(root, 'folder', 'a.txt'))).toBe(true);
  });

  it('refuses a file that is not on the disk', async () => {
    const root = await makeRoot();
    const result = await deleteTool().execute({ path: 'ghost.txt' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ghost.txt');
  });

  it('refuses a call without a path', async () => {
    const root = await makeRoot();
    const result = await deleteTool().execute({}, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('no path');
  });

  it('deletes nothing when one path of the call is refused', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    await mkdir(join(root, 'folder'), { recursive: true });
    const result = await deleteTool().execute(
      { paths: ['a.txt', 'folder'] },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    // A half deleted call is a lie in the feed, nothing goes away.
    expect(await exists(join(root, 'a.txt'))).toBe(true);
  });
});

describe('the plan of the deletion', () => {
  it('names every file with its size', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'two\n', 'utf8');
    const plan = await planDelete({ paths: ['a.txt', 'b.txt'] }, root);
    expect(plan.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
    expect(plan.files[0]?.bytes).toBe(4);
    expect(plan.totalBytes).toBe(8);
    expect(plan.sizesKnown).toBe(true);
  });

  it('marks a folder and a missing file', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'folder'), { recursive: true });
    const plan = await planDelete({ paths: ['folder', 'ghost.txt'] }, root);
    expect(plan.files[0]?.directory).toBe(true);
    expect(plan.files[1]?.missing).toBe(true);
  });

  it('keeps a path out of the workspace out of the plan of the files', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'ws');
    await mkdir(root, { recursive: true });
    const plan = await planDelete({ path: '../evil.txt' }, root);
    expect(plan.files[0]?.error).toContain('workspace');
  });
});

describe('the files of the card of the confirmation', () => {
  it('lists every file with its size', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'two\n', 'utf8');
    const files = await deleteCardFiles({ paths: ['a.txt', 'b.txt'] }, root);
    expect(files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
    expect(files[0]?.bytes).toBe(4);
  });
});

describe('the commands of the deletion in the shell', () => {
  const commands = [
    'rm a.txt',
    'rm -rf src',
    'del a.txt',
    'erase a.txt',
    'unlink a.txt',
    'rmdir folder',
    'rd folder',
    'Remove-Item a.txt',
    'Remove-Item -Recurse folder',
    'npm test && rm -rf src',
    'git rm a.txt'
  ];

  it('refuses a delete command in the terminal and names the tool', async () => {
    const root = await makeRoot();
    const tool = createTerminalTools().find((entry) => entry.name === 'run_terminal');
    for (const command of commands) {
      const result = await tool!.execute({ command }, makeContext(root));
      expect(result.isError).toBe(true);
      expect(result.content).toContain('delete_files');
    }
  });

  it('refuses a delete command in cmd and names the tool', async () => {
    const root = await makeRoot();
    const tool = createCmdTools().find((entry) => entry.name === 'run_cmd');
    for (const command of commands) {
      const result = await tool!.execute({ command }, makeContext(root));
      expect(result.isError).toBe(true);
      expect(result.content).toContain('delete_files');
    }
  });

  it('runs a command that does not delete anything', async () => {
    const root = await makeRoot();
    const tool = createTerminalTools().find((entry) => entry.name === 'run_terminal');
    const result = await tool!.execute(
      { command: 'node -e "console.log(42)"' },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('42');
  });
});
