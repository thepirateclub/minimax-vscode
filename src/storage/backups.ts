export interface BackupEntry {
  path: string;
  previousContent: string | null;
  createdAt: number;
}

export interface BackupStore {
  save(path: string, previousContent: string | null): Promise<void>;
  revertLast(): Promise<BackupEntry | undefined>;
  list(): Promise<BackupEntry[]>;
}

export class InMemoryBackupStore implements BackupStore {
  private readonly entries: BackupEntry[] = [];

  async save(path: string, previousContent: string | null): Promise<void> {
    this.entries.push({ path, previousContent, createdAt: Date.now() });
  }

  async revertLast(): Promise<BackupEntry | undefined> {
    return this.entries.pop();
  }

  async list(): Promise<BackupEntry[]> {
    return [...this.entries];
  }
}
