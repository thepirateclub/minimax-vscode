// The notes in SQLite: the built-in node:sqlite of the runtime of the editor
// (Node 22.13 and newer, the Electron of VS Code ships it), no native
// dependency to build for every Electron. The journal of the database keeps
// a note whole when the editor dies in the middle of a write; a json file
// rewritten whole was easy to break.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { MAX_NOTE_CHARS, MAX_NOTES, MAX_TOTAL_CHARS, NoteStore, normalizeKey, searchNotes, type Note } from './store';

// The part of node:sqlite the store uses. The types of Node 20 in the
// project do not know the module yet.
interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => Database;
}

export interface Notes {
  list(): Promise<Note[]>;
  get(key: string): Promise<Note | undefined>;
  put(key: string, content: string, at?: number): Promise<{ cut: boolean; dropped: number }>;
  search(query: string): Promise<Note[]>;
  // Where the notes live, the log names it.
  readonly kind: 'sqlite' | 'json';
}

export class SqliteNoteStore implements Notes {
  readonly kind = 'sqlite' as const;

  constructor(private readonly db: Database) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS notes (key TEXT PRIMARY KEY, content TEXT NOT NULL, at INTEGER NOT NULL)');
  }

  async list(): Promise<Note[]> {
    return this.db.prepare('SELECT key, content, at FROM notes ORDER BY at DESC').all() as Note[];
  }

  async get(key: string): Promise<Note | undefined> {
    const rows = this.db.prepare('SELECT key, content, at FROM notes WHERE key = ?').all(normalizeKey(key)) as Note[];
    return rows[0];
  }

  // The write and the trim of the oldest notes are one transaction: the
  // store is never half written.
  async put(key: string, content: string, at: number = Date.now()): Promise<{ cut: boolean; dropped: number }> {
    const name = normalizeKey(key);
    const cut = content.length > MAX_NOTE_CHARS;
    this.db.exec('BEGIN');
    try {
      if (content.length === 0) {
        this.db.prepare('DELETE FROM notes WHERE key = ?').run(name);
        this.db.exec('COMMIT');
        return { cut: false, dropped: 0 };
      }
      this.db
        .prepare('INSERT INTO notes (key, content, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET content = excluded.content, at = excluded.at')
        .run(name, cut ? content.slice(0, MAX_NOTE_CHARS) : content, at);
      const rows = this.db.prepare('SELECT key, length(content) AS size FROM notes ORDER BY at DESC').all() as Array<{
        key: string;
        size: number;
      }>;
      let total = 0;
      let dropped = 0;
      rows.forEach((row, index) => {
        total += row.size;
        if (index >= MAX_NOTES || total > MAX_TOTAL_CHARS) {
          this.db.prepare('DELETE FROM notes WHERE key = ?').run(row.key);
          dropped += 1;
        }
      });
      this.db.exec('COMMIT');
      return { cut, dropped };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async search(query: string): Promise<Note[]> {
    return searchNotes(await this.list(), query);
  }
}

export class JsonNotes implements Notes {
  readonly kind = 'json' as const;
  private readonly store: NoteStore;

  constructor(file: string) {
    this.store = new NoteStore(file);
  }

  list(): Promise<Note[]> {
    return this.store.list();
  }

  get(key: string): Promise<Note | undefined> {
    return this.store.get(key);
  }

  put(key: string, content: string, at?: number): Promise<{ cut: boolean; dropped: number }> {
    return this.store.put(key, content, at);
  }

  search(query: string): Promise<Note[]> {
    return this.store.search(query);
  }
}

// The folder of the agent in the project: .minimax/agent. The skills of the
// project live next to it in .minimax/skills and belong to the repository,
// so the ignore covers this folder only.
export const AGENT_DIR = '.minimax/agent';

// The folder ignores itself with a .gitignore of `*`: git never sees the
// notes, even when the .gitignore of the project does not name the folder,
// and the file of the user is not changed without asking.
export async function ensureIgnored(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, '.gitignore');
  const current = await readFile(file, 'utf8').catch(() => undefined);
  if (current === undefined || !/^\*\s*$/m.test(current)) {
    await writeFile(file, '# The notes of MiniMax Agent, never committed.\n*\n', 'utf8');
  }
}

// SQLite when the runtime has it, the json file written through a temporary
// one when it does not (an old editor).
export async function openNotes(dir: string, preferSqlite = true): Promise<Notes> {
  await ensureIgnored(dir);
  if (preferSqlite) {
    try {
      // The runtime loads the module itself: the bundler and the test runner
      // do not know node:sqlite, the types of Node 20 do not know it either.
      const sqlite = createRequire(join(dir, 'notes.js'))('node:sqlite') as SqliteModule;
      return new SqliteNoteStore(new sqlite.DatabaseSync(join(dir, 'notes.sqlite')));
    } catch {
      // No node:sqlite in this runtime, the json store takes over.
    }
  }
  return new JsonNotes(join(dir, 'notes.json'));
}
