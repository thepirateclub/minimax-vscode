import type { MiniMaxController } from '../extension';
import { buildPrompt, effortFor, thinkingMode } from './setup';
import { buildUsageRows } from '../ui/usageRows';
import { MODELS } from '../config/models';
import { generateCommitMessage as writeCommitMessage } from '../agent/commitMessage';
import { showUsageDetails } from '../ui/usageDetails';
import { gitRepositories, collectStagedChanges, setCommitMessage } from '../git/scm';
import { fetchQuota } from '../api/quota';
import { searchFor } from './workspace';
import { HttpMiniMaxClient } from '../api/client';
import { getApiKey } from '../config/secrets';
import { resolveBaseUrl } from '../config/models';
import { unlink, writeFile } from 'node:fs/promises';
import { getSettings } from '../config/settings';
import * as vscode from 'vscode';

export function showLogs(host: MiniMaxController): void {
  host.channel.show(true);
}


export async function showUsage(host: MiniMaxController): Promise<void> {
  await refreshQuota(host);
  const rows = buildUsageRows(host.ledger.lastDay(), host.quota);
  showUsageDetails(rows, () => host.panel.reveal());
}


export async function generateCommitMessage(host: MiniMaxController): Promise<void> {
  const repositories = await gitRepositories();
  const repository = repositories[0];
  const root = repository?.rootUri.fsPath ?? host.workspaceRoot();
  const changes = await collectStagedChanges(root);
  if (changes.diff.trim().length === 0) {
    void vscode.window.showInformationMessage(
      'MiniMax: there are no changes to describe.'
    );
    return;
  }
  const key = await getApiKey(host.context.secrets);
  if (!key) {
    void vscode.window.showErrorMessage(
      'MiniMax: no API key. Run "MiniMax: Add API Key" from the command palette.'
    );
    return;
  }
  const settings = getSettings();
  const model = MODELS.find((item) => item.id === settings.model);
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'MiniMax writes the commit message'
      },
      async () =>
        await writeCommitMessage({
          client: new HttpMiniMaxClient({
            baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
            apiKey: key
          }),
          model: settings.model,
          maxTokens: model?.maxTokens ?? 65_536,
          effort: effortFor(host, settings),
          thinking: thinkingMode(host, settings),
          context: {
            files: changes.files,
            diff: changes.diff,
            recentSubjects: changes.recentSubjects
          }
        })
    );
    host.ledger.add({
      at: Date.now(),
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      cacheRead: result.usage.cacheReadTokens ?? 0,
      cacheCreation: result.usage.cacheCreationTokens ?? 0
    });
    host.statusBar.setUsage(host.ledger.lastDay());
    if (result.message.length === 0) {
      void vscode.window.showErrorMessage(
        'MiniMax: the model returned an empty commit message.'
      );
      return;
    }
    if (repository) {
      setCommitMessage(repository, result.message);
      void vscode.window.showInformationMessage(
        'MiniMax: the commit message is ready.'
      );
      return;
    }
    await vscode.env.clipboard.writeText(result.message);
    void vscode.window.showInformationMessage(
      'MiniMax: the commit message is in the clipboard.'
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    host.logger.error('the commit message failed', error);
    void vscode.window.showErrorMessage('MiniMax: ' + reason);
  }
}


export async function refreshQuota(host: MiniMaxController): Promise<void> {
  const key = await getApiKey(host.context.secrets);
  if (!key) {
    return;
  }
  const settings = getSettings();
  try {
    host.quota = await fetchQuota({
      baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
      apiKey: key
    });
    host.statusBar.setQuota(host.quota);
    host.statusBar.setUsage(host.ledger.lastDay());
  } catch (error) {
    host.logger.error('the quota request failed', error);
  }
}


export async function undoLastChange(host: MiniMaxController): Promise<void> {
  const entry = await host.backups.revertLast();
  if (!entry) {
    void vscode.window.showInformationMessage('MiniMax: there is nothing to undo.');
    return;
  }
  try {
    if (entry.previousContent === null) {
      await unlink(entry.path);
    } else {
      await writeFile(entry.path, entry.previousContent, 'utf8');
    }
    void vscode.window.showInformationMessage('MiniMax: reverted ' + entry.path);
  } catch (error) {
    host.logger.error('the undo failed', error);
    void vscode.window.showErrorMessage('MiniMax: the undo failed, see the output channel.');
  }
}


export async function refreshContext(host: MiniMaxController): Promise<void> {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  runtime.agent?.setSystemPrompt(await buildPrompt(host));
  void vscode.window.showInformationMessage('MiniMax: the workspace context is refreshed.');
}


export function prepareIndex(host: MiniMaxController): void {
  void searchFor(host, host.workspaceRoot()).ensureIndex();
}


export async function reindex(host: MiniMaxController): Promise<void> {
  const search = searchFor(host, host.workspaceRoot());
  await search.rebuild();
  void vscode.window.showInformationMessage(
    'MiniMax: the index of the project is ready, ' + search.fileCount + ' files.'
  );
}

