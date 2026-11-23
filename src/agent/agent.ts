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
import type { SessionState, ToolStateUpdate } from './state';

export type AgentEvent =
  | { type: 'assistant_start' }
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; text: string }
  // The request runs again from the start: the piece of the broken answer
  // goes away, the new one takes its place.
  | { type: 'assistant_reset' }
  // The connection to MiniMax is lost, the request is repeated.
  | { type: 'retrying'; attempt: number; total: number; delayMs: number }
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

export interface AgentOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  approval: ApprovalGate;
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

const MAX_IDENTICAL_CALLS = 3;
// How many times a request is repeated when the connection is lost.
export const DEFAULT_MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;

// The delay grows with every attempt: a second, two, four, eight. The
// server needs time, a fast second attempt hits the same overload.
export function retryDelay(attempt: number, baseMs = RETRY_BASE_DELAY_MS): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), RETRY_MAX_DELAY_MS);
}

function signatureOf(name: string, input: Record<string, unknown>): string {
  return name + ':' + JSON.stringify(input);
}

// A tool with a side effect that worked makes every answer of a reading tool
// stale: the model reads the file it has just written. Such a call is not a
// loop, so the counters of the reading tools go away. The counters of the
// tools with a side effect stay: a loop of identical writes is exactly what
// the guard is for.
function forgetReadCalls(counts: Map<string, number>, registry: ToolRegistry): void {
  const writePrefixes = registry
    .list()
    .filter((entry) => entry.sideEffect)
    .map((entry) => entry.name + ':');
  for (const key of [...counts.keys()]) {
    if (!writePrefixes.some((prefix) => key.startsWith(prefix))) {
      counts.delete(key);
    }
  }
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
      // The spend of every request goes to the host, the limits of the goal
      // are checked there.
      this.options.onEvent({ type: 'usage', usage: streamed.usage });

      messages.push({ role: 'assistant', content: blocks });

      const toolUses = blocks.filter(
        (block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use'
      );
      if (toolUses.length === 0) {
        this.options.onEvent({ type: 'done', stopReason: streamed.stopReason, usage });
        return { messages, stopReason: streamed.stopReason, usage, requestIndex };
      }

      // The budget of the goal. The request that just went out can be the one
      // that broke the budget, then the tools do not run and the model gets no
      // more work. The check does not stand at the top of the loop: an answer
      // that ends the turn without tools stays an answer.
      if (this.options.budget && !this.options.budget()) {
        this.options.onEvent({ type: 'done', stopReason: 'goal_limit', usage });
        return { messages, stopReason: 'goal_limit', usage, requestIndex };
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
          // The refusal is a card of its own. The model sees the reason, the
          // reader has to see it too, a silent refusal is a defect.
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

        const entry = this.options.registry.get(toolUse.name);
        if (!entry) {
          const message = 'Unknown tool: ' + toolUse.name;
          // The refusal is a card of its own, the reader sees the reason.
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
        let state: ToolStateUpdate | undefined;
        try {
          const result = await entry.execute(toolUse.input, {
            workspaceRoot: this.options.workspaceRoot,
            signal: this.controller.signal,
            logger: this.options.logger,
            depth: this.options.depth,
            sessionId: this.options.sessionId,
            sessionState: this.options.sessionState,
            progress: (line) =>
              this.options.onEvent({ type: 'tool_progress', id: toolUse.id, line })
          });
          // The spend of the child belongs to the action of the parent, the
          // column of the graph of the spend holds the sum. It is not added to
          // the `usage` event of the parent: the host counts the budget of the
          // goal from the `usage` events only, and the child sends its own
          // `usage` events to the host, so the child would be counted twice
          // against the budget of the goal.
          if (result.usage) {
            usage = addUsage(usage, result.usage);
          }
          content = result.content;
          isError = result.isError === true;
          state = result.state;
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
          diff,
          state
        });
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: isError
        });
        // The write worked, the world changed: the same read is a new read.
        if (entry.sideEffect && !isError) {
          forgetReadCalls(identicalCalls, this.options.registry);
        }
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
  ): Promise<{
    blocks: AnthropicContentBlock[];
    stopReason: StopReason;
    usage: Usage;
  }> {
    const maxRetries = Math.max(0, this.options.maxRetries ?? DEFAULT_MAX_RETRIES);
    const baseDelay = this.options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
    let attempt = 0;
    for (;;) {
      let emitted = false;
      let blocks: AnthropicContentBlock[] = [];
      let stopReason: StopReason = 'end_turn';
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      // The budget of the goal ran out in the middle of the answer.
      let budgetStopped = false;
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
          // The budget of the goal is checked before every event of the
          // stream: a long answer stops in the middle of the turn when
          // the time of the goal is over. Only the limit of the time can
          // trip here, the spend of the request is counted after it.
          if (this.options.budget && !this.options.budget()) {
            budgetStopped = true;
            break;
          }
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
        if (budgetStopped) {
          // The answer was cut. The text that came stays visible in the
          // panel, the tools of the request do not run and the history
          // keeps no call without a result.
          blocks = [];
          stopReason = 'goal_limit';
        }
        return { blocks, stopReason, usage };
      } catch (error) {
        const retryable = error instanceof MiniMaxApiError && error.retryable;
        // A request that the user stopped is not a failure of the server,
        // a retry would wait and fail again.
        if (this.controller.signal.aborted || !retryable || attempt >= maxRetries) {
          const message = error instanceof Error ? error.message : String(error);
          this.options.onEvent({ type: 'error', message });
          throw error;
        }
        const delay = retryDelay(attempt, baseDelay);
        attempt += 1;
        if (emitted) {
          // The answer broke in the middle: the piece that came is not the
          // answer, the whole request runs again.
          this.options.onEvent({ type: 'assistant_reset' });
        }
        this.options.onEvent({
          type: 'retrying',
          attempt,
          total: maxRetries,
          delayMs: delay
        });
        this.options.logger.info(
          'retrying MiniMax request in ' + delay + 'ms: ' + error.message
        );
        await this.waitBeforeRetry(delay);
      }
    }
  }

  // The pause between the attempts ends at once when the user stops the
  // turn, the panel must not wait for the delay.
  private async waitBeforeRetry(ms: number): Promise<void> {
    if (this.controller.signal.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.controller.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.controller.signal.addEventListener('abort', onAbort, { once: true });
    });
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
