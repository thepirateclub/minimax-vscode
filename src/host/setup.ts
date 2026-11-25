import type { MiniMaxController } from '../extension';
import type { RuntimeSession } from './runtime';
import type { ToolRegistry } from '../tools/registry';
import { postFor } from './channel';
import { handleAgentEvent } from './events';
import { MODELS, resolveBaseUrl } from '../config/models';
import { HttpMiniMaxClient } from '../api/client';
import type { EffortLevel } from '../api/types';
import { buildWorkspaceSnapshot, renderSnapshot } from '../agent/context';
import { buildSystemPrompt, renderGitContext, renderTasksContext, renderGoalContext } from '../agent/prompt';
import { readRepositoryState, summarizeState } from '../git/status';
import { budgetOver } from '../agent/goalBudget';
import { renderRepoMap } from '../search/repoMap';
import { planTurn, withPlan } from '../agent/planner';
import { searchFor } from './workspace';
import { AgentSession } from '../agent/session';
import type { MiniMaxSettings } from '../config/settings';
import { getApiKey } from '../config/secrets';
import { getSettings } from '../config/settings';
import * as vscode from 'vscode';

export async function buildPrompt(host: MiniMaxController, registry: ToolRegistry = host.registry): Promise<string> {
  const settings = getSettings();
  const root = host.workspaceRoot();
  const openFiles = vscode.window.visibleTextEditors
    .map((editor) => vscode.workspace.asRelativePath(editor.document.uri, false))
    .filter((path) => path.length > 0 && !path.startsWith('..'));
  const snapshot = await buildWorkspaceSnapshot(root, {
    includeOpenFiles: settings.rulesEnabled,
    openFiles: openFiles.map((path) => ({ path }))
  });

  const tools = registry
    .list()
    .filter((tool) => registry.isAllowed(tool, settings.mode))
    .map((tool) => tool.name);

  return buildSystemPrompt({
    workspaceRoot: root,
    os: process.platform,
    shell: process.platform === 'win32' ? 'powershell' : 'sh',
    mode: settings.mode,
    tools,
    rulesText: settings.rulesEnabled ? renderSnapshot(snapshot) : '',
    treeText: snapshot.tree.join('\n'),
    stackText: snapshot.stack.join(', '),
    openFilesText: snapshot.openFiles.map((file) => file.path).join(', ')
  });
}


export async function gitContext(host: MiniMaxController): Promise<string> {
  const state = await readRepositoryState(host.workspaceRoot());
  if (!state) {
    return '';
  }
  return renderGitContext(summarizeState(state));
}


export async function sessionContext(host: MiniMaxController, runtime: RuntimeSession): Promise<string> {
  const parts: string[] = [];
  const git = await gitContext(host);
  if (git.length > 0) {
    parts.push(git);
  }
  // The map of the project: the model knows where a thing lives before it
  // searches. A failed index leaves the turn without the map, not broken.
  const root = host.workspaceRoot();
  const map = root ? await searchFor(host, root).repoMap().catch(() => '') : '';
  if (map.length > 0) {
    parts.push(renderRepoMap(map));
  }
  const tasks = renderTasksContext(runtime.todos);
  if (tasks.length > 0) {
    parts.push(tasks);
  }
  const goal = renderGoalContext(runtime.goal);
  if (goal.length > 0) {
    parts.push(goal);
  }
  return parts.join('\n\n');
}


export function goalBudgetOk(_host: MiniMaxController, runtime: RuntimeSession): boolean {
  const goal = runtime.goal;
  if (!goal) {
    return true;
  }
  // The time of the running turn counts too. The time of a turn that is
  // over is already in the spend of the goal, the time between the turns
  // is not the work.
  const running =
    runtime.busy && runtime.turnStartedAt > 0
      ? (Date.now() - runtime.turnStartedAt) / 1000
      : 0;
  return !budgetOver(goal, {
    tokens: goal.used.tokens,
    requests: goal.used.requests,
    seconds: goal.used.seconds + running
  });
}


