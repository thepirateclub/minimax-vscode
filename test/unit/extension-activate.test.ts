import { mkdtemp, readFile } from 'node:fs/promises';
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
  responses: [] as string[]
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
      asRelativePath: (uri: { fsPath: string }) => uri.fsPath
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
    state.responses.length = 0;
    state.receive = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        state.fetched.push(String(url));
        state.headers.push((init?.headers ?? {}) as Record<string, string>);
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
    state.receive?.({ type: 'send', text: 'hello', mentions: [] });
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
    state.receive?.({ type: 'send', text: 'hello', mentions: [] });

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
    state.receive?.({ type: 'send', text: 'write a note', mentions: [] });

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
    state.receive?.({ type: 'send', text: 'write a note', mentions: [] });

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

    state.receive?.({ type: 'send', text: 'first question', mentions: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'second question', mentions: [] });
    await vi.waitFor(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });

    const stored = state.globalState.get('minimax.sessions') as Array<{ messages: unknown[] }>;
    expect(stored.length).toBe(1);
    expect(stored[0]?.messages.length).toBe(4);
  });
});
