import type { TaskLine } from './types';

// The id of a task is a short mark at the start of the text. The rest of the
// text is the task itself.
const ID_PATTERN = /^([A-Za-z]{0,8}[-_]?\d+)\s*[:.)\-]?\s+(.*)$/;

// The task of the file is a line with a mark of a checklist.
const TASK_PATTERN = /^(\s*[-*]\s*\[( |x|X)\]\s*)(.*)$/;

export function parseTasks(content: string): TaskLine[] {
  const tasks: TaskLine[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    const match = TASK_PATTERN.exec(raw);
    if (!match) {
      continue;
    }
    const prefix = match[1] ?? '';
    const rest = (match[3] ?? '').trim();
    if (rest.length === 0) {
      continue;
    }
    const idMatch = ID_PATTERN.exec(rest);

    const id = idMatch ? (idMatch[1] ?? '') : '';
    const text = idMatch ? (idMatch[2] ?? '').trim() : rest;
    tasks.push({
      line: index,
      id,
      text,
      label: rest,
      done: (match[2] ?? ' ').toLowerCase() === 'x',
      prefix,
      raw
    });
  }
  return tasks;
}

// The task the model means: by its id, by its whole text or by the start of
// its text. The ambiguous answer is not a guess, the tool asks.
export function findTaskCandidates(
  tasks: TaskLine[],
  needle: string
): TaskLine[] {
  const query = needle.trim().toLowerCase();
  if (query.length === 0) {
    return [];
  }
  const byId = tasks.filter(
    (task) => task.id.length > 0 && task.id.toLowerCase() === query
  );
  if (byId.length > 0) {
    return byId;
  }
  const exact = tasks.filter((task) => task.text.toLowerCase() === query);
  if (exact.length > 0) {
    return exact;
  }
  // The whole line of the task, the id lives in it.
  const labelled = tasks.filter((task) => task.label.toLowerCase() === query);
  if (labelled.length > 0) {
    return labelled;
  }
  return tasks.filter((task) => task.text.toLowerCase().startsWith(query));
}

export function isClosedHeading(line: string): boolean {
  return /^##\s+closed\s*$/i.test(line.trim());
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

// The end of a section: the next heading of the file or the end of it.
export function sectionEnd(lines: string[], from: number): number {
  for (let index = from; index < lines.length; index++) {
    if (isHeading(lines[index] ?? '')) {
      return index;
    }
  }
  return lines.length;
}

// The lines of the file without the empty tail, the tail comes back at the
// end: a file of a project ends with a newline.
export function splitLines(content: string): { lines: string[]; tail: number } {
  const lines = content.split(/\r?\n/);
  let tail = 0;
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim().length === 0) {
    lines.pop();
    tail += 1;
  }
  return { lines, tail };
}

export function joinLines(lines: string[]): string {
  return lines.join('\n') + '\n';
}
