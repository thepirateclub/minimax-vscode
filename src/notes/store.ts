// The notes of the agent: what it took from the code and wants to keep for
// the next steps. The model wrote such pieces into tmp files of the project
// and read them again later, one thought became three actions and the folder
// filled with litter. The notes live in the folder of the extension for the
// workspace (context.storageUri), not in the repository: no approval, no
// trace in git, the next turn and the next chat of the project find them.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Note {
  key: string;
  content: string;
  // When the note was written, the list of the notes is newest first.
  at: number;
}

export const MAX_NOTE_CHARS = 50_000;
export const MAX_NOTES = 200;
export const MAX_TOTAL_CHARS = 2_000_000;

export function normalizeKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ').slice(0, 120);
}

// A query matches by its words: every word must be in the key or in the
// text, the notes with the word in the key go first.
export function searchNotes(notes: readonly Note[], query: string): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }
  return notes
    .map((note) => {
      const key = note.key.toLowerCase();
      const text = note.content.toLowerCase();
      if (!words.every((word) => key.includes(word) || text.includes(word))) {
        return undefined;
      }
      return { note, score: words.filter((word) => key.includes(word)).length };
    })
    .filter((item): item is { note: Note; score: number } => item !== undefined)
    .sort((a, b) => b.score - a.score || b.note.at - a.note.at)
    .map((item) => item.note);
}

export class NoteStore {
  private notes: Note[] | undefined;

  constructor(private readonly file: string) {}

  private async load(): Promise<Note[]> {
    if (this.notes) {
      return this.notes;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      this.notes = Array.isArray(parsed)
        ? parsed.filter(
            (item): item is Note =>
              typeof item === 'object' && item !== null && typeof (item as Note).key === 'string' && typeof (item as Note).content === 'string'
          )
        : [];
    } catch {
      this.notes = [];
    }
    return this.notes;
  }

  // The file is written whole through a temporary one: a crash in the middle
  // leaves the old notes, not half of them.
  private async save(notes: Note[]): Promise<void> {
    this.notes = notes;
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    await writeFile(temporary, JSON.stringify(notes), 'utf8');
    await rename(temporary, this.file);
  }

  async list(): Promise<Note[]> {
    return [...(await this.load())].sort((a, b) => b.at - a.at);
  }

  async get(key: string): Promise<Note | undefined> {
    const wanted = normalizeKey(key);
    return (await this.load()).find((note) => note.key === wanted);
  }

  // An empty content deletes the note. The oldest notes go when the store is
  // full, by the count or by the size.
  async put(key: string, content: string, at: number = Date.now()): Promise<{ cut: boolean; dropped: number }> {
    const name = normalizeKey(key);
    const rest = (await this.load()).filter((note) => note.key !== name);
    if (content.length === 0) {
      await this.save(rest);
      return { cut: false, dropped: 0 };
    }
    const cut = content.length > MAX_NOTE_CHARS;
    const notes = [...rest, { key: name, content: cut ? content.slice(0, MAX_NOTE_CHARS) : content, at }].sort(
      (a, b) => b.at - a.at
    );
    let dropped = 0;
    let total = notes.reduce((sum, note) => sum + note.content.length, 0);
    while (notes.length > MAX_NOTES || total > MAX_TOTAL_CHARS) {
      const oldest = notes.pop();
      if (!oldest) {
        break;
      }
      total -= oldest.content.length;
      dropped += 1;
    }
    await this.save(notes);
    return { cut, dropped };
  }

  async search(query: string): Promise<Note[]> {
    return searchNotes(await this.load(), query);
  }
}

// The section of the context: the keys of the newest notes and the size of
// each, the model reads the text with note_read when it needs it.
export function renderNotes(notes: readonly Note[], limit = 30): string {
  if (notes.length === 0) {
    return '';
  }
  const lines = notes.slice(0, limit).map((note) => '- ' + note.key + ' (' + note.content.length + ' chars)');
  if (notes.length > limit) {
    lines.push('- ... and ' + (notes.length - limit) + ' older notes, note_search finds them');
  }
  return ['Your notes of this project (note_read gives the text):', ...lines].join('\n');
}
