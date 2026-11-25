import type { AnthropicMessage } from '../api/types';
import type { AgentState, UiMessage, UiUsageTurn, QueuedMessage } from '../ui/protocol';
import type { AgentSession } from '../agent/session';
import type { GoalState, TodoItem } from '../agent/state';
import type { TurnAnchor } from '../agent/turns';
import type { ChangedFile } from '../tools/types';

// The state of one chat in the extension host. The controller owns it, the
// modules of the host read and change it: the queue, the approvals, the
// agent of the turn.
export interface RuntimeSession {
  id: string;
  title: string;
  updatedAt: number;
  // The project of the chat: the root of the workspace it belongs to.
  workspaceRoot: string;
  history: AnthropicMessage[];
  uiMessages: UiMessage[];
  // Where the history of the panel starts in the messages of the session.
  // The older messages wait in the host until the panel asks for them.
  panelOffset: number | undefined;
  agent: AgentSession | undefined;
  busy: boolean;
  // The state of the dot: every chat keeps its own, the panel shows the
  // one of the chat that is open.
  state: AgentState;
  // The chat was deleted while its turn was still running: the turn ends,
  // but nothing of it goes back into the store.
  deleted: boolean;
  errorReported: boolean;
  // The token spend of every action of this session.
  usage: UiUsageTurn[];
  // The anchors of the requests, they tell where a request sits in the
  // history and let the chat roll back to it.
  turns: TurnAnchor[];
  // The list of tasks of the session, the model writes it.
  todos: TodoItem[];
  // The goal of the session, the user sets it.
  goal: GoalState | undefined;
  // When the turn of this moment started, the panel shows how long it
  // took.
  turnStartedAt: number;
  // The turn whose bar the chart of the spend grows, by its start.
  usageTurnAt: number;
  // The tools the reader allowed for the session. The permission of a
  // child belongs to the chat of this session, it must not leak into
  // another chat.
  approvedTools: Set<string>;
  // The messages the reader wrote while the agent worked. They go out one
  // after another when the turn is over.
  queue: QueuedMessage[];
  // The queue waits until the reader asks for it: the user stopped the
  // turn, the messages stay in the queue.
  queuePaused: boolean;
  // The reader pressed Send now on a message of the queue while a turn
  // ran: the turn stops and the queue does not go on hold.
  sendNow?: boolean;
  // The user stopped the turn of this moment.
  turnStopped: boolean;
  // The reason of the last failure of the turn.
  lastError: string | undefined;
  // The files the agent changed in this chat, the panel shows them with
  // their status.
  changedFiles: ChangedFile[];
}
