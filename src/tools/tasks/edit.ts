import {
  findTaskCandidates,
  isClosedHeading,
  joinLines,
  parseTasks,
  sectionEnd,
  splitLines
} from './parse';
import type { TaskEdit } from './types';

// The section of the closed tasks. A closed task leaves the open list and
// goes here, it is not thrown away.
const CLOSED_HEADING = '## Closed';

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
