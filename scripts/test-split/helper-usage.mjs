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

const helpers = readdirSync('test/helpers').filter((f) => f.endsWith('.ts'));
const tests = walk('test').filter((p) => !p.replace(/\\/g, '/').startsWith('test/helpers'));
console.log('test files: ' + tests.length);

for (const helper of helpers) {
  const name = helper.replace(/\.ts$/, '');
  const users = [];
  for (const test of tests) {
    const text = readFileSync(test, 'utf8');
    if (text.includes('helpers/' + name)) {
      users.push(relative('.', test).replace(/\\/g, '/'));
    }
  }
  console.log(helper + ' <- ' + users.length + ': ' + users.slice(0, 5).join(', '));
}
