import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';
import { state } from './vscodeMock';

export async function waitForState(check: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(check, { timeout: 10_000 });
}

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

// The log of the network of one controller: the addresses, the headers
// and the bodies of the requests.
export interface FetchLog {
  fetched: string[];
  headers: Array<Record<string, string>>;
  bodies: string[];
}


export const MESSAGES_URL = 'https://api.minimax.io/anthropic/v1/messages';

// The test of the address of the API marks its request with this text. The
// answer is given by the mark, so a leftover request of another test cannot
// take it away from the test that waits for it.
export const PROBE_MARK = 'endpoint-probe';
export const PROBE_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"probe answer"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

// The workspace of a test can be a repository, the state of it goes into
// the prompt of the model.
export const runGit = promisify(execFile);

export const QUOTA_JSON = JSON.stringify({
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

export const TEXT_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi from the model"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

export const TOOL_SSE = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\\"path\\\":\\\"note.txt\\\",\\\"content\\\":\\\"written by the agent\\\"}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

export const TODO_SSE = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"todo_write","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"todos\\":[{\\"content\\":\\"Read the parser\\",\\"status\\":\\"pending\\",\\"priority\\":\\"high\\"}]}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

export const GOAL_SSE = [
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"update_goal","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"status\\":\\"complete\\",\\"note\\":\\"The parser is rewritten\\"}"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

// The request of the parent: the model starts a sub-agent.
export function taskSse(role: string, prompt: string): string {
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
export function writeSse(id: string, path: string, content: string): string {
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
export const CHILD_TEXT_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The parser "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"is in "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"src/app.ts."}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
].join('');

export function makeContext(): ExtensionContext {
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

export function makeView(): unknown {
  // The panel of this controller writes into the list of this test. The
  // panel of the controller of the previous test keeps the list it was
  // built with, its late messages do not fall into this test.
  const posted = state.posted;
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
        posted.push(structuredClone(message));
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

// The stub of the network. Every boot of the extension gets its own: the
// controller of the previous test keeps the stub it was built with, a late
// request of it cannot take the answer of the next test.
export function stubFetch(queue: string[], log: FetchLog): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      log.fetched.push(href);
      log.headers.push((init?.headers ?? {}) as Record<string, string>);
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body) {
        log.bodies.push(body);
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
      const payload = queue.shift() ?? TEXT_SSE;
      if (payload === 'HOLD') {
        // The turn of the model waits for the test.
        // The stop of the turn aborts the request, as the real fetch does.
        await new Promise<void>((resolve, reject) => {
          state.holdResponse = resolve;
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        return new Response(TEXT_SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        });
      }
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    })
  );
}

export async function boot(): Promise<void> {
  const { activate } = await import('../../src/extension');
  await activate(makeContext());
  const provider = state.viewProviders.get('minimax.chat');
  if (!provider) {
    throw new Error('the webview view provider was not registered');
  }
  provider.resolveWebviewView(makeView());
  state.receive?.({ type: 'ready' });
  await waitForState(() => {
    expect(state.posted.some((message) => message.type === 'init')).toBe(true);
  });
}

export function types(): string[] {
  return state.posted.map((message) => message.type);
}

export function ofType<T extends ExtToWeb['type']>(type: T): Array<Extract<ExtToWeb, { type: T }>> {
  return state.posted.filter((message) => message.type === type) as Array<
    Extract<ExtToWeb, { type: T }>
  >;
}
