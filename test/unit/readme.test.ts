import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The number of the version lived in the install line of the README and
// fell behind the manifest three times. The line names a placeholder, and
// the English README goes into the package: the Marketplace page links it.
describe('the README of the extension', () => {
  it('does not pin a version of the package', () => {
    for (const file of ['README.md', 'README.en.md']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/minimax-agent-\d+\.\d+\.\d+\.vsix/);
    }
  });

  it('ships the English README', () => {
    const ignored = readFileSync('.vscodeignore', 'utf8').split(/\r?\n/).map((line) => line.trim());
    expect(ignored).not.toContain('README.en.md');
  });
});
