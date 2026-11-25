// The body of a function, a method or a class by its name: the model wants
// `emit` and `checkAchievements` of a file, not the whole file and not a
// range it has to guess. It cut such pieces into tmp files of the project
// before and read them again; one call now gives several bodies at once.

export interface SymbolBody {
  name: string;
  // The lines counted from 1, the comment above the declaration included.
  start: number;
  end: number;
  text: string;
}

const MAX_SYMBOL_LINES = 400;

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarations(name: string, python: boolean): RegExp[] {
  const n = escape(name);
  if (python) {
    return [new RegExp('^\\s*(?:async\\s+)?def\\s+' + n + '\\b'), new RegExp('^\\s*class\\s+' + n + '\\b')];
  }
  // The modifiers of TS and JS, and of Kotlin, Java, C# and Rust: the model
  // compares the same code in two languages, a web and a native version.
  const modifiers =
    '(?:(?:export|default|declare|public|private|protected|internal|static|async|readonly|override|abstract|get|set|' +
    'suspend|inline|open|final|data|sealed|operator|infix|tailrec|external|lateinit|const|virtual|partial|extern|unsafe|pub(?:\\([^)]*\\))?|synchronized)\\s+)*';
  return [
    new RegExp('^\\s*' + modifiers + '(?:function\\*?|class|interface|type|enum|namespace|object|struct|trait|impl|record)\\s+' + n + '\\b'),
    new RegExp('^\\s*' + modifiers + '(?:const|let|var|val)\\s+' + n + '\\b'),
    // fun of Kotlin (also an extension `fun Foo.name`), func of Go with a
    // receiver, fn of Rust.
    new RegExp('^\\s*' + modifiers + '(?:fun|func|fn)\\s+(?:<[^>]*>\\s*)?(?:\\([^)]*\\)\\s*)?(?:[\\w.]+\\.)?' + n + '\\s*[<(]'),
    // A method of Java and C#: a type before the name.
    new RegExp('^\\s*' + modifiers + '[\\w<>\\[\\],.?]+\\s+' + n + '\\s*\\('),
    // A method: the name, generics, the parameters, at the start of a line.
    new RegExp('^\\s*' + modifiers + '\\*?' + n + '\\s*(?:<[^>]*>)?\\s*\\('),
    // A property with an arrow function: `name = (...) =>`.
    new RegExp('^\\s*' + modifiers + n + '\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\(|function|[A-Za-z_$][\\w$]*\\s*=>)')
  ];
}

const CONTROL = /^\s*(?:if|for|while|switch|catch|return|else)\b/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

// The braces of the code, the strings and the comments skipped roughly: a
// brace in a string must not close the body.
function braceEnd(lines: readonly string[], from: number): number {
  let depth = 0;
  let opened = false;
  let block = false;
  for (let i = from; i < lines.length && i < from + MAX_SYMBOL_LINES; i++) {
    const line = lines[i]!;
    let quote = '';
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!;
      const next = line[j + 1];
      if (block) {
        if (ch === '*' && next === '/') {
          block = false;
          j++;
        }
        continue;
      }
      if (quote) {
        if (ch === '\\') {
          j++;
        } else if (ch === quote) {
          quote = '';
        }
        continue;
      }
      if (ch === '/' && next === '/') {
        break;
      }
      if (ch === '/' && next === '*') {
        block = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
        if (opened && depth <= 0) {
          return i;
        }
      }
    }
    // A declaration without a body ends on its line: `const x = 1;`.
    if (!opened && /;\s*$/.test(line)) {
      return i;
    }
  }
  return Math.min(lines.length, from + MAX_SYMBOL_LINES) - 1;
}

function indentEnd(lines: readonly string[], from: number): number {
  const base = indentOf(lines[from]!);
  let end = from;
  for (let i = from + 1; i < lines.length && i < from + MAX_SYMBOL_LINES; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) {
      continue;
    }
    if (indentOf(line) <= base) {
      break;
    }
    end = i;
  }
  return end;
}

// The comment and the decorators right above the declaration belong to it.
function headStart(lines: readonly string[], at: number): number {
  let start = at;
  while (start > 0 && /^\s*(?:\/\/|\/\*|\*|@|#)/.test(lines[start - 1]!)) {
    start--;
  }
  return start;
}

export function extractSymbol(text: string, name: string, path: string): SymbolBody | undefined {
  const python = /\.pyi?$/i.test(path);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const patterns = declarations(name, python);
  const at = lines.findIndex((line) => !CONTROL.test(line) && patterns.some((pattern) => pattern.test(line)));
  if (at === -1) {
    return undefined;
  }
  const end = python ? indentEnd(lines, at) : braceEnd(lines, at);
  const start = headStart(lines, at);
  return { name, start: start + 1, end: end + 1, text: lines.slice(start, end + 1).join('\n') };
}

// The bodies as the model reads them: a header with the place, the lines
// with their numbers, the names that were not found at the end.
export function formatSymbols(path: string, text: string, names: readonly string[]): string {
  const parts: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const body = extractSymbol(text, name, path);
    if (!body) {
      missing.push(name);
      continue;
    }
    const numbered = body.text
      .split('\n')
      .map((line, index) => body.start + index + ': ' + line)
      .join('\n');
    parts.push('=== ' + name + ' (' + path + ':' + body.start + '-' + body.end + ') ===\n' + numbered);
  }
  if (missing.length > 0) {
    parts.push('Not found in ' + path + ': ' + missing.join(', ') + '. search_code finds where they live.');
  }
  return parts.join('\n\n');
}
