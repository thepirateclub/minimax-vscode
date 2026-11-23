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

  it('returns the settings and saves the changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    state.posted.length = 0;
    state.receive?.({ type: 'request_settings' });
    await waitForState(() => {
      expect(ofType('settings').length).toBe(1);
    });
    const settings = ofType('settings')[0]!.settings;
    expect(settings.model).toBe('MiniMax-M3.1-Flash');
    expect(settings.tools).toContain('write_file');
    expect(settings.hasApiKey).toBe(false);

    state.receive?.({
      type: 'save_settings',
      values: {
        baseUrl: 'china',
        customBaseUrl: '',
        model: 'MiniMax-M3',
        effort: 'high',
        mode: 'plan',
        thinking: true,
        maxIterations: 12,
        maxRetries: 3,
        fontSize: 15,
        historyMaxMessages: 40,
        contextThreshold: 60,
        semanticSearch: true,
        autoApprove: ['run_terminal'],
        rulesEnabled: false,
        enableWebSearch: false,
        collapseTools: true,
        collapseCode: true,
        showToolSteps: true,
        speechLanguage: 'ru',
        microphone: 'Mic 1'
      }
    });
    await waitForState(() => {
      expect(state.config.get('model')).toBe('MiniMax-M3');
    });
    expect(state.config.get('baseUrl')).toBe('china');
    expect(state.config.get('effort')).toBe('high');
    expect(state.config.get('mode')).toBe('plan');
    expect(state.config.get('thinking')).toBe(true);
    expect(state.config.get('fontSize')).toBe(15);
    expect(state.config.get('historyMaxMessages')).toBe(40);
    expect(state.config.get('contextThreshold')).toBe(60);
    expect(state.config.get('semanticSearch')).toBe(true);
    expect(state.config.get('autoApprove')).toEqual(['run_terminal']);
    expect(state.config.get('rulesEnabled')).toBe(false);
    expect(state.config.get('collapseTools')).toBe(true);
    expect(state.config.get('collapseCode')).toBe(true);
    expect(state.config.get('showToolSteps')).toBe(true);
    expect(state.config.get('speechLanguage')).toBe('ru');
    expect(state.config.get('microphone')).toBe('Mic 1');
  });

  it('adds the selection to the prompt sent to the model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();
    state.receive?.({
      type: 'send',
      text: 'explain this',
      mentions: [],
      selections: [
        {
          id: 'sel-1',
          path: 'src/app.ts',
          label: 'app.ts',
          detail: 'lines 11-13',
          content: 'const answer = 42;'
        }
      ]
    });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    const prompt = body.messages[0]?.content[0]?.text ?? '';
    expect(prompt).toContain('explain this');
    expect(prompt).toContain('Selected code from src/app.ts');
    expect(prompt).toContain('const answer = 42;');
  });

  it('turns a file into an inline mention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    state.posted.length = 0;
    state.commands.get('minimax.addFile')?.({ fsPath: 'src/app.ts' });
    await waitForState(() => {
      expect(ofType('mention').length).toBe(1);
    });
    expect(ofType('mention')[0]!.path).toBe('src/app.ts');
  });

  it('switches the agent mode from the webview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    expect(ofType('init')[0]!.state.mode).toBe('code');
    state.receive?.({ type: 'set_mode', mode: 'plan' });
    await waitForState(() => {
      expect(state.config.get('mode')).toBe('plan');
    });
    await waitForState(() => {
      const inits = ofType('init');
      expect(inits.length).toBeGreaterThan(0);
      expect(inits[inits.length - 1]!.state.mode).toBe('plan');
    });
  });

  it('sends only the read tools in plan mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.config.set('mode', 'plan');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'plan this', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as {
      system: string;
      tools: Array<{ name: string }>;
    };
    const names = body.tools.map((tool) => tool.name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_terminal');
    expect(body.system).toContain('Mode: PLAN');
    expect(body.system).not.toContain('write_file');
  });

  it('collects the token spend of every action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('usage').length).toBe(1);
    });
    expect(ofType('usage')[0]!.turns).toEqual([
      { input: 11, output: 7, cache: 0 }
    ]);
    await waitForState(() => {
      const statuses = ofType('status');
      expect(statuses[statuses.length - 1]!.tokens).toBe(18);
    });
  });

  it('switches the thinking of the model from the webview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    expect(ofType('init')[0]!.state.thinking).toBe(false);
    state.receive?.({ type: 'set_thinking', thinking: true });
    await waitForState(() => {
      expect(state.config.get('thinking')).toBe(true);
    });
    await waitForState(() => {
      const inits = ofType('init');
      expect(inits[inits.length - 1]!.state.thinking).toBe(true);
    });
  });

  it('asks the M3 model to think when the thinking is on', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.config.set('model', 'MiniMax-M3');
    state.config.set('thinking', true);
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as Record<string, unknown>;
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['output_config']).toBeUndefined();
  });
});
