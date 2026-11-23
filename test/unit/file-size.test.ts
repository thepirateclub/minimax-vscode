import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 400;
// The roots come from the place of the file: the test may be run from any
// directory.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['src', 'test'];
// Every file of the project counts, not only the sources.
const FILES = /\.(ts|tsx|css|mjs|json|html)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (FILES.test(path)) {
      out.push(path);
    }
  }
  return out;
}

// The empty lines count, the last line of a file without a newline does not.
function lineCount(path: string): number {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length;
}

describe('the size of the files', () => {
  it('keeps every file of the project under the limit', () => {
    const tooBig: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(REPO, root))) {
        const count = lineCount(file);
        if (count > LIMIT) {
          tooBig.push(relative(REPO, file).replace(/\\/g, '/') + ': ' + count);
        }
      }
    }
    expect(tooBig).toEqual([]);
  });
});
