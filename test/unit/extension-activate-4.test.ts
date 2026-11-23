import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('keeps the thinking of the M3 model off by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.config.set('model', 'MiniMax-M3');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as Record<string, unknown>;
    expect(body['thinking']).toBeUndefined();
  });

  it('shows the remaining 5-hour quota in the status bar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    await boot();
    await waitForState(() => {
      expect(state.statusBar?.text).toContain('97%');
    });
    expect(state.statusBar?.tooltip).toContain('Left in the 5-hour window: 97%');
    expect(state.statusBar?.tooltip).toContain('Tokens spent in the last 24 hours');
    expect(state.fetched).toContain('https://api.minimax.io/v1/token_plan/remains');
  });

  it('opens the numbers of the plan on a click of the badge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    await boot();
    const command = state.commands.get('minimax.showUsage');
    expect(command).toBeDefined();
    command!();
    await waitForState(() => {
      expect(state.quickPick?.title).toBe('MiniMax token spend');
    });
    const items = (state.quickPick?.items ?? []) as Array<{
      label: string;
      description?: string;
    }>;
    const labels = items.map((item) => item.label);
    expect(labels).toContain('Tokens spent in the last 24 hours');
    expect(labels).toContain('Left this week');
    expect(labels).toContain('Left in the 5-hour window');
    expect(labels).toContain('Cache hit in the last 24 hours');
    expect(items.map((item) => item.description)).toContain('97%');
  });

  it('attaches the file mentioned in the request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await writeFile(join(root, 'context.md'), '# Title\nbody line\n', 'utf8');
    await boot();

    state.receive?.({ type: 'send', text: 'read @context.md please', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    const prompt = body.messages[0]?.content[0]?.text ?? '';
    expect(prompt).toContain('read @context.md please');
    expect(prompt).toContain('Attached file: context.md');
    expect(prompt).toContain('body line');
  });

  it('attaches the file named by a chip in the input field', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await writeFile(join(root, 'context.md'), '# Title\nbody line\n', 'utf8');
    await boot();

    state.receive?.({
      type: 'send',
      text: 'look at @context.md',
      mentions: ['context.md'],
      selections: []
    });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    const prompt = body.messages[0]?.content[0]?.text ?? '';
    expect(prompt).toContain('Attached file: context.md');
    expect(prompt).toContain('body line');
  });

  it('opens the last chat again after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.globalState.set('minimax.sessions', [
      {
        id: 's-old',
        title: 'Old chat',
        updatedAt: 5,
        messages: [],
        uiMessages: [{ id: 'm1', role: 'user', text: 'old question' }],
        usage: []
      }
    ]);
    state.globalState.set('minimax.activeSession', 's-old');
    await boot();

    const init = ofType('init')[0]!;
    expect(init.state.activeSessionId).toBe('s-old');
    expect(init.state.messages).toHaveLength(1);
    expect(init.state.messages[0]?.text).toBe('old question');
    expect(init.state.sessions.map((item) => item.id)).toContain('s-old');
  });

  it('starts a new chat when the project has no chats', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    const rootB = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', rootA);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();
    const chatA = ofType('init')[0]!.state.activeSessionId;
    expect(chatA).toBeDefined();
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'question of A', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The project B opens: it has no chats of its own.
    state.config.set('root', rootB);
    state.posted.length = 0;
    await boot();
    const init = ofType('init')[0]!;
    expect(init.state.workspaceRoot).toBe(rootB);
    expect(init.state.activeSessionId).toBeDefined();
    // The chat of the other project is not opened here.
    expect(init.state.activeSessionId).not.toBe(chatA);
    expect(init.state.messages).toHaveLength(0);
    // It stays in the list, the switch of every chat shows it.
    expect(init.state.sessions.map((item) => item.id)).toContain(chatA);
    const summary = init.state.sessions.find((item) => item.id === chatA);
    expect(summary?.workspaceRoot).toBe(rootA);
  });

  it('opens the chat that was active in the project', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    const rootB = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.secrets.set('minimax.apiKey', 'test-key');

    // The chat of the project A.
    state.config.set('root', rootA);
    state.responses.push(TEXT_SSE);
    await boot();
    state.receive?.({ type: 'send', text: 'question of A', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    const chatA = ofType('init')[0]!.state.activeSessionId;

    // The chat of the project B.
    state.config.set('root', rootB);
    state.posted.length = 0;
    state.responses.push(TEXT_SSE);
    await boot();
    state.receive?.({ type: 'send', text: 'question of B', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    const chatB = ofType('init')[0]!.state.activeSessionId;
    expect(chatB).not.toBe(chatA);

    // The project A opens again: its own chat is open.
    state.config.set('root', rootA);
    state.posted.length = 0;
    await boot();
    const init = ofType('init')[0]!;
    expect(init.state.activeSessionId).toBe(chatA);
    expect(init.state.messages[0]?.text).toBe('question of A');
  });
});
