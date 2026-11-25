import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MiniMaxController } from '../extension';
import { ensureIgnored } from '../notes/sqlite';

// A pasted image becomes a file of the project: the chat model does not see
// images, it reads them with read_image from a path. The file lies in
// .minimax/agent/attachments/, a folder that ignores itself, so git never
// sees it.

const MAX_BYTES = 10 * 1024 * 1024;
const NAME = /^paste-[\w-]+\.(?:png|jpg|webp|gif)$/;
const DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

// The bytes of the image, or the reason it is refused. The name comes from
// the panel, so it is checked: no folder, no other extension.
export function decodePastedImage(name: string, dataUrl: string): Buffer | string {
  if (!NAME.test(name)) {
    return 'The name of the pasted image is not valid.';
  }
  const match = DATA_URL.exec(dataUrl);
  if (!match) {
    return 'Only PNG, JPEG, WebP and GIF images can be pasted.';
  }
  const bytes = Buffer.from(match[1] ?? '', 'base64');
  if (bytes.length === 0) {
    return 'The pasted image is empty.';
  }
  if (bytes.length > MAX_BYTES) {
    return 'The pasted image is larger than 10 MB.';
  }
  return bytes;
}

export async function savePastedImage(host: MiniMaxController, name: string, dataUrl: string): Promise<void> {
  const bytes = decodePastedImage(name, dataUrl);
  if (typeof bytes === 'string') {
    host.panel.post({ type: 'notice', message: bytes, kind: 'error' });
    return;
  }
  try {
    const agentDir = join(host.workspaceRoot(), '.minimax', 'agent');
    await ensureIgnored(agentDir);
    const dir = join(agentDir, 'attachments');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
    const path = '.minimax/agent/attachments/' + name;
    // The same answer as a picked file: the panel puts a chip into the field.
    host.panel.post({ type: 'files', requestId: 'paste', files: [{ path, label: name }] });
  } catch (error) {
    host.panel.post({
      type: 'notice',
      message: 'The pasted image was not saved: ' + (error instanceof Error ? error.message : String(error)),
      kind: 'error'
    });
  }
}
