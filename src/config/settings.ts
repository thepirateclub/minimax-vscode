import * as vscode from 'vscode';
import type { AgentMode, BaseUrlPreset, EffortLevel } from './models';

export interface MiniMaxSettings {
  baseUrl: BaseUrlPreset;
  customBaseUrl: string;
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  maxIterations: number;
  // How many times a request is repeated after the loss of the connection.
  maxRetries: number;
  // The size of the font of the panel in pixels.
  fontSize: number;
  // How many messages the chat keeps before the old turns are cut.
  historyMaxMessages: number;
  // The share of the context window the history may take, in percent.
  contextThreshold: number;
  // The semantic layer of the search sends the code of the project to the server.
  semanticSearch: boolean;
  // The cards of the actions fold to their title.
  collapseTools: boolean;
  // The code blocks of the answers fold to their header.
  collapseCode: boolean;
  // The steps of the tools are shown in the feed.
  showToolSteps: boolean;
  autoApprove: string[];
  enableWebSearch: boolean;
  rulesEnabled: boolean;
  // The language of the voice input, empty lets the model pick it.
  speechLanguage: string;
  // The device of the voice input, empty picks a microphone by its name.
  microphone: string;
  speechVocabulary: string[];
  ffmpegPath: string;
}

// The settings that decide where the key of the user goes and what the
// agent may do without a question. A repository that the user opens must not
// be able to change them. The manifest declares the scope of these settings,
// this check is the second wall for it.
function userValue<T>(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  fallback: T
): T {
  const inspected = typeof cfg.inspect === 'function' ? cfg.inspect<T>(key) : undefined;
  if (!inspected) {
    return cfg.get<T>(key, fallback);
  }
  // The value of the workspace and of the folder is not taken, the user sets
  // these settings himself.
  if (inspected.globalValue !== undefined) {
    return inspected.globalValue;
  }
  if (inspected.defaultValue !== undefined) {
    return inspected.defaultValue;
  }
  return fallback;
}

export function getSettings(): MiniMaxSettings {
  const cfg = vscode.workspace.getConfiguration('minimax');
  return {
    baseUrl: userValue<BaseUrlPreset>(cfg, 'baseUrl', 'auto'),
    customBaseUrl: userValue<string>(cfg, 'customBaseUrl', ''),
    model: cfg.get<string>('model', 'MiniMax-M3.1-Flash'),
    effort: cfg.get<EffortLevel>('effort', 'max'),
    mode: cfg.get<AgentMode>('mode', 'code'),
    thinking: cfg.get<boolean>('thinking', false),
    maxIterations: cfg.get<number>('maxIterations', 40),
    maxRetries: userValue<number>(cfg, 'maxRetries', 5),
    fontSize: cfg.get<number>('fontSize', 13),
    historyMaxMessages: cfg.get<number>('historyMaxMessages', 120),
    contextThreshold: cfg.get<number>('contextThreshold', 50),
    semanticSearch: cfg.get<boolean>('semanticSearch', false),
    collapseTools: cfg.get<boolean>('collapseTools', false),
    collapseCode: cfg.get<boolean>('collapseCode', false),
    showToolSteps: cfg.get<boolean>('showToolSteps', true),
    autoApprove: userValue<string[]>(cfg, 'autoApprove', []),
    enableWebSearch: cfg.get<boolean>('enableWebSearch', false),
    rulesEnabled: cfg.get<boolean>('rulesEnabled', true),
    speechLanguage: cfg.get<string>('speechLanguage', ''),
    microphone: cfg.get<string>('microphone', ''),
    speechVocabulary: cfg.get<string[]>('speechVocabulary', []),
    ffmpegPath: userValue<string>(cfg, 'ffmpegPath', 'ffmpeg')
  };
}

export function onSettingsChanged(cb: (settings: MiniMaxSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('minimax')) {
      cb(getSettings());
    }
  });
}
