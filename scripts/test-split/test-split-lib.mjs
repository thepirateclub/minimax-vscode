import { readFileSync, writeFileSync } from 'node:fs';

// A test file is split into a helper with the shared parts and a few files
// with the cases. The names of the imports are checked, an unused import
// breaks the build.
export function readImports(lines) {
  const imports = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.startsWith('import')) {
      break;
    }
    let statement = line;
    while (!statement.trimEnd().endsWith(';')) {
      index += 1;
      statement += '\n' + lines[index];
    }
    imports.push(statement);
    index += 1;
  }
  return { imports, rest: lines.slice(index) };
}

export function importedNames(statement) {
  const names = [];
  const match = /import\s+(type\s+)?\{([\s\S]*?)\}/.exec(statement);
  if (match) {
    for (const part of match[2].split(',')) {
      const raw = part.trim();
      const isType = /^type\s+/.test(raw) || /^type\s/.test(match[1] ?? '');
      const name = raw.replace(/^type\s+/, '');
      if (name.length > 0) {
        names.push({ name: name.split(/\s+as\s+/).pop(), isType });
      }
    }
    return names;
  }
  const defaultMatch = /import\s+([A-Za-z0-9_$]+)\s+from/.exec(statement);
  if (defaultMatch) {
    names.push({ name: defaultMatch[1], isType: false });
  }
  return names;
}

export function usedNames(imports, body) {
  const keep = [];
  for (const statement of imports) {
    const names = importedNames(statement);
    const used = names.filter((entry) =>
      new RegExp('(^|[^A-Za-z0-9_$])' + entry.name + '([^A-Za-z0-9_$]|$)').test(body)
    );
    if (used.length === 0) {
      continue;
    }
    const statementIsType = /^import\s+type\s/.test(statement);
    const rebuilt = statement.replace(
      /\{([\s\S]*?)\}/,
      (whole, inner) =>
        '{ ' +
        used.map((entry) => (entry.isType && !statementIsType ? 'type ' + entry.name : entry.name)).join(', ') +
        ' }'
    );
    keep.push(rebuilt);
  }
  return keep;
}

// The cases of a describe live at the indent of two spaces.
export function splitIts(body) {
  const blocks = [];
  let current = null;
  for (const line of body) {
    if (current === null) {
      if (/^  it\(/.test(line)) {
        current = [line];
      }
      continue;
    }
    current.push(line);
    if (line === '  });') {
      blocks.push(current.join('\n'));
      current = null;
    }
  }
  if (current !== null) {
    throw new Error('a case is not closed');
  }
  return blocks;
}

export function writeFile(path, lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : lines;
  writeFileSync(path, text.replace(/\s*$/, '') + '\n', 'utf8');
  console.log(path + ': ' + text.split('\n').length + ' lines');
}
