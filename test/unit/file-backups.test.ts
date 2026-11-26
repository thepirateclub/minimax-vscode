import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planRestore } from '../../src/storage/backups';
import { FileBackupStore } from '../../src/storage/fileBackups';

const dir = (): string => join(mkdtempSync(join(tmpdir(), 'backups-')), 'b');

describe('the backups on the disk', () => {
  it('outlive a restart of the editor, the rewind takes them back', async () => {
    const folder = dir();
    const t = Date.now();
    const first = new FileBackupStore(folder);
    await first.save('a.ts', 'one', { sessionId: 's', next: 'two', at: t });
    await first.save('a.ts', 'two', { sessionId: 's', next: 'three', at: t + 100 });
    await first.save('b.ts', null, { sessionId: 'other', next: 'x', at: t + 50 });
    const second = new FileBackupStore(folder);
    const taken = await second.takeSince('s', t);
    expect(planRestore(taken)).toEqual([{ path: 'a.ts', restore: 'one', expected: 'three' }]);
    await second.flush();
    const third = new FileBackupStore(folder);
    expect((await third.list()).map((entry) => entry.path)).toEqual(['b.ts']);
  });

  it('prunes the oldest by count, size and age', async () => {
    const folder = dir();
    let now = 1_000_000;
    const store = new FileBackupStore(folder, { maxEntries: 3, maxChars: 10_000, maxAgeMs: 5000 }, () => now);
    for (let i = 0; i < 5; i++) {
      await store.save('f' + i, 'x', { at: now + i });
    }
    expect((await store.list()).map((entry) => entry.path)).toEqual(['f2', 'f3', 'f4']);
    await store.save('big', 'y'.repeat(20_000), { at: now + 10 });
    expect(await store.list()).toEqual([]);
    now += 10_000;
    await store.save('fresh', 'z', { at: now });
    await store.flush();
    expect(readdirSync(folder)).toHaveLength(1);
  });

  it('undoes the last change on the disk too', async () => {
    const folder = dir();
    const store = new FileBackupStore(folder);
    await store.save('a.ts', 'one');
    expect((await store.revertLast())?.previousContent).toBe('one');
    expect(readdirSync(folder)).toHaveLength(0);
  });
});
