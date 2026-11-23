import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { resolveWorkspacePath } from '../../paths';
import { parseTasks } from './parse';

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

export const MAX_FILE_CHARS = 30_000;

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

export function summary(content: string, display: string): string {
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
