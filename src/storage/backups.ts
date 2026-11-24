import { readFile, unlink, writeFile } from 'node:fs/promises';

export interface BackupEntry {
  path: string;
  previousContent: string | null;
  createdAt: number;
  // The chat whose agent made the change, the rewind takes back its files.
  sessionId?: string;
  // The text the agent wrote. The rewind restores a file only when the disk
  // still holds this text: an edit of the user after the agent stays.
  nextContent?: string;
}

export interface BackupMeta {
  sessionId?: string;
  next?: string;
  // The moment of the change, the clock of the store when absent.
  at?: number;
}

export interface BackupStore {
  save(path: string, previousContent: string | null, meta?: BackupMeta): Promise<void>;
  revertLast(): Promise<BackupEntry | undefined>;
  list(): Promise<BackupEntry[]>;
  // The backups of one chat since a moment, the store forgets them.
  takeSince(sessionId: string, since: number): Promise<BackupEntry[]>;
}

export class InMemoryBackupStore implements BackupStore {
  private entries: BackupEntry[] = [];

  async save(path: string, previousContent: string | null, meta?: BackupMeta): Promise<void> {
    const entry: BackupEntry = { path, previousContent, createdAt: meta?.at ?? Date.now() };
    if (meta?.sessionId !== undefined) {
      entry.sessionId = meta.sessionId;
    }
    if (meta?.next !== undefined) {
      entry.nextContent = meta.next;
    }
    this.entries.push(entry);
  }

  async revertLast(): Promise<BackupEntry | undefined> {
    return this.entries.pop();
  }

  async list(): Promise<BackupEntry[]> {
    return [...this.entries];
  }

  async takeSince(sessionId: string, since: number): Promise<BackupEntry[]> {
    const taken = this.entries.filter(
      (entry) => entry.sessionId === sessionId && entry.createdAt >= since
    );
    this.entries = this.entries.filter((entry) => !taken.includes(entry));
    return taken;
  }
}

export interface RestorePlan {
  path: string;
  // The text before the first change of the turn, null for a new file.
  restore: string | null;
  // The text of the last change of the agent, absent in an old backup.
  expected: string | undefined;
}

// One restore per file: the state before the first change and the text of
// the last one, the entries come in the order of the changes.
export function planRestore(entries: readonly BackupEntry[]): RestorePlan[] {
  const plans = new Map<string, RestorePlan>();
  for (const entry of entries) {
    const plan = plans.get(entry.path);
    if (plan) {
      plan.expected = entry.nextContent;
    } else {
      plans.set(entry.path, {
        path: entry.path,
        restore: entry.previousContent,
        expected: entry.nextContent
      });
    }
  }
  return [...plans.values()];
}

// The files go back only when the disk holds the text of the agent: the user
// may have changed the file after it, that work is not overwritten.
export async function restoreFiles(
  plans: readonly RestorePlan[]
): Promise<{ restored: string[]; skipped: string[] }> {
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const plan of plans) {
    const current = await readFile(plan.path, 'utf8').catch(() => null);
    if (plan.expected === undefined || current !== plan.expected) {
      skipped.push(plan.path);
      continue;
    }
    try {
      if (plan.restore === null) {
        await unlink(plan.path);
      } else {
        await writeFile(plan.path, plan.restore, 'utf8');
      }
      restored.push(plan.path);
    } catch {
      skipped.push(plan.path);
    }
  }
  return { restored, skipped };
}
