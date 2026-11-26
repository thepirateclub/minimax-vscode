import { isDeniedPath } from '../denyPaths';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next'];

export const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml',
  '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php',
  '.sh', '.ps1', '.html', '.css', '.scss', '.sql', '.toml', '.ini', '.vue', '.svelte'
]);

export function isIgnoredName(name: string): boolean {
  return IGNORED_DIRS.includes(name) || name.startsWith('.');
}

export function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

// The path of the file inside the workspace, the separator is always a slash.
export function toRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

// The text files of the workspace, the big folders are skipped.
export async function collectTextFiles(
  root: string,
  options: { maxFiles?: number } = {}
): Promise<string[]> {
  const maxFiles = options.maxFiles ?? 4000;
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (found.length >= maxFiles) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) {
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
      if (!isTextFile(entry.name) || isDeniedPath(root, full)) {
        continue;
      }
      found.push(full);
    }
  };
  await walk(root);
  return found;
}
