import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { ensureIgnored } from '../notes/sqlite';

// The deletion of the agent goes to a trash inside the project, not to the
// void: `delete_files` was the only tool whose mistake git could not always
// undo (an untracked file, a file under .gitignore). A rename moves the file,
// no shell and no system API are needed. The folder of the agent ignores
// itself, git does not see the trash.
export const TRASH_DIR = join('.minimax', 'agent', 'trash');
export const TRASH_LIMITS = { maxAgeMs: 14 * 24 * 60 * 60 * 1000, maxBytes: 200 * 1024 * 1024 };

// The folder of one deletion: the chat and the moment, the files keep their
// paths inside it.
export function trashFolder(root: string, sessionId: string | undefined, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
  return join(root, TRASH_DIR, (sessionId ?? 'chat').replace(/[^\w.-]/g, '_'), stamp);
}

export async function moveToTrash(root: string, target: string, folder: string): Promise<string> {
  await ensureIgnored(join(root, '.minimax', 'agent'));
  const place = join(folder, relative(root, target));
  await mkdir(dirname(place), { recursive: true });
  await rename(target, place);
  return relative(root, place).split(sep).join('/');
}

interface Entry {
  dir: string;
  at: number;
  bytes: number;
}

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path).catch(() => undefined);
  if (!info) {
    return 0;
  }
  if (!info.isDirectory()) {
    return info.size;
  }
  let total = 0;
  for (const name of await readdir(path).catch(() => [] as string[])) {
    total += await sizeOf(join(path, name));
  }
  return total;
}

// The deletions of the trash, the oldest first.
async function entries(root: string): Promise<Entry[]> {
  const base = join(root, TRASH_DIR);
  const found: Entry[] = [];
  for (const chat of await readdir(base).catch(() => [] as string[])) {
    for (const moment of await readdir(join(base, chat)).catch(() => [] as string[])) {
      const dir = join(base, chat, moment);
      const info = await stat(dir).catch(() => undefined);
      if (info?.isDirectory()) {
        found.push({ dir, at: info.mtimeMs, bytes: await sizeOf(dir) });
      }
    }
  }
  return found.sort((left, right) => left.at - right.at);
}

// The old deletions leave the trash: by age, then the oldest until the size
// fits. The answer is the number of deletions that went.
export async function pruneTrash(root: string, now = Date.now(), limits = TRASH_LIMITS): Promise<number> {
  const list = await entries(root);
  let total = list.reduce((sum, entry) => sum + entry.bytes, 0);
  let removed = 0;
  for (const entry of list) {
    if (entry.at >= now - limits.maxAgeMs && total <= limits.maxBytes) {
      continue;
    }
    await rm(entry.dir, { recursive: true, force: true });
    total -= entry.bytes;
    removed += 1;
  }
  return removed;
}

export async function clearTrash(root: string): Promise<void> {
  await rm(join(root, TRASH_DIR), { recursive: true, force: true });
}
