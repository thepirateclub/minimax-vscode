import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { MiniMaxController } from '../extension';
import { discoverSkills, type Skill } from '../skills/skills';
import type { ExtrasToExt, UiMcpServer, UiSkill } from '../ui/extrasProtocol';
import { startMcp } from './mcp';
import { skillSource } from './skillSource';

// The tabs MCP and Skills of the settings and the skills of the field.

function toUiSkill(skill: Skill, root: string): UiSkill {
  return {
    name: skill.name,
    description: skill.description,
    source: skillSource(skill.dir, root),
    file: join(skill.dir, 'SKILL.md')
  };
}

export async function postSkills(host: MiniMaxController): Promise<void> {
  const root = host.workspaceRoot();
  const skills = await discoverSkills(root, homedir()).catch(() => []);
  host.panel.post({ type: 'skills', items: skills.map((skill) => toUiSkill(skill, root)) });
}

export function postMcp(host: MiniMaxController): void {
  const servers: UiMcpServer[] = [...host.mcp.servers.values()];
  host.panel.post({ type: 'mcp', servers });
}

// The servers of the setting minimax.mcpServers, the user scope only.
function userServers(): Record<string, unknown> {
  const inspected = vscode.workspace.getConfiguration('minimax').inspect<Record<string, unknown>>('mcpServers');
  return { ...(inspected?.globalValue ?? {}) };
}

async function writeServers(servers: Record<string, unknown>): Promise<void> {
  await vscode.workspace
    .getConfiguration('minimax')
    .update('mcpServers', servers, vscode.ConfigurationTarget.Global);
}

export async function handleExtrasMessage(host: MiniMaxController, message: ExtrasToExt): Promise<void> {
  if (message.type === 'request_extras') {
    await postSkills(host);
    postMcp(host);
    return;
  }
  if (message.type === 'open_skill') {
    // Only a skill the extension found opens: the panel does not name files.
    const skills = await discoverSkills(host.workspaceRoot(), homedir()).catch(() => []);
    const skill = skills.find((item) => item.name === message.name);
    if (skill) {
      await vscode.window.showTextDocument(vscode.Uri.file(join(skill.dir, 'SKILL.md')));
    }
    return;
  }
  if (message.type === 'mcp_open_settings') {
    await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    return;
  }
  if (message.type === 'mcp_restart') {
    await startMcp(host, true);
    postMcp(host);
    return;
  }
  if (message.type === 'mcp_add') {
    const name = message.name.trim();
    if (!name) {
      return;
    }
    const servers = userServers();
    servers[name] = message.url
      ? { url: message.url }
      : { command: message.command ?? '', args: message.args ?? [] };
    // The change of the setting starts the servers again (onSettingsChanged).
    await writeServers(servers);
    return;
  }
  if (message.type === 'mcp_remove') {
    const servers = userServers();
    delete servers[message.name];
    await writeServers(servers);
  }
}
