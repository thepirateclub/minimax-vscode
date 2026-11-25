import type { MiniMaxController } from '../extension';
import type { RuntimeSession } from './runtime';
import type { UiSelection, QueuedMessage } from '../ui/protocol';
import type { TurnAnchor } from '../agent/turns';
import { enqueue, postQueue, pumpQueue } from './queue';
import { setState } from './channel';
import { persist, startNewSession, postHistory } from './sessions';
import { stopNotice } from '../agent/stopReason';
import { getSettings } from '../config/settings';
import { turnOfMessage, findRequestIndex, cutHistory } from '../agent/turns';
import { readMentionedFiles } from '../agent/mentions';
import { formatWorkspaceProblems, mentionsProblems } from '../agent/problems';
import { goalBudgetOk, ensureAgent, planRequest } from './setup';
import { refreshQuota } from './commands';
import * as vscode from 'vscode';
import { isAbsolute, relative } from 'node:path';
import { planRestore, restoreFiles } from '../storage/backups';

// The limit of the title of a chat.
const TITLE_LIMIT = 60;

export async function handleSend(host: MiniMaxController, text: string,
  mentions: string[],
  selections: UiSelection[]): Promise<void> {
  let runtime = host.activeSession();
  if (!runtime) {
    startNewSession(host);
    runtime = host.activeSession();
  }
  if (!runtime) {
    return;
  }
  if (runtime.busy) {
    // The agent works, the request waits in the queue. The reader writes
    // several messages in a row, they go out one after another.
    enqueue(host, runtime, text, mentions, selections);
    return;
  }
  // The reader wrote a new request, the queue is not on hold anymore.
  runtime.queuePaused = false;
  await runTurn(host, runtime, text, mentions, selections);
}


export async function runTurn(host: MiniMaxController, runtime: RuntimeSession,
  text: string,
  mentions: string[],
  selections: UiSelection[],
  queued?: QueuedMessage): Promise<void> {
  // The turn is taken at once: the building of the agent takes a moment
  // and a second send in that window would start two turns on one
  // history. The queue of the reader waits behind this flag.
  runtime.busy = true;
  // The moment of the turn: the rewind takes back the files changed since.
  const startedAt = Date.now();
  // The budget of the goal is over, the request does not go out. The user
  // raises the limit and the work continues.
  if (!goalBudgetOk(host, runtime)) {
    runtime.busy = false;
    const notice = stopNotice(
      'goal_limit',
      getSettings().maxIterations,
      runtime.goal
    );
    host.panel.post({
      type: 'notice',
      message: notice?.message ?? 'The budget of the goal is exhausted.',
      kind: notice?.kind ?? 'warn'
    });
    // The request does not go out, it comes back to the input field, the
    // user does not lose it.
    host.panel.post({ type: 'restore_input', text, mentions, selections });
    if (queued) {
      queued.state = 'error';
      queued.error = 'The budget of the goal is exhausted.';
      postQueue(host, runtime);
    }
    return;
  }
  const agent = await ensureAgent(host, runtime);
  if (!agent) {
    runtime.busy = false;
    if (queued) {
      queued.state = 'error';
      queued.error = 'No API key, the request did not go out.';
      postQueue(host, runtime);
    }
    return;
  }

  runtime.errorReported = false;
  runtime.turnStopped = false;
  runtime.lastError = undefined;
  // The place of the request in the history of the model, the anchor
  // of the turn takes it when the turn is over.
  let requestPlace = -1;
  const userId = host.nextId('user');
  runtime.uiMessages.push({ id: userId, role: 'user', text });
  host.panel.post({ type: 'user_message', id: userId, text });
  if (runtime.title === 'New chat') {
    const firstLine = text.trim().split('\n')[0] ?? '';
    runtime.title = firstLine.slice(0, TITLE_LIMIT) || 'New chat';
  }
  setState(host, 'thinking', runtime);
  runtime.turnStartedAt = Date.now();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'MiniMax is working',
        cancellable: true
      },
      async (_progress, token) => {
        const planning = new AbortController();
        token.onCancellationRequested(() => {
          planning.abort();
          agent.stop();
        });
        const prompt = await buildPromptText(host, text, mentions, selections);
        requestPlace = await agent.send(await planRequest(host, runtime, prompt, planning.signal));
      }
    );
  } catch (error) {
    host.logger.error('the agent run failed', error);
    if (!runtime.errorReported) {
      const message = error instanceof Error ? error.message : String(error);
      host.panel.post({ type: 'error', message });
      setState(host, 'error', runtime);
    }
  } finally {
    runtime.busy = false;
    runtime.history = agent.getHistory();
    // The anchor of the request, the chat can roll back to it.
    runtime.turns.push({
      uiId: userId,
      text,
      historyIndex: requestPlace,
      mentions,
      selections,
      startedAt
    });
    if (queued) {
      if (runtime.turnStopped) {
        // The user stopped the turn, the message waits for the next
        // command. The queue is on hold until the reader asks for it.
        queued.state = 'waiting';
        queued.error = undefined;
        runtime.queuePaused = true;
      } else if (runtime.errorReported) {
        queued.state = 'error';
        queued.error = runtime.lastError;
      } else {
        queued.state = 'done';
      }
      postQueue(host, runtime);
    }
    persist(host, runtime);
    void refreshQuota(host);
    // The next message of the queue goes out.
    void pumpQueue(host, runtime);
  }
}


