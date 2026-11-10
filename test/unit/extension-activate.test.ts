import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';

const state = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  viewProviders: new Map<string, { resolveWebviewView: (view: unknown) => void }>(),
  config: new Map<string, unknown>(),
  secrets: new Map<string, string>(),
  globalState: new Map<string, unknown>(),
  posted: [] as ExtToWeb[],
  receive: undefined as undefined | ((message: WebToExt) => void),
  fetched: [] as string[],
  headers: [] as Array<Record<string, string>>,
  bodies: [] as string[],
  responses: [] as string[],
  editor: undefined as unknown,
  documents: [] as Array<{ uri: { fsPath: string } }>,
  files: [] as string[],
  failState: false,
  statusBar: undefined as undefined | { text: string; tooltip: string },
  theme: 2,
  themeListener: undefined as undefined | (() => void),
  opened: [] as string[],
  shown: [] as string[],
  quickPick: undefined as undefined | { title: string; items: unknown[] }
}));

vi.mock('vscode', () => {
  const configuration = {
    get: (key: string, fallback?: unknown) =>
      state.config.has(key) ? state.config.get(key) : fallback,
    update: async (key: string, value: unknown) => {
      state.config.set(key, value);
    }
  };
  return {
    QuickPickItemKind: {
      Separator: -1,
      Default: 0
    },
    window: {
      createOutputChannel: () => ({
        appendLine: () => undefined,
        show: () => undefined,
        dispose: () => undefined
      }),
      createStatusBarItem: () => {
        const item = {
          text: '',
          tooltip: '',
          command: '',
          show: () => undefined,
          dispose: () => undefined
        };
        state.statusBar = item;
        return item;
      },
      registerWebviewViewProvider: (id: string, provider: { resolveWebviewView: (v: unknown) => void }) => {
        state.viewProviders.set(id, provider);
        return { dispose: () => undefined };
      },
      visibleTextEditors: [],
      get activeTextEditor() {
        return state.editor;
      },
      get activeColorTheme() {
        return { kind: state.theme };
      },
      onDidChangeActiveColorTheme: (listener: () => void) => {
        state.themeListener = listener;
        return { dispose: () => undefined };
      },
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      createQuickPick: () => {
        const quickPick = {
          title: '',
          items: [] as unknown[],
          selectedItems: [] as unknown[],
          onDidAccept: () => ({ dispose: () => undefined }),
          onDidHide: () => ({ dispose: () => undefined }),
          show: () => undefined,
          hide: () => undefined,
          dispose: () => undefined
        };
        state.quickPick = quickPick;
        return quickPick;
      },
      showOpenDialog: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      withProgress: async (
        _options: unknown,
        task: (progress: unknown, token: unknown) => Promise<unknown>
      ) =>
        task(
          { report: () => undefined },
          { onCancellationRequested: () => ({ dispose: () => undefined }) }
        ),
      executeCommand: async () => undefined,
      showTextDocument: async (document: { uri: { fsPath: string } }) => {
        state.shown.push(document.uri.fsPath);
        return {
          selection: undefined,
          revealRange: () => undefined
        };
      }
    },
    commands: {
      registerCommand: (id: string, callback: (...args: unknown[]) => unknown) => {
        state.commands.set(id, callback);
        return { dispose: () => undefined };
      },
      executeCommand: async () => undefined
    },
    workspace: {
      getConfiguration: () => configuration,
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
      get workspaceFolders() {
        const root = state.config.get('root');
        return typeof root === 'string' && root.length > 0
          ? [{ uri: { fsPath: root } }]
          : undefined;
      },
      asRelativePath: (uri: { fsPath: string }) => uri.fsPath,
      get textDocuments() {
        return state.documents;
      },
      findFiles: async () => state.files.map((path) => ({ fsPath: path })),
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose: () => undefined }),
        onDidCreate: () => ({ dispose: () => undefined }),
        onDidDelete: () => ({ dispose: () => undefined }),
        dispose: () => undefined
      }),
      openTextDocument: async (uri: { fsPath: string }) => {
        state.opened.push(uri.fsPath);
        return { uri, lineCount: 500 };
      }
    },
    Uri: {
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        fsPath: [base.fsPath, ...parts].join('/')
      }),
      file: (fsPath: string) => ({ fsPath })
    },
    Position: class {
      constructor(
        public line: number,
        public character: number
      ) {}
    },
    Range: class {
      constructor(
        public start: unknown,
        public end: unknown
      ) {}
    },
    Selection: class {
      constructor(
        public anchor: unknown,
        public active: unknown
      ) {}
    },
    TextEditorRevealType: { InCenter: 2 },
    ThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ProgressLocation: { Window: 10 },
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Right: 2 }
  };
});

const MESSAGES_URL = 'https://api.minimax.io/anthropic/v1/messages';

const QUOTA_JSON = JSON.stringify({
  model_remains: [
    {
      model_name: 'general',
      current_interval_remaining_percent: 97,
      current_weekly_remaining_percent: 99,
      remains_time: 7556954
    }
  ],
  base_resp: { status_code: 0, status_msg: 'success' }
});

const TEXT_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi from the model"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

const TOOL_SSE = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\\"path\\\":\\\"note.txt\\\",\\\"content\\\":\\\"written by the agent\\\"}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

