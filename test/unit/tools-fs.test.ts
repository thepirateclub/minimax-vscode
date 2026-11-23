import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createFileTools, resolveWorkspacePath } from '../../src/tools/fs';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    backups: new InMemoryBackupStore()
  };
}

describe('resolveWorkspacePath', () => {
  it('rejects paths outside the workspace', () => {
    expect(() => resolveWorkspacePath('/tmp/root', '../escape.txt')).toThrow();
  });

  it('resolves a relative path inside the workspace', () => {
    const root = resolve('/tmp/root');
    expect(resolveWorkspacePath(root, 'a/b.txt')).toBe(join(root, 'a', 'b.txt'));
  });
});

describe('file tools', () => {
  it('reads a file with line numbers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute({ path: 'a.txt' }, makeContext(root));
    expect(result.content).toContain('1: one');
    expect(result.content).toContain('2: two');
  });

  it('reads a single line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute(
      { path: 'a.txt', start_line: 2, end_line: 2 },
      makeContext(root)
    );
    expect(result.content).toContain('2: two');
    expect(result.content).not.toContain('1: one');
  });

  it('reads a range of lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute(
      { path: 'a.txt', start_line: 2, end_line: 3 },
      makeContext(root)
    );
    expect(result.content).toContain('2: two');
    expect(result.content).toContain('3: three');
    expect(result.content).not.toContain('1: one');
    expect(result.content).not.toContain('4: four');
  });

  it('names a range outside the file, it is not an empty file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute(
      { path: 'a.txt', start_line: 10, end_line: 20 },
      makeContext(root)
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('no lines in the range 10-20');
    expect(result.content).not.toContain('empty file');
  });

  it('reads several files in one call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'two\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute({ paths: ['a.txt', 'b.txt'] }, makeContext(root));
    expect(result.content).toContain('=== a.txt ===');
    expect(result.content).toContain('1: one');
    expect(result.content).toContain('=== b.txt ===');
    expect(result.content).toContain('1: two');
    expect(result.isError).toBeFalsy();
  });

  it('reports a read without any path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute({}, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('no path');
  });

  it('writes a file and stores a backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8');
    const backups = new InMemoryBackupStore();
    const tools = createFileTools({ backups });
    const write = tools.find((t) => t.name === 'write_file');
    const result = await write!.execute({ path: 'a.txt', content: 'new\n' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('new\n');
    const entries = await backups.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.previousContent).toBe('old\n');
  });

  it('rejects writes outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const write = tools.find((t) => t.name === 'write_file');
    const result = await write!.execute({ path: '../evil.txt', content: 'x' }, makeContext(root));
    expect(result.isError).toBe(true);
  });

  it('reports how many matches edit_file found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'x\nx\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const edit = tools.find((t) => t.name === 'edit_file');
    const result = await edit!.execute({ path: 'a.txt', old_string: 'x', new_string: 'y' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('2');
  });

  it('applies a unique replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'x\ny\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const edit = tools.find((t) => t.name === 'edit_file');
    const result = await edit!.execute({ path: 'a.txt', old_string: 'x', new_string: 'z' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('z\ny\n');
  });
});
