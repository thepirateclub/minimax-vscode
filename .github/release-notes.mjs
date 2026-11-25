// The notes of a GitHub release: the section of the version in CHANGELOG.md,
// from its heading `## 1.2.3 - date` to the next heading of the same level.
// A version without a section is an error: a release without notes says
// nothing to the reader.
import { readFileSync } from 'node:fs';

export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.startsWith('## ' + version + ' ') || line === '## ' + version);
  if (start === -1) {
    return undefined;
  }
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) {
    end = lines.length;
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (!notes) {
    console.error('CHANGELOG.md has no section for the version ' + version + '.');
    process.exit(1);
  }
  process.stdout.write(notes + '\n');
}
