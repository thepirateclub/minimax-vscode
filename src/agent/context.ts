import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { IGNORED_DIRS } from '../tools/explore';

export const RULE_FILES = [
  'AGENTS.md',
  '.github/copilot-instructions.md',
  'CLAUDE.md',
  '.cursorrules'
];

const MANIFEST_FILES = [
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt'
];

const MAX_RULES_CHARS = 20_000;
const MAX_TREE_ENTRIES = 300;
const MAX_OPEN_FILE_CHARS = 20_000;

export interface WorkspaceSnapshot {
  root: string;
  rules: Array<{ path: string; content: string }>;
  tree: string[];
  stack: string[];
  openFiles: Array<{ path: string; content: string }>;
}

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.includes(name) || name.startsWith('.');
}

export async function buildWorkspaceSnapshot(
  root: string,
  options: { includeOpenFiles: boolean; openFiles?: Array<{ path: string }> } = {
    includeOpenFiles: false
  }
): Promise<WorkspaceSnapshot> {
  const rules: WorkspaceSnapshot['rules'] = [];
  let rulesChars = 0;
  for (const ruleFile of RULE_FILES) {
    try {
      const content = await readFile(join(root, ruleFile), 'utf8');
      const room = MAX_RULES_CHARS - rulesChars;
      if (room <= 0) {
        break;
      }
      const clipped = content.slice(0, room);
      rulesChars += clipped.length;
      rules.push({ path: ruleFile, content: clipped });
    } catch {
      continue;
    }
  }

  const stack: string[] = [];
  for (const manifest of MANIFEST_FILES) {
    try {
      await readFile(join(root, manifest), 'utf8');
      stack.push(manifest);
    } catch {
      continue;
    }
  }

  const tree: string[] = [];
  const walk = async (dir: string, level: number): Promise<void> => {
    if (level > 2 || tree.length >= MAX_TREE_ENTRIES) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (tree.length >= MAX_TREE_ENTRIES) {
        return;
      }
      if (isIgnored(entry.name)) {
        continue;
      }
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      tree.push(entry.isDirectory() ? rel + '/' : rel);
      if (entry.isDirectory()) {
        await walk(full, level + 1);
      }
    }
  };
  await walk(root, 1);

  const openFiles: WorkspaceSnapshot['openFiles'] = [];
  if (options.includeOpenFiles && options.openFiles) {
    for (const file of options.openFiles) {
      try {
        const content = await readFile(join(root, file.path), 'utf8');
        openFiles.push({ path: file.path, content: content.slice(0, MAX_OPEN_FILE_CHARS) });
      } catch {
        continue;
      }
    }
  }

  return { root, rules, tree, stack, openFiles };
}

export function renderSnapshot(snapshot: WorkspaceSnapshot): string {
  const parts: string[] = [];
  for (const rule of snapshot.rules) {
    parts.push('--- ' + rule.path + ' ---\n' + rule.content);
  }
  return parts.join('\n\n');
}
