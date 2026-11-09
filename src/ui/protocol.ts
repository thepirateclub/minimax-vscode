import type { EffortLevel } from '../api/types';
import type { AgentMode, BaseUrlPreset, ModelInfo } from '../config/models';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

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
  isError?: boolean;
  running?: boolean;
  // How long the action took, the host measures it.
  durationMs?: number;
}

export interface UiApproval {
  id: string;
  name: string;
  input: Record<string, unknown>;
  preview?: { path: string; lines: UiDiffLine[] };
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  thinking?: string;
  tool?: UiToolCall;
  approval?: UiApproval;
}

export interface UiSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
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
  source: 'open' | 'workspace';
}

export interface UiSettingsValues {
  baseUrl: BaseUrlPreset;
  customBaseUrl: string;
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  maxTokens: number;
  maxIterations: number;
  autoApprove: string[];
  rulesEnabled: boolean;
  enableWebSearch: boolean;
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

export interface UiState {
  sessions: UiSessionSummary[];
  activeSessionId: string | undefined;
  messages: UiMessage[];
  model: string;
  models: ModelInfo[];
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  state: AgentState;
  tokens: number;
  usage: UiUsageTurn[];
  hasApiKey: boolean;
}

export type ExtToWeb =
  | { type: 'init'; state: UiState }
  | { type: 'user_message'; id: string; text: string }
  | { type: 'assistant_start'; id: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      content: string;
      isError: boolean;
      durationMs?: number;
    }
  | { type: 'approval_request'; approval: UiApproval }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'status'; state: AgentState; tokens?: number }
  | { type: 'usage'; turns: UiUsageTurn[] }
  | { type: 'error'; message: string }
  | { type: 'session_loaded'; messages: UiMessage[] }
  | { type: 'sessions'; sessions: UiSessionSummary[] }
  | { type: 'models'; models: ModelInfo[]; selected: string }
  | { type: 'files'; requestId: string; files: UiFile[] }
  | { type: 'selection'; selection: UiSelection }
  | { type: 'mention'; path: string }
  | { type: 'suggestions'; requestId: string; items: UiSuggestion[] }
  | { type: 'settings'; settings: UiSettings };

export type WebToExt =
  | { type: 'ready' }
  | { type: 'send'; text: string; mentions: string[]; selections: UiSelection[] }
  | { type: 'stop' }
  | { type: 'approve'; id: string; allowForSession: boolean }
  | { type: 'reject'; id: string }
  | { type: 'new_session' }
  | { type: 'select_session'; id: string }
  | { type: 'delete_session'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_effort'; effort: EffortLevel }
  | { type: 'set_mode'; mode: AgentMode }
  | { type: 'set_thinking'; thinking: boolean }
  | { type: 'pick_files'; requestId: string }
  | { type: 'files_picked'; requestId: string; files: string[] }
  | { type: 'undo_last_change' }
  | { type: 'request_suggestions'; requestId: string; prefix: string }
  | { type: 'request_settings' }
  | { type: 'save_settings'; values: UiSettingsValues }
  | { type: 'set_api_key'; key: string }
  | { type: 'clear_api_key' };