export async function rewindTo(host: MiniMaxController, id: string): Promise<void> {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  if (runtime.busy) {
    host.panel.post({
      type: 'notice',
      message: 'The agent is busy, wait for the turn to end.',
      kind: 'warn'
    });
    return;
  }
  const index = runtime.uiMessages.findIndex((message) => message.id === id);
  if (index === -1) {
    return;
  }
  const message = runtime.uiMessages[index]!;
  if (message.role !== 'user') {
    host.panel.post({
      type: 'notice',
      message: 'Only a request of the user can be taken back.',
      kind: 'warn'
    });
    return;
  }
  const turn = runtime.turns.find((item) => item.uiId === id);
  const text = turn?.text ?? message.text ?? '';
  const mentions = turn?.mentions ?? [];
  const selections = turn?.selections ?? [];
  // The history of the model is cut before the request, the next
  // request starts from the same state.
  cutHistoryBefore(host, runtime, turn, text);
  // The turns after this one go away with the messages.
  runtime.turns = runtime.turns.filter((item) => {
    const at = runtime.uiMessages.findIndex((entry) => entry.id === item.uiId);
    return at !== -1 && at < index;
  });
  runtime.uiMessages = runtime.uiMessages.slice(0, index);
  // The list of the tasks belongs to the turn that goes away, it goes
  // away with it.
  runtime.todos = [];
  host.panel.post({ type: 'todos', todos: runtime.todos });
  // The panel gets a copy, the chat grows right after this line.
  postHistory(host, runtime);
  // The request comes back to the input field, the agent waits.
  host.panel.post({ type: 'restore_input', text, mentions, selections });
  persist(host, runtime);
  await restoreTurnFiles(host, runtime, turn?.startedAt);
}

// The rewind takes back the files the agent changed since the request: the
// chat and the disk go back to the same point. A file the user changed after
// the agent stays as it is, the notice names it.
async function restoreTurnFiles(host: MiniMaxController, runtime: RuntimeSession,
  since: number | undefined): Promise<void> {
  if (since === undefined) {
    return;
  }
  const plans = planRestore(await host.backups.takeSince(runtime.id, since));
  if (plans.length === 0) {
    return;
  }
  const { restored, skipped } = await restoreFiles(plans);
  const name = (path: string) => relative(runtime.workspaceRoot, path) || path;
  const parts: string[] = [];
  if (restored.length > 0) {
    parts.push('The files went back to the request: ' + restored.map(name).join(', ') + '.');
  }
  if (skipped.length > 0) {
    parts.push(
      'Left as they are, they changed after the agent: ' + skipped.map(name).join(', ') + '.'
    );
  }
  host.panel.post({
    type: 'notice',
    message: parts.join(' '),
    kind: skipped.length > 0 ? 'warn' : 'info'
  });
}


