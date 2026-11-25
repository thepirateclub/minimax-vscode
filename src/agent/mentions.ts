import { readFile, stat } from 'node:fs/promises';
import { resolveWorkspacePath } from '../tools/fs';

const MENTION_PATTERN = /(?:^|\s)@([^\s@]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const MAX_PATH_LENGTH = 260;
const MAX_FILES = 5;
const MAX_LINES = 400;
const MAX_CHARS = 60_000;
const IMAGE = /\.(?:png|jpe?g|webp|gif|bmp)$/i;

export function imageNote(path: string): string {
  return '[An image the user attached. You do not see images in the chat: look at it with read_image(path: "' + path + '"), crop a region of it to read small details.]';
}

export function extractMentionPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const raw = (match[1] ?? '').replace(TRAILING_PUNCTUATION, '');
    if (!looksLikeFilePath(raw)) {
      continue;
    }
    if (!paths.includes(raw)) {
      paths.push(raw);
    }
  }
  return paths;
}

export async function readMentionedFiles(
  root: string,
  text: string,
  extraPaths: string[] = []
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const candidates: string[] = [];
  for (const path of [...extractMentionPaths(text), ...extraPaths]) {
    if (!candidates.includes(path)) {
      candidates.push(path);
    }
  }
  for (const path of candidates) {
    if (files.length >= MAX_FILES) {
      break;
    }
    let target: string;
    try {
      target = resolveWorkspacePath(root, path);
    } catch {
      continue;
    }
    try {
      const info = await stat(target);
      if (!info.isFile()) {
        continue;
      }
      // An image is not text: its bytes read as utf8 were noise. The model
      // reads the image with the tool instead.
      if (IMAGE.test(path)) {
        files.push({ path, content: imageNote(path) });
        continue;
      }
      files.push({ path, content: capContent(await readFile(target, 'utf8')) });
    } catch {
      continue;
    }
  }
  return files;
}

function looksLikeFilePath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > MAX_PATH_LENGTH) {
    return false;
  }
  if (candidate.includes('..')) {
    return false;
  }
  // A file reference always carries an extension, so ordinary words and
  // e-mail addresses never turn into a file attachment.
  const name = candidate.split(/[\\/]/).pop() ?? '';
  return /\.[A-Za-z0-9]+$/.test(name);
}

function capContent(raw: string): string {
  const lines = raw.split('\n');
  const capped = lines.slice(0, MAX_LINES).join('\n');
  if (capped.length > MAX_CHARS) {
    return capped.slice(0, MAX_CHARS) + '\n[truncated]';
  }
  if (lines.length > MAX_LINES) {
    return capped + '\n[truncated]';
  }
  return capped;
}
