import { forgetStamps } from '../tools/fileStamps';
import { getSettings } from '../config/settings';
import { stopReplSession } from '../tools/repl';
import { historyPage, historyTail } from '../ui/historyPage';
import type { UiMessage } from '../ui/protocol';
import type { MiniMaxController } from '../extension';
import type { RuntimeSession } from './runtime';
import type { StoredSession } from '../storage/sessions';
import { setState } from './channel';

export function persist(host: MiniMaxController, runtime: RuntimeSession): void {
  // The chat was deleted while its turn ran, the finished turn must not
  // write it back into the store.
  if (runtime.deleted) {
    return;
  }
  runtime.updatedAt = Date.now();
  // While the turn runs the messages of the panel and the history of the
  // model do not match. A saved state has to be a state the agent can
  // continue from, so the session waits for the end of the turn and only
  // the list of the tasks is written in the meantime.
  if (runtime.busy) {
    persistTodos(host, runtime);
    return;
  }
  const stored: StoredSession = {
    id: runtime.id,
    title: runtime.title,
    updatedAt: runtime.updatedAt,
    workspaceRoot: runtime.workspaceRoot,
    messages: runtime.history,
    ...(runtime.digest ? { digest: runtime.digest } : {}),
    uiMessages: runtime.uiMessages,
    usage: runtime.usage,
    turns: runtime.turns,
    todos: runtime.todos,
    goal: runtime.goal,
    // The queue of the chat, it survives the reload of the panel.
    queue: runtime.queue.map((item) => ({ ...item }))
  };
  // A full state of the host must not break the turn, the chat stays in
  // memory and the failure goes to the log.
  void host.store.save(stored, getSettings().historyMaxMessages).then((saved) => {
    if (!saved) {
      host.logger.error('the chat was not saved to the state of the host');
    } else if (host.activeSessionId === runtime.id) {
      // The id of the active session goes to the state of the host after
      // the session itself. A lonely id would point to nothing. The id
      // belongs to the project of the chat, every project keeps its own.
      host.store.setActiveIdFor(runtime.workspaceRoot, runtime.id);
    }
    host.panel.post({ type: 'sessions', sessions: host.store.summaryList() });
  });
}


export function persistTodos(host: MiniMaxController, runtime: RuntimeSession): void {
  const saved = host.store.get(runtime.id);
  const stored: StoredSession = {
    id: runtime.id,
    title: runtime.title,
    updatedAt: Date.now(),
    workspaceRoot: saved?.workspaceRoot ?? runtime.workspaceRoot,
    messages: saved?.messages ?? [],
    uiMessages: saved?.uiMessages ?? [],
    usage: saved?.usage ?? [],
    turns: saved?.turns ?? [],
    todos: runtime.todos,
    goal: runtime.goal,
    // The queue of памяти хозяина истина, в состоянии хоста она лежит
    // вместе с остальным чатом.
    queue: runtime.queue.map((item) => ({ ...item }))
  };
  void host.store.save(stored, getSettings().historyMaxMessages).then((ok) => {
    if (!ok) {
      host.logger.error('the list of tasks was not saved to the state of the host');
    }
  });
}


export function runtimeFrom(host: MiniMaxController, stored: StoredSession): RuntimeSession {
  return {
    id: stored.id,
    title: stored.title,
    updatedAt: stored.updatedAt,
    // A chat of an older version does not know its project, the project
    // that opens it takes it.
    workspaceRoot: stored.workspaceRoot ?? host.workspaceRoot(),
    history: [...stored.messages],
    digest: stored.digest,
    uiMessages: [...(stored.uiMessages ?? [])],
    panelOffset: undefined,
    agent: undefined,
    busy: false,
    state: 'idle',
    deleted: false,
    errorReported: false,
    changedFiles: [],
    usage: (stored.usage ?? []).map((turn) => ({
      input: turn.input,
      output: turn.output,
      cache: turn.cache ?? 0
    })),
    turns: stored.turns ?? [],
    todos: [...(stored.todos ?? [])],
    goal: stored.goal
      ? { ...stored.goal, used: { ...stored.goal.used } }
      : undefined,
    turnStartedAt: 0,
    usageTurnAt: 0,
    approvedTools: new Set(),
    // A message that was going out when the panel closed waits again.
    queue: (stored.queue ?? []).map((item) => ({
      ...item,
      state: item.state === 'sending' ? 'waiting' : item.state
    })),
    queuePaused: false,
    turnStopped: false,
    lastError: undefined
  };
}


