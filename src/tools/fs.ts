import { mkdir, readFile as readFileAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { BackupStore } from '../storage/backups';
import type { ToolEntry } from './types';

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 200_000;
const MAX_WRITE_CHARS = 200_000;

export function resolveWorkspacePath(root: string, candidate: string): string {
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(resolve(root), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes the workspace root: ' + candidate);
  }
  return target;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function createFileTools(deps: { backups: BackupStore }): ToolEntry[] {
  const readFileTool: ToolEntry = {
    name: 'read_file',
    description:
      'Read a UTF-8 text file from the workspace. Returns content with line numbers. Use start_line and end_line for a range.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        start_line: { type: 'integer', minimum: 1, description: 'First line to read, 1-based.' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive.' }
      },
      required: ['path']
    },
    async execute(input, ctx) {
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const raw = await readFileAsync(target, 'utf8');
        const lines = raw.split('\n');
        const start = Number(input['start_line'] ?? 1);
        const end = Number(input['end_line'] ?? start - 1 + MAX_READ_LINES);
        const slice = lines.slice(Math.max(0, start - 1), Math.max(0, end));
        const body = slice.map((line, offset) => (start + offset) + ': ' + line).join('\n');
        if (body.length > MAX_READ_CHARS) {
          return { content: body.slice(0, MAX_READ_CHARS) + '\n[truncated]', isError: false };
        }
        return { content: body.length > 0 ? body : '[empty file]', isError: false };
      } catch (error) {
        return {
          content: 'read_file failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
    }
  };

  const writeFileTool: ToolEntry = {
    name: 'write_file',
    description:
      'Create a file or replace its whole content. Prefer edit_file for targeted changes. The user reviews a diff before the write is applied.',
    approval: 'always',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        content: { type: 'string', description: 'Full new content of the file.' }
      },
      required: ['path', 'content']
    },
    async execute(input, ctx) {
      const content = String(input['content'] ?? '');
      if (content.length > MAX_WRITE_CHARS) {
        return {
          content: 'write_file refused: content exceeds ' + MAX_WRITE_CHARS + ' characters',
          isError: true
        };
      }
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const previous = await readFileAsync(target, 'utf8').catch(() => null);
        await deps.backups.save(target, previous);
        await mkdir(dirname(target), { recursive: true });
        await writeFileAsync(target, content, 'utf8');
        return { content: 'Wrote ' + String(input['path']), isError: false };
      } catch (error) {
        return {
          content: 'write_file failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
    }
  };

  const editFileTool: ToolEntry = {
    name: 'edit_file',
    description:
      'Replace an exact string in a file. old_string must appear exactly once unless replace_all is true.',
    approval: 'always',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence.' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    async execute(input, ctx) {
      const oldString = String(input['old_string'] ?? '');
      const newString = String(input['new_string'] ?? '');
      if (oldString.length === 0) {
        return { content: 'edit_file failed: old_string must not be empty', isError: true };
      }
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const raw = await readFileAsync(target, 'utf8');
        const matches = countOccurrences(raw, oldString);
        const replaceAll = input['replace_all'] === true;
        if (matches === 0) {
          return { content: 'edit_file failed: old_string not found in the file', isError: true };
        }
        if (matches > 1 && !replaceAll) {
          return {
            content:
              'edit_file failed: old_string found ' +
              matches +
              ' times, provide more context or set replace_all',
            isError: true
          };
        }
        const updated = replaceAll
          ? raw.split(oldString).join(newString)
          : raw.replace(oldString, newString);
        await deps.backups.save(target, raw);
        await writeFileAsync(target, updated, 'utf8');
        return { content: 'Edited ' + String(input['path']), isError: false };
      } catch (error) {
        return {
          content: 'edit_file failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
    }
  };

  return [readFileTool, writeFileTool, editFileTool];
}
