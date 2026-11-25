// The MCP servers of the agent and their tools. The servers come from two
// places the user owns: the setting minimax.mcpServers and the *.mcp.json of
// the plugin packages in ~/.minimax/plugins. A file of the workspace never
// starts a server: a cloned repository would run its command on the machine
// of the reader.

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpCallResult, McpClient, McpTool } from './client';
import type { ToolEntry } from '../tools/types';

export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { url: string; headers?: Record<string, string> };

export interface McpServer {
  name: string;
  config: McpServerConfig;
  // Where the server is declared, the note of a failure names it.
  source: string;
}

const MAX_RESULT_CHARS = 60_000;

function asStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function asRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

// One server of the `mcpServers` object, the form of Claude, Cursor and the
// plugins of MiniMax: a command with its arguments, or a url.
export function parseServerConfig(value: unknown): McpServerConfig | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record['disabled'] === true) {
    return undefined;
  }
  if (typeof record['url'] === 'string' && /^https?:\/\//i.test(record['url'])) {
    const headers = asRecord(record['headers']);
    return { url: record['url'], ...(headers ? { headers } : {}) };
  }
  if (typeof record['command'] === 'string' && record['command'].trim().length > 0) {
    const args = asStrings(record['args']);
    const env = asRecord(record['env']);
    return { command: record['command'], ...(args ? { args } : {}), ...(env ? { env } : {}) };
  }
  return undefined;
}

// `{ "mcpServers": { name: config } }` or the bare object of the servers.
export function parseServers(value: unknown, source: string): McpServer[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const servers = (typeof record['mcpServers'] === 'object' && record['mcpServers'] !== null
    ? record['mcpServers']
    : record) as Record<string, unknown>;
  const found: McpServer[] = [];
  for (const [name, config] of Object.entries(servers)) {
    const parsed = parseServerConfig(config);
    if (parsed) {
      found.push({ name, config: parsed, source });
    }
  }
  return found;
}

// The servers of the plugin packages of the user: plugin.json names its
// *.mcp.json files, every one holds `mcpServers`.
export async function pluginServers(home: string = homedir()): Promise<McpServer[]> {
  const root = join(home, '.minimax', 'plugins');
  let packages: string[];
  try {
    packages = await readdir(root);
  } catch {
    return [];
  }
  const servers: McpServer[] = [];
  for (const name of packages.sort()) {
    const dir = join(root, name);
    try {
      const manifest: unknown = JSON.parse(await readFile(join(dir, '.minimax-plugin', 'plugin.json'), 'utf8'));
      const files = asStrings((manifest as { mcpServers?: unknown }).mcpServers) ?? [];
      for (const file of files) {
        const text = await readFile(join(dir, file), 'utf8');
        servers.push(...parseServers(JSON.parse(text), 'plugin ' + name));
      }
    } catch {
      continue;
    }
  }
  return servers;
}

// The setting wins over a plugin with the same name.
export function mergeServers(...lists: McpServer[][]): McpServer[] {
  const byName = new Map<string, McpServer>();
  for (const list of lists) {
    for (const server of list) {
      if (!byName.has(server.name)) {
        byName.set(server.name, server);
      }
    }
  }
  return [...byName.values()];
}

// The name of the tool for the model: mcp__server__tool, the characters the
// API takes, 64 at most.
export function mcpToolName(server: string, tool: string): string {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
  return ('mcp__' + clean(server) + '__' + clean(tool)).slice(0, 64);
}

export function formatCallResult(result: McpCallResult): string {
  const parts = (result.content ?? []).map((item) =>
    item.type === 'text' && typeof item.text === 'string' ? item.text : '[' + item.type + ' content]'
  );
  const text = parts.join('\n').trim() || '(no content)';
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '\n[truncated]' : text;
}

// The tool of a server as a tool of the registry. The server is not ours:
// every call asks the user, a rule of minimax.autoApprove may allow it. A
// tool that the server marks read-only stays in the plan mode.
export function mcpToolEntry(server: string, tool: McpTool, client: () => McpClient | undefined): ToolEntry {
  return {
    name: mcpToolName(server, tool.name),
    description: '[MCP server ' + server + '] ' + (tool.description ?? tool.name),
    // The schema of the server is json schema already, the API takes it as it is.
    inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as unknown as ToolEntry['inputSchema'],
    approval: 'always',
    sideEffect: tool.annotations?.readOnlyHint !== true,
    async execute(input, ctx) {
      const current = client();
      if (!current) {
        return { content: 'The MCP server ' + server + ' is not running.', isError: true };
      }
      try {
        const result = await current.callTool(tool.name, input, ctx.signal);
        return { content: formatCallResult(result), ...(result.isError ? { isError: true } : {}) };
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true };
      }
    }
  };
}
