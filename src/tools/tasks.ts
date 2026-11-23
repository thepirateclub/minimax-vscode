import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolEntry, ToolExecutionResult } from './types';
import { applyTaskAction } from './tasks/edit';
import { MAX_FILE_CHARS, resolveTaskFile, summary } from './tasks/file';

export { applyTaskAction } from './tasks/edit';
export { resolveTaskFile } from './tasks/file';
export { findTaskCandidates, parseTasks } from './tasks/parse';
export type { TaskEdit, TaskLine } from './tasks/types';

function failure(message: string): ToolExecutionResult {
  return { content: message, isError: true };
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
