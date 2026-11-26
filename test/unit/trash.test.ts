import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearTrash, moveToTrash, pruneTrash, TRASH_DIR, trashFolder } from '../../src/tools/trash';

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'trash-'));
  await mkdir(join(root, 'src'), { recursive: true });
  return root;
}

describe('the trash of the project', () => {
  it('keeps the path of the file and prunes by age and size', async () => {
    const root = await project();
    const now = Date.now();
    await writeFile(join(root, 'src', 'old.txt'), 'x'.repeat(10));
    await writeFile(join(root, 'src', 'big.txt'), 'y'.repeat(100));
    await writeFile(join(root, 'src', 'new.txt'), 'z');
    const old = trashFolder(root, 's', now - 1000);
    expect(await moveToTrash(root, join(root, 'src', 'old.txt'), old)).toMatch(/^\.minimax\/agent\/trash\/s\/.+\/src\/old\.txt$/);
    const ancient = new Date(now - 30 * 24 * 3600 * 1000);
    await utimes(old, ancient, ancient);
    await moveToTrash(root, join(root, 'src', 'big.txt'), trashFolder(root, 's', now - 500));
    await moveToTrash(root, join(root, 'src', 'new.txt'), trashFolder(root, 's', now));
    // The old one goes by age, the big one by size, the new one stays.
    const removed = await pruneTrash(root, now, { maxAgeMs: 7 * 24 * 3600 * 1000, maxBytes: 50 });
    expect(removed).toBe(2);
    expect(await readdir(join(root, TRASH_DIR, 's'))).toHaveLength(1);
    await clearTrash(root);
    await expect(readdir(join(root, TRASH_DIR))).rejects.toThrow();
  });
});
