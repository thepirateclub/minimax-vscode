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

const files = walk('src');
const shims = [
  'ui/webview/icons',
  'ui/webview/highlight',
  'search/project',
  'tools/git',
  'tools/repl',
  'tools/tasks',
  'tools/containers'
];

for (const shim of shims) {
  const base = shim.split('/').pop();
  const users = [];
  for (const file of files) {
    const rel = relative('.', file).replace(/\\/g, '/');
    if (rel === 'src/' + shim + '.ts' || rel === 'src/' + shim + '.tsx') continue;
    const text = readFileSync(file, 'utf8');
    const re = new RegExp("from '(\\.\\.?/[^']*?)" + base + "'");
    if (re.test(text)) {
      users.push(rel);
    }
  }
  console.log(shim + ' <- ' + users.length + ' importers');
}
