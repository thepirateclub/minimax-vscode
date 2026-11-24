import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore, planRestore, restoreFiles } from '../../src/storage/backups';

// The rewind of a chat takes back the files the agent changed after the
// request: the chat and the disk go back to the same point.
describe('the backups of a turn', () => {
  it('gives the backups of one chat since a moment and forgets them', async () => {
    const store = new InMemoryBackupStore();
    await store.save('/a', 'old a', { sessionId: 's1', next: 'new a', at: 100 });
    await store.save('/b', 'old b', { sessionId: 's2', next: 'new b', at: 200 });
    await store.save('/c', 'old c', { sessionId: 's1', next: 'new c', at: 300 });
    const taken = await store.takeSince('s1', 150);
    expect(taken.map((entry) => entry.path)).toEqual(['/c']);
    expect((await store.list()).map((entry) => entry.path)).toEqual(['/a', '/b']);
  });

  it('plans one restore per file: the state before the first change, the text of the last', () => {
    const plans = planRestore([
      { path: '/a', previousContent: 'v0', nextContent: 'v1', createdAt: 1 },
      { path: '/b', previousContent: null, nextContent: 'new', createdAt: 2 },
      { path: '/a', previousContent: 'v1', nextContent: 'v2', createdAt: 3 }
    ]);
    expect(plans).toEqual([
      { path: '/a', restore: 'v0', expected: 'v2' },
      { path: '/b', restore: null, expected: 'new' }
    ]);
  });

  it('restores the files the agent left as they were and deletes the files it created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const edited = join(root, 'edited.ts');
    const created = join(root, 'created.ts');
    await writeFile(edited, 'v2', 'utf8');
    await writeFile(created, 'new', 'utf8');
    const result = await restoreFiles([
      { path: edited, restore: 'v0', expected: 'v2' },
      { path: created, restore: null, expected: 'new' }
    ]);
    expect(result).toEqual({ restored: [edited, created], skipped: [] });
    expect(await readFile(edited, 'utf8')).toBe('v0');
    expect(existsSync(created)).toBe(false);
  });

  it('leaves a file the user changed after the agent, the work of the user is not lost', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const file = join(root, 'a.ts');
    await writeFile(file, 'v2 and the edit of the user', 'utf8');
    const result = await restoreFiles([{ path: file, restore: 'v0', expected: 'v2' }]);
    expect(result).toEqual({ restored: [], skipped: [file] });
    expect(await readFile(file, 'utf8')).toBe('v2 and the edit of the user');
  });

  it('skips a backup without the text of the agent, the old store did not keep it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const file = join(root, 'a.ts');
    await writeFile(file, 'v2', 'utf8');
    const result = await restoreFiles([{ path: file, restore: 'v0', expected: undefined }]);
    expect(result.skipped).toEqual([file]);
  });
});

describe('the backup of a write of the agent', () => {
  it('keeps the chat and the text the agent wrote', async () => {
    const { createFileTools } = await import('../../src/tools/fs');
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'one', 'utf8');
    const store = new InMemoryBackupStore();
    const tools = createFileTools({ backups: store });
    const ctx = {
      workspaceRoot: root,
      signal: new AbortController().signal,
      logger: { info: () => undefined, error: () => undefined },
      sessionId: 's1'
    };
    await tools.find((tool) => tool.name === 'edit_file')!.execute(
      { path: 'a.ts', old_string: 'one', new_string: 'two' },
      ctx
    );
    await tools.find((tool) => tool.name === 'write_file')!.execute({ path: 'b.ts', content: 'new' }, ctx);
    const entries = await store.list();
    expect(entries.map((entry) => [entry.sessionId, entry.previousContent, entry.nextContent])).toEqual([
      ['s1', 'one', 'two'],
      ['s1', null, 'new']
    ]);
  });
});
