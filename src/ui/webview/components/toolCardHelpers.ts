
// The helpers of the description of a card of an action.
import { text } from '../value';

export { text };

export function filePaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const single = input['path'];
  if (typeof single === 'string' && single.length > 0) {
    paths.push(single);
  }
  const many = input['paths'];
  if (Array.isArray(many)) {
    for (const item of many) {
      if (typeof item === 'string' && item.length > 0) {
        paths.push(item);
      }
    }
  }
  return paths;
}

export function countLines(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  return value.split('\n').filter((line) => line.trim().length > 0).length;
}

export function firstLine(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const line = value.split('\n')[0] ?? '';
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

// The range of a read stands in the title, the reader sees which lines the
// agent has taken.
export function readRange(input: Record<string, unknown>): string {
  const start = Number(input['start_line']);
  const end = Number(input['end_line']);
  const hasStart = Number.isFinite(start) && start >= 1;
  const hasEnd = Number.isFinite(end) && end >= 1;
  if (!hasStart && !hasEnd) {
    return '';
  }
  const first = hasStart ? Math.floor(start) : 1;
  if (!hasEnd) {
    return first + '+';
  }
  const last = Math.floor(end);
  return first === last ? String(first) : first + '-' + last;
}
