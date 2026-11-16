import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { resolveWorkspacePath } from '../paths';
import type { ToolEntry, ToolExecutionResult } from './types';

// The files the projects keep their tasks in. The first one that exists is
// the file of the project, the model can name another file.
const TASK_FILES = [
  'tasks.md',
  'TASKS.md',
  'Tasks.md',
  'TODO.md',
  'todo.md',
  'docs/tasks.md',
  'docs/TASKS.md',
  'docs/todo.md',
  '.tasks.md'
];

// The section of the closed tasks. A closed task leaves the open list and
// goes here, it is not thrown away.
const CLOSED_HEADING = '## Closed';

const MAX_FILE_CHARS = 30_000;

export interface TaskLine {
  // The number of the line in the file.
  line: number;
  // The id of the task, it is the first word of the text when it looks like
  // an id, for example T-12 or 7.
  id: string;
  // The text of the task without its id.
  text: string;
  // The whole text of the line, the id lives in it.
  label: string;
  done: boolean;
  // The part of the line before the text, the bullet and the mark.
  prefix: string;
  raw: string;
}

export type TaskEdit =
  | { ok: true; content: string; message: string }
  | { ok: false; error: string };

function failure(message: string): ToolExecutionResult {
  return { content: message, isError: true };
}

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
  if (exact.length > 0) {
    return exact;
  }
  return tasks.filter((task) => task.text.toLowerCase().startsWith(query));
}

function isClosedHeading(line: string): boolean {
  return /^##\s+closed\s*$/i.test(line.trim());
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

// The end of a section: the next heading of the file or the end of it.
function sectionEnd(lines: string[], from: number): number {
  for (let index = from; index < lines.length; index++) {
    if (isHeading(lines[index] ?? '')) {
      return index;
    }
  }
  return lines.length;
}

// The lines of the file without the empty tail, the tail comes back at the
// end: a file of a project ends with a newline.
function splitLines(content: string): { lines: string[]; tail: number } {
  const lines = content.split(/\r?\n/);
  let tail = 0;
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim().length === 0) {
    lines.pop();
    tail += 1;
  }
  return { lines, tail };
}

function joinLines(lines: string[]): string {
  return lines.join('\n') + '\n';
}

// The change of the file of the tasks. The function is pure: it takes the
// text and gives the new text, the tests do not need a file for it.
export function applyTaskAction(
  content: string,
  action: string,
  options: { title?: string; task?: string; id?: string }
): TaskEdit {
  const { lines } = splitLines(content);
  const tasks = parseTasks(content);

  if (action === 'add') {
    const title = (options.title ?? '').trim();
    if (title.length === 0) {
      return { ok: false, error: 'tasks_update failed: title must not be empty' };
    }
    const id = (options.id ?? '').trim();
    const text = id.length > 0 ? id + ' ' + title : title;
    const entry = '- [ ] ' + text;
    const closed = lines.findIndex(isClosedHeading);
    if (closed >= 0) {
      // The open tasks live before the closed section.
      let at = closed;
      while (at > 0 && (lines[at - 1] ?? '').trim().length === 0) {
        at -= 1;
      }
      lines.splice(at, 0, entry);
    } else {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push(entry);
    }
    return { ok: true, content: joinLines(lines), message: 'added the task: ' + text };
  }

  const needle = (options.task ?? '').trim();
  if (needle.length === 0) {
    return { ok: false, error: 'tasks_update failed: task must not be empty' };
  }
  const found = findTaskCandidates(tasks, needle);
  if (found.length === 0) {
    return {
      ok: false,
      error:
        'tasks_update failed: the task "' +
        needle +
        '" is not in the file of the tasks'
    };
  }
  if (found.length > 1) {
    const list = found.map((task) => task.text).join(', ');
    return {
      ok: false,
      error:
        'tasks_update failed: the task "' +
        needle +
        '" matches more than one task: ' +
        list
    };
  }
  const task = found[0]!;

  if (action === 'complete') {
    lines[task.line] = task.prefix.replace(/\[( |x|X)\]/, '[x]') + task.label;
    return {
      ok: true,
      content: joinLines(lines),
      message: 'the task is done: ' + task.text
    };
  }

  if (action === 'close') {
    lines.splice(task.line, 1);
    const closedLine = '- [x] ' + task.label;
    const closed = lines.findIndex(isClosedHeading);
    if (closed < 0) {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push(CLOSED_HEADING, '', closedLine);
    } else {
      const end = sectionEnd(lines, closed + 1);
      let at = end;
      while (at > closed + 1 && (lines[at - 1] ?? '').trim().length === 0) {
        at -= 1;
      }
      lines.splice(at, 0, closedLine);
    }
    return {
      ok: true,
      content: joinLines(lines),
      message: 'the task is closed: ' + task.text
    };
  }

  if (action === 'update') {
    const title = (options.title ?? '').trim();
    if (title.length === 0) {
      return { ok: false, error: 'tasks_update failed: title must not be empty' };
    }
    lines[task.line] = task.prefix + title;
    return {
      ok: true,
      content: joinLines(lines),
      message: 'the task is changed: ' + title
    };
  }

  if (action === 'remove') {
    lines.splice(task.line, 1);
    return {
      ok: true,
      content: joinLines(lines),
      message: 'the task is removed: ' + task.text
    };
  }

  return {
    ok: false,
    error:
      'tasks_update failed: the action must be add, complete, close, update or remove'
  };
}

