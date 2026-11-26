import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryBackupStore, type BackupEntry, type BackupMeta, type BackupStore } from './backups';

// The backups of the writes of the agent on the disk of the editor: the
// rewind of a chat gives the files back after a restart of the editor too.
// One file per backup, the store prunes by age, count and size, so a long
// week of work does not fill the disk.
export const BACKUP_LIMITS = {
  maxEntries: 1000,
  maxChars: 50_000_000,
  maxAgeMs: 14 * 24 * 60 * 60 * 1000
};

interface Stored {
  entry: BackupEntry;
  file: string;
  size: number;
}

export class FileBackupStore implements BackupStore {
  private entries: Stored[] = [];
  private counter = 0;
  // The writes go one after another: a prune must not race a save.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly limits = BACKUP_LIMITS,
    private readonly now: () => number = Date.now
  ) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.json')).sort()) {
      try {
        const text = readFileSync(join(dir, name), 'utf8');
        const entry = JSON.parse(text) as BackupEntry;
        if (typeof entry.path === 'string' && typeof entry.createdAt === 'number') {
          this.entries.push({ entry, file: name, size: text.length });
        }
      } catch {
        // A broken file is a lost backup, not a broken store.
        void rm(join(dir, name), { force: true });
      }
    }
    this.entries.sort((left, right) => left.entry.createdAt - right.entry.createdAt);
    this.prune();
  }

  save(path: string, previousContent: string | null, meta?: BackupMeta): Promise<void> {
    const entry: BackupEntry = { path, previousContent, createdAt: meta?.at ?? this.now() };
    if (meta?.sessionId !== undefined) {
      entry.sessionId = meta.sessionId;
    }
    if (meta?.next !== undefined) {
      entry.nextContent = meta.next;
    }
    const text = JSON.stringify(entry);
    // The name keeps the order of the changes inside one millisecond.
    const file = String(entry.createdAt).padStart(15, '0') + '-' + String(this.counter++).padStart(6, '0') + '.json';
    this.entries.push({ entry, file, size: text.length });
    const removed = this.prune();
    return this.run(async () => {
      await writeFile(join(this.dir, file), text, 'utf8');
      await this.remove(removed);
    });
  }

  async revertLast(): Promise<BackupEntry | undefined> {
    const last = this.entries.pop();
    if (last) {
      await this.run(() => this.remove([last]));
    }
    return last?.entry;
  }

  async list(): Promise<BackupEntry[]> {
    return this.entries.map((stored) => stored.entry);
  }

  async takeSince(sessionId: string, since: number): Promise<BackupEntry[]> {
    const taken = this.entries.filter(
      (stored) => stored.entry.sessionId === sessionId && stored.entry.createdAt >= since
    );
    this.entries = this.entries.filter((stored) => !taken.includes(stored));
    await this.run(() => this.remove(taken));
    return taken.map((stored) => stored.entry);
  }

  // The backups that wait for the disk are written before the caller goes on.
  flush(): Promise<unknown> {
    return this.queue;
  }

  private prune(): Stored[] {
    const removed: Stored[] = [];
    const oldest = this.now() - this.limits.maxAgeMs;
    let total = this.entries.reduce((sum, stored) => sum + stored.size, 0);
    while (
      this.entries.length > 0 &&
      (this.entries.length > this.limits.maxEntries ||
        total > this.limits.maxChars ||
        this.entries[0]!.entry.createdAt < oldest)
    ) {
      const gone = this.entries.shift()!;
      total -= gone.size;
      removed.push(gone);
    }
    return removed;
  }

  private async remove(list: readonly Stored[]): Promise<void> {
    await Promise.all(list.map((stored) => rm(join(this.dir, stored.file), { force: true })));
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

// The store on the disk of the editor, in memory when there is no folder or
// the folder cannot be made: the rewind works for the session at least.
export function createBackupStore(dir: string | undefined): BackupStore {
  if (dir !== undefined) {
    try {
      return new FileBackupStore(join(dir, 'backups'));
    } catch {
      // The memory store below.
    }
  }
  return new InMemoryBackupStore();
}
