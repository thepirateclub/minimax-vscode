import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ToolEntry } from './types';

export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next'];

const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_RESULTS = 200;
const DEFAULT_SEARCH_RESULTS = 50;
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml',
  '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php',
  '.sh', '.ps1', '.html', '.css', '.scss', '.sql', '.toml', '.ini', '.vue', '.svelte'
]);

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.includes(name) || name.startsWith('.');
}

export function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

export function createExploreTools(): ToolEntry[] {
  const listFiles: ToolEntry = {
    name: 'list_files',
    description:
      'List files and folders of the workspace. Use it to understand the project layout before reading files.',
    approval: 'never',
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
          if (isIgnored(entry.name)) {
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
      'Search the workspace for a literal string. Returns matching file paths with line numbers and the matching line.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal text to look for.' },
        path: { type: 'string', description: 'Subdirectory to search in, relative to the workspace root.' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          description: 'Maximum number of matches, default 50.'
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
          if (isIgnored(entry.name)) {
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
