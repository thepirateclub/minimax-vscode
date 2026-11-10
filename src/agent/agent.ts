import type { MiniMaxClient } from '../api/client';
import { balanceHistory } from '../api/history';
import { MiniMaxApiError } from '../api/errors';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  EffortLevel,
  StopReason,
  StreamEvent,
  Usage
} from '../api/types';
import type { AgentMode } from '../config/models';
import type { Logger } from '../logger';
import type { ToolRegistry } from '../tools/registry';
import { buildPreview } from '../tools/preview';
import type { ApprovalGate, DiffPreview } from '../ui/approvals';

export type AgentEvent =
  | { type: 'assistant_start' }
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      content: string;
      isError: boolean;
      // The change of a file, it is taken before the write.
      diff?: DiffPreview;
    }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'done'; stopReason: StopReason; usage: Usage }
  | { type: 'error'; message: string };

export interface AgentRunResult {
  messages: AnthropicMessage[];
  stopReason: StopReason;
  usage: Usage;
  // The place of the request in the history, the chat rolls back to it.
  requestIndex: number;
}

export interface AgentOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  approval: ApprovalGate;
  model: string;
  maxTokens: number;
  maxIterations: number;
  effort?: EffortLevel;
  thinking?: 'adaptive';
  mode: AgentMode;
  systemPrompt: string;
  workspaceRoot: string;
  logger: Logger;
  onEvent: (event: AgentEvent) => void;
}

