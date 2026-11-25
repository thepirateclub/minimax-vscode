import type { ExtrasToExt, ExtrasToWeb } from './extrasProtocol';
import type { GoalState, TodoItem } from '../agent/state';
import type { EffortLevel } from '../api/types';
import type { AgentMode, BaseUrlPreset, ModelInfo } from '../config/models';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

// The kind of the theme of the host, it picks the palette of the code blocks.
export type ThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

export interface UiDiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface UiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  content?: string;
  // The journal of a long action, the sub-agent writes its lines here.
  progress?: string[];
  isError?: boolean;
  running?: boolean;
  // How long the action took, the host measures it.
  durationMs?: number;
  // The change of a file, the host takes it before the write.
  diff?: { path: string; lines: UiDiffLine[] };
}

// A file of the working tree that the agent has changed.
export interface UiChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

// A file of a deletion: the reader sees the list of the files before he
// answers the card of the confirmation.
export interface UiApprovalFile {
  path: string;
  bytes?: number;
}

export interface UiApproval {
  id: string;
  name: string;
  input: Record<string, unknown>;
  preview?: { path: string; lines: UiDiffLine[] };
  // The files of a deletion, empty for the other tools.
  files?: UiApprovalFile[];
}

// The kind of a notice: a note, a warning or a failure.
export type NoticeKind = 'info' | 'warn' | 'error';

// The voice input: the microphone records, then MiniMax turns it into text.
export type VoiceState = 'idle' | 'recording' | 'transcribing';

export interface UiMessage {
  id: string;
  // A notice is a failure of the panel itself, it is not the answer of the
  // model.
  role: 'user' | 'assistant' | 'tool' | 'notice';
  text?: string;
  thinking?: string;
  tool?: UiToolCall;
  approval?: UiApproval;
  // The kind of a notice.
  kind?: NoticeKind;
  // The time of the step that ends with this message.
  elapsedMs?: number;
  // When the message came, the feed shows the moment of every action.
  at?: number;
  // When the turn ended, the plate of the turn shows it.
  endedAt?: number;
}

export interface UiSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  // The project of the chat: the root of the workspace it belongs to.
  workspaceRoot?: string;
  // The name of the project, the reader sees it in the list of the chats.
  workspaceLabel?: string;
}

export interface UiFile {
  path: string;
  label: string;
}

export interface UiSelection {
  id: string;
  path: string;
  label: string;
  detail?: string;
  content?: string;
}

export interface UiSuggestion {
  id: string;
  path: string;
  label: string;
  // A skill comes from the panel itself, after a slash.
  source: 'open' | 'workspace' | 'skill';
  // The description of a skill under its name.
  detail?: string;
}

// The status of a repeated request: the connection to MiniMax is lost.
export interface UiRetryStatus {
  attempt: number;
  total: number;
  delayMs: number;
}

// The state of a message in the queue: it waits, it goes out, it is sent
// or it failed.
export type QueueState = 'waiting' | 'sending' | 'done' | 'error';

export interface UiQueuedMessage {
  id: string;
  text: string;
  state: QueueState;
  // The reason of the failure, the reader sees it on the item.
  error?: string;
}

// The message of the queue in the host: the mentions and the selections are
// needed to build the prompt when the message goes out.
export interface QueuedMessage extends UiQueuedMessage {
  mentions: string[];
  selections: UiSelection[];
}

export interface UiSettingsValues {
  baseUrl: BaseUrlPreset;
  customBaseUrl: string;
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  maxIterations: number;
  // How many times a request is repeated after the loss of the connection.
  maxRetries: number;
  fontSize: number;
  historyMaxMessages: number;
  contextThreshold: number;
  semanticSearch: boolean;
  autoApprove: string[];
  rulesEnabled: boolean;
  enableWebSearch: boolean;
  // The cards of the actions fold to their title.
  collapseTools: boolean;
  // The code blocks of the answers fold to their header.
  collapseCode: boolean;
  // The steps of the tools are shown in the feed.
  showToolSteps: boolean;
  speechLanguage: string;
  microphone: string;
}

export interface UiSettings extends UiSettingsValues {
  hasApiKey: boolean;
  models: ModelInfo[];
  tools: string[];
}

// The token spend of one action, the input and the output parts.
export interface UiUsageTurn {
  input: number;
  output: number;
  cache: number;
}

import type { UiQuota } from './quotaMeter';

export interface UiState {
  sessions: UiSessionSummary[];
  activeSessionId: string | undefined;
  // The project of the panel: the root of the workspace and its name. The
  // list of the chats belongs to it.
  workspaceRoot: string;
  workspaceLabel: string;
  messages: UiMessage[];
  model: string;
  models: ModelInfo[];
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  state: AgentState;
  tokens: number;
  usage: UiUsageTurn[];
  // The limits of the M Plan, absent until the first answer of the server.
  quota?: UiQuota;
  hasApiKey: boolean;
  theme: ThemeKind;
  // The size of the font of the panel in pixels.
  fontSize: number;
  // The cards of the actions fold to their title.
  collapseTools: boolean;
  // The code blocks of the answers fold to their header.
  collapseCode: boolean;
  // The steps of the tools are shown in the feed.
  showToolSteps: boolean;
  // The files of the last action, the panel shows them under the feed.
  summary: UiChangedFile[];
  // The version of the running extension, the panel shows it in the header.
  version: string;
  // The list of tasks of the session.
  todos: TodoItem[];
  // The goal of the session.
  goal?: GoalState;
  // The queue of the messages of the chat.
  queue: UiQueuedMessage[];
  // How many messages of the chat the panel does not hold yet. The host
  // keeps them, the panel asks for them when the reader wants to see the
  // older part of the chat.
  olderMessages: number;
}

