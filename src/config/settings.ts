import * as vscode from 'vscode';
import type { AgentMode, BaseUrlPreset, EffortLevel } from './models';

export interface MiniMaxSettings {
  baseUrl: BaseUrlPreset;
  customBaseUrl: string;
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  maxTokens: number;
  maxIterations: number;
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
    maxTokens: cfg.get<number>('maxTokens', 32000),
    maxIterations: cfg.get<number>('maxIterations', 40),
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