const MAX_IDENTICAL_CALLS = 3;
const RETRY_DELAYS_MS = [1000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signatureOf(name: string, input: Record<string, unknown>): string {
  return name + ':' + JSON.stringify(input);
}

// One action can send several requests to the API, the spend of the action
// is the sum of all of them.
function addUsage(total: Usage, part: Usage): Usage {
  return {
    inputTokens: total.inputTokens + part.inputTokens,
    outputTokens: total.outputTokens + part.outputTokens,
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (part.cacheReadTokens ?? 0),
    cacheCreationTokens: (total.cacheCreationTokens ?? 0) + (part.cacheCreationTokens ?? 0)
  };
}

export class Agent {
  private readonly options: AgentOptions;
  private readonly controller = new AbortController();
  private pendingAssistantStart = true;

  constructor(options: AgentOptions) {
    this.options = options;
  }

  abort(): void {
    this.controller.abort();
  }

  async run(userText: string, history: AnthropicMessage[]): Promise<AgentRunResult> {
    // A history that breaks the rule of the calls and their results is
    // refused by the API, it is repaired before the request goes out.
    const messages: AnthropicMessage[] = balanceHistory([...history]);
    const last = messages[messages.length - 1];
    // The text of the request goes into its own message. A message that
    // carries the result of a tool call must not hold it, the API refuses
    // such a message with "tool call result does not follow tool call".
    const carriesResult =
      last?.role === 'user' && last.content.some((block) => block.type === 'tool_result');
    if (last && last.role === 'user' && !carriesResult) {
      // The protocol combines consecutive user turns, but a single turn keeps
      // the request valid even for a stricter implementation.
      messages[messages.length - 1] = {
        role: 'user',
        content: [...last.content, { type: 'text', text: userText }]
      };
    } else {
      messages.push({ role: 'user', content: [{ type: 'text', text: userText }] });
    }
    const requestIndex = messages.length - 1;
    const identicalCalls = new Map<string, number>();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

    for (let iteration = 0; iteration < this.options.maxIterations; iteration++) {
      this.pendingAssistantStart = true;
      const streamed = await this.streamWithRetry(messages);
      const blocks = streamed.blocks;
      usage = addUsage(usage, streamed.usage);

      messages.push({ role: 'assistant', content: blocks });

      const toolUses = blocks.filter(
        (block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use'
      );
      if (toolUses.length === 0) {
        this.options.onEvent({ type: 'done', stopReason: streamed.stopReason, usage });
        return { messages, stopReason: streamed.stopReason, usage, requestIndex };
      }

      const results: AnthropicContentBlock[] = [];
      for (const toolUse of toolUses) {
        const signature = signatureOf(toolUse.name, toolUse.input);
        const seen = (identicalCalls.get(signature) ?? 0) + 1;
        identicalCalls.set(signature, seen);

        if (seen > MAX_IDENTICAL_CALLS) {
          const message =
            'The same tool call was repeated ' +
            MAX_IDENTICAL_CALLS +
            ' times with identical arguments. Change the approach instead of repeating it.';
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: message,
            is_error: true
          });
          continue;
        }

        const entry = this.options.registry.get(toolUse.name);
        if (!entry) {
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Unknown tool: ' + toolUse.name,
            is_error: true
          });
          continue;
        }

        // The model should not even see this tool in plan mode, but a tool
        // call that slipped through is refused instead of executed.
        if (!this.options.registry.isAllowed(entry, this.options.mode)) {
          const message =
            'This tool is disabled in plan mode. The user has to switch the agent to code mode first.';
          this.options.onEvent({
            type: 'tool_start',
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input
          });
          this.options.onEvent({
            type: 'tool_end',
            id: toolUse.id,
            name: toolUse.name,
            content: message,
            isError: true
          });
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: message,
            is_error: true
          });
          continue;
        }

        const decision = await this.options.approval.approve(entry, toolUse.input);
        this.options.onEvent({
          type: 'approval_resolved',
          id: toolUse.id,
          approved: decision.approved
        });

        if (!decision.approved) {
          this.options.onEvent({
            type: 'tool_start',
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input
          });
          this.options.onEvent({
            type: 'tool_end',
            id: toolUse.id,
            name: toolUse.name,
            content: 'Rejected by the user.',
            isError: true
          });
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Rejected by the user.',
            is_error: true
          });
          continue;
        }

        this.options.onEvent({
          type: 'tool_start',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input
        });

        // The change of a file is taken before the write. After the write the
        // file on disk is already the new one and the change is gone.
        const diff = await this.previewOf(toolUse.name, toolUse.input);

        let content: string;
        let isError = false;
        try {
          const result = await entry.execute(toolUse.input, {
            workspaceRoot: this.options.workspaceRoot,
            signal: this.controller.signal,
            logger: this.options.logger
          });
          content = result.content;
          isError = result.isError === true;
        } catch (error) {
          content = error instanceof Error ? error.message : String(error);
          isError = true;
        }

        this.options.onEvent({
          type: 'tool_end',
          id: toolUse.id,
          name: toolUse.name,
          content,
          isError,
          diff
        });
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: isError
        });
      }

      messages.push({ role: 'user', content: results });
    }

    this.options.onEvent({ type: 'done', stopReason: 'max_iterations', usage });
    return { messages, stopReason: 'max_iterations', usage, requestIndex };
  }

  // The change of a file, it is taken before the write. A path outside of
  // the workspace throws inside the preview, the action still runs.
  private async previewOf(
    name: string,
    input: Record<string, unknown>
  ): Promise<DiffPreview | undefined> {
    try {
      return await buildPreview(name, input, this.options.workspaceRoot);
    } catch {
      return undefined;
    }
  }

  private async streamWithRetry(
    messages: AnthropicMessage[]
  ): Promise<{ blocks: AnthropicContentBlock[]; stopReason: StopReason; usage: Usage }> {
    let attempt = 0;
    for (;;) {
      let emitted = false;
      let blocks: AnthropicContentBlock[] = [];
      let stopReason: StopReason = 'end_turn';
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const stream = this.options.client.stream(
          {
            model: this.options.model,
            maxTokens: this.options.maxTokens,
            system: this.options.systemPrompt,
            messages: [...messages],
            tools: this.options.registry.toAnthropicTools(this.options.mode),
            effort: this.options.effort,
            thinking: this.options.thinking,
            signal: this.controller.signal
          },
          { signal: this.controller.signal }
        );
        for await (const event of stream) {
          this.handleEvent(event);
          if (event.type === 'text_delta' || event.type === 'thinking_delta') {
            emitted = true;
          }
          if (event.type === 'message_stop') {
            blocks = event.blocks;
            stopReason = event.stopReason;
            usage = event.usage;
          }
        }
        return { blocks, stopReason, usage };
      } catch (error) {
        const retryable = error instanceof MiniMaxApiError && error.retryable;
        // A request that the user stopped is not a failure of the server,
        // a retry would wait and fail again.
        if (
          this.controller.signal.aborted ||
          !retryable ||
          emitted ||
          attempt >= RETRY_DELAYS_MS.length
        ) {
          const message = error instanceof Error ? error.message : String(error);
          this.options.onEvent({ type: 'error', message });
          throw error;
        }
        const delay = RETRY_DELAYS_MS[attempt]!;
        attempt += 1;
        this.options.logger.info(
          'retrying MiniMax request in ' + delay + 'ms: ' + error.message
        );
        await sleep(delay);
      }
    }
  }

  private handleEvent(event: StreamEvent): void {
    if (event.type === 'text_delta') {
      this.startAssistantMessage();
      this.options.onEvent({ type: 'assistant_text', text: event.text });
    } else if (event.type === 'thinking_delta') {
      this.startAssistantMessage();
      this.options.onEvent({ type: 'assistant_thinking', text: event.text });
    }
  }

  private startAssistantMessage(): void {
    if (!this.pendingAssistantStart) {
      return;
    }
    this.pendingAssistantStart = false;
    this.options.onEvent({ type: 'assistant_start' });
  }

}
