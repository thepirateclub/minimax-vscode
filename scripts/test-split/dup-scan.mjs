import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const normalise = (line) => line.replace(/\s+/g, ' ').trim();

const windows = new Map();
for (const file of walk('src')) {
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(normalise)
    .filter((line) => line.length > 12 && !line.startsWith('import ') && !line.startsWith('//'));
  for (let i = 0; i + 2 < lines.length; i++) {
    const key = lines.slice(i, i + 3).join('\n');
    if (!windows.has(key)) windows.set(key, new Set());
    windows.get(key).add(relative('.', file).replace(/\\/g, '/'));
  }
}

const groups = [...windows.entries()].filter(([, files]) => files.size > 1);
console.log('duplicate blocks of three lines: ' + groups.length);
for (const [key, files] of groups.slice(0, 12)) {
  console.log('--- ' + [...files].join(' | '));
  console.log('    ' + key.split('\n')[0]);
}
