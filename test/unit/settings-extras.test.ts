import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseServerForm, splitCommand } from '../../src/ui/webview/mcpForm';
import { McpSettings } from '../../src/ui/webview/components/settings/McpSettings';
import { SkillsSettings } from '../../src/ui/webview/components/settings/SkillsSettings';
import { skillSource } from '../../src/host/skillSource';

const noop = () => undefined;

// The tabs MCP and Skills of the settings.
describe('the form of an MCP server', () => {
  it('reads a command with its arguments and a url', () => {
    expect(splitCommand('npx -y "@scope/server files" .')).toEqual(['npx', '-y', '@scope/server files', '.']);
    expect(parseServerForm('fs', 'npx -y server .')).toEqual({ ok: true, server: { name: 'fs', command: 'npx', args: ['-y', 'server', '.'] } });
    expect(parseServerForm('web', 'https://mcp.example.com/mcp')).toEqual({ ok: true, server: { name: 'web', url: 'https://mcp.example.com/mcp' } });
  });

  it('waits for both fields and names a bad name', () => {
    expect(parseServerForm('', 'npx x')).toEqual({ ok: false });
    expect(parseServerForm('my server', 'npx x').ok).toBe(false);
  });
});

describe('the tabs of the settings', () => {
  it('shows the servers with their state and tools, a plugin server cannot be removed', () => {
    const markup = renderToStaticMarkup(
      createElement(McpSettings, {
        servers: [
          { name: 'fs', source: 'the setting minimax.mcpServers', transport: 'stdio', target: 'npx server', status: 'running', tools: ['read', 'write'], removable: true },
          { name: 'web', source: 'plugin research', transport: 'http', target: 'https://x', status: 'failed', tools: [], error: 'refused', removable: false }
        ],
        onAdd: noop, onRemove: noop, onRestart: noop, onOpenSettings: noop
      }) as ReactElement
    );
    expect(markup).toContain('mcp-dot mcp-running');
    expect(markup).toContain('2 tools: read, write');
    expect(markup).toContain('mcp-dot mcp-failed');
    expect(markup).toContain('refused');
    expect(markup.match(/extras-server/g)?.length).toBe(2);
    expect(markup.match(/aria-label="Remove the server"/g)?.length).toBe(1);
  });

  it('groups the skills by where they live and names them with the slash', () => {
    const markup = renderToStaticMarkup(
      createElement(SkillsSettings, {
        skills: [
          { name: 'review', description: 'Review the change', source: 'project', file: '/w/.minimax/skills/review/SKILL.md' },
          { name: 'pdf', description: 'Make a PDF', source: 'user', file: '/h/.claude/skills/pdf/SKILL.md' }
        ],
        onOpen: noop, onRefresh: noop
      }) as ReactElement
    );
    expect(markup.indexOf('This project')).toBeLessThan(markup.indexOf('/review'));
    expect(markup.indexOf('/review')).toBeLessThan(markup.indexOf('Your skills'));
    expect(markup).toContain('/pdf');
  });

  it('tells a skill of the project, of the user and of a plugin apart', () => {
    expect(skillSource('C:\\w\\.minimax\\skills\\a', 'C:\\w', '\\')).toBe('project');
    expect(skillSource('C:\\Users\\me\\.claude\\skills\\a', 'C:\\w', '\\')).toBe('user');
    expect(skillSource('C:\\Users\\me\\.minimax\\plugins\\p\\skills\\a', 'C:\\w', '\\')).toBe('plugin');
  });
});
