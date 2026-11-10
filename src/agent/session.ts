import type { MiniMaxClient } from '../api/client';
import { fitHistory } from '../api/history';
import type { AnthropicMessage, EffortLevel } from '../api/types';
import type { AgentMode } from '../config/models';
import { Agent, type AgentEvent } from './agent';
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
      request: (request) => this.requestApproval(request.toolName, request.input)
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
  }

  approve(id: string, allowForSession: boolean): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve({ approved: true, allowForSession });
    }
  }

  reject(id: string): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve({ approved: false, allowForSession: false });
    }
  }

  async send(prompt: string): Promise<void> {
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
      effort: this.options.effort,
      thinking: this.options.thinking,
      mode: this.options.mode,
      systemPrompt,
      workspaceRoot: this.options.workspaceRoot,
      logger: this.options.logger,
      onEvent: (event) => this.options.onEvent(event)
    });

    const result = await this.agent.run(prompt, this.history);
    this.history = fitHistory(
      result.messages,
      this.options.historyLimit,
      this.options.contextWindow ?? 1_000_000,
      this.options.contextThreshold
    );
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
