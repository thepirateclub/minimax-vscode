import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { IGNORED_DIRS, isIgnoredName, isTextFile, TEXT_EXTENSIONS } from '../search/files';
import { findInTree } from '../search/find';
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

// The texts of the search: the patterns replace the query, a line matches
// if it holds any of them.
function readPatterns(input: Record<string, unknown>, query: string): string[] {
  const many = input['patterns'];
  if (Array.isArray(many)) {
    const list = many.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    );
    if (list.length > 0) {
      return list;
    }
  }
  const single = query.trim();
  return single.length > 0 ? [single] : [];
}

// A hidden part of the path, the index of the project does not hold it.
function hasHiddenPart(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  return path
    .split(/[\\/]+/)
    .some((part) => part.length > 1 && part.startsWith('.'));
}

// What the path of the search names: a file, a folder, nothing at all or
// a path that is not on the disk.
async function pathKind(
  root: string,
  path: string | undefined
): Promise<'file' | 'folder' | 'missing' | undefined> {
  if (!path || path.length === 0) {
    return undefined;
  }
  try {
    const info = await stat(join(root, path));
    return info.isFile() ? 'file' : 'folder';
  } catch {
    return 'missing';
  }
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
      'Search the project for a text. The answer holds the path, the line number and the line of the code. Use patterns for several words, a line matches if it holds any of them, and ignore_case to ignore the case. The path can point to a file or to a folder, a hidden folder is searched too when the path names it.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text to look for.' },
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Several texts to look for, a line matches if it holds any of them. They replace the query.'
        },
        ignore_case: { type: 'boolean', description: 'Ignore the case of the letters.' },
        path: {
          type: 'string',
          description:
            'The file or the folder to search in, relative to the workspace root.'
        },
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
      const patterns = readPatterns(input, query);
      if (patterns.length === 0) {
        return { content: 'search_code failed: query must not be empty', isError: true };
      }
      const ignoreCase = input['ignore_case'] === true;
      const limit = Math.min(
        MAX_SEARCH_RESULTS,
        Math.max(1, Number(input['max_results'] ?? DEFAULT_SEARCH_RESULTS))
      );
      const mode = String(input['mode'] ?? 'auto') as SearchMode;
      const sub = input['path'] === undefined ? undefined : String(input['path']);

      // A path that is not on the disk is named right away, the model asked
      // for a place that does not exist.
      const kind = await pathKind(ctx.workspaceRoot, sub);
      if (kind === 'missing') {
        return {
          content: 'search_code failed: the path does not exist: ' + sub,
          isError: true
        };
      }
      // The index of the project answers a plain search of a folder. A file
      // that the model names, several words and the rule of the case need
      // the files to be read directly, and so does a hidden folder: the
      // index does not hold it.
      const direct =
        patterns.length > 1 ||
        ignoreCase ||
        kind === 'file' ||
        hasHiddenPart(sub);
      if (direct) {
        try {
          const hits = await findInTree(ctx.workspaceRoot, {
            patterns,
            ignoreCase,
            limit,
            sub
          });
          if (hits.length === 0) {
            return { content: 'No matches for ' + JSON.stringify(patterns.join(' ')) };
          }
          return {
            content: hits
              .map((hit) => hit.path + ':' + hit.line + ': ' + hit.text)
              .join('\n')
          };
        } catch (error) {
          return {
            content:
              'search_code failed: ' +
              (error instanceof Error ? error.message : String(error)),
            isError: true
          };
        }
      }

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
