import { createHash } from 'node:crypto';

// The text of a file the agent last saw, by chat and path. The reader edits
// the files too: a write over a file that changed since the agent read it
// throws away the work of the reader, an edit works from a stale picture.
const MAX_STAMPS = 2000;
const stamps = new Map<string, string>();

function keyOf(sessionId: string | undefined, path: string): string {
  return (sessionId ?? '') + '\u0000' + path.toLowerCase();
}

export function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

// The agent read or wrote the file: this text is what it knows.
export function rememberText(sessionId: string | undefined, path: string, text: string): void {
  const key = keyOf(sessionId, path);
  stamps.delete(key);
  stamps.set(key, hashText(text));
  if (stamps.size > MAX_STAMPS) {
    const oldest = stamps.keys().next().value;
    if (oldest !== undefined) {
      stamps.delete(oldest);
    }
  }
}

// True when the agent saw the file and the disk now holds another text. A
// file the agent never saw is not changed outside: there is nothing to lose
// that the agent knew about.
export function changedOutside(sessionId: string | undefined, path: string, current: string | null): boolean {
  const known = stamps.get(keyOf(sessionId, path));
  if (known === undefined) {
    return false;
  }
  return current === null || hashText(current) !== known;
}

export function forgetStamps(sessionId?: string): void {
  if (sessionId === undefined) {
    stamps.clear();
    return;
  }
  const prefix = sessionId + '\u0000';
  for (const key of [...stamps.keys()]) {
    if (key.startsWith(prefix)) {
      stamps.delete(key);
    }
  }
}
