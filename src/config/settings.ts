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
  autoApprove: string[];
  enableWebSearch: boolean;
  rulesEnabled: boolean;
}

export function getSettings(): MiniMaxSettings {
  const cfg = vscode.workspace.getConfiguration('minimax');
  return {
    baseUrl: cfg.get<BaseUrlPreset>('baseUrl', 'auto'),
    customBaseUrl: cfg.get<string>('customBaseUrl', ''),
    model: cfg.get<string>('model', 'MiniMax-M3.1-Flash'),
    effort: cfg.get<EffortLevel>('effort', 'max'),
    mode: cfg.get<AgentMode>('mode', 'code'),
    thinking: cfg.get<boolean>('thinking', false),
    maxIterations: cfg.get<number>('maxIterations', 40),
    fontSize: cfg.get<number>('fontSize', 13),
    historyMaxMessages: cfg.get<number>('historyMaxMessages', 120),
    contextThreshold: cfg.get<number>('contextThreshold', 50),
    semanticSearch: cfg.get<boolean>('semanticSearch', false),
    collapseTools: cfg.get<boolean>('collapseTools', false),
    collapseCode: cfg.get<boolean>('collapseCode', false),
    autoApprove: cfg.get<string[]>('autoApprove', []),
    enableWebSearch: cfg.get<boolean>('enableWebSearch', false),
    rulesEnabled: cfg.get<boolean>('rulesEnabled', true)
  };
}

export function onSettingsChanged(cb: (settings: MiniMaxSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('minimax')) {
      cb(getSettings());
    }
  });
}
