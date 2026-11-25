import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TOOL_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('keeps the message in the queue while the agent works', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push('HOLD', TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(1);
    });

    // The agent works, the next message waits in the queue.
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('queue').length).toBeGreaterThan(0);
    });
    const queue = ofType('queue').pop()!;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.text).toBe('second question');
    expect(queue.items[0]?.state).toBe('waiting');
    // The request of the queue did not go out yet.
    expect(ofType('user_message')).toHaveLength(1);

    // The turn is over, the message of the queue goes out.
    await vi.waitFor(() => {
      expect(state.holdResponse).toBeDefined();
    });
    state.holdResponse?.();
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(2);
    });
    expect(ofType('user_message')[1]?.text).toBe('second question');
    await vi.waitFor(() => {
      const last = ofType('queue').pop()!;
      expect(last.items[0]?.state).toBe('done');
    });
  });

  it('removes a message from the queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push('HOLD');
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(1);
    });
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('queue').length).toBeGreaterThan(0);
    });
    const item = ofType('queue').pop()!.items[0]!;

    state.receive?.({ type: 'remove_queued', id: item.id });
    await vi.waitFor(() => {
      expect(ofType('queue').pop()!.items).toHaveLength(0);
    });

    // The message of the queue does not go out.
    await vi.waitFor(() => {
      expect(state.holdResponse).toBeDefined();
    });
    state.holdResponse?.();
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    expect(ofType('user_message')).toHaveLength(1);
  });

  it('sends every message of the queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push('HOLD', TEXT_SSE, TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(1);
    });
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    state.receive?.({ type: 'send', text: 'third question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('queue').pop()!.items).toHaveLength(2);
    });

    state.receive?.({ type: 'send_all_queued' });
    await vi.waitFor(() => {
      expect(state.holdResponse).toBeDefined();
    });
    state.holdResponse?.();
    // Both messages of the queue go out, one after another.
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(3);
    });
    expect(ofType('user_message').map((message) => message.text)).toEqual([
      'first question',
      'second question',
      'third question'
    ]);
  });

  it('sends a message of the queue now: the running turn stops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push('HOLD', TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(1);
    });
    state.receive?.({ type: 'send', text: 'urgent question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('queue').pop()?.items).toHaveLength(1);
    });
    const item = ofType('queue').pop()!.items[0]!;

    await vi.waitFor(() => {
      expect(state.holdResponse).toBeDefined();
    });
    // The reader does not wait for the turn: the button sends the message now.
    state.receive?.({ type: 'send_queued', id: item.id });
    await vi.waitFor(() => {
      expect(ofType('user_message').map((message) => message.text)).toEqual([
        'first question',
        'urgent question'
      ]);
    });
    await vi.waitFor(() => {
      expect(ofType('queue').pop()!.items[0]?.state).toBe('done');
    });
  });

  it('tells the panel which version is running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    const init = ofType('init')[0]!;
    expect(init.state.version).toBe('0.1.0');
  });

  it('measures the duration of an action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TOOL_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });
    await waitForState(() => {
      expect(ofType('tool_end').length).toBe(1);
    });
    const end = ofType('tool_end')[0]!;
    expect(typeof end.durationMs).toBe('number');
    expect(end.durationMs ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('keeps the turn alive when the state of the host refuses the write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    state.failState = true;
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    expect(ofType('error').length).toBe(0);
  });

  it('cuts a huge chat before it reaches the state of the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    const messages = Array.from({ length: 600 }, (_, index) => ({
      id: 'm' + index,
      role: 'assistant' as const,
      text: 'line ' + index
    }));
    state.globalState.set('minimax.sessions', [
      {
        id: 's-big',
        title: 'Big chat',
        updatedAt: 5,
        messages: [],
        uiMessages: messages,
        usage: []
      }
    ]);
    state.globalState.set('minimax.activeSession', 's-big');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        uiMessages: unknown[];
      }>;
      expect(stored[0]?.uiMessages.length).toBe(400);
    });
  });
});
