import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectStdio, readHttpAnswer } from '../../src/mcp/client';
import { formatCallResult, mcpToolEntry, mcpToolName, mergeServers, parseServers } from '../../src/mcp/config';
import { describe as describeCard } from '../../src/ui/webview/components/toolDescriptions';

const ctx = {
  workspaceRoot: '',
  signal: new AbortController().signal,
  logger: { info: () => undefined, error: () => undefined }
};

// The agent takes the tools of MCP servers: the setting of the user and the
// plugins of MiniMax declare them in the form of Claude and Cursor.
describe('the MCP servers', () => {
  it('reads the servers of a config and skips the broken and the disabled', () => {
    const servers = parseServers(
      {
        mcpServers: {
          files: { command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' } },
          web: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } },
          off: { command: 'x', disabled: true },
          broken: { args: [] }
        }
      },
      'setting'
    );
    expect(servers.map((server) => [server.name, server.config])).toEqual([
      ['files', { command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' } }],
      ['web', { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } }]
    ]);
    const plugin = parseServers({ files: { command: 'other' } }, 'plugin');
    expect(mergeServers(servers, plugin).find((server) => server.name === 'files')?.source).toBe('setting');
  });

  it('names a tool for the API and the card names it in words', () => {
    expect(mcpToolName('my server', 'create.issue')).toBe('mcp__my_server__create_issue');
    expect(describeCard({ id: '1', name: 'mcp__github__create_issue', input: {} }, true).title).toBe(
      'github: create issue'
    );
  });

  it('talks to a server over stdio and asks before a call that may change things', async () => {
    const client = await connectStdio({ command: process.execPath, args: [join(__dirname, '..', 'helpers', 'fakeMcpServer.mjs')] });
    try {
      const tools = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['echo']);
      const entry = mcpToolEntry('fake', tools[0]!, () => client);
      expect(entry).toMatchObject({ name: 'mcp__fake__echo', approval: 'always', sideEffect: false });
      expect(await entry.execute({ text: 'hi' }, ctx)).toEqual({ content: 'echo: hi' });
      expect(mcpToolEntry('fake', { name: 'write' }, () => client).sideEffect).toBe(true);
    } finally {
      client.close();
    }
  });

  it('reads the answer of the HTTP transport as json or as events', () => {
    expect(readHttpAnswer('application/json', '{"jsonrpc":"2.0","id":3,"result":{"ok":1}}', 3)).toEqual({ ok: 1 });
    const events = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":4,"result":{"tools":[]}}\n\n';
    expect(readHttpAnswer('text/event-stream', events, 4)).toEqual({ tools: [] });
    expect(() => readHttpAnswer('application/json', '{"jsonrpc":"2.0","id":5,"error":{"message":"nope"}}', 5)).toThrow('nope');
  });

  it('gives the text of a result and names the other content', () => {
    expect(formatCallResult({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] })).toBe('a\n[image content]');
    expect(formatCallResult({ content: [] })).toBe('(no content)');
  });

  it('says the server is gone instead of failing', async () => {
    const entry = mcpToolEntry('gone', { name: 'x' }, () => undefined);
    expect(await entry.execute({}, ctx)).toEqual({ content: 'The MCP server gone is not running.', isError: true });
  });
});

describe('the transport of a server by url', () => {
  it('sends the headers only over https or to this machine', () => {
    const servers = parseServers({
      remote: { url: 'http://example.com/mcp', headers: { Authorization: 'Bearer t' } },
      secure: { url: 'https://example.com/mcp' },
      local: { url: 'http://localhost:3000/mcp' }
    }, 'settings');
    expect(servers.map((server) => server.name).sort()).toEqual(['local', 'secure']);
  });

  it('names a broken answer instead of a raw exception', () => {
    expect(() => readHttpAnswer('application/json', '{oops', 1)).toThrow(/broken answer/);
  });
});
