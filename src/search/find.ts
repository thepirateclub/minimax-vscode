import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { resolveWorkspacePath } from '../paths';
import { IGNORED_DIRS, TEXT_EXTENSIONS } from './files';

// The search of findstr: several words, a line matches if it holds any of
// them, the case can be ignored and the number of the line comes with the
// match. The model does it with a tool, not with a command in the shell.
export const MAX_FIND_MATCHES = 200;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SNIPPET_LIMIT = 240;

export interface FindOptions {
  // The texts to look for, a line matches if it holds one of them.
  patterns: string[];
  ignoreCase: boolean;
  // How many matches to collect.
  limit: number;
}

export interface FindMatch {
  // The path of the file, relative to the root, with slashes.
  path: string;
  line: number;
  text: string;
}

// Does the line hold one of the patterns.
export function matchLine(line: string, patterns: string[], ignoreCase: boolean): boolean {
  const haystack = ignoreCase ? line.toLowerCase() : line;
  for (const pattern of patterns) {
    if (pattern.length === 0) {
      continue;
    }
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    if (haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

// The lines of the text that hold one of the patterns.
export function findInText(
  content: string,
  options: Pick<FindOptions, 'patterns' | 'ignoreCase' | 'limit'>
): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && found.length < options.limit; i++) {
    const text = lines[i] ?? '';
    if (matchLine(text, options.patterns, options.ignoreCase)) {
      found.push({ line: i + 1, text: text.trim().slice(0, SNIPPET_LIMIT) });
    }
  }
  return found;
}

// The path of the file inside the root, the separator is always a slash.
function relativePath(root: string, full: string): string {
  return relative(root, full).split(sep).join('/');
}

// A folder the search skips, the big ones and the folder of git.
function isSkipped(name: string): boolean {
  return IGNORED_DIRS.includes(name);
}

async function statOrUndefined(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

// The search of the files of a folder. A folder that the model named by hand
// is searched as it is, the hidden folders inside it belong to the work, for
// example the worktrees of git. A search of the whole project skips them.
export async function findInTree(
  root: string,
  options: FindOptions & { sub?: string }
): Promise<FindMatch[]> {
  const matches: FindMatch[] = [];
  const limit = Math.max(1, Math.min(MAX_FIND_MATCHES, options.limit));

  const scanFile = async (absolute: string): Promise<void> => {
    if (matches.length >= limit) {
      return;
    }
    const info = await statOrUndefined(absolute);
    if (!info || !info.isFile() || info.size > MAX_FILE_BYTES) {
      return;
    }
    let content: string;
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      return;
    }
    for (const line of findInText(content, { ...options, limit: limit - matches.length })) {
      matches.push({ path: relativePath(root, absolute), line: line.line, text: line.text });
      if (matches.length >= limit) {
        return;
      }
    }
  };

  const walk = async (dir: string, allowHidden: boolean): Promise<void> => {
    if (matches.length >= limit) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= limit) {
        return;
      }
      if (isSkipped(entry.name)) {
        continue;
      }
      if (!allowHidden && entry.name.startsWith('.')) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, allowHidden);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      const extension = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) {
        continue;
      }
      await scanFile(full);
    }
  };

  if (options.sub === undefined || options.sub.length === 0) {
    await walk(root, false);
    return matches;
  }

  // The path of the model must stay inside the root, the join of the
  // paths normalizes the .. and the file outside of it would be read.
  const target = resolveWorkspacePath(root, options.sub);
  const info = await statOrUndefined(target);
  if (!info) {
    throw new Error('the path does not exist: ' + options.sub);
  }
  if (info.isFile()) {
    // A file that the model named is read as it is, its extension does not
    // matter.
    await scanFile(target);
    return matches;
  }
  if (!info.isDirectory()) {
    throw new Error('the path is not a file or a folder: ' + options.sub);
  }
  await walk(target, true);
  return matches;
}
