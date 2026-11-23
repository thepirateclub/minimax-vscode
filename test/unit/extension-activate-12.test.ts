import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TODO_SSE, taskSse, writeSse, stubFetch, boot, ofType } from '../helpers/extensionHarness';

vi.mock('vscode', async () => (await import('../helpers/vscodeMock')).vscodeMock());

describe('extension activation', () => {
  beforeEach(() => {
    state.commands.clear();
    state.viewProviders.clear();
    state.config.clear();
    state.workspaceConfig.clear();
    state.secrets.clear();
    state.globalState.clear();
    state.posted = [];
    // Every test has its own answers and its own log of the network. The
    // controller of the previous test keeps the stub it was built with, a
    // late request of it cannot take the answer of this test.
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

  it('the permission of a child stays in the chat of the child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The parent starts a worker, the child asks to write a file. The same
    // happens in the second chat and once more in the first one.
    state.responses.push(
      taskSse('worker', 'write a note'),
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      TEXT_SSE,
      TEXT_SSE,
      taskSse('worker', 'write in the other chat'),
      writeSse('toolu_1', 'other.txt', 'written in the other chat'),
      TEXT_SSE,
      TEXT_SSE,
      taskSse('worker', 'write once more'),
      writeSse('toolu_1', 'third.txt', 'written once more'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();

    const first = ofType('init')[0]!.state.activeSessionId;
    expect(first).toBeDefined();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'let the worker write',
      mentions: [],
      selections: []
    });

    // The child asks the reader for a permission.
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    expect(approval.id.startsWith('child-')).toBe(true);

    // The reader switches to another chat and answers there.
    state.receive?.({ type: 'new_session' });
    await waitForState(() => {
      expect(ofType('init').length).toBeGreaterThan(0);
    });
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: true });

    // The child writes the file, the answer of the reader was heard.
    await waitForState(async () => {
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the agent');
    });

    // The other chat has no permission, the child of it asks again.
    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'let the worker write here too',
      mentions: [],
      selections: []
    });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const other = ofType('approval_request')[0]!.approval;
    expect(other.id.startsWith('child-')).toBe(true);
    state.receive?.({ type: 'approve', id: other.id, allowForSession: false });
    await waitForState(async () => {
      expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe(
        'written in the other chat'
      );
    });

    // The permission stayed in the first chat, the child of it writes
    // without a question.
    state.posted.length = 0;
    state.receive?.({ type: 'select_session', id: first! });
    state.receive?.({
      type: 'send',
      text: 'let the worker write once more',
      mentions: [],
      selections: []
    });
    await waitForState(async () => {
      expect(await readFile(join(root, 'third.txt'), 'utf8')).toBe('written once more');
    });
    expect(ofType('approval_request').length).toBe(0);
  });

  it('the card of an approval stays in the chat that asked for it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The parent writes the tasks, starts a worker, the child asks for a
    // write of its own.
    state.responses.push(
      TODO_SSE,
      taskSse('worker', 'write a note'),
      writeSse('toolu_1', 'note.txt', 'written by the child'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();
    const first = ofType('init')[0]!.state.activeSessionId;

    state.receive?.({
      type: 'send',
      text: 'let the worker write',
      mentions: [],
      selections: []
    });
    // The list of the tasks is written without a question, the child asks
    // for the write next.
    await waitForState(() => {
      expect(ofType('tool_end').some((message) => message.name === 'todo_write')).toBe(true);
    });

    // The reader opens another chat while the child waits for the answer.
    state.receive?.({ type: 'new_session' });
    await waitForState(() => {
      expect(ofType('init').length).toBeGreaterThan(1);
    });
    state.posted.length = 0;
    await waitForState(() => {
      expect(state.bodies.length).toBeGreaterThanOrEqual(3);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The card of the child did not land in the open chat.
    expect(ofType('approval_request')).toHaveLength(0);

    // Back in the chat that asked, the card is there and answers the turn.
    state.receive?.({ type: 'select_session', id: first! });
    await waitForState(() => {
      const loaded = ofType('session_loaded').at(-1);
      expect(loaded?.messages.some((message) => message.approval)).toBe(true);
    });
    const card = ofType('session_loaded')
      .at(-1)!
      .messages.find((message) => message.approval)!;
    state.receive?.({ type: 'approve', id: card.approval!.id, allowForSession: false });
    await waitForState(async () => {
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the child');
    });

    // The card does not go to the disk: a restored chat must not show a
    // question whose turn is gone.
    await waitForState(() => {
      expect(ofType('status').at(-1)?.state).toBe('idle');
    });
    const stored = state.globalState.get('minimax.sessions') as Array<{
      id: string;
      uiMessages?: Array<{ approval?: unknown }>;
    }>;
    const saved = stored.find((item) => item.id === first);
    expect(saved?.uiMessages?.some((message) => message.approval)).toBeFalsy();
  });
});
