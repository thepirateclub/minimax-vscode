import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { resolveWorkspacePath } from '../paths';
import { IGNORED_DIRS, TEXT_EXTENSIONS } from '../search/files';
import type { ToolEntry } from './types';

// The search of grep: a regular expression, the lines around a match and
// a filter of the files by a glob. search_code looks for words, grep finds
// a shape of the code (`function \w+Async`, `TODO\(.*\)`) and shows it with
// its neighbours, so the model does not read the file after every match.

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RESULTS = 200;
const MAX_CONTEXT = 10;
const LINE_LIMIT = 300;

// A glob of a file name or a path: `*.ts`, `src/**/*.test.ts`.
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // A glob without a slash names the file anywhere in the tree.
  return new RegExp((glob.includes('/') ? '^' : '(?:^|/)') + source + '$');
}

// The matches of one text with the lines around them, merged when they touch.
export function grepText(content: string, pattern: RegExp, context: number, limit: number): { lines: string[]; count: number } {
  const lines = content.split(/\r?\n/);
  const hits: number[] = [];
  for (let i = 0; i < lines.length && hits.length < limit; i++) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[i] ?? '')) {
      hits.push(i);
    }
  }
  const out: string[] = [];
  let shownTo = -1;
  for (const hit of hits) {
    const from = Math.max(hit - context, shownTo + 1);
    if (out.length > 0 && from > shownTo + 1) {
      out.push('--');
    }
    for (let i = from; i <= Math.min(lines.length - 1, hit + context); i++) {
      const mark = hits.includes(i) ? ':' : '-';
      out.push(i + 1 + mark + (lines[i] ?? '').slice(0, LINE_LIMIT));
      shownTo = i;
    }
  }
  return { lines: out, count: hits.length };
}

async function* walk(dir: string, root: string, hidden: boolean): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.includes(entry.name) || (!hidden && entry.name.startsWith('.'))) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, root, hidden);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (TEXT_EXTENSIONS.has(dot === -1 ? '' : entry.name.slice(dot).toLowerCase())) {
        yield full;
      }
    }
  }
}

export function createGrepTools(): ToolEntry[] {
  const grep: ToolEntry = {
    name: 'grep',
    description:
      'Search the files of the workspace with a regular expression, like grep -n -C. The answer groups the matches by file: `12:` marks a matching line, `11-` a line of the context, `--` a gap. Use it to find a shape of code and see it with its neighbours in one call; use search_code to find code by words.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'A JavaScript regular expression, for example "function \\\\w+Async".' },
        path: { type: 'string', description: 'A folder or a file to search, relative to the workspace root. Default: the whole workspace.' },
        glob: { type: 'string', description: 'Only the files that match, for example "*.ts" or "src/**/*.test.ts".' },
        ignore_case: { type: 'boolean', description: 'Ignore the case of the letters.' },
        context: { type: 'number', description: 'Lines before and after every match, 0-10, default 2.' },
        max_results: { type: 'number', description: 'The most matches to return, default 100.' }
      },
      required: ['pattern']
    },
    async execute(input, ctx) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(String(input['pattern'] ?? ''), input['ignore_case'] === true ? 'i' : '');
      } catch (error) {
        return { content: 'grep failed: the pattern is not a valid regular expression: ' + (error as Error).message, isError: true };
      }
      const context = Math.max(0, Math.min(MAX_CONTEXT, Number(input['context'] ?? 2) || 0));
      const limit = Math.max(1, Math.min(MAX_RESULTS, Number(input['max_results'] ?? 100) || 100));
      const glob = typeof input['glob'] === 'string' && input['glob'].trim() ? globToRegExp(input['glob'].trim()) : undefined;
      const sub = typeof input['path'] === 'string' ? input['path'].trim() : '';
      let start: string;
      try {
        start = sub ? resolveWorkspacePath(ctx.workspaceRoot, sub) : ctx.workspaceRoot;
      } catch (error) {
        return { content: 'grep failed: ' + (error as Error).message, isError: true };
      }
      const info = await stat(start).catch(() => undefined);
      if (!info) {
        return { content: 'grep failed: ' + sub + ' does not exist.', isError: true };
      }
      const files = info.isFile() ? [start] : walk(start, ctx.workspaceRoot, sub.length > 0);
      const parts: string[] = [];
      let total = 0;
      for await (const file of files) {
        if (total >= limit) {
          break;
        }
        const name = relative(ctx.workspaceRoot, file).split(sep).join('/');
        if (glob && !glob.test(name)) {
          continue;
        }
        const size = (await stat(file).catch(() => undefined))?.size ?? 0;
        if (size > MAX_FILE_BYTES) {
          continue;
        }
        const text = await readFile(file, 'utf8').catch(() => '');
        const found = grepText(text, pattern, context, limit - total);
        if (found.count > 0) {
          total += found.count;
          parts.push(name, ...found.lines, '');
        }
      }
      if (total === 0) {
        return { content: 'No matches for /' + pattern.source + '/.' };
      }
      return {
        content: parts.join('\n') + (total >= limit ? '\nThe search stopped at ' + limit + ' matches, narrow it with path or glob.' : '') +
          '\n' + total + ' matches.'
      };
    }
  };
  return [grep];
}
