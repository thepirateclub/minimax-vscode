import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TODO_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('gives the older part of the chat to the panel on demand', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    const messages = Array.from({ length: 200 }, (_, index) => ({
      id: 'm' + index,
      role: 'assistant' as const,
      text: 'line ' + index
    }));
    state.globalState.set('minimax.sessions', [
      {
        id: 's-long',
        title: 'Long chat',
        updatedAt: 5,
        messages: [],
        uiMessages: messages,
        usage: []
      }
    ]);
    state.globalState.set('minimax.activeSession', 's-long');
    await boot();

    const init = ofType('init')[0]!;
    // The panel gets the tail of the chat, the older part waits in the
    // host: a big chat in one message is slow to transfer and to draw.
    expect(init.state.messages).toHaveLength(120);
    expect(init.state.olderMessages).toBe(80);

    state.posted.length = 0;
    state.receive?.({ type: 'load_older' });
    await vi.waitFor(() => {
      expect(ofType('history_older').length).toBe(1);
    });
    const page = ofType('history_older')[0]!;
    expect(page.messages).toHaveLength(80);
    expect(page.messages[0]?.id).toBe('m0');
    expect(page.olderMessages).toBe(0);
  });

  it('never keeps an active session that the state of the host does not know', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    const activeId = state.globalState.get('minimax.activeSession') as string | undefined;
    const stored =
      (state.globalState.get('minimax.sessions') as Array<{ id: string }> | undefined) ?? [];
    expect(activeId === undefined || stored.some((item) => item.id === activeId)).toBe(true);
  });

  it('remembers the active session after a turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await waitForState(() => {
      const activeId = state.globalState.get('minimax.activeSession') as string | undefined;
      const stored =
        (state.globalState.get('minimax.sessions') as Array<{ id: string }> | undefined) ?? [];
      expect(activeId).toBeDefined();
      expect(stored.map((item) => item.id)).toContain(activeId);
    });
  });

  it('does not leave a deleted session active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.globalState.set('minimax.sessions', [
      { id: 's-old', title: 'Old chat', updatedAt: 5, messages: [], uiMessages: [], usage: [] }
    ]);
    state.globalState.set('minimax.activeSession', 's-old');
    await boot();

    state.receive?.({ type: 'delete_session', id: 's-old' });

    const activeId = state.globalState.get('minimax.activeSession') as string | undefined;
    const stored =
      (state.globalState.get('minimax.sessions') as Array<{ id: string }> | undefined) ?? [];
    expect(activeId).not.toBe('s-old');
    expect(activeId === undefined || stored.some((item) => item.id === activeId)).toBe(true);
  });

  it('tells the panel how long the step took', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('step_time').length).toBe(1);
    });
    expect(ofType('step_time')[0]?.elapsedMs ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('rolls the chat back to a request and puts it into the input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const userId = ofType('user_message')[0]?.id ?? '';
    expect(userId.length).toBeGreaterThan(0);
    // The turn is over when the anchor of the request is in the state.
    await waitForState(() => {
      const stored =
        (state.globalState.get('minimax.sessions') as
          | Array<{ turns?: unknown[] }>
          | undefined) ?? [];
      expect(stored[0]?.turns?.length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'rewind', id: userId });
    await waitForState(() => {
      expect(ofType('session_loaded').length).toBe(1);
    });
    // The chat went back to the request, the answer of the model is gone.
    expect(ofType('session_loaded')[0]!.messages).toHaveLength(0);
    // The request comes back to the input field, the agent waits for it.
    expect(ofType('restore_input').length).toBe(1);
    expect(ofType('restore_input')[0]?.text).toBe('first question');
    expect(ofType('user_message').length).toBe(0);
    expect(ofType('text_delta').length).toBe(0);
  });

  it('runs the request again when the request is repeated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const userId = ofType('user_message')[0]?.id ?? '';

    state.posted.length = 0;
    state.receive?.({ type: 'retry', id: userId });
    await waitForState(() => {
      expect(ofType('user_message').length).toBe(1);
    });
    expect(ofType('user_message')[0]?.text).toBe('first question');
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
  });

  it('keeps the list of the tasks of the model in the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TODO_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });

    await waitForState(() => {
      expect(ofType('todos').length).toBe(1);
    });
    expect(ofType('todos')[0]!.todos).toEqual([
      { content: 'Read the parser', status: 'pending', priority: 'high' }
    ]);
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        todos?: unknown[];
      }>;
      expect(stored[0]?.todos).toEqual([
        { content: 'Read the parser', status: 'pending', priority: 'high' }
      ]);
    });
  });
});
