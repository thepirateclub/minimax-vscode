export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

const MAX_MATRIX_CELLS = 4_000_000;
const CONTEXT_LINES = 3;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.length === 0 ? [] : oldText.replace(/\n$/, '').split('\n');
  const newLines = newText.length === 0 ? [] : newText.replace(/\n$/, '').split('\n');

  if (oldLines.length === 0 && newLines.length === 0) {
    return [];
  }
  if (oldLines.length * newLines.length > MAX_MATRIX_CELLS) {
    return fallbackDiff(oldText, newText);
  }

  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0)
  );
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      const row = table[i]!;
      const nextRow = table[i + 1]!;
      row[j] =
        oldLines[i] === newLines[j]
          ? nextRow[j + 1]! + 1
          : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'context', oldLine: i + 1, newLine: j + 1, text: oldLines[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      result.push({ type: 'remove', oldLine: i + 1, text: oldLines[i]! });
      i++;
    } else {
      result.push({ type: 'add', newLine: j + 1, text: newLines[j]! });
      j++;
    }
  }
  while (i < oldLines.length) {
    result.push({ type: 'remove', oldLine: i + 1, text: oldLines[i]! });
    i++;
  }
  while (j < newLines.length) {
    result.push({ type: 'add', newLine: j + 1, text: newLines[j]! });
    j++;
  }
  return trimContext(result, CONTEXT_LINES);
}

function trimContext(lines: DiffLine[], context: number): DiffLine[] {
  const keep = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (line.type === 'context') {
      continue;
    }
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let i = from; i <= to; i++) {
      keep.add(i);
    }
  }
  return lines.filter((_, index) => keep.has(index));
}

function fallbackDiff(oldText: string, newText: string): DiffLine[] {
  const result: DiffLine[] = [];
  for (const [index, text] of oldText.split('\n').entries()) {
    result.push({ type: 'remove', oldLine: index + 1, text });
  }
  for (const [index, text] of newText.split('\n').entries()) {
    result.push({ type: 'add', newLine: index + 1, text });
  }
  return result;
}
