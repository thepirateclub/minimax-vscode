import type { MiniMaxClient } from '../api/client';
import type {
  AnthropicMessage,
  EffortLevel,
  StopReason,
  Usage,
} from '../api/types';
import type { AgentMode } from '../config/models';
import type { ToolRegistry } from '../tools/registry';
import type { ChangedFile } from '../tools/types';
import type { ApprovalGate, DiffPreview } from '../ui/approvals';
import type { SessionState, ToolStateUpdate } from './state';
import type { Logger } from '../logger';
import type { FallbackModel } from './fallback';

export type AgentEvent =
  | { type: 'assistant_start' }
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; text: string }
  // The request runs again from the start: the piece of the broken answer
  // goes away, the new one takes its place.
  | { type: 'assistant_reset' }
  // The connection to MiniMax is lost, the request is repeated.
  | { type: 'retrying'; attempt: number; total: number; delayMs: number }
  // The chat model is not available, the turn goes on the fallback model.
  | { type: 'model_fallback'; from: string; to: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      content: string;
      isError: boolean;
      // The change of a file, it is taken before the write.
      diff?: DiffPreview;
      // The change of the state of the session, the host applies it.
      state?: ToolStateUpdate;
      // The files the tool changed, the host puts them in the list of the
      // changed files of the panel.
      changed?: ChangedFile[];
    }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'tool_progress'; id: string; line: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; stopReason: StopReason; usage: Usage }
  | { type: 'error'; message: string };

export interface AgentRunResult {
  messages: AnthropicMessage[];
  stopReason: StopReason;
  usage: Usage;
  // The place of the request in the history, the chat rolls back to it.
  requestIndex: number;
}

// The options of a run of the agent. The session and the agent share
// them, a field added here reaches both without a list of names.
export interface AgentRunOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  model: string;
  maxTokens: number;
  maxIterations: number;
  // How many times a request is repeated after the loss of the connection.
  // Zero turns the repeats off.
  maxRetries?: number;
  // The first pause between the attempts. The pause grows from it. The
  // tests use a small base, a real turn waits a second.
  retryBaseDelayMs?: number;
  effort?: EffortLevel;
  thinking?: 'adaptive';
  // The model of the turn when the chat model is not available.
  fallback?: FallbackModel;
  mode: AgentMode;
  systemPrompt: string;
  workspaceRoot: string;
  // How deep the agent is. Undefined is the main agent.
  depth?: number;
  // The budget of the goal. The agent stops when the guard says no.
  budget?: () => boolean;
  // The state of the session, the tools read it.
  sessionState?: SessionState;
  // The id of the session, the tools know who they work for.
  sessionId?: string;
  logger: Logger;
  onEvent: (event: AgentEvent) => void;
}

export interface AgentOptions extends AgentRunOptions {
  // The gate of the agent. The session builds its own gate and passes it.
  approval: ApprovalGate;
}
