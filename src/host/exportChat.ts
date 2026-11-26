import { writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { MiniMaxController } from '../extension';
import { chatToMarkdown, exportFileName, type ChatExport } from '../ui/chatExport';

// The chat in memory is newer than the stored one: a running turn has not
// been saved yet.
function chatFor(host: MiniMaxController, id: string | undefined): ChatExport | undefined {
  const runtime = id ? host.sessions.get(id) : host.activeSession();
  if (runtime) {
    return runtime;
  }
  return id ? host.store.get(id) : undefined;
}

export async function exportChat(host: MiniMaxController, id?: string): Promise<void> {
  const chat = chatFor(host, id);
  if (!chat || chat.uiMessages.length === 0) {
    void vscode.window.showInformationMessage('MiniMax: there is no chat to export.');
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const name = exportFileName(chat.title);
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, name) : vscode.Uri.file(name),
    filters: { Markdown: ['md'] },
    saveLabel: 'Export'
  });
  if (!target) {
    return;
  }
  try {
    await writeFile(target.fsPath, chatToMarkdown(chat), 'utf8');
    void vscode.window.showInformationMessage('MiniMax: the chat is exported to ' + target.fsPath);
  } catch (error) {
    void vscode.window.showErrorMessage('MiniMax: the chat is not exported: ' + String(error));
  }
}
