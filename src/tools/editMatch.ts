// The arithmetic of edit_file, one place for the write and for the preview:
// the reader approves the diff of the preview, it must be the diff that
// lands on the disk.
//
// The exact match goes first and keeps its old rules. When it misses, the
// lines are compared without the indentation and the spaces at the end: the
// model often gets the whitespace wrong (Aider saw nine times more failed
// edits without a lenient match). A lenient match counts only when it is
// unique. A miss names the closest text, the model fixes old_string instead
// of reading the whole file again.

export type EditResult =
  | { ok: true; text: string; lenient: boolean }
  | { ok: false; error: string };

// The lines of the closest text in the message of a miss.
const MAX_HINT_LINES = 12;

export function applyEdit(
  raw: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): EditResult {
  if (oldString.length === 0) {
    return { ok: false, error: 'edit_file failed: old_string must not be empty' };
  }
  const matches = countOccurrences(raw, oldString);
  if (matches > 1 && !replaceAll) {
    return {
      ok: false,
      error:
        'edit_file failed: old_string found ' + matches + ' times, provide more context or set replace_all'
    };
  }
  if (matches > 0) {
    // replace_all keeps the dollars literal, a single replace expands the
    // dollar patterns of String.replace: the old rule of the tool.
    const text = replaceAll ? raw.split(oldString).join(newString) : raw.replace(oldString, newString);
    return { ok: true, text, lenient: false };
  }
  return lenientEdit(raw, oldString, newString);
}

function lenientEdit(raw: string, oldString: string, newString: string): EditResult {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const fileLines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
  const wanted = trimEmptyEdges(oldString.replace(/\r/g, '').split('\n'));
  if (wanted.length === 0) {
    return { ok: false, error: 'edit_file failed: old_string has no text, only whitespace' };
  }
  const key = wanted.map(normalize);
  const starts: number[] = [];
  for (let start = 0; start + key.length <= fileLines.length; start++) {
    if (key.every((line, index) => normalize(fileLines[start + index] ?? '') === line)) {
      starts.push(start);
    }
  }
  if (starts.length > 1) {
    return {
      ok: false,
      error:
        'edit_file failed: old_string matches ' +
        starts.length +
        ' places when the whitespace is ignored, provide more context'
    };
  }
  const start = starts[0];
  if (start === undefined) {
    return { ok: false, error: missMessage(fileLines, key) };
  }
  // The indentation of the file wins: the lines of new_string move by the
  // same step that separates old_string from the matched lines.
  const fileIndent = indentOf(fileLines[start] ?? '');
  const oldIndent = indentOf(wanted[0] ?? '');
  const replacement = newString
    .replace(/\r/g, '')
    .split('\n')
    .map((line) =>
      line.trim().length === 0
        ? line.trim()
        : line.startsWith(oldIndent)
          ? fileIndent + line.slice(oldIndent.length)
          : line
    );
  const next = [
    ...fileLines.slice(0, start),
    ...replacement,
    ...fileLines.slice(start + key.length)
  ];
  return { ok: true, text: next.join(eol), lenient: true };
}

// The miss names the window of the file that shares the most lines with
// old_string, the first one on a tie.
function missMessage(fileLines: readonly string[], key: readonly string[]): string {
  let best = -1;
  let bestScore = 0;
  for (let start = 0; start + key.length <= Math.max(fileLines.length, key.length); start++) {
    let score = 0;
    key.forEach((line, index) => {
      if (line.length > 0 && normalize(fileLines[start + index] ?? '') === line) {
        score++;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  if (best === -1) {
    return 'edit_file failed: old_string not found in the file, no line of it is there, read the file again';
  }
  const end = Math.min(fileLines.length, best + Math.min(key.length, MAX_HINT_LINES));
  const lines = fileLines.slice(best, end).map((line, index) => best + index + 1 + ': ' + line);
  return (
    'edit_file failed: old_string not found in the file. The closest text, lines ' +
    (best + 1) +
    '-' +
    end +
    ':\n' +
    lines.join('\n')
  );
}

function normalize(line: string): string {
  return line.trim();
}

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

function trimEmptyEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim().length === 0) {
    start++;
  }
  while (end > start && (lines[end - 1] ?? '').trim().length === 0) {
    end--;
  }
  return lines.slice(start, end);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
