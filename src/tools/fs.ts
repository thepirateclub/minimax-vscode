import { isScratchPath, SCRATCH_REFUSAL } from './scratch';
import { mkdir, readFile as readFileAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveWorkspacePath } from '../paths';
import type { BackupStore } from '../storage/backups';
import { withProblems, type DiagnosticsProvider } from './diagnostics';
import { applyEdit } from './editMatch';
import type { ToolEntry } from './types';

export { resolveWorkspacePath };

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 200_000;
const MAX_WRITE_CHARS = 200_000;
// One call reads several files, the list is bounded so a single request stays sane.
const MAX_READ_FILES = 12;

// The model reads one file or a list of files in a single call.
function collectPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const single = input['path'];
  if (typeof single === 'string' && single.trim().length > 0) {
    paths.push(single.trim());
  }
  const many = input['paths'];
  if (Array.isArray(many)) {
    for (const item of many) {
      if (typeof item !== 'string') {
        continue;
      }
      const path = item.trim();
      if (path.length > 0 && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }
  return paths.slice(0, MAX_READ_FILES);
}

export function createFileTools(deps: {
  backups: BackupStore;
  // The problems of a file after a change, the host reads them from the
  // language servers of the editor.
  diagnostics?: DiagnosticsProvider;
}): ToolEntry[] {
  const readFileTool: ToolEntry = {
    name: 'read_file',
    description:
      'Read one or several UTF-8 text files from the workspace. Returns content with line numbers. Use start_line and end_line to read a single line or a range of lines. Pass paths to read several files in one call.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Several paths relative to the workspace root, read in one call.'
        },
        start_line: { type: 'integer', minimum: 1, description: 'First line to read, 1-based.' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive.' }
      }
    },
    async execute(input, ctx) {
      const paths = collectPaths(input);
      if (paths.length === 0) {
        return { content: 'read_file failed: no path given', isError: true };
      }
      const start = Number(input['start_line'] ?? 1);
      const end = Number(input['end_line'] ?? start - 1 + MAX_READ_LINES);
      const blocks: string[] = [];
      let failed = 0;
      for (const path of paths) {
        let body: string;
        // A range that stands outside the file reads nothing: an empty
        // answer would read as an empty file and the model would believe
        // there is no code at all.
        let beyondRange = false;
        try {
          const target = resolveWorkspacePath(ctx.workspaceRoot, path);
          const raw = await readFileAsync(target, 'utf8');
          // An empty file has no lines: split gives one empty line and the
          // answer read `1: ` instead of an empty file.
          const lines = raw.length === 0 ? [] : raw.split('\n');
          const slice = lines.slice(Math.max(0, start - 1), Math.max(0, end));
          body = slice.map((line, offset) => (start + offset) + ': ' + line).join('\n');
          beyondRange = slice.length === 0 && raw.length > 0;
        } catch (error) {
          failed += 1;
          body = 'read_file failed: ' + (error instanceof Error ? error.message : String(error));
        }
        const header = paths.length > 1 ? '=== ' + path + ' ===\n' : '';
        blocks.push(
          header +
            (body.length > 0
              ? body
              : beyondRange
                ? '[no lines in the range ' + start + '-' + end + ', the file is shorter]'
                : '[empty file]')
        );
      }
      let content = blocks.join('\n\n');
      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS) + '\n[truncated]';
      }
      return { content, isError: failed === paths.length };
    }
  };

  const writeFileTool: ToolEntry = {
    name: 'write_file',
    description:
      'Create a file or replace its whole content. Prefer edit_file for targeted changes. The user reviews a diff before the write is applied. The result lists the errors and warnings of the file after the write, fix the ones your change caused.',
    approval: 'always',
    sideEffect: true,
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
        // A new file in a scratch folder is the scratch of the model, a file
        // that is already there belongs to the project.
        if (previous === null && isScratchPath(String(input['path'] ?? ''))) {
          return { content: SCRATCH_REFUSAL, isError: true };
        }
        await deps.backups.save(target, previous, { sessionId: ctx.sessionId, next: content });
        await mkdir(dirname(target), { recursive: true });
        await writeFileAsync(target, content, 'utf8');
        const wrote = 'Wrote ' + String(input['path']);
        return {
          content: await withProblems(wrote, target, deps.diagnostics, ctx.signal),
          isError: false,
          // The panel shows the file with its status: a file that was not
          // on the disk is added, a replaced one is changed.
          changed: [
            {
              path: String(input['path']),
              status: previous === null ? 'added' : 'modified'
            }
          ]
        };
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
      'Replace an exact string in a file. old_string must appear exactly once unless replace_all is true. When the exact text is not found, the lines are matched with the indentation and the trailing spaces ignored, and a miss shows the closest text with its line numbers. The result lists the errors and warnings of the file after the edit, fix the ones your change caused.',
    approval: 'always',
    sideEffect: true,
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
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const raw = await readFileAsync(target, 'utf8');
        const edit = applyEdit(raw, oldString, newString, input['replace_all'] === true);
        if (!edit.ok) {
          return { content: edit.error, isError: true };
        }
        const updated = edit.text;
        if (updated.length > MAX_WRITE_CHARS) {
          return {
            content: 'edit_file refused: the file after the edit exceeds ' + MAX_WRITE_CHARS + ' characters',
            isError: true
          };
        }
        await deps.backups.save(target, raw, { sessionId: ctx.sessionId, next: updated });
        await writeFileAsync(target, updated, 'utf8');
        // A lenient match is named: the model learns its old_string was off.
        const edited =
          'Edited ' +
          String(input['path']) +
          (edit.lenient ? ' (old_string matched with the whitespace ignored)' : '');
        return {
          content: await withProblems(edited, target, deps.diagnostics, ctx.signal),
          isError: false,
          changed: [{ path: String(input['path']), status: 'modified' }]
        };
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