export async function retryTurn(host: MiniMaxController, id: string): Promise<void> {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  if (runtime.busy) {
    host.panel.post({
      type: 'notice',
      message: 'The agent is busy, wait for the turn to end.',
      kind: 'warn'
    });
    return;
  }
  const turn = turnOfMessage(runtime.turns, runtime.uiMessages, id);
  if (!turn) {
    host.panel.post({
      type: 'notice',
      message: 'This message has no request to repeat, the chat is too old.',
      kind: 'warn'
    });
    return;
  }
  const userIndex = runtime.uiMessages.findIndex(
    (message) => message.id === turn.uiId
  );
  if (userIndex === -1) {
    return;
  }
  // The turns after this one go away with the messages.
  runtime.turns = runtime.turns.filter((item) => {
    const at = runtime.uiMessages.findIndex((message) => message.id === item.uiId);
    return at !== -1 && at < userIndex;
  });
  cutHistoryBefore(host, runtime, turn, turn.text);
  runtime.uiMessages = runtime.uiMessages.slice(0, userIndex);
  // The list of the tasks belongs to the turn that goes away, it goes
  // away with it.
  runtime.todos = [];
  host.panel.post({ type: 'todos', todos: runtime.todos });
  // The panel gets a copy, the chat grows right after this line.
  postHistory(host, runtime);
  await handleSend(host, turn.text, turn.mentions, turn.selections);
}


export function cutHistoryBefore(_host: MiniMaxController, runtime: RuntimeSession,
  turn: TurnAnchor | undefined,
  text: string): void {
  const hint = turn?.historyIndex;
  const found = findRequestIndex(runtime.history, text, hint);
  let cut = found;
  if (cut === -1) {
    // The request is not in the history any more, the place of the
    // anchor is the best guess.
    cut =
      hint !== undefined && hint >= 0
        ? Math.min(hint, runtime.history.length)
        : runtime.history.length;
  }
  // The cut must not split a call of a tool from its result, the model
  // would see a call without the answer and the API would refuse the
  // request.
  runtime.history = cutHistory(runtime.history, cut);
  runtime.agent?.setHistory(runtime.history);
}


export async function buildPromptText(host: MiniMaxController, text: string,
  mentions: string[],
  selections: UiSelection[]): Promise<string> {
  const blocks: string[] = [];
  const files = await readMentionedFiles(host.workspaceRoot(), text, mentions);
  if (files.length > 0) {
    host.logger.info('attached ' + files.length + ' file(s) mentioned in the request');
  }
  for (const file of files) {
    blocks.push('Attached file: ' + file.path + '\n' + file.content);
  }
  if (mentionsProblems(text)) {
    blocks.push(formatWorkspaceProblems(workspaceDiagnostics(host.workspaceRoot())));
  }
  for (const selection of selections) {
    const header =
      'Selected code from ' +
      selection.path +
      (selection.detail ? ' (' + selection.detail + ')' : '');
    blocks.push(header + ':\n' + (selection.content ?? ''));
  }
  if (blocks.length === 0) {
    return text;
  }
  return text + '\n\n' + blocks.join('\n\n');
}

// The Problems of the editor inside the workspace, the paths relative to it.
function workspaceDiagnostics(root: string): Array<{ path: string; diagnostics: Array<{ severity: number; line: number; message: string; source?: string }> }> {
  return vscode.languages
    .getDiagnostics()
    .map(([uri, items]) => ({ path: relative(root, uri.fsPath).replace(/\\/g, '/'), items }))
    .filter((file) => root.length > 0 && !file.path.startsWith('..') && !isAbsolute(file.path))
    .map((file) => ({
      path: file.path,
      diagnostics: file.items.map((item) => ({
        severity: item.severity,
        line: item.range.start.line,
        message: item.message,
        ...(item.source ? { source: item.source } : {})
      }))
    }));
}
