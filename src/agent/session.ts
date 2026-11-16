import type { MiniMaxClient } from '../api/client';
import { balanceHistory, fitHistory } from '../api/history';
import type { AnthropicMessage, EffortLevel } from '../api/types';
import type { AgentMode } from '../config/models';
import { Agent, type AgentEvent } from './agent';
import type { SessionState } from './state';
import type { Logger } from '../logger';
import { buildPreview } from '../tools/preview';
import type { ToolRegistry } from '../tools/registry';
import { ApprovalGate, type ApprovalDecision } from '../ui/approvals';
import type { UiApproval } from '../ui/protocol';

export interface SessionOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  model: string;
  maxTokens: number;
  maxIterations: number;
  // How many times a request is repeated after the loss of the connection.
  maxRetries?: number;
  // The first pause between the attempts, the pause grows from it.
  retryBaseDelayMs?: number;
  effort: EffortLevel;
  thinking?: 'adaptive';
  // The context window of the model, the history is cut to fit into it.
  contextWindow?: number;
  // How many messages the history keeps before the old turns are cut.
  historyLimit: number;
  // The share of the context window the history may take, in percent.
  contextThreshold: number;
  mode: AgentMode;
  systemPrompt: string;
  // How deep the agent is. Undefined is the main agent.
  depth?: number;
  // The budget of the goal. The agent stops when the guard says no.
  budget?: () => boolean;
  // The state of the session, the tools read it.
  sessionState?: SessionState;
  // The id of the session, the tools know who they work for.
  sessionId?: string;
  // The permissions of the session. The gate of the agent uses this list,
  // the gate of a child of this session shares it.
  sessionApproved?: Set<string>;
  // The state of the repository is read before every turn, the prompt of
  // the model carries the fresh one.
  contextProvider?: () => Promise<string>;
  workspaceRoot: string;
  logger: Logger;
  autoApprove: string[];
  onEvent: (event: AgentEvent) => void;
  onApproval: (approval: UiApproval) => void;
}

export class AgentSession {
  private readonly options: SessionOptions;
  private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly approval: ApprovalGate;
  private history: AnthropicMessage[] = [];
  private agent: Agent | undefined;
  private systemPrompt: string;
  private approvalCounter = 0;

  constructor(options: SessionOptions) {
    this.options = options;
    this.systemPrompt = options.systemPrompt;
    this.approval = new ApprovalGate({
      autoApprove: options.autoApprove,
      request: (request) => this.requestApproval(request.toolName, request.input),
      // The gate of the session, a child of this session shares it.
      sessionApproved: options.sessionApproved
    });
  }

  getHistory(): AnthropicMessage[] {
    return this.history;
  }

  setHistory(messages: AnthropicMessage[]): void {
    this.history = [...messages];
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  setAutoApprove(names: string[]): void {
    this.approval.setAutoApprove(names);
  }

  stop(): void {
    this.agent?.abort();
    // The turn waits for the answer of the reader, a stop must end it:
    // every approval that waits is rejected.
    for (const [id, resolve] of this.pending) {
      this.pending.delete(id);
      resolve({ approved: false, allowForSession: false });
    }
  }

  approve(id: string, allowForSession: boolean): boolean {
    const resolve = this.pending.get(id);
    if (!resolve) {
      return false;
    }
    this.pending.delete(id);
    resolve({ approved: true, allowForSession });
    return true;
  }

  reject(id: string): boolean {
    const resolve = this.pending.get(id);
    if (!resolve) {
      return false;
    }
    this.pending.delete(id);
    resolve({ approved: false, allowForSession: false });
    return true;
  }

  // The turn runs and the history comes back. The place of the request in
  // the history comes with it, the chat rolls back to that place.
  async send(prompt: string): Promise<number> {
    const context = this.options.contextProvider
      ? await this.options.contextProvider()
      : '';
    const systemPrompt =
      context.length > 0 ? this.systemPrompt + '\n\n' + context : this.systemPrompt;
    this.agent = new Agent({
      client: this.options.client,
      registry: this.options.registry,
      approval: this.approval,
      model: this.options.model,
      maxTokens: this.options.maxTokens,
      maxIterations: this.options.maxIterations,
      maxRetries: this.options.maxRetries,
      retryBaseDelayMs: this.options.retryBaseDelayMs,
      effort: this.options.effort,
      thinking: this.options.thinking,
      mode: this.options.mode,
      systemPrompt,
      workspaceRoot: this.options.workspaceRoot,
      depth: this.options.depth,
      sessionId: this.options.sessionId,
      budget: this.options.budget,
      sessionState: this.options.sessionState,
      logger: this.options.logger,
      onEvent: (event) => this.options.onEvent(event)
    });

    const result = await this.agent.run(prompt, this.history);
    const balanced = balanceHistory(result.messages);
    const kept = fitHistory(
      balanced,
      this.options.historyLimit,
      this.options.contextWindow ?? 1_000_000,
      this.options.contextThreshold
    );
    this.history = kept;
    // The request is found by itself, the same text can stand in the
    // history more than once.
    const request = result.messages[result.requestIndex];
    return request ? kept.indexOf(request) : -1;
  }

  private async requestApproval(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ApprovalDecision> {
    const preview = await buildPreview(toolName, input, this.options.workspaceRoot);
    this.approvalCounter += 1;
    const id = toolName + '-' + Date.now().toString(36) + '-' + this.approvalCounter;
    const approval: UiApproval = { id, name: toolName, input };
    if (preview) {
      approval.preview = { path: preview.path, lines: preview.lines };
    }
    return await new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(id, resolve);
      this.options.onApproval(approval);
    });
  }
}