export function startNewSession(host: MiniMaxController): void {
  // The processes of the REPL are keyed by the chat, a new chat has a new
  // id and starts with no process of its own. The processes of the other
  // chats stay alive: starting a chat must not drop their state.
  const current = host.activeSession();
  if (current) {
    persist(host, current);
  }
  const id = host.nextId('s');
  host.sessions.set(id, {
    id,
    title: 'New chat',
    updatedAt: Date.now(),
    // A new chat belongs to the project that is open.
    workspaceRoot: host.workspaceRoot(),
    history: [],
    uiMessages: [],
    panelOffset: undefined,
    agent: undefined,
    busy: false,
    state: 'idle',
    deleted: false,
    errorReported: false,
    changedFiles: [],
    usage: [],
    turns: [],
    todos: [],
    goal: undefined,
    turnStartedAt: 0,
    usageTurnAt: 0,
    approvedTools: new Set(),
    queue: [],
    queuePaused: false,
    turnStopped: false,
    lastError: undefined
  });
  host.activeSessionId = id;
  // The id of the new chat goes to the state of the host together with the
  // chat itself. A lonely id would point to nothing after a restart.
  setState(host, 'idle');
  void host.sendInit();
}


export function restoreSession(host: MiniMaxController): void {
  const root = host.workspaceRoot();
  // The chats of an older version do not know their project, this one
  // takes them.
  const list = host.store.claimUnbound(root);
  const activeId = host.store.activeIdFor(root);
  const active = activeId ? list.find((session) => session.id === activeId) : undefined;
  // The chat that was open in the project, otherwise the newest chat of
  // the project. A chat of another project is not opened here.
  const stored =
    active && (active.workspaceRoot === root || active.workspaceRoot === undefined)
      ? active
      : list.find((session) => session.workspaceRoot === root);
  if (!stored) {
    // The project has no chats, a new one starts.
    startNewSession(host);
    return;
  }
  // A chat that still lives in the host (it may run in the background) is
  // taken as it is, a second copy would lose its turn.
  const runtime = host.sessions.get(stored.id) ?? runtimeFrom(host, stored);
  host.sessions.set(runtime.id, runtime);
  host.activeSessionId = runtime.id;
  host.store.setActiveIdFor(root, runtime.id);
  setState(host, runtime.state, runtime);
  void host.sendInit();
}


export function selectSession(host: MiniMaxController, id: string): void {
  const stored = host.store.get(id);
  if (!stored) {
    return;
  }
  const current = host.activeSession();
  if (current && current.id !== id) {
    persist(host, current);
  }
  let runtime = host.sessions.get(id);
  if (!runtime) {
    runtime = runtimeFrom(host, stored);
    host.sessions.set(id, runtime);
  }
  host.activeSessionId = id;
  // The chat that is open belongs to the project of the panel, every
  // project remembers its own.
  host.store.setActiveIdFor(host.workspaceRoot(), id);
  // The opened chat brings its own state: a chat that runs in the
  // background is busy and its stop button has to stand in the field,
  // otherwise the busy chat looks idle and cannot be stopped.
  setState(host, runtime.state);
  postHistory(host, runtime);
  void host.sendInit();
}


export function deleteSession(host: MiniMaxController, id: string): void {
  const runtime = host.sessions.get(id);
  if (runtime) {
    // A chat that still runs stops first: the tokens of a deleted chat
    // must not burn any further, and the finished turn must not write
    // the chat back into the store.
    runtime.deleted = true;
    // The queue goes with the chat, it must not start a turn after the stop.
    runtime.queue.length = 0;
    if (runtime.busy) {
      runtime.agent?.stop();
    }
    // The cards of the chat go with it, they must not keep an owner of a
    // chat that is gone.
    for (const [approvalId, owner] of host.approvalOwner) {
      if (owner === id) {
        host.approvalOwner.delete(approvalId);
      }
    }
  }
  // The processes of the REPL of the chat go with it.
  stopReplSession(id);
  forgetStamps(id);
  host.store.remove(id);
  // The removed chat is not the open one of any project.
  host.store.clearActiveId(id);
  host.sessions.delete(id);
  if (host.activeSessionId === id) {
    host.activeSessionId = undefined;
    // The removed chat must not stay active, its id would point to nothing
    // after a restart.
    host.store.setActiveIdFor(host.workspaceRoot(), undefined);
    startNewSession(host);
    return;
  }
  void host.sendInit();
}


export function panelHistory(
  _host: MiniMaxController,
  runtime: RuntimeSession | undefined,
  reset: boolean
): { messages: UiMessage[]; olderMessages: number } {
  if (!runtime) {
    return { messages: [], olderMessages: 0 };
  }
  if (!reset && runtime.panelOffset !== undefined) {
    const start = Math.max(0, Math.min(runtime.panelOffset, runtime.uiMessages.length));
    return { messages: runtime.uiMessages.slice(start), olderMessages: start };
  }
  const tail = historyTail(runtime.uiMessages);
  runtime.panelOffset = tail.offset;
  return { messages: tail.messages, olderMessages: tail.offset };
}

export function postHistory(host: MiniMaxController, runtime: RuntimeSession): void {
  const tail = historyTail(runtime.uiMessages);
  runtime.panelOffset = tail.offset;
  host.panel.post({
    type: 'session_loaded',
    messages: tail.messages,
    olderMessages: tail.offset
  });
}


export function loadOlder(host: MiniMaxController): void {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  const page = historyPage(runtime.uiMessages, runtime.panelOffset ?? 0);
  runtime.panelOffset = page.offset;
  host.panel.post({
    type: 'history_older',
    messages: page.messages,
    olderMessages: page.offset
  });
}

