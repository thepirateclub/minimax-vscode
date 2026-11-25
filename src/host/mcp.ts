import type { MiniMaxController } from '../extension';
import { connectHttp, connectStdio, type McpClient } from '../mcp/client';
import { mcpToolEntry, mergeServers, parseServers, pluginServers, type McpServer } from '../mcp/config';
import { getSettings } from '../config/settings';

// The running MCP servers and the names of their tools in the registry.
export interface McpState {
  clients: Map<string, McpClient>;
  tools: string[];
  // The servers of the last start, a change of the setting starts them again.
  signature: string;
}

export function createMcpState(): McpState {
  return { clients: new Map(), tools: [], signature: '' };
}

export function stopMcp(host: MiniMaxController): void {
  for (const client of host.mcp.clients.values()) {
    client.close();
  }
  host.mcp.clients.clear();
  for (const name of host.mcp.tools) {
    host.registry.unregister(name);
  }
  host.mcp.tools = [];
}

async function connect(server: McpServer, cwd: string): Promise<McpClient> {
  return 'url' in server.config
    ? await connectHttp(server.config)
    : await connectStdio({ ...server.config, ...(cwd ? { cwd } : {}) });
}

// Starts the servers of the setting and of the plugins and puts their tools
// into the registry. A server that fails is named in the log, the others
// work. The same set of servers is not started twice.
export async function startMcp(host: MiniMaxController, force = false): Promise<void> {
  const servers = mergeServers(
    parseServers(getSettings().mcpServers, 'the setting minimax.mcpServers'),
    await pluginServers()
  );
  const signature = JSON.stringify(servers);
  if (!force && signature === host.mcp.signature) {
    return;
  }
  stopMcp(host);
  host.mcp.signature = signature;
  for (const server of servers) {
    try {
      const client = await connect(server, host.workspaceRoot());
      host.mcp.clients.set(server.name, client);
      for (const tool of await client.listTools()) {
        const entry = mcpToolEntry(server.name, tool, () => host.mcp.clients.get(server.name));
        host.registry.register(entry);
        host.mcp.tools.push(entry.name);
      }
      host.logger.info('the MCP server ' + server.name + ' gave ' + host.mcp.tools.length + ' tool(s)');
    } catch (error) {
      host.logger.error('the MCP server ' + server.name + ' of ' + server.source + ' failed', error);
    }
  }
}