export async function ensureAgent(host: MiniMaxController, runtime: RuntimeSession): Promise<AgentSession | undefined> {
  if (runtime.agent) {
    return runtime.agent;
  }
  const key = await getApiKey(host.context.secrets);
  if (!key) {
    host.logger.error('no API key found in the secret storage');
    host.panel.post({
      type: 'error',
      message: 'No API key. Run "MiniMax: Add API Key" from the command palette.'
    });
    return undefined;
  }
  const settings = getSettings();
  const model = MODELS.find((item) => item.id === settings.model);
  const agent = new AgentSession({
    client: new HttpMiniMaxClient({
      baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
      apiKey: key
    }),
    registry: host.registry,
    model: settings.model,
    maxTokens: model?.maxTokens ?? 65_536,
    maxIterations: settings.maxIterations,
    maxRetries: settings.maxRetries,
    effort: effortFor(host, settings),
    mode: settings.mode,
    thinking: thinkingMode(host, settings),
    contextWindow: model?.contextWindow,
    historyLimit: settings.historyMaxMessages,
    contextThreshold: settings.contextThreshold,
    systemPrompt: await buildPrompt(host),
    contextProvider: async () => await sessionContext(host, runtime),
    sessionId: runtime.id,
    // The gate of the session, a child of this session shares it.
    sessionApproved: runtime.approvedTools,
    sessionState: {
      get todos() {
        return runtime.todos;
      },
      get goal() {
        return runtime.goal;
      }
    },
    budget: () => goalBudgetOk(host, runtime),
    workspaceRoot: host.workspaceRoot(),
    logger: host.logger,
    autoApprove: settings.autoApprove,
    onEvent: (event) => handleAgentEvent(host, runtime, event),
    onApproval: (approval) => {
      // The card belongs to the chat of the turn: it goes into the
      // messages of that chat and reaches the panel only while the chat
      // is open.
      runtime.uiMessages.push({
        id: 'approval-' + approval.id,
        role: 'assistant',
        approval
      });
      host.approvalOwner.set(approval.id, runtime.id);
      postFor(host, runtime, { type: 'approval_request', approval });
    }
  });
  agent.setHistory(runtime.history);
  runtime.agent = agent;
  return agent;
}


export function effortFor(_host: MiniMaxController, settings: MiniMaxSettings): EffortLevel | undefined {
  const model = MODELS.find((item) => item.id === settings.model);
  return model?.supportsEffort ? settings.effort : undefined;
}


export function thinkingMode(_host: MiniMaxController, settings: MiniMaxSettings): 'adaptive' | undefined {
  if (!settings.thinking) {
    return undefined;
  }
  const model = MODELS.find((item) => item.id === settings.model);
  if (!model || model.thinkingAlwaysOn) {
    return undefined;
  }
  return 'adaptive';
}

// The planner model writes the plan of the turn, the request of the
// executor carries it (src/agent/planner.ts). Off by default, only in the
// code mode and only when the planner is another model. A failed plan leaves
// the turn without a plan, the reader sees a note.
export async function planRequest(host: MiniMaxController, runtime: RuntimeSession,
  request: string,
  signal: AbortSignal): Promise<string> {
  const settings = getSettings();
  const planner = MODELS.find((item) => item.id === settings.plannerModel);
  if (!planner || settings.mode !== 'code' || planner.id === settings.model) {
    return request;
  }
  const key = await getApiKey(host.context.secrets);
  if (!key) {
    return request;
  }
  try {
    const result = await planTurn({
      client: new HttpMiniMaxClient({ baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl), apiKey: key }),
      model: planner.id,
      context: await sessionContext(host, runtime),
      request,
      ...(planner.supportsEffort ? { effort: 'high' as const } : { thinking: 'adaptive' as const }),
      signal
    });
    handleAgentEvent(host, runtime, { type: 'usage', usage: result.usage });
    if (result.plan.length > 0) {
      postFor(host, runtime, { type: 'notice', message: 'Plan by ' + planner.id + ':\n' + result.plan, kind: 'info' });
    }
    return withPlan(request, result.plan, planner.id);
  } catch (error) {
    if (signal.aborted) {
      return request;
    }
    host.logger.error('the planner failed', error);
    postFor(host, runtime, { type: 'notice', message: 'The planner failed, the turn goes without a plan.', kind: 'warn' });
    return request;
  }
}
