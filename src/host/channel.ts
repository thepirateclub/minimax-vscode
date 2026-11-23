import type { MiniMaxController } from '../extension';
import type { AgentState, ExtToWeb } from '../ui/protocol';
import type { RuntimeSession } from './runtime';

export function postFor(host: MiniMaxController, runtime: RuntimeSession, message: ExtToWeb): void {
  if (runtime.id === host.activeSessionId) {
    host.panel.post(message);
  }
}


export function setState(host: MiniMaxController, state: AgentState, runtime?: RuntimeSession): void {
  // The state belongs to a chat: the events of a chat that runs in the
  // background do not write into the open one, and the chat keeps its
  // own dot for the moment the reader opens it again.
  const owner = runtime ?? host.activeSession();
  if (owner) {
    owner.state = state;
  }
  if (!runtime || runtime.id === host.activeSessionId) {
    host.agentState = state;
    host.statusBar.setState(state);
    host.panel.post({
      type: 'status',
      state,
      tokens: usageTotal(host, host.activeSession())
    });
    return;
  }
  host.statusBar.setState(state);
}


export function appendToAssistant(host: MiniMaxController, runtime: RuntimeSession,
  field: 'text' | 'thinking',
  text: string): void {
  for (let i = runtime.uiMessages.length - 1; i >= 0; i--) {
    const message = runtime.uiMessages[i]!;
    if (message.role === 'assistant' && !message.approval) {
      message[field] = (message[field] ?? '') + text;
      return;
    }
  }
  runtime.uiMessages.push({
    id: host.nextId('assistant'),
    role: 'assistant',
    [field]: text
  });
}


export function markStepTime(host: MiniMaxController, runtime: RuntimeSession): void {
  if (runtime.turnStartedAt === 0) {
    return;
  }
  const elapsed = Date.now() - runtime.turnStartedAt;
  if (elapsed < 0) {
    return;
  }
  for (let i = runtime.uiMessages.length - 1; i >= 0; i--) {
    const message = runtime.uiMessages[i]!;
    if (message.role === 'assistant' && !message.approval) {
      message.elapsedMs = elapsed;
      postFor(host, runtime, {
        type: 'step_time',
        id: message.id,
        elapsedMs: elapsed
      });
      return;
    }
  }
}


export function usageTotal(_host: MiniMaxController, runtime: RuntimeSession | undefined): number {
  if (!runtime) {
    return 0;
  }
  return runtime.usage.reduce(
    (sum, turn) => sum + turn.input + turn.output + (turn.cache ?? 0),
    0
  );
}

