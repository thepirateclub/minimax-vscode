import type { MiniMaxController } from '../extension';
import type { AnthropicMessage } from '../api/types';
import { Agent, type AgentEvent, type AgentRunResult } from '../agent/agent';
import { HttpMiniMaxClient } from '../api/client';
import { MODELS, resolveBaseUrl } from '../config/models';
import { getApiKey } from '../config/secrets';
import { getSettings } from '../config/settings';
import type { RuntimeSession } from './runtime';
import { childApproval, releaseChildApprovals } from './approvals';
import { ToolRegistry } from '../tools/registry';
import { CHILD_MAX_ITERATIONS, describeInput, type TaskOutcome, type TaskRequest, type TaskRole } from '../tools/task';
import type { ToolContext } from '../tools/types';

// The role of a sub-agent tells it what it may do and what its answer looks
// like. The text goes to the model, it is English.
const ROLE_PROMPTS: Record<TaskRole, string> = {
  explore:
    'You are a sub-agent of the main agent. Your task is to explore: you read the files and you search the project, you never change anything. Answer with a short report: what you found, the paths and the facts. Your answer is the result of the task, write it as plain text.',
  worker:
    'You are a sub-agent of the main agent. Your task is to make the change: you edit the files and you run the commands. Answer with a short report: what you changed and what you checked. Your answer is the result of the task, write it as plain text.',
  verifier:
    'You are a sub-agent of the main agent. Your task is to check the work: you read the files and the changes and you look for the defects. Answer with the list of the defects you found, or with the words that there are none. Your answer is the result of the task, write it as plain text.'
};

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
    if (entry.name === 'task') {
      continue;
    }
    if (role === 'worker' || !entry.sideEffect) {
      registry.register(entry);
    }
  }
  return registry;
}


export function handleChildEvent(host: MiniMaxController, runtime: RuntimeSession,
  event: AgentEvent,
  progress: (line: string) => void): void {
  if (event.type === 'usage') {
    host.handleAgentEvent(runtime, event);
    return;
  }
  if (event.type === 'tool_start') {
    // The line names the target of the action, the content of a file is
    // not a line of the journal.
    const target = describeInput(event.input);
    progress(target.length > 0 ? event.name + ' ' + target : event.name);
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
  const context = await host.sessionContext(runtime);
  const systemPrompt = [
    await host.buildPrompt(registry),
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
    effort: host.effortFor(settings),
    thinking: host.thinkingMode(settings),
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
    budget: () => host.goalBudgetOk(runtime),
    logger: host.logger,
    onEvent: (event) => handleChildEvent(host, runtime, event, progress)
  });
  // The stop of the parent stops the child too, and the approvals that
  // wait are released: a child must not wait for an answer that never
  // comes. The listener goes away with the child.
  const onAbort = (): void => {
    child.abort();
    releaseChildApprovals(host, );
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

