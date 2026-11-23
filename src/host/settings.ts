import type { MiniMaxController } from '../extension';
import type { UiSettingsValues, UiSettings } from '../ui/protocol';
import { checkBaseUrl, MODELS, isOfficialBaseUrlHost, AGENT_MODES } from '../config/models';
import { setApiKey, getApiKey } from '../config/secrets';
import { applySemanticProvider } from './workspace';
import type { EffortLevel } from '../api/types';
import { getSettings } from '../config/settings';
import * as vscode from 'vscode';
import { clearApiKey as clearStoredApiKey } from '../config/secrets';

export async function postSettings(host: MiniMaxController): Promise<void> {
  const settings = getSettings();
  const key = await getApiKey(host.context.secrets);
  const payload: UiSettings = {
    baseUrl: settings.baseUrl,
    customBaseUrl: settings.customBaseUrl,
    model: settings.model,
    models: MODELS,
    effort: settings.effort,
    mode: settings.mode,
    thinking: settings.thinking,
    maxIterations: settings.maxIterations,
    fontSize: settings.fontSize,
    historyMaxMessages: settings.historyMaxMessages,
    contextThreshold: settings.contextThreshold,
    semanticSearch: settings.semanticSearch,
    autoApprove: settings.autoApprove,
    rulesEnabled: settings.rulesEnabled,
    enableWebSearch: settings.enableWebSearch,
    collapseTools: settings.collapseTools,
    collapseCode: settings.collapseCode,
    showToolSteps: settings.showToolSteps,
    maxRetries: settings.maxRetries,
    speechLanguage: settings.speechLanguage,
    microphone: settings.microphone,
    hasApiKey: Boolean(key),
    tools: host.registry.list().map((tool) => tool.name)
  };
  host.panel.post({ type: 'settings', settings: payload });
}


export async function saveSettings(host: MiniMaxController, values: UiSettingsValues): Promise<void> {
  const config = vscode.workspace.getConfiguration('minimax');
  // The address of the API holds the key of the user, a wrong address is
  // refused and the rest of the settings is saved.
  let customBaseUrl = values.customBaseUrl;
  if (typeof customBaseUrl === 'string' && customBaseUrl.trim().length > 0) {
    const check = checkBaseUrl(customBaseUrl);
    if (!check.ok) {
      host.panel.post({
        type: 'error',
        message: 'The custom base URL is not accepted: ' + check.reason + '.'
      });
      customBaseUrl = '';
    } else if (!isOfficialBaseUrlHost(check.host ?? '')) {
      // The key of the user goes to this host. The command of the endpoint
      // asks about another host, the panel has to ask the same question:
      // a typo in the address sends the key to a stranger.
      const answer = await vscode.window.showWarningMessage(
        'MiniMax: the API key will go to ' +
          check.host +
          '. It is not the address of MiniMax.',
        { modal: true },
        'Use it'
      );
      if (answer !== 'Use it') {
        customBaseUrl = '';
        host.panel.post({
          type: 'notice',
          message: 'The custom base URL was not saved: it is not the address of MiniMax.',
          kind: 'warn'
        });
      }
    }
  }
  const updates: Array<[string, unknown]> = [
    ['baseUrl', values.baseUrl],
    ['customBaseUrl', customBaseUrl],
    ['model', values.model],
    ['effort', values.effort],
    ['mode', values.mode],
    ['thinking', values.thinking],
    ['maxIterations', values.maxIterations],
    ['maxRetries', values.maxRetries],
    ['fontSize', values.fontSize],
    ['historyMaxMessages', values.historyMaxMessages],
    ['contextThreshold', values.contextThreshold],
    ['semanticSearch', values.semanticSearch],
    ['autoApprove', values.autoApprove],
    ['rulesEnabled', values.rulesEnabled],
    ['enableWebSearch', values.enableWebSearch],
    ['collapseTools', values.collapseTools],
    ['collapseCode', values.collapseCode],
    ['showToolSteps', values.showToolSteps],
    ['speechLanguage', values.speechLanguage],
    ['microphone', values.microphone]
  ];
  for (const [key, value] of updates) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
  applySettings(host);
  await host.sendInit();
  await postSettings(host);
}


export async function storeApiKey(host: MiniMaxController, key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    host.panel.post({ type: 'error', message: 'The API key is empty.' });
    return;
  }
  await setApiKey(host.context.secrets, trimmed);
  await host.sendInit();
  await postSettings(host);
}


