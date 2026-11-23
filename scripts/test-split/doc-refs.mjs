import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The links of the documentation must point at files of the repository. A
// name without a path is searched by its name in the whole tree, so the
// check does not cry wolf over the bare names of the prose.
const skip = new Set(['node_modules', '.git', '.worktrees', 'dist', 'out', 'analysis', 'coverage']);

// The mentions that are not links to a file of the repository: the example
// names of the files of the tasks, the files that are named to say that they
// are gone, the template of a name and the conventions of the other tools.
const notLinks = new Set([
  'tasks.md',
  'TASKS.md',
  'TODO.md',
  'docs/tasks.md',
  'src/ui/webview/codicons.ts',
  'test/unit/activity-status.test.ts',
  'extension-activate-N.test.ts',
  'CLAUDE.md',
  '.github/copilot-instructions.md'
]);

function collect(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      collect(join(dir, entry.name), found);
    } else {
      found.add(entry.name);
    }
  }
  return found;
}

const allFiles = collect('.', new Set());
const files = ['AGENTS.md', 'README.md'];
const missing = new Map();

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const re = /\x60([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|json|css|md|py))\x60/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ref = m[1];
    if (notLinks.has(ref)) continue;
    const name = ref.split('/').pop();
    const exists = ref.includes('/')
      ? existsSync(ref) || existsSync(join('src', ref))
      : allFiles.has(name);
    if (!exists) {
      if (!missing.has(ref)) missing.set(ref, []);
      missing.get(ref).push(file);
    }
  }
}

console.log('references that do not exist: ' + missing.size);
for (const [ref, where] of missing) {
  console.log('  ' + ref + '  <- ' + [...new Set(where)].join(', '));
}
process.exit(missing.size === 0 ? 0 : 1);
