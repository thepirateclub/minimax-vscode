import { useState, type ClipboardEvent } from 'react';

// An image pasted into the field. The browser put the <img> right into the
// contenteditable: the picture stood inside the text, and the request
// carried nothing the model could read. Now the image goes to the host,
// which saves it to .minimax/agent/attachments/ and answers with its path;
// the field gets a chip with the name of the file, the thumbnail stands
// over the field, and the model reads the file with read_image.

export const ATTACHMENTS_DIR = '.minimax/agent/attachments/';

export interface PastedImage {
  path: string;
  src: string;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// The name of the file of a pasted image: the moment and a counter, so two
// images of one paste do not share a name.
export function pastedName(type: string, at: Date, index: number): string | undefined {
  const extension = EXTENSIONS[type];
  if (!extension) {
    return undefined;
  }
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return 'paste-' + stamp + (index > 0 ? '-' + (index + 1) : '') + '.' + extension;
}

// The thumbnails of the images whose chips are still in the field: a chip
// removed takes its thumbnail away.
export function shownImages(mentions: readonly string[], sources: Readonly<Record<string, string>>): PastedImage[] {
  return mentions
    .filter((path) => path.startsWith(ATTACHMENTS_DIR) && sources[path])
    .map((path) => ({ path, src: sources[path]! }));
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function usePastedImages(onPasteImage: ((name: string, dataUrl: string) => void) | undefined) {
  const [sources, setSources] = useState<Record<string, string>>({});
  const [mentions, setMentions] = useState<string[]>([]);

  // The paste of the field: images go to the host, a text goes in as plain
  // text, without the markup of the page it came from.
  const onPaste = (after: () => void) => (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(event.clipboardData.files).filter((file) => EXTENSIONS[file.type]);
    event.preventDefault();
    if (files.length > 0 && onPasteImage) {
      const at = new Date();
      files.forEach((file, index) => {
        const name = pastedName(file.type, at, index);
        if (!name) {
          return;
        }
        void readDataUrl(file).then((dataUrl) => {
          setSources((prev) => ({ ...prev, [ATTACHMENTS_DIR + name]: dataUrl }));
          onPasteImage(name, dataUrl);
        });
      });
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
      after();
    }
  };

  return { onPaste, track: setMentions, images: shownImages(mentions, sources) };
}
