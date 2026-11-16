import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyTaskAction,
  createTaskFileTools,
  findTaskCandidates,
  parseTasks
} from '../../src/tools/tasks';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

function tool(name: string) {
  const entry = createTaskFileTools().find((item) => item.name === name);
  if (!entry) {
    throw new Error('no tool ' + name);
  }
  return entry;
}

async function makeWorkspace(content?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-tasks-'));
  if (content !== undefined) {
    await writeFile(join(root, 'tasks.md'), content, 'utf8');
  }
  return root;
}

describe('the file of the tasks', () => {
  it('reads the tasks of the file with their marks', () => {
    const tasks = parseTasks(
      ['# Tasks', '', '- [ ] T-1 Read the parser', '- [x] Add the tests'].join('\n')
    );
    expect(tasks.length).toBe(2);
    expect(tasks[0]?.id).toBe('T-1');
    expect(tasks[0]?.text).toBe('Read the parser');
    expect(tasks[0]?.done).toBe(false);
    expect(tasks[1]?.done).toBe(true);
  });

  it('finds a task by its id, by its text and by the start of it', () => {
    const tasks = parseTasks(['- [ ] T-1 Read the parser', '- [ ] Add the tests'].join('\n'));
    expect(findTaskCandidates(tasks, 'T-1').length).toBe(1);
    expect(findTaskCandidates(tasks, 'add the tests').length).toBe(1);
    expect(findTaskCandidates(tasks, 'read').length).toBe(1);
    expect(findTaskCandidates(tasks, '').length).toBe(0);
  });

  it('adds a task before the closed section', () => {
    const edit = applyTaskAction(
      ['- [ ] One', '', '## Closed', '', '- [x] Old'].join('\n'),
      'add',
      { title: 'Two' }
    );
    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    const tasks = parseTasks(edit.content);
    expect(tasks.length).toBe(3);
    expect(edit.content.indexOf('Two')).toBeLessThan(edit.content.indexOf('## Closed'));
  });

  it('marks a task as done', () => {
    const edit = applyTaskAction('- [ ] Read the parser\n', 'complete', {
      task: 'Read the parser'
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    expect(parseTasks(edit.content)[0]?.done).toBe(true);
  });

  it('closes a task, it leaves the open list', () => {
    const edit = applyTaskAction('- [ ] Read the parser\n', 'close', {
      task: 'Read the parser'
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    expect(edit.content).toContain('## Closed');
    const tasks = parseTasks(edit.content);
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.done).toBe(true);
  });

  it('asks when the text fits more than one task', () => {
    const edit = applyTaskAction(
      '- [ ] Read the parser\n- [ ] Read the writer\n',
      'complete',
      { task: 'Read' }
    );
    expect(edit.ok).toBe(false);
    if (edit.ok) {
      return;
    }
    expect(edit.error).toContain('more than one');
  });

  it('refuses an unknown action and an empty title', () => {
    expect(applyTaskAction('', 'destroy', {}).ok).toBe(false);
    expect(applyTaskAction('', 'add', {}).ok).toBe(false);
  });
});

describe('the tools of the file of the tasks', () => {
  it('reads the file of the project without a confirmation', () => {
    const entries = createTaskFileTools();
    const read = entries.find((item) => item.name === 'tasks_read');
    const update = entries.find((item) => item.name === 'tasks_update');
    expect(read?.approval).toBe('never');
    expect(read?.sideEffect).toBe(false);
    expect(update?.approval).toBe('always');
    expect(update?.sideEffect).toBe(true);
  });

  it('reads the tasks of the project', async () => {
    const root = await makeWorkspace('- [ ] Read the parser\n');
    const result = await tool('tasks_read').execute({}, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Read the parser');
    expect(result.content).toContain('tasks.md');
  });

  it('writes the file of the tasks and reads it back', async () => {
    const root = await makeWorkspace('- [ ] Read the parser\n');
    const added = await tool('tasks_update').execute(
      { action: 'add', title: 'Add the tests', id: 'T-2' },
      makeContext(root)
    );
    expect(added.isError).toBeFalsy();
    const content = await readFile(join(root, 'tasks.md'), 'utf8');
    expect(content).toContain('- [ ] T-2 Add the tests');
    const done = await tool('tasks_update').execute(
      { action: 'complete', task: 'T-2' },
      makeContext(root)
    );
    expect(done.isError).toBeFalsy();
    const after = await readFile(join(root, 'tasks.md'), 'utf8');
    expect(after).toContain('- [x] T-2 Add the tests');
  });

  it('creates the file of the tasks when it does not exist', async () => {
    const root = await makeWorkspace();
    const added = await tool('tasks_update').execute(
      { action: 'add', title: 'Read the parser' },
      makeContext(root)
    );
    expect(added.isError).toBeFalsy();
    const content = await readFile(join(root, 'tasks.md'), 'utf8');
    expect(content).toContain('- [ ] Read the parser');
  });

  it('refuses a file outside the workspace', async () => {
    const root = await makeWorkspace('- [ ] One\n');
    const result = await tool('tasks_update').execute(
      { action: 'add', title: 'Two', file: '../outside.md' },
      makeContext(root)
    );
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('outside');
  });
});
