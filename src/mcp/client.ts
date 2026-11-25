// A small client of the Model Context Protocol: the JSON-RPC of the protocol
// over the stdio of a process or over HTTP. The agent needs four calls:
// initialize, the initialized notice, tools/list and tools/call. The SDK of
// the protocol would bring a large dependency for these four.

import { spawn, type ChildProcess } from 'node:child_process';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

export interface McpContent {
  type: string;
  text?: string;
}

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpClient {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  close(): void;
}

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'minimax-vscode', version: '1' };
export const REQUEST_TIMEOUT_MS = 60_000;

type Send = (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
type Notify = (method: string, params: unknown) => Promise<void>;

// The calls of the protocol over any transport.
async function handshake(send: Send, notify: Notify): Promise<void> {
  await send('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO
  });
  await notify('notifications/initialized', {});
}

function protocolCalls(send: Send): Pick<McpClient, 'listTools' | 'callTool'> {
  return {
    async listTools() {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      // The list may come in pages, ten pages are more than any server has.
      for (let page = 0; page < 10; page++) {
        const result = (await send('tools/list', cursor ? { cursor } : {})) as {
          tools?: McpTool[];
          nextCursor?: string;
        };
        tools.push(...(result.tools ?? []));
        cursor = result.nextCursor;
        if (!cursor) {
          break;
        }
      }
      return tools;
    },
    async callTool(name, args, signal) {
      return (await send('tools/call', { name, arguments: args }, signal)) as McpCallResult;
    }
  };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// The stdio transport: one json message a line in both directions.
export async function connectStdio(config: {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}): Promise<McpClient> {
  const child: ChildProcess = spawn(config.command, config.args ?? [], {
    cwd: config.cwd,
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    // npx and the scripts of npm are .cmd files on Windows, CreateProcess
    // does not start them without the shell. The command is the setting of
    // the user, not the text of the model.
    shell: process.platform === 'win32',
    windowsHide: true
  });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let buffer = '';
  let closed = false;
  const failAll = (error: Error) => {
    closed = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on('error', (error) => failAll(error));
  child.on('exit', (code) => failAll(new Error('The MCP server stopped with the code ' + code + '.')));
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.length === 0) {
        continue;
      }
      try {
        settle(pending, JSON.parse(line));
      } catch {
        // A server may print a line of its own log to stdout, it is not a message.
      }
    }
  });
  const write = (message: unknown) => {
    if (closed || !child.stdin) {
      throw new Error('The MCP server is not running.');
    }
    child.stdin.write(JSON.stringify(message) + '\n');
  };
  const send: Send = (method, params, signal) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The MCP server did not answer ' + method + ' in time.'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error('The call was stopped.'));
      });
      try {
        write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  const notify: Notify = async (method, params) => {
    write({ jsonrpc: '2.0', method, params });
  };
  try {
    await handshake(send, notify);
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    ...protocolCalls(send),
    close() {
      closed = true;
      child.kill();
    }
  };
}

function settle(pending: Map<number, Pending>, message: unknown): void {
  if (typeof message !== 'object' || message === null) {
    return;
  }
  const record = message as { id?: unknown; result?: unknown; error?: { message?: string } };
  if (typeof record.id !== 'number') {
    return;
  }
  const item = pending.get(record.id);
  if (!item) {
    return;
  }
  pending.delete(record.id);
  clearTimeout(item.timer);
  if (record.error) {
    item.reject(new Error(record.error.message ?? 'The MCP server failed.'));
  } else {
    item.resolve(record.result);
  }
}

// The answer of the HTTP transport is json or a stream of events; the
// message with the id of the request is the answer.
export function readHttpAnswer(contentType: string, body: string, id: number): unknown {
  const messages: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        messages.push(JSON.parse(data));
      }
    }
  } else if (body.trim().length > 0) {
    const parsed: unknown = JSON.parse(body);
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  for (const message of messages) {
    const record = message as { id?: unknown; result?: unknown; error?: { message?: string } };
    if (record.id === id) {
      if (record.error) {
        throw new Error(record.error.message ?? 'The MCP server failed.');
      }
      return record.result;
    }
  }
  throw new Error('The MCP server sent no answer.');
}

// The streamable HTTP transport: every message is a POST, the server keeps
// the session by the Mcp-Session-Id header.
export async function connectHttp(
  config: { url: string; headers?: Record<string, string> },
  fetchImpl: typeof fetch = fetch
): Promise<McpClient> {
  let session: string | undefined;
  let nextId = 1;
  const post = async (message: unknown, signal?: AbortSignal) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(config.headers ?? {})
    };
    if (session) {
      headers['Mcp-Session-Id'] = session;
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!response.ok) {
      throw new Error('The MCP server answered ' + response.status + '.');
    }
    session = response.headers.get('mcp-session-id') ?? session;
    return response;
  };
  const send: Send = async (method, params, signal) => {
    const id = nextId++;
    const response = await post({ jsonrpc: '2.0', id, method, params }, signal);
    return readHttpAnswer(response.headers.get('content-type') ?? '', await response.text(), id);
  };
  const notify: Notify = async (method, params) => {
    await post({ jsonrpc: '2.0', method, params });
  };
  await handshake(send, notify);
  return { ...protocolCalls(send), close: () => undefined };
}
