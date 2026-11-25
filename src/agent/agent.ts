import { findLeakedCall, leakedCallNotice } from '../api/leakedCalls';

import { clearOldToolResults } from '../api/clearResults';
import { balanceHistory } from '../api/history';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  StreamEvent,
  Usage,
} from '../api/types';
import {
  addUsage,
  forgetReadCalls,
  MAX_IDENTICAL_CALLS,
  previewOf,
  signatureOf, progressCheck, todoCheck, noteCheck, isReadingCall } from './toolRunner';
import { streamWithRetry } from './retry';
import type { AgentOptions, AgentRunResult } from './types';
export { DEFAULT_MAX_RETRIES, retryDelay } from './retry';
export type { AgentEvent, AgentOptions, AgentRunOptions, AgentRunResult } from './types';
import type { ToolStateUpdate } from './state';
import type { ChangedFile } from '../tools/types';

// The answers in a row with a call of a tool in the text, then the turn ends.
const MAX_LEAKS = 2;



// One action can send several requests to the API, the spend of the action
// is the sum of all of them.

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
    // The actions of the turn, the check of the progress counts them.
    let actions = 0;
    // The actions since the last todo_write, for the reminder of the list.
    let sinceTodo = 0;
    // The reading actions since the last note_write, for the reminder of the notes.
    let sinceNote = 0;
    // The answers in a row whose call of a tool came as text.
    let leaks = 0;
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

    for (let iteration = 0; iteration < this.options.maxIterations; iteration++) {
      this.pendingAssistantStart = true;
      // The request carries the old long results of the tools as stubs, the
      // history of the run keeps them whole (src/api/clearResults.ts).
      const request = clearOldToolResults(messages);
      const streamed = await streamWithRetry(this.options, this.controller, request, (event) => this.handleEvent(event));
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
        // The call came as text and did not run: the model is told so and
        // calls again. Two such answers in a row end the turn as they are.
        const text = blocks.map((block) => (block.type === 'text' ? block.text : '')).join('');
        const leak = findLeakedCall(text);
        if (leak && leaks < MAX_LEAKS) {
          leaks += 1;
          messages.push({ role: 'user', content: [{ type: 'text', text: leakedCallNotice(leak) }] });
          continue;
        }
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
        const diff = await previewOf(this.options.workspaceRoot, toolUse.name, toolUse.input);

        let content: string;
        let isError = false;
        let state: ToolStateUpdate | undefined;
        // The files the tool changed, the panel shows them with their
        // status.
        let changed: ChangedFile[] | undefined;
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
          changed = result.changed;
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
          state,
          changed
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

      // The note rides on the last result: a text block next to the results
      // breaks the protocol of MiniMax (2013).
      sinceTodo = toolUses.some((use) => use.name === 'todo_write') ? 0 : sinceTodo + toolUses.length;
      const reminder = (this.options.depth ?? 0) === 0 ? todoCheck(this.options.sessionState?.todos ?? [], sinceTodo) : undefined;
      if (reminder) {
        sinceTodo = 0;
      }
      const main = (this.options.depth ?? 0) === 0;
      const reads = toolUses.filter((use) => isReadingCall(use.name, this.options.registry.get(use.name)?.sideEffect ?? true)).length;
      sinceNote = toolUses.some((use) => use.name === 'note_write') ? 0 : sinceNote + reads;
      const noteReminder = main && this.options.registry.get('note_write') ? noteCheck(sinceNote) : undefined;
      if (noteReminder) {
        sinceNote = 0;
      }
      const check = (progressCheck(actions, actions + toolUses.length) ?? '') + (reminder ?? '') + (noteReminder ?? '');
      actions += toolUses.length;
      const last = results[results.length - 1];
      if (check && last && last.type === 'tool_result') {
        last.content = (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)) + check;
      }
      messages.push({ role: 'user', content: results });
    }

    this.options.onEvent({ type: 'done', stopReason: 'max_iterations', usage });
    return { messages, stopReason: 'max_iterations', usage, requestIndex };
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
