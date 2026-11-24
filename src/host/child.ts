import type { MiniMaxController } from '../extension';
import type { AnthropicMessage } from '../api/types';
import { Agent } from '../agent/agent';
import { HttpMiniMaxClient } from '../api/client';
import { MODELS, resolveBaseUrl } from '../config/models';
import { getApiKey } from '../config/secrets';
import { getSettings } from '../config/settings';
import type { RuntimeSession } from './runtime';
import { childApproval, releaseChildApprovals } from './approvals';
import { handleAgentEvent } from './events';
import { ToolRegistry } from '../tools/registry';
import { actionInput, CHILD_MAX_ITERATIONS, ROLE_PROMPTS, toolAllowedForRole } from '../tools/task';
import type { ToolContext } from '../tools/types';
import type { TaskRole, TaskRequest, TaskOutcome } from '../tools/task';
import type { AgentEvent, AgentRunResult } from '../agent/agent';
import { sessionContext, buildPrompt, goalBudgetOk, effortFor, thinkingMode } from './setup';

// The answer of the child is the text of its last message.
function finalText(messages: AnthropicMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== 'assistant') {
      continue;
    }
    const parts = message.content.flatMap((block) =>
      block.type === 'text' ? [block.text] : []
    );
    const text = parts.join('\n').trim();
    if (text.length > 0) {
      return text;
    }
  }
  return '';
}
export function registryForRole(host: MiniMaxController, role: TaskRole): ToolRegistry {
  const registry = new ToolRegistry();
  for (const entry of host.registry.list()) {
    if (toolAllowedForRole(entry, role)) {
      registry.register(entry);
    }
  }
  return registry;
}


export function handleChildEvent(host: MiniMaxController, runtime: RuntimeSession,
  event: AgentEvent,
  progress: (line: string) => void): void {
  if (event.type === 'usage') {
    handleAgentEvent(host, runtime, event);
    return;
  }
  if (event.type === 'tool_start') {
    // The start of the action carries its input without the payload: the
    // panel names the action like a card of the parent. The content of a
    // file is not a line of the journal.
    progress(JSON.stringify({ tool: event.name, input: actionInput(event.input) }));
    return;
  }
  if (event.type === 'tool_end') {
    progress(event.name + (event.isError ? ' failed' : ' done'));
    // The change of the child must not be lost: the lines of the diff go
    // into the journal of the call.
    if (event.diff) {
      for (const line of event.diff.lines) {
        if (line.type === 'add') {
          progress('+ ' + line.text);
        } else if (line.type === 'remove') {
          progress('- ' + line.text);
        }
      }
    }
    return;
  }
  if (event.type === 'error') {
    progress('error: ' + event.message);
  }
}


export async function spawnTask(host: MiniMaxController, request: TaskRequest,
  ctx: ToolContext,
  progress: (line: string) => void): Promise<TaskOutcome> {
  const runtime = ctx.sessionId
    ? host.sessions.get(ctx.sessionId)
    : host.activeSession();
  if (!runtime) {
    return { content: 'There is no session for the sub-agent.', isError: true };
  }
  const key = await getApiKey(host.context.secrets);
  if (!key) {
    return { content: 'No API key, the sub-agent cannot run.', isError: true };
  }
  const settings = getSettings();
  const model = MODELS.find((item) => item.id === settings.model);
  // The tools of the child, the prompt of the child names them and the
  // child calls only them.
  const registry = registryForRole(host, request.role);
  // The child works in the session of its parent, it gets the same context
  // of the turn as the parent: the goal, the list of the tasks and the
  // state of the repository.
  const context = await sessionContext(host, runtime);
  const systemPrompt = [
    await buildPrompt(host, registry),
    ROLE_PROMPTS[request.role],
    context
  ]
    .filter((part) => part.length > 0)
    .join('\n\n');
  const child = new Agent({
    client: new HttpMiniMaxClient({
      baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
      apiKey: key
    }),
    registry,
    approval: childApproval(host, runtime, ctx.signal),
    model: settings.model,
    maxTokens: model?.maxTokens ?? 65_536,
    maxIterations: CHILD_MAX_ITERATIONS,
    effort: effortFor(host, settings),
    thinking: thinkingMode(host, settings),
    mode: settings.mode,
    systemPrompt,
    workspaceRoot: host.workspaceRoot(),
    depth: 1,
    sessionId: runtime.id,
    sessionState: {
      get todos() {
        return runtime.todos;
      },
      get goal() {
        return runtime.goal;
      }
    },
    budget: () => goalBudgetOk(host, runtime),
    logger: host.logger,
    onEvent: (event) => handleChildEvent(host, runtime, event, progress)
  });
  // The stop of the parent stops the child too, and the approvals that
  // wait are released: a child must not wait for an answer that never
  // comes. The listener goes away with the child.
  const onAbort = (): void => {
    child.abort();
    releaseChildApprovals(host);
  };
  ctx.signal.addEventListener('abort', onAbort);
  if (ctx.signal.aborted) {
    onAbort();
  }
  let result: AgentRunResult;
  try {
    result = await child.run(request.prompt, []);
  } catch (error) {
    // The child was stopped or it failed, the tool reports the error and
    // the parent continues.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      content: ctx.signal.aborted
        ? 'The sub-agent was stopped.'
        : 'The sub-agent failed: ' + reason,
      isError: true
    };
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }
  const text = finalText(result.messages);
  if (text.length === 0) {
    return {
      content:
        'The sub-agent finished without an answer, it stopped with: ' +
        result.stopReason +
        '.',
      isError: true,
      usage: result.usage
    };
  }
  return { content: text, usage: result.usage };
}

