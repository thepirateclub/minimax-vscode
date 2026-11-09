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
  files: [] as string[]
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
    window: {
      createOutputChannel: () => ({
        appendLine: () => undefined,
        show: () => undefined,
        dispose: () => undefined
      }),
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        command: '',
        show: () => undefined,
        dispose: () => undefined
      }),
      registerWebviewViewProvider: (id: string, provider: { resolveWebviewView: (v: unknown) => void }) => {
        state.viewProviders.set(id, provider);
        return { dispose: () => undefined };
      },
      visibleTextEditors: [],
      get activeTextEditor() {
        return state.editor;
      },
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
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
      executeCommand: async () => undefined
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
      findFiles: async () => state.files.map((path) => ({ fsPath: path }))
    },
    Uri: {
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        fsPath: [base.fsPath, ...parts].join('/')
      })
    },
    ProgressLocation: { Window: 10 },
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Right: 2 }
  };
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
    state.receive = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        state.fetched.push(String(url));
        state.headers.push((init?.headers ?? {}) as Record<string, string>);
        state.bodies.push(typeof init?.body === 'string' ? init.body : '');
        const body = state.responses.shift() ?? TEXT_SSE;
        return new Response(body, {
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
      'minimax.clearApiKey'
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

  it('reports a missing key instead of calling the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', selections: [] });
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
    state.receive?.({ type: 'send', text: 'hello', selections: [] });

    await vi.waitFor(() => {
      expect(ofType('text_delta').map((message) => message.text).join('')).toBe('hi from the model');
    });
    expect(ofType('user_message')[0]?.text).toBe('hello');
    expect(ofType('assistant_start').length).toBeGreaterThan(0);
    await vi.waitFor(() => {
      const status = ofType('status').pop();
      expect(status?.state).toBe('idle');
    });

    expect(state.fetched[0]).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(state.headers[0]?.['Authorization']).toBe('Bearer test-key');
    expect(state.headers[0]?.['anthropic-version']).toBe('2023-06-01');
  });

  it('asks for an approval before a write and applies it after the answer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TOOL_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'write a note', selections: [] });

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
  });

  it('does not write anything when the approval is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TOOL_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'write a note', selections: [] });

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

    state.receive?.({ type: 'send', text: 'first question', selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'second question', selections: [] });
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
        maxTokens: 16384,
        maxIterations: 12,
        autoApprove: ['run_terminal'],
        rulesEnabled: false,
        enableWebSearch: false
      }
    });
    await vi.waitFor(() => {
      expect(state.config.get('model')).toBe('MiniMax-M3');
    });
    expect(state.config.get('baseUrl')).toBe('china');
    expect(state.config.get('effort')).toBe('high');
    expect(state.config.get('maxTokens')).toBe(16384);
    expect(state.config.get('autoApprove')).toEqual(['run_terminal']);
    expect(state.config.get('rulesEnabled')).toBe(false);
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

  it('attaches the file mentioned in the request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await writeFile(join(root, 'context.md'), '# Title\nbody line\n', 'utf8');
    await boot();

    state.receive?.({ type: 'send', text: 'read @context.md please', selections: [] });
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
});
