import type { MiniMaxController } from '../extension';
import { canFixAgain, exitCodeOf, shouldVerify, verifyPrompt } from '../agent/verify';
import { getSettings } from '../config/settings';
import { createTerminalTools } from '../tools/terminal';
import { postFor } from './channel';
import { handleAgentEvent } from './events';
import type { RuntimeSession } from './runtime';

// The check of the project after a turn of the agent that changed files.
// The run stands in the feed as a card of a command, the reader sees what
// ran and what it said. A failure becomes the next request of the chat.
// The answer is the request of the fix, or undefined when nothing follows.
export async function verifyTurn(
  host: MiniMaxController,
  runtime: RuntimeSession,
  startedAt: number
): Promise<string | undefined> {
  const settings = getSettings();
  const changed = (await host.backups.list()).some(
    (entry) => entry.sessionId === runtime.id && entry.createdAt >= startedAt
  );
  const state = {
    command: settings.verifyCommand,
    changed,
    stopped: runtime.turnStopped,
    failed: runtime.errorReported,
    mode: settings.mode,
    round: runtime.verifyRound ?? 0,
    maxRounds: settings.verifyRounds
  };
  if (!shouldVerify(state) || runtime.deleted) {
    return undefined;
  }
  const id = host.nextId('verify');
  const input = { command: settings.verifyCommand };
  handleAgentEvent(host, runtime, { type: 'tool_start', id, name: 'run_terminal', input });
  const [terminal] = createTerminalTools();
  const result = await terminal!.execute(input, {
    workspaceRoot: runtime.workspaceRoot,
    signal: new AbortController().signal,
    logger: host.logger,
    sessionId: runtime.id,
    progress: (line) => handleAgentEvent(host, runtime, { type: 'tool_progress', id, line })
  });
  const failed = result.isError === true || (exitCodeOf(result.content) ?? 0) !== 0;
  handleAgentEvent(host, runtime, {
    type: 'tool_end',
    id,
    name: 'run_terminal',
    content: result.content,
    isError: failed
  });
  if (!failed) {
    runtime.verifyRound = 0;
    postFor(host, runtime, { type: 'notice', message: 'The project check passed: ' + settings.verifyCommand, kind: 'info' });
    return undefined;
  }
  if (!canFixAgain(state)) {
    runtime.verifyRound = 0;
    postFor(host, runtime, {
      type: 'notice',
      message: 'The project check still fails after ' + state.maxRounds + ' rounds of fixes, the agent waits for you.',
      kind: 'warn'
    });
    return undefined;
  }
  runtime.verifyRound = state.round + 1;
  return verifyPrompt(settings.verifyCommand, result.content);
}
