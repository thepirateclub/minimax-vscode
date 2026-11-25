import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createDeleteTools } from '../../src/tools/delete';
import { createFileTools } from '../../src/tools/fs';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

function tool(name: string) {
  const tools = [
    ...createFileTools({ backups: new InMemoryBackupStore() }),
    ...createDeleteTools()
  ];
  const found = tools.find((entry) => entry.name === name);
  if (!found) {
    throw new Error('the tool ' + name + ' is missing');
  }
  return found;
}

async function makeRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'mm-changed-'));
}

// The tools report the files they changed: the panel shows them with their
// status. The state of the repository does not see every file of the work.
describe('the files a tool changed', () => {
  it('names a new file as added and a replaced one as modified', async () => {
    const root = await makeRoot();
    const write = tool('write_file');
    const created = await write.execute({ path: 'new.ts', content: 'const a = 1;\n' }, makeContext(root));
    expect(created.changed).toEqual([{ path: 'new.ts', status: 'added' }]);

    await writeFile(join(root, 'old.ts'), 'const b = 1;\n', 'utf8');
    const replaced = await write.execute({ path: 'old.ts', content: 'const b = 2;\n' }, makeContext(root));
    expect(replaced.changed).toEqual([{ path: 'old.ts', status: 'modified' }]);
  });

  it('names the edited file as modified', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'app.ts'), 'const a = 1;\n', 'utf8');
    const edit = tool('edit_file');
    const result = await edit.execute(
      { path: 'app.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' },
      makeContext(root)
    );
    expect(result.changed).toEqual([{ path: 'app.ts', status: 'modified' }]);
  });

  it('names the deleted files as deleted', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'one.ts'), 'const a = 1;\n', 'utf8');
    await writeFile(join(root, 'two.ts'), 'const b = 1;\n', 'utf8');
    const remove = tool('delete_files');
    const result = await remove.execute({ paths: ['one.ts', 'two.ts'] }, makeContext(root));
    expect(result.changed).toEqual([
      { path: 'one.ts', status: 'deleted' },
      { path: 'two.ts', status: 'deleted' }
    ]);
  });

  it('says nothing when the tool refused', async () => {
    const root = await makeRoot();
    const remove = tool('delete_files');
    const result = await remove.execute({ path: 'ghost.ts' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.changed).toBeUndefined();
  });
});
