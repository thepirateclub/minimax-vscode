import { readFile } from 'node:fs/promises';
import type { Notes } from '../notes/sqlite';
import { resolveWorkspacePath } from '../paths';
import { formatSymbols } from './symbols';
import type { ToolEntry } from './types';

export interface NoteToolOptions {
  // The notes of the workspace, absent when the editor gives no storage.
  notes: (workspaceRoot: string) => Promise<Notes | undefined>;
}

const MAX_NAMES = 20;
const MAX_KEYS = 12;
const NO_STORE = 'The notes are not available in this window.';

function strings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return typeof value === 'string' && value.trim().length > 0 ? [value] : [];
}

// The scratch of the agent lives in the notes, not in the files of the
// project: the notes need no approval, leave no trace in git and come back
// in the next turn and the next chat of the project.
export function createNoteTools(options: NoteToolOptions): ToolEntry[] {
  const write: ToolEntry = {
    name: 'note_write',
    description:
      'Keep a note for the next steps of the work: a piece of code you study, a finding, a plan, a list of places to change. The notes live in the storage of the extension, not in the project, and the next turns and chats of the project see them. Never write scratch files into the project for this. An empty content deletes the note.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'A short name of the note, for example "game: emit and achievements".' },
        content: { type: 'string', description: 'The text of the note, an empty string deletes it.' }
      },
      required: ['key', 'content']
    },
    async execute(input, ctx) {
      const notes = await options.notes(ctx.workspaceRoot);
      if (!notes) {
        return { content: NO_STORE, isError: true };
      }
      const key = String(input['key'] ?? '').trim();
      if (!key) {
        return { content: 'The key of the note is empty.', isError: true };
      }
      const content = String(input['content'] ?? '');
      const result = await notes.put(key, content);
      if (content.length === 0) {
        return { content: 'Deleted the note ' + key + '.' };
      }
      const extra = [
        result.cut ? 'the text was cut to 50000 characters' : '',
        result.dropped > 0 ? result.dropped + ' oldest notes were dropped' : ''
      ].filter((part) => part.length > 0);
      return { content: 'Saved the note ' + key + (extra.length > 0 ? ', ' + extra.join(', ') : '') + '.' };
    }
  };

  const read: ToolEntry = {
    name: 'note_read',
    description: 'Read your notes by their keys, several at once.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: { keys: { type: 'array', items: { type: 'string' }, description: 'The keys of the notes.' } },
      required: ['keys']
    },
    async execute(input, ctx) {
      const notes = await options.notes(ctx.workspaceRoot);
      if (!notes) {
        return { content: NO_STORE, isError: true };
      }
      const parts: string[] = [];
      for (const key of strings(input['keys']).slice(0, MAX_KEYS)) {
        const note = await notes.get(key);
        parts.push(note ? '=== ' + note.key + ' ===\n' + note.content : 'No note ' + key + '.');
      }
      return { content: parts.length > 0 ? parts.join('\n\n') : 'No keys given.' };
    }
  };

  const search: ToolEntry = {
    name: 'note_search',
    description: 'Find your notes by words of their key or text.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The words to find.' } },
      required: ['query']
    },
    async execute(input, ctx) {
      const notes = await options.notes(ctx.workspaceRoot);
      if (!notes) {
        return { content: NO_STORE, isError: true };
      }
      const found = await notes.search(String(input['query'] ?? ''));
      if (found.length === 0) {
        return { content: 'No notes found.' };
      }
      return {
        content: found
          .slice(0, 20)
          .map((note) => '- ' + note.key + ': ' + note.content.slice(0, 160).replace(/\s+/g, ' '))
          .join('\n')
      };
    }
  };

  const symbols: ToolEntry = {
    name: 'read_symbol',
    description:
      'Read the bodies of functions, methods, classes or constants of one file by their names, several at once, with line numbers. Faster than reading the whole file when you need a few symbols.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file, relative to the workspace root.' },
        names: { type: 'array', items: { type: 'string' }, description: 'The names of the symbols.' }
      },
      required: ['path', 'names']
    },
    async execute(input, ctx) {
      const path = String(input['path'] ?? '');
      const names = strings(input['names']).slice(0, MAX_NAMES);
      if (names.length === 0) {
        return { content: 'No names given.', isError: true };
      }
      try {
        const text = await readFile(resolveWorkspacePath(ctx.workspaceRoot, path), 'utf8');
        return { content: formatSymbols(path, text, names) };
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true };
      }
    }
  };

  return [write, read, search, symbols];
}
