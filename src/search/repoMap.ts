// A short map of the project for the system prompt: the files and the names
// they declare. The model knows where a thing lives before it searches, the
// way Aider gives its repo map. The budget keeps the map near 1K tokens, the
// files the others import the most go first.

export const REPO_MAP_BUDGET = 4000;
const MAX_NAMES_PER_FILE = 8;

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs)$/i;

const DECLARATIONS: RegExp[] = [
  // TypeScript and JavaScript exports.
  /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let)\s+([A-Za-z_$][\w$]*)/,
  // Python, Go, Rust, Java and C# declarations at the top level.
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^class\s+([A-Za-z_]\w*)/,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
  /^public\s+(?:static\s+|abstract\s+|final\s+|sealed\s+)*(?:class|interface|record|enum)\s+([A-Za-z_]\w*)/
];

export function isMapFile(path: string): boolean {
  return CODE_FILE.test(path);
}

// The names a file declares at the top level, in the order of the file.
export function declarationsOf(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    for (const pattern of DECLARATIONS) {
      const match = pattern.exec(line);
      if (match?.[1] && !names.includes(match[1])) {
        names.push(match[1]);
        break;
      }
    }
  }
  return names;
}

// How many other files name the file in an import: a module the project
// leans on is worth a line of the map more than a leaf.
function importCounts(files: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  const stems = new Map<string, string>();
  for (const path of files.keys()) {
    const stem = path.replace(/\.[^./]+$/, '').split('/').pop() ?? path;
    stems.set(path, stem);
  }
  for (const [path, content] of files) {
    const imported = new Set<string>();
    for (const match of content.matchAll(/(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g)) {
      const stem = (match[1] ?? '').split('/').pop()?.replace(/\.[^.]+$/, '');
      if (stem) {
        imported.add(stem);
      }
    }
    for (const [other, stem] of stems) {
      if (other !== path && imported.has(stem)) {
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function buildRepoMap(files: ReadonlyMap<string, string>, budget = REPO_MAP_BUDGET): string {
  const counts = importCounts(files);
  const entries = [...files]
    .map(([path, content]) => ({ path, names: declarationsOf(content), rank: counts.get(path) ?? 0 }))
    .filter((entry) => entry.names.length > 0)
    .sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path));
  const lines: string[] = [];
  let used = 0;
  let left = 0;
  for (const entry of entries) {
    const shown = entry.names.slice(0, MAX_NAMES_PER_FILE);
    const more = entry.names.length - shown.length;
    const line = entry.path + ': ' + shown.join(', ') + (more > 0 ? ' +' + more : '');
    if (used + line.length + 1 > budget) {
      left++;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) {
    return '';
  }
  lines.sort();
  if (left > 0) {
    lines.push('... and ' + left + ' more files, search_code finds them');
  }
  return lines.join('\n');
}

export function renderRepoMap(map: string): string {
  return map.length > 0 ? 'Repository map (files and their top-level names):\n' + map : '';
}