// The file of the tasks of the project. The model can name another file, it
// has to stay inside the workspace.
export async function resolveTaskFile(
  workspaceRoot: string,
  candidate: unknown
): Promise<{ path: string; display: string } | { error: string }> {
  const raw = typeof candidate === 'string' ? candidate.trim() : '';
  if (raw.length > 0) {
    let path: string;
    try {
      path = resolveWorkspacePath(workspaceRoot, raw);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      path,
      display: relative(workspaceRoot, path).split(/[\\/]/).join('/')
    };
  }
  for (const name of TASK_FILES) {
    const path = resolveWorkspacePath(workspaceRoot, name);
    try {
      await readFile(path, 'utf8');
      return { path, display: name };
    } catch {
      // The file does not exist, the next one is tried.
    }
  }
  return {
    path: resolveWorkspacePath(workspaceRoot, TASK_FILES[0] as string),
    display: TASK_FILES[0] as string
  };
}

function summary(content: string, display: string): string {
  const tasks = parseTasks(content);
  const open = tasks.filter((task) => !task.done);
  const done = tasks.length - open.length;
  const lines = [
    'file: ' + display,
    'open tasks: ' + open.length + ', done tasks: ' + done
  ];
  for (const task of open) {
    lines.push('- [ ] ' + (task.id.length > 0 ? task.id + ' ' : '') + task.text);
  }
  return lines.join('\n');
}

export function createTaskFileTools(): ToolEntry[] {
  const tasksRead: ToolEntry = {
    name: 'tasks_read',
    description:
      'Read the file of the tasks of the project: the open tasks and the closed ones. The file is tasks.md, TASKS.md, TODO.md or docs/tasks.md, the tool finds it, another file can be named with the file argument.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description:
            'The file of the tasks, relative to the workspace root. The file of the project is used when it is empty.'
        }
      }
    },
    async execute(input, ctx) {
      const target = await resolveTaskFile(ctx.workspaceRoot, input['file']);
      if ('error' in target) {
        return failure(target.error);
      }
      let content: string;
      try {
        content = await readFile(target.path, 'utf8');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(
          'The file of the tasks cannot be read: ' + target.display + ': ' + reason
        );
      }
      const head =
        content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + '\n[the file is cut, it is too long]'
          : content;
      return { content: summary(content, target.display) + '\n\n' + head };
    }
  };

  const tasksUpdate: ToolEntry = {
    name: 'tasks_update',
    description:
      'Change the file of the tasks of the project. Use it while the work goes: add a task when the plan starts, mark it as done when it is done (complete), move it to the closed section when it is dropped (close), change its text (update) or remove it. The status of the tasks is updated as the work goes, not at the end of it.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'complete', 'close', 'update', 'remove'],
          description: 'What to do with the file of the tasks.'
        },
        task: {
          type: 'string',
          description:
            'The id or the text of the task to change. The tool asks when the text fits more than one task.'
        },
        title: {
          type: 'string',
          description: 'The text of the new task or of the changed task.'
        },
        id: {
          type: 'string',
          description: 'The id of the new task, for example T-12.'
        },
        file: {
          type: 'string',
          description:
            'The file of the tasks, relative to the workspace root. The file of the project is used when it is empty.'
        }
      },
      required: ['action']
    },
    async execute(input, ctx) {
      const action = String(input['action'] ?? '').trim().toLowerCase();
      const target = await resolveTaskFile(ctx.workspaceRoot, input['file']);
      if ('error' in target) {
        return failure(target.error);
      }
      let content = '';
      try {
        content = await readFile(target.path, 'utf8');
      } catch {
        // The file does not exist yet. A new task creates it, the other
        // actions have nothing to change.
        if (action !== 'add') {
          return failure(
            'The file of the tasks does not exist: ' + target.display
          );
        }
      }
      const edit = applyTaskAction(content, action, {
        title: typeof input['title'] === 'string' ? input['title'] : undefined,
        task: typeof input['task'] === 'string' ? input['task'] : undefined,
        id: typeof input['id'] === 'string' ? input['id'] : undefined
      });
      if (!edit.ok) {
        return failure(edit.error);
      }
      try {
        await mkdir(dirname(target.path), { recursive: true });
        await writeFile(target.path, edit.content, 'utf8');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(
          'The file of the tasks cannot be written: ' +
            target.display +
            ': ' +
            reason
        );
      }
      return {
        content:
          edit.message +
          '\nfile: ' +
          target.display +
          '\n' +
          summary(edit.content, target.display)
      };
    }
  };

  return [tasksRead, tasksUpdate];
}
