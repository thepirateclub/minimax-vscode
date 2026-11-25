import { addRequestUsage } from '../ui/usageTurns';
import type { MiniMaxController } from '../extension';
import type { RuntimeSession } from './runtime';
import { isAbortMessage, stopNotice } from '../agent/stopReason';
import { getSettings } from '../config/settings';
import type { AgentEvent } from '../agent/agent';
import { dropApprovalCards } from './approvals';
import { postFor, appendToAssistant, setState, markStepTime } from './channel';
import { persist } from './sessions';
import { postSummary } from './workspace';

// How many actions the spend graph keeps in the header.

export function handleAgentEvent(host: MiniMaxController, runtime: RuntimeSession, event: AgentEvent): void {
  if (event.type === 'assistant_start') {
    runtime.uiMessages.push({ id: host.nextId('assistant'), role: 'assistant', text: '' });
    const last = runtime.uiMessages[runtime.uiMessages.length - 1];
    postFor(host, runtime, { type: 'assistant_start', id: last ? last.id : '' });
    return;
  }
  if (event.type === 'assistant_text') {
    appendToAssistant(host, runtime, 'text', event.text);
    postFor(host, runtime, { type: 'text_delta', text: event.text });
    setState(host, 'streaming', runtime);
    return;
  }
  if (event.type === 'assistant_thinking') {
    appendToAssistant(host, runtime, 'thinking', event.text);
    postFor(host, runtime, { type: 'thinking_delta', text: event.text });
    setState(host, 'thinking', runtime);
    return;
  }
  if (event.type === 'assistant_reset') {
    // The answer broke in the middle: the piece that came is not the
    // answer. The request runs again and the new text takes its place.
    for (let index = runtime.uiMessages.length - 1; index >= 0; index--) {
      const message = runtime.uiMessages[index]!;
      if (message.role === 'assistant' && !message.approval) {
        message.text = '';
        message.thinking = '';
        break;
      }
    }
    postFor(host, runtime, { type: 'assistant_reset' });
    return;
  }
  if (event.type === 'retrying') {
    // The connection to MiniMax is lost, the request is repeated. The
    // panel shows the attempt and the reader knows the agent works.
    postFor(host, runtime, {
      type: 'retry_status',
      status: { attempt: event.attempt, total: event.total, delayMs: event.delayMs }
    });
    setState(host, 'thinking');
    return;
  }
  if (event.type === 'tool_progress') {
    // The journal of the action: the lines that the tool writes while it
    // runs. They stay in the card of the action. The same id of a tool
    // call can come back in a later turn, the last card with that id
    // takes the line.
    for (let index = runtime.uiMessages.length - 1; index >= 0; index--) {
      const message = runtime.uiMessages[index]!;
      if (message.tool && message.tool.id === event.id) {
        message.tool.progress = [
          ...(message.tool.progress ?? []),
          event.line
        ];
        break;
      }
    }
    postFor(host, runtime, {
      type: 'tool_progress',
      id: event.id,
      line: event.line
    });
    return;
  }
  if (event.type === 'tool_start') {
    host.toolStarted.set(event.id, Date.now());
    runtime.uiMessages.push({
      id: event.id,
      role: 'tool',
      tool: { id: event.id, name: event.name, input: event.input, running: true }
    });
    postFor(host, runtime, { type: 'tool_start', id: event.id, name: event.name, input: event.input });
    setState(host, 'tool', runtime);
    return;
  }
  if (event.type === 'tool_end') {
    const started = host.toolStarted.get(event.id);
    host.toolStarted.delete(event.id);
    const durationMs = started === undefined ? undefined : Date.now() - started;
    // The result of the call stands in the content of the card, the
    // journal of the action lives in its own field. The same id of a tool
    // call can come back in a later turn, the content goes into the last
    // card with that id, the card of the earlier turn keeps its own
    // result.
    for (let index = runtime.uiMessages.length - 1; index >= 0; index--) {
      const message = runtime.uiMessages[index]!;
      if (message.tool && message.tool.id === event.id) {
        message.tool.content = event.content;
        message.tool.isError = event.isError;
        message.tool.running = false;
        if (event.diff) {
          message.tool.diff = event.diff;
        }
        if (durationMs !== undefined) {
          message.tool.durationMs = durationMs;
        }
        break;
      }
    }
    if (event.state?.kind === 'todos') {
      runtime.todos = event.state.todos;
      postFor(host, runtime, { type: 'todos', todos: runtime.todos });
      persist(host, runtime);
      // The tasks are done, the reader wants to see what changed.
      if (
        runtime.todos.length > 0 &&
        runtime.todos.every((item) => item.status === 'completed')
      ) {
        void postSummary(host, runtime);
      }
    }
    if (event.state?.kind === 'goal') {
      const goal = runtime.goal;
      if (goal) {
        goal.status = event.state.status;
        postFor(host, runtime, { type: 'goal', goal: { ...goal } });
        // The reason of the model stands in the card of the call: a notice
        // printed it twice and was lost on the reload of the panel, the
        // card stays in the saved chat.
        persist(host, runtime);
      }
    }
    postFor(host, runtime, {
      type: 'tool_end',
      id: event.id,
      name: event.name,
      content: event.content,
      isError: event.isError,
      durationMs,
      diff: event.diff
    });
    return;
  }
  if (event.type === 'approval_resolved') {
    return;
  }
  if (event.type === 'usage') {
    // Every request counts at once: the chart, the counter and the ledger
    // move while the turn runs, the requests of a sub-agent included.
    host.ledger.add({
      at: Date.now(),
      input: event.usage.inputTokens,
      output: event.usage.outputTokens,
      cacheRead: event.usage.cacheReadTokens ?? 0,
      cacheCreation: event.usage.cacheCreationTokens ?? 0
    });
    host.statusBar.setUsage(host.ledger.lastDay());
    const newTurn = runtime.usageTurnAt !== runtime.turnStartedAt || runtime.turnStartedAt === 0;
    runtime.usageTurnAt = runtime.turnStartedAt;
    runtime.usage = addRequestUsage(runtime.usage, event.usage, newTurn);
    postFor(host, runtime, { type: 'usage', turns: runtime.usage });
    const goal = runtime.goal;
    // The spend is counted for every status of the goal, the panel has to
    // show the truth.
    if (goal) {
      goal.used.tokens +=
        event.usage.inputTokens +
        event.usage.outputTokens +
        (event.usage.cacheReadTokens ?? 0) +
        (event.usage.cacheCreationTokens ?? 0);
      goal.used.requests += 1;
      postFor(host, runtime, { type: 'goal', goal: { ...goal } });
    }
    return;
  }
  if (event.type === 'done') {
    // The spend of the turn is already counted request by request.
    // The last message of the step tells how long the step took, and
    // the reason of the stop is named, a silent stop confuses.
    markStepTime(host, runtime);
    const goal = runtime.goal;
    if (goal && runtime.turnStartedAt > 0) {
      goal.used.seconds += (Date.now() - runtime.turnStartedAt) / 1000;
      // The widget of the goal shows the time of the turn, the panel has
      // to get the goal with the time that was added.
      postFor(host, runtime, { type: 'goal', goal: { ...goal } });
    }
    // The action is over, the reader sees the files it changed.
    void postSummary(host, runtime);
    const notice = stopNotice(event.stopReason, getSettings().maxIterations, goal);
    if (notice) {
      postFor(host, runtime, { type: 'notice', message: notice.message, kind: notice.kind });
    }
    dropApprovalCards(host, runtime, false);
    setState(host, 'idle', runtime);
    // The turn is over, the time of the turn is not running anymore.
    runtime.turnStartedAt = 0;
    // The repeats are over, the panel drops the status of the attempt.
    postFor(host, runtime, { type: 'retry_status', status: undefined });
    return;
  }
  if (event.type === 'error') {
    runtime.errorReported = true;
    runtime.lastError = event.message;
    // A turn that ended with an error has no event `done`, its time is
    // added here, otherwise the limit of the time is evaded by failing
    // turns.
    const goal = runtime.goal;
    if (goal && runtime.turnStartedAt > 0) {
      goal.used.seconds += (Date.now() - runtime.turnStartedAt) / 1000;
      // The widget of the goal shows the time of the turn, the panel has
      // to get the goal with the time that was added.
      postFor(host, runtime, { type: 'goal', goal: { ...goal } });
    }
    // Every question of the turn is over: the answer that never comes
    // must not stay in the chat as a dead card, and the card must not go
    // to the disk with the chat. The drop stands before the early return
    // of the stopped turn below: a turn cancelled from the window of the
    // editor takes that branch too.
    dropApprovalCards(host, runtime, false);
    if (isAbortMessage(event.message)) {
      // The user stopped the turn, it is not a failure of the server.
      runtime.turnStopped = true;
      postFor(host, runtime, {
        type: 'notice',
        message: 'The request was stopped.',
        kind: 'info'
      });
      markStepTime(host, runtime);
      setState(host, 'idle', runtime);
      // The turn is over, the time of the turn is not running anymore.
      runtime.turnStartedAt = 0;
      return;
    }
    postFor(host, runtime, { type: 'error', message: event.message });
    setState(host, 'error', runtime);
    // The turn is over, the time of the turn is not running anymore.
    runtime.turnStartedAt = 0;
    // The repeats are over, the panel drops the status of the attempt.
    postFor(host, runtime, { type: 'retry_status', status: undefined });
  }
}

