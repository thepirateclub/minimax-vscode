import type { TodoItem } from './state';
import type { Usage } from '../api/types';
import type { ToolRegistry } from '../tools/registry';
import { buildPreview } from '../tools/preview';
import type { DiffPreview } from '../ui/approvals';

// The helpers of the calls of the tools: the guard of the identical calls
// and the preview of a change.
export const MAX_IDENTICAL_CALLS = 3;

// A turn of hundreds of actions told the reader nothing until its end. Every
// PROGRESS_EVERY actions the model is asked for a short note: what is done,
// what is left. The note is text, the panel shows it between the groups of
// the actions, so a long turn reads as steps.
export const PROGRESS_EVERY = 25;

export function progressCheck(before: number, after: number): string | undefined {
  if (Math.floor(after / PROGRESS_EVERY) <= Math.floor(before / PROGRESS_EVERY)) {
    return undefined;
  }
  return (
    '\n\n[Progress check: ' + after + ' actions in this turn. Before the next tool call, write the user 2-4 short lines: ' +
    'what is done, what is left, and whether the plan changed. Then continue the work.]'
  );
}

// The model forgot its list of tasks: the step was done long ago and still
// stood open. After TODO_EVERY actions without todo_write, while a task is
// open, the last result reminds it of the current task.
export const TODO_EVERY = 6;

export function todoCheck(todos: readonly TodoItem[], sinceWrite: number): string | undefined {
  if (sinceWrite < TODO_EVERY) {
    return undefined;
  }
  const done = todos.filter((item) => item.status === 'completed').length;
  const working = todos.find((item) => item.status === 'in_progress');
  if (working) {
    return (
      '\n\n[Task list: ' + done + ' of ' + todos.length + ' done, the current task is "' + working.content + '". ' +
      'If it is finished, mark it completed with todo_write now and set the next task in_progress: the user follows the list.]'
    );
  }
  // No task stands in progress: the reader does not see where the work is.
  const next = todos.find((item) => item.status === 'pending');
  if (!next) {
    return undefined;
  }
  return (
    '\n\n[Task list: ' + done + ' of ' + todos.length + ' done and no task is in_progress. ' +
    'Call todo_write now: mark the finished tasks completed and set the task you work on in_progress, next by priority is "' +
    next.content + '".]'
  );
}

// The notes stood empty after 500 actions: one line of the prompt did not
// make the model write them. After NOTE_EVERY reading actions without a
// note the last result asks it to keep what it found.
export const NOTE_EVERY = 12;

// The tools that only read the project: their results are what a note keeps.
export function isReadingCall(name: string, sideEffect: boolean): boolean {
  return !sideEffect && !name.startsWith('note_') && name !== 'todo_write' && name !== 'get_goal' && name !== 'update_goal';
}

export function noteCheck(sinceNote: number): string | undefined {
  if (sinceNote < NOTE_EVERY) {
    return undefined;
  }
  return (
    '\n\n[Notes: ' + sinceNote + ' reads since your last note. The old results leave the context soon. ' +
    'Keep what you found with note_write now: the facts, the paths with line numbers, the differences, the open questions. ' +
    'One note per topic, for example note_write("dropLoot: web vs native", ...). Then continue.]'
  );
}

export function signatureOf(name: string, input: Record<string, unknown>): string {
  return name + ':' + JSON.stringify(input);
}

// A tool with a side effect that worked makes every answer of a reading tool
// stale: the model reads the file it has just written. Such a call is not a
// loop, so the counters of the reading tools go away. The counters of the
// tools with a side effect stay: a loop of identical writes is exactly what
// the guard is for.
export function forgetReadCalls(counts: Map<string, number>, registry: ToolRegistry): void {
  const writePrefixes = registry
    .list()
    .filter((entry) => entry.sideEffect)
    .map((entry) => entry.name + ':');
  for (const key of [...counts.keys()]) {
    if (!writePrefixes.some((prefix) => key.startsWith(prefix))) {
      counts.delete(key);
    }
  }
}

export function addUsage(total: Usage, part: Usage): Usage {
  return {
    inputTokens: total.inputTokens + part.inputTokens,
    outputTokens: total.outputTokens + part.outputTokens,
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (part.cacheReadTokens ?? 0),
    cacheCreationTokens: (total.cacheCreationTokens ?? 0) + (part.cacheCreationTokens ?? 0)
  };
}

// The change of a file, it is taken before the write. A path outside of the
// workspace throws inside the preview, the action still runs.
export async function previewOf(
  workspaceRoot: string,
  name: string,
  input: Record<string, unknown>
): Promise<DiffPreview | undefined> {
  try {
    return await buildPreview(name, input, workspaceRoot);
  } catch {
    return undefined;
  }
}
