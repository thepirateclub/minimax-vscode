import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

vi.mock('vscode', async () => (await import('../helpers/vscodeMock')).vscodeMock());

const run = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await run('git', ['-C', root, ...args], { windowsHide: true });
  return result.stdout;
}

// The answer of the model with one call of a tool.
function toolSse(id: string, name: string, input: Record<string, unknown>): string {
  return [
    'event: content_block_start\ndata: ' +
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id, name, input: {} }
      }) +
      '\n\n',
    'event: content_block_delta\ndata: ' +
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) }
      }) +
      '\n\n',
    'event: message_delta\ndata: ' +
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 9 }
      }) +
      '\n\n',
    'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n'
  ].join('');
}

// A repository with one file and a folder that git does not see.
async function makeRepo(ignore: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-panel-'));
  await git(root, 'init');
  await git(root, 'config', 'user.email', 'agent@example.com');
  await git(root, 'config', 'user.name', 'Agent');
  await git(root, 'config', 'commit.gpgsign', 'false');
  if (ignore) {
    await writeFile(join(root, '.gitignore'), 'work/\n', 'utf8');
  }
  await writeFile(join(root, 'tracked.ts'), 'const t = 1;\n', 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'feat: first commit');
  return root;
}

// The agent writes, changes and deletes a file, the reader sees the list.
async function runAgent(root: string, calls: Array<[string, Record<string, unknown>]>): Promise<void> {
  state.config.set('root', root);
  state.secrets.set('minimax.apiKey', 'test-key');
  for (const [index, [name, input]] of calls.entries()) {
    state.responses.push(toolSse('t' + index, name, input));
  }
  state.responses.push(TEXT_SSE);

  await boot();
  state.receive?.({
    type: 'send',
    text: 'change the files',
    mentions: [],
    selections: []
  });

  for (const [name] of calls) {
    await waitForState(() => {
      const cards = ofType('approval_request').filter((message) => message.approval.name === name);
      expect(cards.length).toBe(1);
    });
    const card = ofType('approval_request')
      .filter((message) => message.approval.name === name)
      .pop()!.approval;
    state.receive?.({ type: 'approve', id: card.id, allowForSession: false });
  }

  await waitForState(() => {
    expect(ofType('summary').length).toBeGreaterThan(0);
  });
}

function statusOf(files: Array<{ path: string; status: string }>, path: string): string | undefined {
  return files.find((file) => file.path === path)?.status;
}

describe('the list of the changed files', () => {
  beforeEach(() => {
    state.commands.clear();
    state.viewProviders.clear();
    state.config.clear();
    state.workspaceConfig.clear();
    state.secrets.clear();
    state.globalState.clear();
    state.posted = [];
    state.fetched = [];
    state.headers = [];
    state.bodies = [];
    state.responses = [];
    state.editor = undefined;
    state.documents.length = 0;
    state.files.length = 0;
    state.failState = false;
    state.receive = undefined;
    state.progressCancel = undefined;
    state.warningAnswer = undefined;
    state.warningCalls.length = 0;
    state.theme = 2;
    state.themeListener = undefined;
    state.opened.length = 0;
    state.shown.length = 0;
    state.holdResponse = undefined;
    stubFetch(state.responses, {
      fetched: state.fetched,
      headers: state.headers,
      bodies: state.bodies
    });
  });

  it('names the added, the changed and the deleted files', async () => {
    const root = await makeRepo(false);
    await writeFile(join(root, 'old.ts'), 'const b = 1;\n', 'utf8');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'feat: second commit');

    await runAgent(root, [
      ['write_file', { path: 'new.ts', content: 'const c = 1;\n' }],
      [
        'edit_file',
        { path: 'tracked.ts', old_string: 'const t = 1;', new_string: 'const t = 2;' }
      ],
      ['delete_files', { path: 'old.ts' }]
    ]);

    const files = ofType('summary').pop()!.files;
    expect(statusOf(files, 'new.ts')).toBe('added');
    expect(statusOf(files, 'tracked.ts')).toBe('modified');
    expect(statusOf(files, 'old.ts')).toBe('deleted');
  });

  it('names the files the repository does not show', async () => {
    const root = await makeRepo(true);
    await mkdir(join(root, 'work'), { recursive: true });
    await writeFile(join(root, 'work', 'kept.ts'), 'const k = 1;\n', 'utf8');

    await runAgent(root, [
      ['write_file', { path: 'work/added.ts', content: 'const c = 1;\n' }],
      [
        'edit_file',
        {
          path: 'work/kept.ts',
          old_string: 'const k = 1;',
          new_string: 'const k = 2;'
        }
      ],
      ['delete_files', { path: 'tracked.ts' }]
    ]);

    const files = ofType('summary').pop()!.files;
    // The deletion reaches the panel: a deleted file stays in the state of
    // the repository. The added and the changed file do not: the repository
    // does not see the folder that git ignores.
    expect(statusOf(files, 'tracked.ts')).toBe('deleted');
    expect(statusOf(files, 'work/added.ts')).toBe('added');
    expect(statusOf(files, 'work/kept.ts')).toBe('modified');
  });
});
