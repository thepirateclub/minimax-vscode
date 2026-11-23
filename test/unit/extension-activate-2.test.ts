import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
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

  it('keeps the session history between the turns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });

    const stored = state.globalState.get('minimax.sessions') as Array<{ messages: unknown[] }>;
    expect(stored.length).toBe(1);
    expect(stored[0]?.messages.length).toBe(4);
  });

  it('turns the editor selection into a chip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.editor = {
      document: {
        uri: { fsPath: 'src/app.ts' },
        getText: () => 'const answer = 42;'
      },
      selection: {
        isEmpty: false,
        start: { line: 10, character: 0 },
        end: { line: 12, character: 5 }
      }
    };
    await boot();
    state.posted.length = 0;
    state.commands.get('minimax.addSelection')?.();
    await waitForState(() => {
      expect(ofType('selection').length).toBe(1);
    });
    const selected = ofType('selection')[0]!.selection;
    expect(selected.path).toBe('src/app.ts');
    expect(selected.detail).toBe('lines 11-13');
    expect(selected.content).toBe('const answer = 42;');
  });

  it('suggests open tabs and workspace files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.documents.push({ uri: { fsPath: 'src/open.ts' } });
    state.files = ['src/open.ts', 'src/other.ts'];
    await boot();
    state.posted.length = 0;
    state.receive?.({ type: 'request_suggestions', requestId: 'r1', prefix: 'open' });
    await waitForState(() => {
      expect(ofType('suggestions').length).toBe(1);
    });
    const items = ofType('suggestions')[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.path).toBe('src/open.ts');
    expect(items[0]?.source).toBe('open');
  });

  it('hides a document that lives outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.documents.push({ uri: { fsPath: join(root, '..', 'outside.ts') } });
    await boot();
    state.posted.length = 0;
    state.receive?.({ type: 'request_suggestions', requestId: 'r1', prefix: 'outside' });
    await waitForState(() => {
      expect(ofType('suggestions').length).toBe(1);
    });
    expect(ofType('suggestions')[0]!.items).toHaveLength(0);
  });

  it('does not save the address of another host without a confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    state.posted.length = 0;
    state.receive?.({
      type: 'save_settings',
      values: {
        baseUrl: 'auto',
        customBaseUrl: 'https://api.example.com/anthropic',
        model: 'MiniMax-M3.1-Flash',
        effort: 'max',
        mode: 'code',
        thinking: false,
        maxIterations: 40,
        maxRetries: 5,
        fontSize: 13,
        historyMaxMessages: 120,
        contextThreshold: 50,
        semanticSearch: false,
        autoApprove: [],
        rulesEnabled: true,
        enableWebSearch: false,
        collapseTools: false,
        collapseCode: false,
        showToolSteps: true,
        speechLanguage: '',
        microphone: ''
      }
    });
    await waitForState(() => {
      expect(state.warningCalls.length).toBe(1);
    });
    expect(state.warningCalls[0]).toContain('api.example.com');
    // The reader did not agree, the address is not saved and the rest of
    // the settings is saved.
    await waitForState(() => {
      expect(state.config.get('model')).toBe('MiniMax-M3.1-Flash');
      expect(state.config.get('customBaseUrl')).toBe('');
    });
    expect(ofType('notice').some((item) => item.message.includes('not saved'))).toBe(true);
  });

  it('saves the address of another host when the reader agrees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.warningAnswer = 'Use it';
    await boot();
    state.receive?.({
      type: 'save_settings',
      values: {
        baseUrl: 'auto',
        customBaseUrl: 'https://api.example.com/anthropic',
        model: 'MiniMax-M3.1-Flash',
        effort: 'max',
        mode: 'code',
        thinking: false,
        maxIterations: 40,
        maxRetries: 5,
        fontSize: 13,
        historyMaxMessages: 120,
        contextThreshold: 50,
        semanticSearch: false,
        autoApprove: [],
        rulesEnabled: true,
        enableWebSearch: false,
        collapseTools: false,
        collapseCode: false,
        showToolSteps: true,
        speechLanguage: '',
        microphone: ''
      }
    });
    await waitForState(() => {
      expect(state.config.get('customBaseUrl')).toBe('https://api.example.com/anthropic');
    });
  });
});