export type ExtToWeb =
  | ExtrasToWeb
  | { type: 'init'; state: UiState }
  | { type: 'user_message'; id: string; text: string; at: number }
  | { type: 'assistant_start'; id: string; at: number }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown>; at: number }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      content: string;
      isError: boolean;
      durationMs?: number;
      diff?: { path: string; lines: UiDiffLine[] };
    }
  // The journal of a long action, one line at a time.
  | { type: 'tool_progress'; id: string; line: string }
  | { type: 'approval_request'; approval: UiApproval }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'status'; state: AgentState; tokens?: number }
  | { type: 'theme'; kind: ThemeKind }
  | { type: 'usage'; turns: UiUsageTurn[] }
  | { type: 'quota'; quota: UiQuota }
  // The list of tasks of the session, the model writes it.
  | { type: 'todos'; todos: TodoItem[] }
  // The goal of the session, the host owns it.
  | { type: 'goal'; goal?: GoalState }
  // The files that the last action changed.
  | { type: 'summary'; files: UiChangedFile[] }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string; kind: NoticeKind }
  | { type: 'step_time'; id: string; elapsedMs: number; endedAt: number }
  // The connection to MiniMax is lost, the request is repeated.
  | { type: 'retry_status'; status: UiRetryStatus | undefined }
  // The answer broke in the middle, the piece goes away.
  | { type: 'assistant_reset' }
  // The queue of the messages of the chat.
  | { type: 'queue'; items: UiQueuedMessage[] }
  | { type: 'restore_input'; text: string; mentions: string[]; selections: UiSelection[] }
  | { type: 'session_loaded'; messages: UiMessage[]; olderMessages?: number }
  // The older messages of the chat come on demand: a big history in one
  // message is slow to transfer and to draw.
  | { type: 'history_older'; messages: UiMessage[]; olderMessages: number }
  | { type: 'sessions'; sessions: UiSessionSummary[] }
  | { type: 'models'; models: ModelInfo[]; selected: string }
  | { type: 'files'; requestId: string; files: UiFile[] }
  | { type: 'selection'; selection: UiSelection }
  | { type: 'mention'; path: string }
  | { type: 'suggestions'; requestId: string; items: UiSuggestion[] }
  | { type: 'settings'; settings: UiSettings }
  | { type: 'voice_state'; state: VoiceState }
  // The live text of the speech, it is replaced by the next one.
  | { type: 'voice_partial'; text: string }
  // The final text of the speech, it takes the place of the live text.
  | { type: 'voice_text'; text: string };

export type WebToExt =
  | ExtrasToExt
  | { type: 'ready' }
  | { type: 'send'; text: string; mentions: string[]; selections: UiSelection[] }
  // One message of the queue goes out now.
  | { type: 'send_queued'; id: string }
  // Every message of the queue goes out, the failed ones are tried again.
  | { type: 'send_all_queued' }
  // A message leaves the queue.
  | { type: 'remove_queued'; id: string }
  // The panel asks for the older messages of the chat.
  | { type: 'load_older' }
  | { type: 'stop' }
  | { type: 'retry'; id: string }
  | { type: 'rewind'; id: string }
  | { type: 'approve'; id: string; allowForSession: boolean }
  | { type: 'reject'; id: string }
  | { type: 'new_session' }
  | { type: 'select_session'; id: string }
  | { type: 'delete_session'; id: string }
  | {
      type: 'set_goal';
      objective: string;
      tokenBudget?: number;
      requestLimit?: number;
      secondsLimit?: number;
    }
  | { type: 'clear_goal' }
  // The reader drops the list of the tasks, the model starts from an empty one.
  | { type: 'clear_todos' }
  | { type: 'set_model'; model: string }
  | { type: 'set_effort'; effort: EffortLevel }
  | { type: 'set_mode'; mode: AgentMode }
  | { type: 'set_thinking'; thinking: boolean }
  | { type: 'pick_files'; requestId: string }
  // An image pasted into the field: the host saves it and answers with files.
  | { type: 'paste_image'; name: string; dataUrl: string }
  | { type: 'files_picked'; requestId: string; files: string[] }
  | { type: 'open_file'; path: string; line?: number }
  | { type: 'undo_last_change' }
  | { type: 'request_suggestions'; requestId: string; prefix: string }
  | { type: 'request_settings' }
  | { type: 'save_settings'; values: UiSettingsValues }
  | { type: 'set_api_key'; key: string }
  | { type: 'clear_api_key' }
  | { type: 'voice_start' }
  | { type: 'voice_stop' }
  | { type: 'voice_cancel' };
