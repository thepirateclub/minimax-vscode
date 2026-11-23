import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TODO_SSE, writeSse, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('the card of an approval leaves the chat when the turn is cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(writeSse('toolu_1', 'note.txt', 'written by the agent'), TEXT_SSE);
    // A cancelled turn never reaches the server, the request dies on the wire.
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new Error('This operation was aborted');
        }
        return await base(url, init);
      })
    );
    try {
      await boot();
      state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
      await waitForState(() => {
        expect(ofType('approval_request').length).toBe(1);
      });
      const approval = ofType('approval_request')[0]!.approval;

      // The reader cancels the work in the window of the editor, not with
      // the Stop button of the panel.
      state.progressCancel?.();
      await waitForState(() => {
        expect(ofType('status').at(-1)?.state).toBe('idle');
      });

      // The card left the chat with the answer that never comes.
      expect(
        ofType('approval_resolved').some((message) => message.id === approval.id)
      ).toBe(true);
      expect(
        ofType('notice').some((message) => message.message.includes('stopped'))
      ).toBe(true);
      // The answer of the server was never asked for.
      expect(state.responses.length).toBe(1);
      // The dead card did not go to the disk with the chat.
      await waitForState(() => {
        const stored = state.globalState.get('minimax.sessions') as Array<{
          uiMessages?: Array<{ approval?: unknown }>;
        }>;
        expect(stored.length).toBeGreaterThan(0);
        for (const session of stored) {
          expect(session.uiMessages?.some((message) => message.approval)).toBeFalsy();
        }
      });
    } finally {
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('keeps the events of a chat in the background out of the open chat', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The first chat writes a file, then the tasks, then it answers.
    state.responses.push(
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      TODO_SSE,
      TEXT_SSE
    );
    await boot();
    const first = ofType('init')[0]!.state.activeSessionId;

    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;

    // The reader opens another chat while the first one waits.
    state.receive?.({ type: 'new_session' });
    await waitForState(() => {
      expect(ofType('init').length).toBeGreaterThan(1);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });
    await waitForState(async () => {
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the agent');
    });
    await waitForState(() => {
      expect(state.responses.length).toBe(0);
    });
    // The tasks and the text of the first chat did not land in the open one.
    expect(ofType('todos').filter((message) => message.todos.length > 0)).toHaveLength(0);
    expect(ofType('text_delta')).toHaveLength(0);
    expect(ofType('tool_start')).toHaveLength(0);

    // Back in the first chat everything is there.
    state.receive?.({ type: 'select_session', id: first! });
    await waitForState(() => {
      const init = ofType('init').at(-1);
      expect(init?.state.activeSessionId).toBe(first);
      expect(init?.state.todos.length).toBeGreaterThan(0);
    });
  });

  it('the status of the open chat ignores a chat that runs in the background', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The first chat writes a file and answers while another chat is open.
    state.responses.push(
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      TEXT_SSE
    );
    await boot();

    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;

    // The reader opens another chat, the first one keeps working.
    state.receive?.({ type: 'new_session' });
    await waitForState(() => {
      expect(ofType('init').length).toBeGreaterThan(1);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });
    await waitForState(() => {
      expect(state.responses.length).toBe(0);
    });
    // The dot of the open chat stayed idle, the work of the background
    // chat did not flip it.
    expect(ofType('status')).toHaveLength(0);
  });

  it('the opened busy chat shows its state and the stop ends its turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      TEXT_SSE
    );
    await boot();
    const first = ofType('init')[0]!.state.activeSessionId;

    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });

    // The reader opens another chat and comes back to the busy one.
    state.receive?.({ type: 'new_session' });
    await waitForState(() => {
      expect(ofType('init').length).toBeGreaterThan(1);
    });
    state.receive?.({ type: 'select_session', id: first! });
    // The opened chat brought its busy state, the stop button stands in
    // the field.
    await waitForState(() => {
      expect(ofType('status').at(-1)?.state).toBe('thinking');
    });

    state.receive?.({ type: 'stop' });
    // The turn was stopped, the chat is idle again and the answer of the
    // server is not waited for.
    await waitForState(() => {
      expect(ofType('status').at(-1)?.state).toBe('idle');
    });
    await waitForState(() => {
      expect(state.responses.length).toBe(0);
    });
  });
});
