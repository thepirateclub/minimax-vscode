import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { IGNORED_DIRS, isIgnoredName, isTextFile, TEXT_EXTENSIONS } from '../search/files';
import type { ProjectSearch, SearchMode } from '../search/project';
import type { ToolEntry } from './types';

export { IGNORED_DIRS, isTextFile };

const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_RESULTS = 200;
const DEFAULT_SEARCH_RESULTS = 30;

export interface ExploreOptions {
  // The index of the project. The resolver picks the index of the workspace
  // root, the tool walks the tree when there is no index.
  search?: (workspaceRoot: string) => ProjectSearch | undefined;
}

export function createExploreTools(options: ExploreOptions = {}): ToolEntry[] {
  const listFiles: ToolEntry = {
    name: 'list_files',
    description:
      'List files and folders of the workspace. Use it to understand the project layout before reading files.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the workspace root.' },
        depth: { type: 'integer', minimum: 1, maximum: 5, description: 'How deep to descend, default 2.' }
      }
    },
    async execute(input, ctx) {
      const start = join(ctx.workspaceRoot, String(input['path'] ?? '.'));
      const depth = Math.min(5, Math.max(1, Number(input['depth'] ?? 2)));
      const lines: string[] = [];
      const walk = async (dir: string, level: number): Promise<void> => {
        if (level > depth || lines.length >= MAX_LIST_ENTRIES) {
          return;
        }
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (lines.length >= MAX_LIST_ENTRIES) {
            return;
          }
          if (isIgnoredName(entry.name)) {
            continue;
          }
          const full = join(dir, entry.name);
          const rel = relative(ctx.workspaceRoot, full).split(sep).join('/');
          lines.push(entry.isDirectory() ? rel + '/' : rel);
          if (entry.isDirectory()) {
            await walk(full, level + 1);
          }
        }
      };
      await walk(start, 1);
      if (lines.length === 0) {
        return { content: 'No files found', isError: false };
      }
      return { content: lines.join('\n'), isError: false };
    }
  };

  const searchCode: ToolEntry = {
    name: 'search_code',
    description:
      'Search the workspace for a text. The index of the project ranks the files, the answer holds the path, the line number and the line of the code. Use it to find a place in the code, not to read a whole file.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text to look for.' },
        path: { type: 'string', description: 'Subdirectory to search in, relative to the workspace root.' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          description: 'Maximum number of matches, default 30.'
        },
        mode: {
          type: 'string',
          enum: ['auto', 'lexical', 'semantic', 'hybrid'],
          description:
            'How the search runs. Auto uses the lexical index and adds the semantic layer when it is on.'
        }
      },
      required: ['query']
    },
    async execute(input, ctx) {
      const query = String(input['query'] ?? '');
      if (query.length === 0) {
        return { content: 'search_code failed: query must not be empty', isError: true };
      }
      const limit = Math.min(
        MAX_SEARCH_RESULTS,
        Math.max(1, Number(input['max_results'] ?? DEFAULT_SEARCH_RESULTS))
      );
      const mode = String(input['mode'] ?? 'auto') as SearchMode;
      const sub = input['path'] === undefined ? undefined : String(input['path']);

      const search = options.search?.(ctx.workspaceRoot);
      if (search) {
        const outcome = await search.search(query, { limit, mode, path: sub });
        if (outcome.hits.length === 0) {
          const note = outcome.note ? ' (' + outcome.note + ')' : '';
          return { content: 'No matches for ' + JSON.stringify(query) + note, isError: false };
        }
        const lines = outcome.hits.map(
          (hit) => hit.path + ':' + hit.line + ': ' + hit.snippet
        );
        return { content: lines.join('\n'), isError: false };
      }

      const root = join(ctx.workspaceRoot, String(input['path'] ?? '.'));
      const results: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        if (results.length >= limit) {
          return;
        }
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= limit) {
            return;
          }
          if (isIgnoredName(entry.name)) {
            continue;
          }
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
            continue;
          }
          const dot = entry.name.lastIndexOf('.');
          const extension = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
          if (!TEXT_EXTENSIONS.has(extension)) {
            continue;
          }
          let content: string;
          try {
            content = await readFile(full, 'utf8');
          } catch {
            continue;
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.includes(query)) {
              const rel = relative(ctx.workspaceRoot, full).split(sep).join('/');
              results.push(rel + ':' + (i + 1) + ': ' + line.trim());
              if (results.length >= limit) {
                return;
              }
            }
          }
        }
      };
      await walk(root);
      if (results.length === 0) {
        return { content: 'No matches for ' + JSON.stringify(query), isError: false };
      }
      return { content: results.join('\n'), isError: false };
    }
  };

  return [listFiles, searchCode];
}
