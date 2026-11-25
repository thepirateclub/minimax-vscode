import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMentionedFiles } from '../../src/agent/mentions';
import { decodePastedImage } from '../../src/host/pasteImage';
import { ATTACHMENTS_DIR, pastedName, shownImages } from '../../src/ui/webview/components/pastedImages';

// A pasted image stood inside the text of the field. Now it is a file of
// .minimax/agent/attachments/, a chip in the field and a thumbnail over it.
describe('a pasted image', () => {
  it('gets a name of the moment and a counter', () => {
    const at = new Date(Date.UTC(2026, 10, 25, 17, 3, 9));
    expect(pastedName('image/png', at, 0)).toBe('paste-20261125-170309.png');
    expect(pastedName('image/jpeg', at, 1)).toBe('paste-20261125-170309-2.jpg');
    expect(pastedName('text/html', at, 0)).toBeUndefined();
  });

  it('shows the thumbnails of the chips that are still in the field', () => {
    const sources = { [ATTACHMENTS_DIR + 'a.png']: 'data:a', [ATTACHMENTS_DIR + 'b.png']: 'data:b' };
    expect(shownImages([ATTACHMENTS_DIR + 'b.png', 'src/app.ts'], sources)).toEqual([
      { path: ATTACHMENTS_DIR + 'b.png', src: 'data:b' }
    ]);
  });

  it('is checked by the host before it is saved', () => {
    const png = 'data:image/png;base64,' + Buffer.from('png').toString('base64');
    expect(Buffer.isBuffer(decodePastedImage('paste-1.png', png))).toBe(true);
    expect(decodePastedImage('../evil.png', png)).toContain('name');
    expect(decodePastedImage('paste-1.png', 'data:text/html;base64,AAAA')).toContain('Only PNG');
  });

  it('reaches the model as a path to read_image, not as bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-paste-'));
    await writeFile(join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    const files = await readMentionedFiles(root, 'look at @shot.png');
    expect(files[0]?.content).toContain('read_image(path: "shot.png")');
  });
});
