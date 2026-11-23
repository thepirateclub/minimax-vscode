import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, MESSAGES_URL, PROBE_MARK, TEXT_SSE, TOOL_SSE, stubFetch, boot, types, ofType } from '../helpers/extensionHarness';

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

  it('registers every command and the panel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    const ids = [...state.commands.keys()];
    for (const id of [
      'minimax.openPanel',
      'minimax.newChat',
      'minimax.addApiKey',
      'minimax.setEndpoint',
      'minimax.selectModel',
      'minimax.setEffort',
      'minimax.undoLastChange',
      'minimax.refreshContext',
      'minimax.showLogs',
      'minimax.clearApiKey',
      'minimax.showUsage'
    ]) {
      expect(ids).toContain(id);
    }
    expect(state.viewProviders.has('minimax.chat')).toBe(true);
  });

  it('sends the initial state without a key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    const init = ofType('init')[0]!;
    expect(init.state.hasApiKey).toBe(false);
    expect(init.state.model).toBe('MiniMax-M3.1-Flash');
    expect(init.state.models.length).toBeGreaterThan(0);
  });

  it('sends the kind of the theme and follows its change', async () => {
    await boot();
    const init = ofType('init')[0]!;
    expect(init.state.theme).toBe('dark');

    state.theme = 1;
    state.themeListener?.();
    const themes = ofType('theme');
    expect(themes.length).toBe(1);
    expect(themes[0]!.kind).toBe('light');
  });

  it('opens the file of a snippet in the editor', async () => {
    await boot();
    state.receive?.({ type: 'open_file', path: 'src/api/history.ts' });
    await waitForState(() => {
      expect(state.shown.length).toBe(1);
    });
    expect(state.opened[0]).toContain('history.ts');
    expect(state.shown[0]).toContain('history.ts');
  });

  it('refuses a path outside the workspace', async () => {
    await boot();
    state.receive?.({ type: 'open_file', path: '../outside.ts' });
    await waitForState(() => {
      expect(state.posted.some((message) => message.type === 'error')).toBe(true);
    });
    expect(state.opened.length).toBe(0);
    // The panel shows a sentence, not the text of the exception.
    const error = state.posted.find((message) => message.type === 'error');
    expect(error?.message).toContain('outside the workspace');
    expect(error?.message).not.toContain('escapes the workspace root');
  });

  it('reports a missing key instead of calling the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(types()).toContain('error');
    });
    expect(state.fetched).toHaveLength(0);
  });

  it('runs a turn and streams the answer to the webview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });

    await waitForState(() => {
      expect(ofType('text_delta').map((message) => message.text).join('')).toBe('hi from the model');
    });
    expect(ofType('user_message')[0]?.text).toBe('hello');
    expect(ofType('assistant_start').length).toBeGreaterThan(0);
    await waitForState(() => {
      const status = ofType('status').pop();
      expect(status?.state).toBe('idle');
    });

    expect(state.fetched).toContain(MESSAGES_URL);
    const index = state.fetched.indexOf(MESSAGES_URL);
    expect(state.headers[index]?.['Authorization']).toBe('Bearer test-key');
    expect(state.headers[index]?.['anthropic-version']).toBe('2023-06-01');
  });

  it('does not take the address of the API from the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    // A repository that the user opens tries to move the API to its own host
    // with the key of the user.
    state.workspaceConfig.set('customBaseUrl', 'https://attacker.example/anthropic');
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: PROBE_MARK, mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').map((message) => message.text).join('')).toBe(
        'probe answer'
      );
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    expect(state.fetched).toContain(MESSAGES_URL);
    expect(state.fetched.some((url) => url.includes('attacker.example'))).toBe(false);
    const index = state.fetched.indexOf(MESSAGES_URL);
    expect(state.headers[index]?.['Authorization']).toBe('Bearer test-key');
  });

  it('takes the address of the API from the user', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.config.set('customBaseUrl', 'https://proxy.example/anthropic');
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: PROBE_MARK, mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').map((message) => message.text).join('')).toBe(
        'probe answer'
      );
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    expect(state.fetched).toContain('https://proxy.example/anthropic/v1/messages');
  });

  it('asks for an approval before a write and applies it after the answer', async () => {
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
    expect(approval.name).toBe('write_file');
    expect(approval.preview?.path).toBe('note.txt');

    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });

    await waitForState(() => {
      const end = ofType('tool_end').pop();
      expect(end?.isError).toBe(false);
    });
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the agent');
    expect(ofType('approval_resolved')[0]?.approved).toBe(true);
    // The card of the action shows the change of the file as a diff.
    const end = ofType('tool_end').pop();
    expect(end?.diff?.path).toBe('note.txt');
    expect(end?.diff?.lines.filter((line) => line.type === 'add').length).toBe(1);
  });

  it('does not write anything when the approval is rejected', async () => {
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
    state.receive?.({ type: 'reject', id: approval.id });

    await waitForState(() => {
      const end = ofType('tool_end').pop();
      expect(end?.isError).toBe(true);
    });
    await expect(readFile(join(root, 'note.txt'), 'utf8')).rejects.toThrow();
  });
});
