import type { ToolStateUpdate } from '../agent/state';
import type { JsonSchema } from '../api/types';
import type { Logger } from '../logger';

export interface ToolContext {
  workspaceRoot: string;
  signal: AbortSignal;
  logger: Logger;
  // How deep the agent is. Undefined is the main agent, 1 is a sub-agent.
  depth?: number;
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
  // The change of the state of the session, the host applies it.
  state?: ToolStateUpdate;
}

export type ApprovalPolicy = 'never' | 'always';

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  approval: ApprovalPolicy;
  // A side effect tool changes the workspace or runs a command, plan mode
  // hides those tools and refuses to run them.
  sideEffect: boolean;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult>;
}
