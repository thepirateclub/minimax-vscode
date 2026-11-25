import type { MiniMaxController } from '../extension';
import type { UiSuggestion, UiSelection } from '../ui/protocol';
import { postFor } from './channel';
import { getApiKey } from '../config/secrets';
import { getSettings } from '../config/settings';
import { resolveBaseUrl } from '../config/models';
import { ProjectSearch } from '../search/project';
import { HttpEmbeddingsClient } from '../api/embeddings';
import { isTextFile } from '../search/files';
import { resolveWorkspacePath } from '../paths';
import { fileErrorMessage } from '../ui/fileError';
import type { RuntimeSession } from './runtime';
import { readChangedFiles } from '../git/changes';
import { mergeChangedFiles } from './changedFiles';
import { isAbsolute } from 'node:path';
import * as vscode from 'vscode';

export function searchFor(host: MiniMaxController, root: string): ProjectSearch {
  let search = host.searches.get(root);
  if (!search) {
    search = new ProjectSearch(root);
    host.searches.set(root, search);
    void applySemanticProvider(host);
  }
  return search;
}


export async function applySemanticProvider(host: MiniMaxController): Promise<void> {
  const settings = getSettings();
  const key = settings.semanticSearch ? await getApiKey(host.context.secrets) : undefined;
  for (const search of host.searches.values()) {
    if (!key) {
      search.setSemanticProvider(undefined);
      continue;
    }
    search.setSemanticProvider(
      new HttpEmbeddingsClient({
        baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
        apiKey: key
      })
    );
  }
}


export async function sendSuggestions(host: MiniMaxController, requestId: string, prefix: string): Promise<void> {
  const items = await collectSuggestions(host, prefix);
  host.panel.post({ type: 'suggestions', requestId, items });
}


export async function collectSuggestions(host: MiniMaxController, prefix: string): Promise<UiSuggestion[]> {
  const query = prefix.trim().toLowerCase();
  const items: UiSuggestion[] = [];
  const seen = new Set<string>();

  for (const path of openFilePaths(host)) {
    if (seen.has(path)) {
      continue;
    }
    if (query.length === 0 || path.toLowerCase().includes(query)) {
      seen.add(path);
      items.push({ id: 'open:' + path, path, label: path, source: 'open' });
    }
  }

  for (const path of await workspaceFiles(host)) {
    if (items.length >= 60) {
      break;
    }
    if (seen.has(path)) {
      continue;
    }
    if (query.length > 0 && !path.toLowerCase().includes(query)) {
      continue;
    }
    seen.add(path);
    items.push({ id: 'file:' + path, path, label: path, source: 'workspace' });
  }

  return items;
}


export function openFilePaths(_host: MiniMaxController): string[] {
  const paths: string[] = [];
  for (const document of vscode.workspace.textDocuments) {
    const path = vscode.workspace.asRelativePath(document.uri, false);
    if (path.length === 0 || path.startsWith('..')) {
      continue;
    }
    // Virtual documents, for example the git history, live outside the
    // workspace and come back as an absolute path.
    if (isAbsolute(path)) {
      continue;
    }
    paths.push(path);
  }
  return paths;
}


export async function workspaceFiles(host: MiniMaxController): Promise<string[]> {
  const now = Date.now();
  if (host.fileCache && now - host.fileCache.at < 60_000) {
    return host.fileCache.files;
  }
  let files: string[] = [];
  try {
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,dist,out,coverage,.next,build}/**',
      1000
    );
    files = uris
      .map((uri) => vscode.workspace.asRelativePath(uri, false))
      .filter(
        (path) =>
          path.length > 0 &&
          !path.startsWith('..') &&
          !isAbsolute(path) &&
          isTextFile(path)
      );
  } catch (error) {
    host.logger.error('the workspace file search failed', error);
  }
  host.fileCache = { files, at: now };
  return files;
}


export function addSelectionToChat(host: MiniMaxController): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('MiniMax: open a file to send a selection.');
    return;
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    void vscode.window.showInformationMessage('MiniMax: select the code you want to send.');
    return;
  }
  const path = vscode.workspace.asRelativePath(editor.document.uri, false);
  const startLine = selection.start.line + 1;
  const endLine = selection.end.line + 1;
  const selected: UiSelection = {
    id: host.nextId('sel'),
    path,
    label: path.split(/[\\/]/).pop() ?? path,
    detail: 'lines ' + startLine + '-' + endLine,
    content: editor.document.getText(selection)
  };
  host.panel.post({ type: 'selection', selection: selected });
  host.panel.reveal();
}


export function addFileToChat(host: MiniMaxController, uri?: vscode.Uri): void {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    return;
  }
  const path = vscode.workspace.asRelativePath(target, false);
  host.panel.post({ type: 'mention', path });
  host.panel.reveal();
}


export async function openFile(host: MiniMaxController, path: string, line?: number): Promise<void> {
  try {
    const target = resolveWorkspacePath(host.workspaceRoot(), path);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (line !== undefined && line > 0) {
      const row = Math.min(line - 1, Math.max(0, document.lineCount - 1));
      const position = new vscode.Position(row, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    host.logger.error('cannot open ' + path + ': ' + reason);
    host.panel.post({ type: 'error', message: fileErrorMessage(path, reason) });
  }
}


export async function postSummary(host: MiniMaxController, runtime: RuntimeSession): Promise<void> {
  // The files the agent changed come first, the state of the repository
  // adds the rest of the working tree. The project of the chat is the
  // source, not the first folder of the window.
  const files = mergeChangedFiles(
    runtime.changedFiles,
    await readChangedFiles(runtime.workspaceRoot)
  );
  if (files.length === 0) {
    return;
  }
  postFor(host, runtime, { type: 'summary', files });
}

