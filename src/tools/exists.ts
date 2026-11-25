import { readdir, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { resolveWorkspacePath } from '../paths';
import type { ToolEntry } from './types';

// The model checked a path by reading it and got an error, or ran a script
// in the REPL for it. The check is a tool now: several paths in one call,
// each one a file, a folder or missing, a missing one with the names that
// look like it in its folder, so the model fixes the path instead of
// guessing again.

const MAX_PATHS = 50;
const MAX_NEAR = 5;

// The names of the folder that look like the missing one: the same name in
// another case, or a name that holds it or is held by it.
export function nearNames(missing: string, names: string[]): string[] {
  const wanted = missing.toLowerCase();
  const stem = wanted.replace(/\.[^.]*$/, '');
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower === wanted || (stem.length >= 3 && (lower.includes(stem) || stem.includes(lower.replace(/\.[^.]*$/, ''))));
    })
    .slice(0, MAX_NEAR);
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function describe(root: string, path: string): Promise<string> {
  let full: string;
  try {
    full = resolveWorkspacePath(root, path);
  } catch (error) {
    return path + ': refused, ' + (error as Error).message;
  }
  const info = await stat(full).catch(() => undefined);
  if (info?.isDirectory()) {
    const entries = await readdir(full).catch(() => []);
    return path + ': folder, ' + entries.length + ' entries';
  }
  if (info?.isFile()) {
    return path + ': file, ' + formatSize(info.size) + ', changed ' + info.mtime.toISOString().slice(0, 16).replace('T', ' ');
  }
  if (info) {
    return path + ': exists, neither a file nor a folder';
  }
  const parent = dirname(full);
  const parentInfo = await stat(parent).catch(() => undefined);
  if (!parentInfo?.isDirectory()) {
    return path + ': missing, its folder is missing too';
  }
  const near = nearNames(basename(full), await readdir(parent).catch(() => []));
  return path + ': missing' + (near.length > 0 ? ', the folder has ' + near.join(', ') : '');
}

export function createExistsTools(): ToolEntry[] {
  const exists: ToolEntry = {
    name: 'path_exists',
    description:
      'Check whether files and folders exist, several paths in one call. Each path comes back as a file (with its size and the time of the last change), a folder (with the number of entries) or missing (with the similar names of its folder). Use it before you read, write or run something on a path you are not sure of.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'The paths to check, relative to the workspace root.'
        }
      },
      required: ['paths']
    },
    async execute(input, ctx) {
      const raw = input['paths'];
      const paths = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, MAX_PATHS);
      if (paths.length === 0) {
        return { content: 'path_exists failed: give at least one path.', isError: true };
      }
      const lines = await Promise.all(paths.map((path) => describe(ctx.workspaceRoot, path)));
      return { content: lines.join('\n') };
    }
  };
  return [exists];
}