export function applySettings(host: MiniMaxController): void {
  const settings = getSettings();
  void applySemanticProvider(host);
  for (const runtime of host.sessions.values()) {
    if (runtime.busy) {
      runtime.agent?.setAutoApprove(settings.autoApprove);
      continue;
    }
    runtime.agent = undefined;
  }
}


export async function updateSetting(host: MiniMaxController, key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration('minimax')
    .update(key, value, vscode.ConfigurationTarget.Global);
  await host.sendInit();
}


export async function pickFiles(host: MiniMaxController, requestId: string): Promise<void> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFolders: false,
    openLabel: 'Attach'
  });
  host.panel.post({
    type: 'files',
    requestId,
    files: (files ?? []).map((uri) => {
      const path = vscode.workspace.asRelativePath(uri, false);
      return { path, label: path };
    })
  });
}


export async function addApiKey(host: MiniMaxController): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'MiniMax API key',
    prompt: 'Paste your M Plan key. It is stored in the secret storage of VS Code.',
    password: true,
    ignoreFocusOut: true
  });
  if (!key || key.trim().length === 0) {
    return;
  }
  await setApiKey(host.context.secrets, key.trim());
  await host.sendInit();
  void vscode.window.showInformationMessage('MiniMax: the API key is saved.');
}


export async function clearApiKey(host: MiniMaxController): Promise<void> {
  await clearStoredApiKey(host.context.secrets);
  await host.sendInit();
  await postSettings(host);
  void vscode.window.showInformationMessage('MiniMax: the API key is removed.');
}


export async function setEndpoint(host: MiniMaxController): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Global (api.minimax.io)', value: 'global' },
      { label: 'China (api.minimaxi.com)', value: 'china' },
      { label: 'Custom URL', value: 'custom' }
    ],
    { title: 'MiniMax endpoint' }
  );
  if (!choice) {
    return;
  }
  const config = vscode.workspace.getConfiguration('minimax');
  if (choice.value === 'custom') {
    const url = await vscode.window.showInputBox({
      title: 'Custom MiniMax base URL',
      prompt: 'For example https://api.minimax.io/anthropic',
      value: config.get<string>('customBaseUrl', '')
    });
    if (!url || url.trim().length === 0) {
      return;
    }
    const trimmed = url.trim();
    const check = checkBaseUrl(trimmed);
    if (!check.ok) {
      void vscode.window.showErrorMessage(
        'MiniMax: the endpoint is not accepted, ' + check.reason + '.'
      );
      return;
    }
    // The key of the user goes to this host, the address of MiniMax is the
    // usual one and another host is asked about.
    if (!isOfficialBaseUrlHost(check.host ?? '')) {
      const answer = await vscode.window.showWarningMessage(
        'MiniMax: the API key will go to ' +
          check.host +
          '. It is not the address of MiniMax.',
        { modal: true },
        'Use it'
      );
      if (answer !== 'Use it') {
        return;
      }
    }
    await config.update('customBaseUrl', trimmed, vscode.ConfigurationTarget.Global);
    await config.update('baseUrl', 'auto', vscode.ConfigurationTarget.Global);
  } else {
    await config.update('baseUrl', choice.value, vscode.ConfigurationTarget.Global);
  }
  await host.sendInit();
}


export function warnAboutTheBaseUrl(host: MiniMaxController): void {
  const custom = getSettings().customBaseUrl.trim();
  if (custom.length === 0) {
    return;
  }
  const check = checkBaseUrl(custom);
  if (check.ok) {
    return;
  }
  host.logger.error('the custom base URL is not accepted: ' + check.reason);
  void vscode.window.showWarningMessage(
    'MiniMax: the custom base URL is not accepted, ' +
      check.reason +
      '. The official endpoint is used.'
  );
}


export async function selectModel(host: MiniMaxController): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    MODELS.map((model) => ({ label: model.label, value: model.id })),
    { title: 'MiniMax model' }
  );
  if (!choice) {
    return;
  }
  await updateSetting(host, 'model', choice.value);
}


export async function selectMode(host: MiniMaxController): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    AGENT_MODES.map((mode) => ({
      label: mode,
      description: mode === 'plan' ? 'read-only, the agent answers with a plan' : 'the agent can change files',
      value: mode
    })),
    { title: 'MiniMax agent mode' }
  );
  if (!choice) {
    return;
  }
  await updateSetting(host, 'mode', choice.value);
}


export async function selectEffort(host: MiniMaxController): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    (['low', 'medium', 'high', 'xhigh', 'max'] as EffortLevel[]).map((level) => ({
      label: level,
      value: level
    })),
    { title: 'MiniMax thinking effort' }
  );
  if (!choice) {
    return;
  }
  await updateSetting(host, 'effort', choice.value);
}
