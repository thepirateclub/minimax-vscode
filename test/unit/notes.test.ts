import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_NOTES, renderNotes } from '../../src/notes/store';
import { openNotes, type Notes } from '../../src/notes/sqlite';
import { createNoteTools } from '../../src/tools/notes';

const log = { info: () => undefined, error: () => undefined };

async function stores(): Promise<Notes[]> {
  const dir = await mkdtemp(join(tmpdir(), 'mm-notes-'));
  return [await openNotes(join(dir, 'a'), true), await openNotes(join(dir, 'b'), false)];
}

// The agent keeps its scratch in the notes of the extension, not in tmp files
// of the project: SQLite when the runtime has it, a json file when it does not.
describe('the notes of the agent', () => {
  it('opens SQLite when the runtime has node:sqlite and json otherwise', async () => {
    const [sqlite, json] = await stores();
    expect(sqlite!.kind).toBe('sqlite');
    expect(json!.kind).toBe('json');
  });

  it('keeps, replaces, finds and deletes a note in both stores', async () => {
    for (const notes of await stores()) {
      await notes.put('game: emit', 'private emit(): void {}', 1);
      await notes.put('plan', 'rename emit to publish', 2);
      await notes.put('game: emit', 'the new text', 3);
      expect((await notes.get('game:  emit'))?.content).toBe('the new text');
      expect((await notes.list()).map((note) => note.key)).toEqual(['game: emit', 'plan']);
      expect((await notes.search('emit')).map((note) => note.key)).toEqual(['game: emit', 'plan']);
      await notes.put('plan', '');
      expect(await notes.get('plan')).toBeUndefined();
    }
  });

  it('drops the oldest notes when the store is full', async () => {
    for (const notes of await stores()) {
      for (let i = 0; i <= MAX_NOTES; i++) {
        await notes.put('n' + i, 'x', i);
      }
      expect((await notes.list()).length).toBe(MAX_NOTES);
      expect(await notes.get('n0')).toBeUndefined();
    }
  });

  it('survives a reopen of the database', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mm-notes-'));
    await (await openNotes(dir)).put('kept', 'still here');
    expect((await (await openNotes(dir)).get('kept'))?.content).toBe('still here');
  });

  it('names the notes in the context without their text', () => {
    expect(renderNotes([{ key: 'plan', content: 'abc', at: 1 }])).toBe(
      'Your notes of this project (note_read gives the text):\n- plan (3 chars)'
    );
    expect(renderNotes([])).toBe('');
  });
});

describe('the tools of the notes', () => {
  it('writes and reads several notes and the bodies of symbols', async () => {
    const [notes] = await stores();
    const root = await mkdtemp(join(tmpdir(), 'mm-ws-'));
    await writeFile(join(root, 'game.ts'), 'class G {\n  emit() {\n    go()\n  }\n}\n', 'utf8');
    const tools = createNoteTools({ notes: async () => notes });
    const ctx = { workspaceRoot: root, signal: new AbortController().signal, logger: log };
    const run = (name: string, input: Record<string, unknown>) => tools.find((tool) => tool.name === name)!.execute(input, ctx);
    expect((await run('note_write', { key: 'a', content: 'one' })).content).toBe('Saved the note a.');
    await run('note_write', { key: 'b', content: 'two' });
    expect((await run('note_read', { keys: ['a', 'b', 'c'] })).content).toBe('=== a ===\none\n\n=== b ===\ntwo\n\nNo note c.');
    expect((await run('note_search', { query: 'two' })).content).toBe('- b: two');
    expect((await run('read_symbol', { path: 'game.ts', names: ['emit'] })).content).toContain('2:   emit() {\n3:     go()\n4:   }');
    expect((await run('read_symbol', { path: '../x.ts', names: ['a'] })).isError).toBe(true);
    for (const tool of tools) {
      expect(tool).toMatchObject({ approval: 'never', sideEffect: false });
    }
  });
});

describe('the folder of the agent in the project', () => {
  it('ignores itself, git does not see the notes of a fresh repository', async () => {
    const { execFileSync } = await import('node:child_process');
    const { AGENT_DIR } = await import('../../src/notes/sqlite');
    const root = await mkdtemp(join(tmpdir(), 'mm-git-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const notes = await openNotes(join(root, AGENT_DIR));
    await notes.put('plan', 'secret scratch');
    await writeFile(join(root, 'app.ts'), 'x', 'utf8');
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
    expect(status.trim()).toBe('?? app.ts');
  });

  it('tells the model to check the .gitignore first and to keep the scratch in the notes', async () => {
    const { buildSystemPrompt } = await import('../../src/agent/prompt');
    const prompt = buildSystemPrompt({
      workspaceRoot: '/w', os: 'win32', shell: 'powershell', mode: 'code', tools: ['note_write', 'read_symbol'],
      rulesText: '', treeText: '', stackText: '', openFilesText: ''
    });
    expect(prompt).toContain('As the first action of a chat, read .gitignore and check that it ignores .minimax/agent/');
    expect(prompt).toContain('never to a file of the project such as tmp/');
    expect(prompt).toContain('- read_symbol(path, names)');
  });
});
