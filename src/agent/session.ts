import { balanceHistory, fitHistory } from '../api/history';
import type { AnthropicMessage } from '../api/types';
import { Agent } from './agent';
import type { AgentRunOptions } from './types';
import { buildPreview } from '../tools/preview';
import { approvalFiles } from '../tools/delete';
import { ApprovalGate, type ApprovalDecision } from '../ui/approvals';
import type { UiApproval } from '../ui/protocol';

export interface SessionOptions extends AgentRunOptions {
  // The context window of the model, the history is cut to fit into it.
  contextWindow?: number;
  // How many messages the history keeps before the old turns are cut.
  historyLimit: number;
  // The share of the context window the history may take, in percent.
  contextThreshold: number;
  // The permissions of the session. The gate of the agent uses this list,
  // the gate of a child of this session shares it.
  sessionApproved?: Set<string>;
  // The state of the repository is read before every turn, the prompt of
  // the model carries the fresh one.
  contextProvider?: () => Promise<string>;
  autoApprove: string[];
  onApproval: (approval: UiApproval) => void;
}

// The counter of the approvals of the whole host. The reader can answer a
// card of a chat that is not open, the id of the approval must not point at
// a call of another chat.
let approvalCounter = 0;

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
    // The options of the session carry the options of the agent, a new
    // field of the agent reaches it without a list of names here.
    const run: AgentRunOptions = this.options;
    this.agent = new Agent({
      ...run,
      approval: this.approval,
      systemPrompt,
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
    approvalCounter += 1;
    const id =
      toolName + '-' + Date.now().toString(36) + '-' + approvalCounter + '-' + this.approvalCounter;
    const approval: UiApproval = { id, name: toolName, input };
    if (preview) {
      approval.preview = { path: preview.path, lines: preview.lines };
    }
    // The card of a deletion lists the files with their size: the reader
    // sees what goes away before he answers.
    const files = await approvalFiles(toolName, input, this.options.workspaceRoot);
    if (files.length > 0) {
      approval.files = files;
    }
    return await new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(id, resolve);
      this.options.onApproval(approval);
    });
  }
}
