import type { SessionState, ToolStateUpdate } from '../agent/state';
import type { JsonSchema, Usage } from '../api/types';
import type { Logger } from '../logger';

export interface ToolContext {
  workspaceRoot: string;
  signal: AbortSignal;
  logger: Logger;
  // How deep the agent is. Undefined is the main agent, 1 is a sub-agent.
  depth?: number;
  // The state of the session, the tools read it.
  sessionState?: SessionState;
  // The journal of a long action, the tool writes the lines into it.
  progress?: (line: string) => void;
  // The id of the session that runs the tool.
  sessionId?: string;
}

// A file that the tool changed. The panel shows it in the list of the
// changed files with its status.
export type ChangedFileStatus = 'added' | 'modified' | 'deleted';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
  // The change of the state of the session, the host applies it.
  state?: ToolStateUpdate;
  // The files the tool changed, the host puts them in the list of the
  // changed files of the panel.
  changed?: ChangedFile[];
  // The spend of the sub-agents inside the call, it belongs to the same
  // action of the graph of the spend.
  usage?: Usage;
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
  // The tool exists only while this says so: a setting of the user turns it
  // on. The registry hides it from the model and refuses to run it.
  available?: () => boolean;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult>;
}
