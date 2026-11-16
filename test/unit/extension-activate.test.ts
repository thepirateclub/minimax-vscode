import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';

// The turn of the model builds the prompt, reads the tree of the project
// and waits for the answer. Under the load of the whole suite the first turn
// takes longer than the second that vi.waitFor gives by default.
const rawWaitFor = vi.waitFor;
vi.waitFor = ((
  callback: Parameters<typeof rawWaitFor>[0],
  options?: Parameters<typeof rawWaitFor>[1]
) =>
  rawWaitFor(callback, {
    timeout: 10_000,
    ...(typeof options === 'number' ? { timeout: options } : options)
  })) as unknown as typeof vi.waitFor;

const state = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  viewProviders: new Map<string, { resolveWebviewView: (view: unknown) => void }>(),
  config: new Map<string, unknown>(),
  workspaceConfig: new Map<string, unknown>(),
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
    // The editor tells where the value of a setting comes from: the user, the
    // workspace or the folder. The extension reads the value of the user for
    // the settings that hold the address of the API.
    inspect: (key: string) => ({
      key,
      defaultValue: undefined,
      globalValue: state.config.get(key),
      workspaceValue: state.workspaceConfig.get(key)
    }),
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

// The test of the address of the API marks its request with this text. The
// answer is given by the mark, so a leftover request of another test cannot
// take it away from the test that waits for it.
const PROBE_MARK = 'endpoint-probe';
const PROBE_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"probe answer"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

// The workspace of a test can be a repository, the state of it goes into
// the prompt of the model.
const runGit = promisify(execFile);

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

const TODO_SSE = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"todo_write","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"todos\\":[{\\"content\\":\\"Read the parser\\",\\"status\\":\\"pending\\",\\"priority\\":\\"high\\"}]}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

const GOAL_SSE = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"update_goal","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"status\\":\\"complete\\",\\"note\\":\\"The parser is rewritten\\"}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

// The request of the parent: the model starts a sub-agent.
function taskSse(role: string, prompt: string): string {
  const input = JSON.stringify({ description: 'a piece of work', prompt, role });
  return [
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"task","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":' +
      JSON.stringify(input) +
      '}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ].join('');
}

// The request of a write. The id of the call can be the same in two
// turns, the server is free to send it again.
function writeSse(id: string, path: string, content: string): string {
  const input = JSON.stringify({ path, content });
  return [
    'event: content_block_start\ndata: ' +
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id, name: 'write_file', input: {} }
      }) +
      '\n\n',
    'event: content_block_delta\ndata: ' +
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: input }
      }) +
      '\n\n',
    'event: message_delta\ndata: ' +
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 9 }
      }) +
      '\n\n',
    'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n'
  ].join('');
}

// The answer of a model comes in pieces, the deltas stand on the token
// borders.
const CHILD_TEXT_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The parser "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"is in "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"src/app.ts."}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

