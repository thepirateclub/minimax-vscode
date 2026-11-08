import type { JsonSchema } from '../api/types';
import type { Logger } from '../logger';

export interface ToolContext {
  workspaceRoot: string;
  signal: AbortSignal;
  logger: Logger;
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export type ApprovalPolicy = 'never' | 'always';

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  approval: ApprovalPolicy;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult>;
}