function makeContext(): ExtensionContext {
  return {
    subscriptions: [],
    extensionUri: { fsPath: 'C:/extension' },
    secrets: {
      get: async (key: string) => state.secrets.get(key),
      store: async (key: string, value: string) => {
        state.secrets.set(key, value);
      },
      delete: async (key: string) => {
        state.secrets.delete(key);
      }
    },
    globalState: {
      get: (key: string, fallback?: unknown) => state.globalState.get(key) ?? fallback,
      update: (key: string, value: unknown) => {
        if (state.failState) {
          throw new Error('the state of the host is full');
        }
        state.globalState.set(key, value);
        return Promise.resolve();
      }
    }
  } as unknown as ExtensionContext;
}

function makeView(): unknown {
  return {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: (message: ExtToWeb) => {
        state.posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (handler: (message: WebToExt) => void) => {
        state.receive = handler;
        return { dispose: () => undefined };
      }
    },
    onDidDispose: () => ({ dispose: () => undefined })
  };
}

async function boot(): Promise<void> {
  const { activate } = await import('../../src/extension');
  await activate(makeContext());
  const provider = state.viewProviders.get('minimax.chat');
  if (!provider) {
    throw new Error('the webview view provider was not registered');
  }
  provider.resolveWebviewView(makeView());
  state.receive?.({ type: 'ready' });
  await vi.waitFor(() => {
    expect(state.posted.some((message) => message.type === 'init')).toBe(true);
  });
}

function types(): string[] {
  return state.posted.map((message) => message.type);
}

function ofType<T extends ExtToWeb['type']>(type: T): Array<Extract<ExtToWeb, { type: T }>> {
  return state.posted.filter((message) => message.type === type) as Array<
    Extract<ExtToWeb, { type: T }>
  >;
}

describe('extension activation', () => {
  beforeEach(() => {
    state.commands.clear();
    state.viewProviders.clear();
    state.config.clear();
    state.secrets.clear();
    state.globalState.clear();
    state.posted.length = 0;
    state.fetched.length = 0;
    state.headers.length = 0;
    state.bodies.length = 0;
    state.responses.length = 0;
    state.editor = undefined;
    state.documents.length = 0;
    state.files.length = 0;
    state.failState = false;
    state.receive = undefined;
    state.theme = 2;
    state.themeListener = undefined;
    state.opened.length = 0;
    state.shown.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        state.fetched.push(href);
        state.headers.push((init?.headers ?? {}) as Record<string, string>);
        const body = typeof init?.body === 'string' ? init.body : '';
        if (body) {
          state.bodies.push(body);
        }
        if (href.includes('/v1/token_plan/remains')) {
          return new Response(QUOTA_JSON, {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        const payload = state.responses.shift() ?? TEXT_SSE;
        return new Response(payload, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        });
      })
    );
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
    await vi.waitFor(() => {
      expect(state.shown.length).toBe(1);
    });
    expect(state.opened[0]).toContain('history.ts');
    expect(state.shown[0]).toContain('history.ts');
  });

  it('refuses a path outside the workspace', async () => {
    await boot();
    state.receive?.({ type: 'open_file', path: '../outside.ts' });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
      expect(ofType('text_delta').map((message) => message.text).join('')).toBe('hi from the model');
    });
    expect(ofType('user_message')[0]?.text).toBe('hello');
    expect(ofType('assistant_start').length).toBeGreaterThan(0);
    await vi.waitFor(() => {
      const status = ofType('status').pop();
      expect(status?.state).toBe('idle');
    });

    expect(state.fetched).toContain(MESSAGES_URL);
    const index = state.fetched.indexOf(MESSAGES_URL);
    expect(state.headers[index]?.['Authorization']).toBe('Bearer test-key');
    expect(state.headers[index]?.['anthropic-version']).toBe('2023-06-01');
  });

  it('asks for an approval before a write and applies it after the answer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TOOL_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });

    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    expect(approval.name).toBe('write_file');
    expect(approval.preview?.path).toBe('note.txt');

    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });

    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    state.receive?.({ type: 'reject', id: approval.id });

    await vi.waitFor(() => {
      const end = ofType('tool_end').pop();
      expect(end?.isError).toBe(true);
    });
    await expect(readFile(join(root, 'note.txt'), 'utf8')).rejects.toThrow();
  });

  it('keeps the session history between the turns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('suggestions').length).toBe(1);
    });
    expect(ofType('suggestions')[0]!.items).toHaveLength(0);
  });

  it('returns the settings and saves the changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    state.posted.length = 0;
    state.receive?.({ type: 'request_settings' });
    await vi.waitFor(() => {
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
        fontSize: 15,
        historyMaxMessages: 40,
        contextThreshold: 60,
        semanticSearch: true,
        autoApprove: ['run_terminal'],
        rulesEnabled: false,
        enableWebSearch: false,
        collapseTools: true,
        collapseCode: true
      }
    });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(state.config.get('mode')).toBe('plan');
    });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('usage').length).toBe(1);
    });
    expect(ofType('usage')[0]!.turns).toEqual([
      { input: 11, output: 7, cache: 0 }
    ]);
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(state.config.get('thinking')).toBe(true);
    });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const body = JSON.parse(state.bodies[0]!) as Record<string, unknown>;
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['output_config']).toBeUndefined();
  });

  it('keeps the thinking of the M3 model off by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.config.set('model', 'MiniMax-M3');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
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

  it('measures the duration of an action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TOOL_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        uiMessages: unknown[];
      }>;
      expect(stored[0]?.uiMessages.length).toBe(400);
    });
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
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
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
});