function makeContext(): ExtensionContext {
  return {
    subscriptions: [],
    extensionUri: { fsPath: 'C:/extension' },
    extension: { packageJSON: { version: '0.1.0' } },
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
        // The webview gets a copy of the message, the host keeps the object
        // and can change it later. A test that looks at the panel has to see
        // the message as it was posted.
        state.posted.push(structuredClone(message));
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
    state.workspaceConfig.clear();
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
        if (body.includes(PROBE_MARK)) {
          return new Response(PROBE_SSE, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          });
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
        speechLanguage: 'ru',
        microphone: 'Mic 1'
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

  it('tells the panel how long the step took', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const userId = ofType('user_message')[0]?.id ?? '';
    expect(userId.length).toBeGreaterThan(0);
    // The turn is over when the anchor of the request is in the state.
    await vi.waitFor(() => {
      const stored =
        (state.globalState.get('minimax.sessions') as
          | Array<{ turns?: unknown[] }>
          | undefined) ?? [];
      expect(stored[0]?.turns?.length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'rewind', id: userId });
    await vi.waitFor(() => {
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
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    const userId = ofType('user_message')[0]?.id ?? '';

    state.posted.length = 0;
    state.receive?.({ type: 'retry', id: userId });
    await vi.waitFor(() => {
      expect(ofType('user_message').length).toBe(1);
    });
    expect(ofType('user_message')[0]?.text).toBe('first question');
    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
      expect(ofType('todos').length).toBe(1);
    });
    expect(ofType('todos')[0]!.todos).toEqual([
      { content: 'Read the parser', status: 'pending', priority: 'high' }
    ]);
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        todos?: unknown[];
      }>;
      expect(stored[0]?.todos).toEqual([
        { content: 'Read the parser', status: 'pending', priority: 'high' }
      ]);
    });
  });

  it('takes the list of the tasks with it when the chat rolls back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TODO_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('todos').length).toBe(1);
    });
    const userId = ofType('user_message')[0]?.id ?? '';
    // The turn is over when the anchor of the request is in the state.
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        turns?: unknown[];
      }>;
      expect(stored[0]?.turns?.length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'rewind', id: userId });
    await vi.waitFor(() => {
      expect(ofType('todos').length).toBe(1);
    });
    // The list of the turn that goes away goes away with it.
    expect(ofType('todos')[0]!.todos).toEqual([]);
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        todos?: unknown[];
      }>;
      expect(stored[0]?.todos).toEqual([]);
    });
  });

  it('writes the list of the tasks while the turn runs and keeps the last complete turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The first turn ends, the second one waits for the approval of a write.
    state.responses.push(TEXT_SSE, TODO_SSE, TOOL_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        turns?: unknown[];
      }>;
      expect(stored[0]?.turns?.length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    // The turn waits for the approval of the write, the list is written already.
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        todos?: unknown[];
        messages: unknown[];
        uiMessages: Array<{ text?: string }>;
      }>;
      expect(stored[0]?.todos).toHaveLength(1);
      // The session keeps the last complete turn, not the running one.
      expect(stored[0]?.messages).toHaveLength(2);
      expect(stored[0]?.uiMessages).toHaveLength(2);
    });
    const stored = state.globalState.get('minimax.sessions') as Array<{
      uiMessages: Array<{ text?: string }>;
    }>;
    expect(stored[0]?.uiMessages.map((message) => message.text)).not.toContain(
      'second question'
    );
  });

  it('carries the list of the tasks into the request of the next turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The model writes the list and answers, the next turn carries it.
    state.responses.push(TODO_SSE, TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    // The turn is over, the agent waits for the next request.
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'continue the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(state.bodies.length).toBe(3);
    });

    // The list was empty when the first turn started, that request has no section.
    const first = JSON.parse(state.bodies[0]!) as { system: string };
    expect(first.system).not.toContain('Tasks:');
    // The list of the tasks is a section of the prompt of the model.
    const body = JSON.parse(state.bodies[2]!) as { system: string };
    expect(body.system).toContain('Tasks:');
    expect(body.system).toContain('- [pending] Read the parser (high)');
    expect(body.system).toContain('\nTasks:\n- [pending] Read the parser (high)');
  });

  it('keeps the goal of the session in the state of the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 8,
      secondsLimit: 600
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });
    const goal = ofType('goal')[0]!.goal!;
    expect(goal.objective).toBe('Rewrite the parser');
    expect(goal.tokenBudget).toBe(12000);
    expect(goal.requestLimit).toBe(8);
    expect(goal.secondsLimit).toBe(600);
    expect(goal.status).toBe('active');

    // The goal is in the saved session.
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { objective: string };
      }>;
      expect(stored[0]?.goal?.objective).toBe('Rewrite the parser');
    });

    // The goal comes back after a restart of the extension.
    await boot();
    const inits = ofType('init');
    expect(inits[inits.length - 1]!.state.goal?.objective).toBe('Rewrite the parser');
  });

  it('counts the spend of a request into the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBeGreaterThan(0);
    });
    const goal = ofType('goal').pop()!.goal!;
    // The request spent 11 input tokens and 7 output tokens.
    expect(goal.used.tokens).toBe(18);
    expect(goal.used.requests).toBe(1);
  });

  it('refuses a turn while the budget of the goal is over', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    // The turn has to be over, otherwise the second request finds the
    // agent busy.
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    // The spend of the request (18 tokens) broke the limit of 10 tokens.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('notice').length).toBeGreaterThan(0);
    });
    const notice = ofType('notice')[0]!;
    expect(notice.message).toContain('budget');
    expect(notice.message).toContain('Rewrite the parser');
    // The request did not go out.
    expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(1);
  });

  it('keeps the spend when the user raises the limit of the same goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The user raises the limit of the same goal, the spend stays.
    state.posted.length = 0;
    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });
    const goal = ofType('goal')[0]!.goal!;
    expect(goal.tokenBudget).toBe(12000);
    // The request spent 18 tokens, the raise of the limit does not forget it.
    expect(goal.used.tokens).toBe(18);
    expect(goal.used.requests).toBe(1);
    expect(goal.status).toBe('active');
  });

  it('refuses a limit of the goal that is not a positive number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 0
    });
    await vi.waitFor(() => {
      expect(ofType('notice').length).toBe(1);
    });
    const notice = ofType('notice')[0]!;
    expect(notice.message).toContain('positive numbers');
    expect(notice.kind).toBe('error');
    // The goal was not set.
    expect(ofType('goal').length).toBe(0);
  });

  it('applies the status of the goal that the model sets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(GOAL_SSE, TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'do the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('tool_end').length).toBe(1);
    });

    // The host applies the status that the model set.
    const goal = ofType('goal').pop()!.goal!;
    expect(goal.status).toBe('complete');
    // The reason of the model reaches the user in the card of the call,
    // the card stays in the saved chat, a notice printed it twice.
    const start = ofType('tool_start').find((message) => message.name === 'update_goal');
    expect(start?.input['note']).toBe('The parser is rewritten');
    expect(
      ofType('notice').some((message) => message.message.includes('The parser is rewritten'))
    ).toBe(false);
  });

  it('keeps the limit of the goal when the model closes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(GOAL_SSE, TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'do the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The model closed the goal, the spend is counted anyway.
    const goal = ofType('goal').pop()!.goal!;
    expect(goal.status).toBe('complete');
    expect(goal.used.tokens).toBe(27);
    expect(goal.used.requests).toBe(2);

    // The limit of the goal still holds, the next turn is refused.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('notice').length).toBeGreaterThan(0);
    });
    expect(ofType('notice')[0]!.message).toContain('budget');
    // The request did not go out.
    expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(2);
  });

  it('adds the time of every turn to the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    // The clock of the test: every request takes five seconds.
    let clock = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/v1/messages')) {
          clock += 5000;
        }
        return base(url, init);
      })
    );
    const storedGoal = () => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { used: { tokens: number; requests: number; seconds: number } };
      }>;
      return stored[0]?.goal;
    };
    const idleCount = () =>
      ofType('status').filter((message) => message.state === 'idle').length;
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        // The idle minute between the turns would cross this limit if the
        // waiting were charged as work.
        secondsLimit: 30
      });
      await vi.waitFor(() => {
        expect(ofType('goal').length).toBe(1);
      });

      const idleBefore = idleCount();
      state.receive?.({ type: 'send', text: 'first', mentions: [], selections: [] });
      await vi.waitFor(() => {
        expect(idleCount()).toBeGreaterThan(idleBefore);
      });
      await vi.waitFor(() => {
        expect(storedGoal()?.used.seconds).toBe(5);
      });

      // The user waits a minute between the turns, the waiting is not work.
      clock += 60_000;
      state.receive?.({ type: 'send', text: 'second', mentions: [], selections: [] });
      // The second turn was not refused: the idle minute is not work.
      await vi.waitFor(() => {
        expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(2);
      });
      expect(
        ofType('notice').filter((message) => message.message.includes('budget'))
      ).toHaveLength(0);
      await vi.waitFor(() => {
        expect(idleCount()).toBeGreaterThan(idleBefore + 1);
      });
      await vi.waitFor(() => {
        expect(storedGoal()?.used.seconds).toBe(10);
      });
      expect(storedGoal()?.used.requests).toBe(2);
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('adds the time of a turn that ended with an error to the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The clock of the test: the failed request takes five seconds.
    let clock = 2_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/v1/messages')) {
          clock += 5000;
          return new Response(
            JSON.stringify({ error: { message: 'bad request' } }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }
        return base(url, init);
      })
    );
    const storedGoal = () => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { used: { tokens: number; requests: number; seconds: number } };
      }>;
      return stored[0]?.goal;
    };
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        secondsLimit: 60
      });
      await vi.waitFor(() => {
        expect(ofType('goal').length).toBe(1);
      });

      state.posted.length = 0;
      state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
      await vi.waitFor(() => {
        expect(ofType('error').length).toBe(1);
      });
      // The failed turn took five seconds, they are in the goal.
      await vi.waitFor(() => {
        expect(storedGoal()?.used.seconds).toBe(5);
      });
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('returns the request to the input when the budget of the goal is over', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The spend of the request (18 tokens) broke the limit of 10 tokens.
    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'again',
      mentions: ['src/app.ts'],
      selections: []
    });
    await vi.waitFor(() => {
      expect(ofType('notice').length).toBeGreaterThan(0);
    });
    // The request comes back to the input field, it is not lost.
    const restored = ofType('restore_input')[0]!;
    expect(restored.text).toBe('again');
    expect(restored.mentions).toEqual(['src/app.ts']);
    expect(restored.selections).toEqual([]);
    // The request did not go out.
    expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(1);
  });

  it('clears the goal of the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'clear_goal' });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });
    // The panel sees that the goal is gone.
    expect(ofType('goal')[0]!.goal).toBeUndefined();
    // The saved session has no goal.
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { objective: string };
      }>;
      expect(stored[0]?.goal).toBeUndefined();
    });
  });

  it('clears the list of the tasks on the button of the reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TODO_SSE, TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('todos').some((message) => message.todos.length > 0)).toBe(true);
    });
    await vi.waitFor(() => {
      expect(ofType('status').at(-1)?.state).toBe('idle');
    });

    state.posted.length = 0;
    state.receive?.({ type: 'clear_todos' });
    await vi.waitFor(() => {
      expect(ofType('todos')).toHaveLength(1);
    });
    expect(ofType('todos')[0]!.todos).toEqual([]);
    // The saved session has no tasks, the reload does not bring them back.
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{ todos?: unknown[] }>;
      expect(stored[0]?.todos ?? []).toEqual([]);
    });
  });

  it('sends the time of the turn to the panel with the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    // The clock of the test: every request takes five seconds.
    let clock = 3_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/v1/messages')) {
          clock += 5000;
        }
        return base(url, init);
      })
    );
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        secondsLimit: 600
      });
      await vi.waitFor(() => {
        expect(ofType('goal').length).toBe(1);
      });

      state.posted.length = 0;
      state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
      await vi.waitFor(() => {
        expect(ofType('status').pop()?.state).toBe('idle');
      });
      // The widget of the goal shows the time of the turn, the panel gets
      // the goal with the seconds of the turn and not with the seconds of
      // the turn before it.
      const goal = ofType('goal').pop()!.goal!;
      expect(goal.used.seconds).toBe(5);
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('does not charge the goal for the time between the turns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The clock of the test: every failed request takes five seconds.
    let clock = 4_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/v1/messages')) {
          clock += 5000;
          return new Response(
            JSON.stringify({ error: { message: 'bad request' } }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }
        return base(url, init);
      })
    );
    const storedGoal = () => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { used: { seconds: number } };
      }>;
      return stored[0]?.goal;
    };
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        secondsLimit: 600
      });
      await vi.waitFor(() => {
        expect(ofType('goal').length).toBe(1);
      });

      state.receive?.({ type: 'send', text: 'first', mentions: [], selections: [] });
      await vi.waitFor(() => {
        expect(ofType('error').length).toBe(1);
      });
      await vi.waitFor(() => {
        expect(storedGoal()?.used.seconds).toBe(5);
      });

      // The user waits a minute between the turns, the waiting is not
      // work.
      clock += 60_000;
      state.receive?.({ type: 'send', text: 'second', mentions: [], selections: [] });
      await vi.waitFor(() => {
        expect(ofType('error').length).toBe(2);
      });
      // Two turns of five seconds, the idle minute is not in the goal.
      await vi.waitFor(() => {
        expect(storedGoal()?.used.seconds).toBe(10);
      });
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('carries the goal of the session into the request of the model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 8
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(state.bodies.length).toBe(1);
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The goal is a section of the prompt of the model.
    const first = JSON.parse(state.bodies[0]!) as { system: string };
    expect(first.system).toContain('Goal: Rewrite the parser');
    expect(first.system).toContain('Budget: 12000 tokens, 8 requests');
    expect(first.system).toContain('Used: 0 tokens, 0 requests');

    // The next request carries the spend of the previous one.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(state.bodies.length).toBe(2);
    });
    const second = JSON.parse(state.bodies[1]!) as { system: string };
    expect(second.system).toContain('Goal: Rewrite the parser');
    expect(second.system).toContain('Used: 18 tokens, 1 requests');
  });

  it('sends no section of the goal when the session has no goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The model writes the list of the tasks, the next turn carries it.
    state.responses.push(TODO_SSE, TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('todos').length).toBe(1);
    });
    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'continue the work', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(state.bodies.length).toBe(3);
    });

    const body = JSON.parse(state.bodies[2]!) as { system: string };
    // The session carries the list of the tasks, but it has no goal.
    expect(body.system).toContain('Tasks:');
    expect(body.system).not.toContain('Goal:');
    // An empty section of the goal is not pushed into the prompt.
    expect(body.system).not.toMatch(/\n\n$/);
  });

  it('gives the child of the role explore no tool with a side effect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(taskSse('explore', 'find the parser'), TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await vi.waitFor(() => {
      expect(state.bodies.length).toBeGreaterThan(1);
    });
    // The second request is the request of the child.
    const child = JSON.parse(state.bodies[1]!) as {
      system: string;
      tools: Array<{ name: string }>;
    };
    const names = child.tools.map((tool) => tool.name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_terminal');
    expect(names).not.toContain('task');
    // The prompt of the child names its role.
    expect(child.system).toContain('You are a sub-agent of the main agent');
    expect(child.system).toContain('Your task is to explore');
  });

  it('the approval of the child carries the preview of the change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(taskSse('worker', 'write a note'), TOOL_SSE, TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'let the worker write',
      mentions: [],
      selections: []
    });

    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    // The approval of the child has an id of its own.
    expect(approval.id.startsWith('child-')).toBe(true);
    expect(approval.name).toBe('write_file');
    // The reader sees the change of the file before he answers.
    expect(approval.preview?.path).toBe('note.txt');
    expect(
      approval.preview?.lines.filter((line) => line.type === 'add').length
    ).toBe(1);
    // Nothing is written before the answer.
    await expect(readFile(join(root, 'note.txt'), 'utf8')).rejects.toThrow();

    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });

    await vi.waitFor(async () => {
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the agent');
    });
    // The change of the child stays in the card of the call: the
    // journal of the child carries the lines of the diff.
    await vi.waitFor(() => {
      const lines = ofType('tool_progress').map((message) => message.line);
      expect(lines).toContain('+ written by the agent');
    });
    // The result of the call stays in the content alone, the journal has
    // its own field.
    await vi.waitFor(() => {
      const end = ofType('tool_end').pop();
      expect(end?.content).not.toContain('+ written by the agent');
    });
  });

  it('the Stop of the parent interrupts the child and the turn ends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(taskSse('explore', 'look for the parser'), TEXT_SSE);
    await boot();

    // The request of the child hangs, only the stop of the parent ends it.
    const base = globalThis.fetch;
    let requests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (!href.includes('/v1/messages')) {
          return await base(url, init);
        }
        requests += 1;
        if (requests === 2) {
          const body = typeof init?.body === 'string' ? init.body : '';
          if (body) {
            state.bodies.push(body);
          }
          // The child waits for the answer of the server.
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const stop = () => reject(new Error('The operation was aborted.'));
            if (signal?.aborted) {
              stop();
              return;
            }
            signal?.addEventListener('abort', stop);
          });
        }
        if (init?.signal?.aborted) {
          throw new Error('The operation was aborted.');
        }
        return await base(url, init);
      })
    );

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await vi.waitFor(() => {
      expect(state.bodies.length).toBeGreaterThan(1);
    });
    // The child waits, the reader stops the turn.
    state.receive?.({ type: 'stop' });

    await vi.waitFor(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    // The host tells the reader that the request was stopped.
    expect(
      ofType('notice').some((message) => message.message.includes('stopped'))
    ).toBe(true);

    // The chat is free again, the next request of the reader goes out.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
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
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    expect(approval.id.startsWith('child-')).toBe(true);

    // The reader switches to another chat and answers there.
    state.receive?.({ type: 'new_session' });
    await vi.waitFor(() => {
      expect(ofType('init').length).toBeGreaterThan(0);
    });
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: true });

    // The child writes the file, the answer of the reader was heard.
    await vi.waitFor(async () => {
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
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const other = ofType('approval_request')[0]!.approval;
    expect(other.id.startsWith('child-')).toBe(true);
    state.receive?.({ type: 'approve', id: other.id, allowForSession: false });
    await vi.waitFor(async () => {
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
    await vi.waitFor(async () => {
      expect(await readFile(join(root, 'third.txt'), 'utf8')).toBe('written once more');
    });
    expect(ofType('approval_request').length).toBe(0);
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
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;

    // The reader opens another chat while the first one waits.
    state.receive?.({ type: 'new_session' });
    await vi.waitFor(() => {
      expect(ofType('init').length).toBeGreaterThan(1);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });
    await vi.waitFor(async () => {
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the agent');
    });
    await vi.waitFor(() => {
      expect(state.responses.length).toBe(0);
    });
    // The tasks and the text of the first chat did not land in the open one.
    expect(ofType('todos').filter((message) => message.todos.length > 0)).toHaveLength(0);
    expect(ofType('text_delta')).toHaveLength(0);
    expect(ofType('tool_start')).toHaveLength(0);

    // Back in the first chat everything is there.
    state.receive?.({ type: 'select_session', id: first! });
    await vi.waitFor(() => {
      const init = ofType('init').at(-1);
      expect(init?.state.activeSessionId).toBe(first);
      expect(init?.state.todos.length).toBeGreaterThan(0);
    });
  });

  it('the prompt of the child carries the goal, the tasks and the state of the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The workspace is a repository, its state goes into the prompt.
    await runGit('git', ['init'], { cwd: root });
    // The model writes the tasks and then it starts the child.
    state.responses.push(
      TODO_SSE,
      taskSse('explore', 'find the parser'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 8
    });
    await vi.waitFor(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await vi.waitFor(() => {
      expect(state.bodies.length).toBeGreaterThan(2);
    });
    // The third request is the request of the child.
    const child = JSON.parse(state.bodies[2]!) as { system: string };
    expect(child.system).toContain('Goal: Rewrite the parser');
    expect(child.system).toContain('Tasks:');
    expect(child.system).toContain('Repository:');
  });

  it('the permission of the parent works for the child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The parent writes a file, then it starts a worker that writes too.
    state.responses.push(
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      taskSse('worker', 'write another note'),
      writeSse('toolu_1', 'child.txt', 'written by the child'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'write and delegate',
      mentions: [],
      selections: []
    });

    // The parent asks the reader for a permission.
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    expect(approval.id.startsWith('child-')).toBe(false);
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: true });

    // The write of the child needs no permission, the reader allowed the
    // tool for the session.
    await vi.waitFor(async () => {
      expect(await readFile(join(root, 'child.txt'), 'utf8')).toBe('written by the child');
    });
    expect(ofType('approval_request').length).toBe(1);
  });

  it('the permission of the child works for the next child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The parent starts two workers, both of them write a file.
    state.responses.push(
      taskSse('worker', 'write the first note'),
      writeSse('toolu_1', 'first.txt', 'first'),
      TEXT_SSE,
      taskSse('worker', 'write the second note'),
      writeSse('toolu_1', 'second.txt', 'second'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'delegate twice',
      mentions: [],
      selections: []
    });

    // The first child asks the reader.
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    state.receive?.({
      type: 'approve',
      id: ofType('approval_request')[0]!.approval.id,
      allowForSession: true
    });

    // The second child writes without a question.
    await vi.waitFor(async () => {
      expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('second');
    });
    expect(ofType('approval_request').length).toBe(1);
  });

  it('the answer of the child is the content of the call and not the journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The child answers in three pieces.
    state.responses.push(taskSse('explore', 'find the parser'), CHILD_TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await vi.waitFor(() => {
      const end = ofType('tool_end').find((message) => message.name === 'task');
      expect(end?.content).toContain('src/app.ts');
    });
    // The journal of the call holds the actions of the child, the answer of
    // the child is not shredded into it.
    const lines = ofType('tool_progress').map((message) => message.line);
    expect(lines).not.toContain('The parser');
    expect(lines.some((line) => line.includes('src/app.ts'))).toBe(false);
    // The card shows the answer once, in the content of the call.
    const end = ofType('tool_end').find((message) => message.name === 'task');
    expect(end?.content).toContain('The parser is in src/app.ts.');
  });

  it('the card of an earlier turn keeps its own result when the id of the call repeats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The server sends the same id of the call in two turns.
    state.responses.push(
      writeSse('toolu_1', 'one.txt', 'first'),
      writeSse('toolu_1', 'two.txt', 'second'),
      TEXT_SSE
    );
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'write twice',
      mentions: [],
      selections: []
    });

    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    state.receive?.({
      type: 'approve',
      id: ofType('approval_request')[0]!.approval.id,
      allowForSession: false
    });
    await vi.waitFor(() => {
      expect(ofType('approval_request').length).toBe(2);
    });
    state.receive?.({
      type: 'approve',
      id: ofType('approval_request')[1]!.approval.id,
      allowForSession: false
    });
    await vi.waitFor(() => {
      expect(ofType('tool_end').length).toBe(2);
    });

    // The state of the host keeps two cards, each one with its own result.
    await vi.waitFor(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        uiMessages: Array<{
          role: string;
          tool?: { id: string; content?: string };
        }>;
      }>;
      const cards = stored[0]?.uiMessages.filter((message) => message.role === 'tool') ?? [];
      expect(cards).toHaveLength(2);
      expect(cards[0]?.tool?.id).toBe('toolu_1');
      expect(cards[0]?.tool?.content).toBe('Wrote one.txt');
      expect(cards[1]?.tool?.content).toBe('Wrote two.txt');
    });
  });

});
