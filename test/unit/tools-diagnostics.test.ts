import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import {
  createDiagnosticsProvider,
  formatProblems,
  type Problem,
  type RawDiagnostic
} from '../../src/tools/diagnostics';
import { createFileTools } from '../../src/tools/fs';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

const ERROR: Problem = { line: 3, severity: 'error', message: "Cannot find name 'foo'.", source: 'ts' };
const WARNING: Problem = { line: 1, severity: 'warning', message: 'Unused import.', source: 'eslint' };

describe('formatProblems', () => {
  it('says nothing when the file is clean', () => {
    expect(formatProblems([])).toBe('');
  });

  it('puts the errors first and names the line and the source', () => {
    const text = formatProblems([WARNING, ERROR]);
    const lines = text.split('\n');
    expect(lines[0]).toContain('1 error, 1 warning');
    expect(lines[1]).toBe("- line 3 error: Cannot find name 'foo'. [ts]");
    expect(lines[2]).toBe('- line 1 warning: Unused import. [eslint]');
  });

  it('caps a long list and says how many are left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...ERROR, line: i + 1 }));
    const text = formatProblems(many);
    expect(text.split('\n').filter((line) => line.startsWith('- ')).length).toBe(20);
    expect(text).toContain('10 more');
  });
});

// The model sees what its change broke in the same turn: the problems of
// the file come back in the result of the write, not on the next request.
describe('the problems of a file after a change', () => {
  it('appends the problems of the file to the result of edit_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'const a = 1;\n', 'utf8');
    const asked: string[] = [];
    const tools = createFileTools({
      backups: new InMemoryBackupStore(),
      diagnostics: async (path) => {
        asked.push(path);
        return [ERROR];
      }
    });
    const edit = tools.find((tool) => tool.name === 'edit_file')!;
    const result = await edit.execute(
      { path: 'a.ts', old_string: 'const a = 1;', new_string: 'const a = foo;' },
      makeContext(root)
    );
    expect(result.isError).toBe(false);
    expect(result.content.split('\n')[0]).toBe('Edited a.ts');
    expect(result.content).toContain("line 3 error: Cannot find name 'foo'.");
    expect(asked).toEqual([join(root, 'a.ts')]);
  });

  it('appends the problems to the result of write_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tools = createFileTools({
      backups: new InMemoryBackupStore(),
      diagnostics: async () => [WARNING]
    });
    const write = tools.find((tool) => tool.name === 'write_file')!;
    const result = await write.execute({ path: 'b.ts', content: 'x' }, makeContext(root));
    expect(result.content).toContain('line 1 warning: Unused import.');
  });

  it('keeps the plain result when the file is clean or nobody can tell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const clean = createFileTools({ backups: new InMemoryBackupStore(), diagnostics: async () => [] });
    const none = createFileTools({ backups: new InMemoryBackupStore() });
    for (const tools of [clean, none]) {
      const write = tools.find((tool) => tool.name === 'write_file')!;
      const result = await write.execute({ path: 'c.ts', content: 'x' }, makeContext(root));
      expect(result.content).toBe('Wrote c.ts');
    }
  });

  it('does not fail the write when the problems cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tools = createFileTools({
      backups: new InMemoryBackupStore(),
      diagnostics: async () => {
        throw new Error('language server is gone');
      }
    });
    const write = tools.find((tool) => tool.name === 'write_file')!;
    const result = await write.execute({ path: 'd.ts', content: 'x' }, makeContext(root));
    expect(result).toEqual({ content: 'Wrote d.ts', isError: false });
  });
});

// The language server needs a moment after the write. The provider waits for
// a fresh report of the file and gives up after the timeout: an old report
// would show the errors of the file before the change.
describe('createDiagnosticsProvider', () => {
  function fakeEditor() {
    let listener: ((paths: string[]) => void) | undefined;
    const reports = new Map<string, RawDiagnostic[]>();
    const editor = {
      opened: [] as string[],
      open: async (path: string) => {
        editor.opened.push(path);
      },
      read: (path: string) => reports.get(path) ?? [],
      onChange: (next: (paths: string[]) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      publish: (path: string, items: RawDiagnostic[]) => {
        reports.set(path, items);
        listener?.([path]);
      },
      listening: () => listener !== undefined
    };
    return editor;
  }

  it('opens the file and returns the fresh report of the language server', async () => {
    const editor = fakeEditor();
    const provider = createDiagnosticsProvider(editor, 1000);
    const pending = provider('/w/a.ts', new AbortController().signal);
    await Promise.resolve();
    editor.publish('/w/other.ts', [{ severity: 0, line: 0, message: 'not this file' }]);
    editor.publish('/w/a.ts', [
      { severity: 0, line: 2, message: 'broken', source: 'ts' },
      { severity: 1, line: 0, message: 'unused' },
      { severity: 2, line: 5, message: 'just a hint' }
    ]);
    expect(await pending).toEqual([
      { line: 3, severity: 'error', message: 'broken', source: 'ts' },
      { line: 1, severity: 'warning', message: 'unused' }
    ]);
    expect(editor.opened).toEqual(['/w/a.ts']);
    expect(editor.listening()).toBe(false);
  });

  it('returns nothing when no fresh report comes in time', async () => {
    const editor = fakeEditor();
    editor.publish('/w/a.ts', [{ severity: 0, line: 0, message: 'stale, from before the change' }]);
    const provider = createDiagnosticsProvider(editor, 20);
    expect(await provider('/w/a.ts', new AbortController().signal)).toEqual([]);
    expect(editor.listening()).toBe(false);
  });

  it('stops waiting when the turn is stopped', async () => {
    const editor = fakeEditor();
    const controller = new AbortController();
    const pending = createDiagnosticsProvider(editor, 10_000)('/w/a.ts', controller.signal);
    controller.abort();
    expect(await pending).toEqual([]);
  });
});
