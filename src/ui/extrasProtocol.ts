// The messages of the tabs MCP and Skills of the settings and of the skills
// of the field. They live apart from protocol.ts, the union of the protocol
// takes them in.
import type { UiSkill } from './skillMentions';

export type { UiSkill };

export interface UiMcpServer {
  name: string;
  // Where the server is declared: the setting or a plugin.
  source: string;
  transport: 'stdio' | 'http';
  // The command with its arguments or the url.
  target: string;
  status: 'running' | 'failed' | 'stopped';
  tools: string[];
  error?: string;
  // A server of the setting can be removed from the panel, a plugin cannot.
  removable: boolean;
}

export type ExtrasToWeb =
  | { type: 'skills'; items: UiSkill[] }
  | { type: 'mcp'; servers: UiMcpServer[] };

export type ExtrasToExt =
  | { type: 'request_extras' }
  | { type: 'open_skill'; name: string }
  | { type: 'mcp_restart' }
  | { type: 'mcp_open_settings' }
  | { type: 'mcp_add'; name: string; command?: string; args?: string[]; url?: string }
  | { type: 'mcp_remove'; name: string };
