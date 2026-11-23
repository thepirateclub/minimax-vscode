import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The style sheet is split into parts by the file size rule. A test reads
// the whole sheet the way the panel gets it: the parts in the order of the
// names, joined back into one text.
const dir = fileURLToPath(new URL('../../src/ui/webview/styles/', import.meta.url));

export function readStyles(): string {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}
