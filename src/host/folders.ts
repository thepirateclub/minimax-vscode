import type { MiniMaxController } from '../extension';
import { persist, restoreSession } from './sessions';
import { clearTrash } from '../tools/trash';
import * as vscode from 'vscode';

// The project of the panel in a window with several folders. The first
// folder was the only choice: the chats, the index and the tools of the
// other folders were out of reach. The choice lives in the state of the
// window, a folder that left the window falls back to the first one.
const KEY = 'minimax.projectRoot';

export function currentRoot(context: vscode.ExtensionContext): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const chosen = context.workspaceState?.get<string>(KEY);
  const folder = folders.find((item) => item.uri.fsPath === chosen) ?? folders[0];
  return folder ? folder.uri.fsPath : process.cwd();
}

export async function selectFolder(host: MiniMaxController): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length < 2) {
    void vscode.window.showInformationMessage('MiniMax: the window has one folder, it is the project of the agent.');
    return;
  }
  const current = host.workspaceRoot();
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath === current ? 'current' : folder.uri.fsPath,
      root: folder.uri.fsPath
    })),
    { placeHolder: 'The project folder of the MiniMax agent' }
  );
  if (!picked || picked.root === current) {
    return;
  }
  // The open chat is saved where it belongs, the project of the chosen
  // folder opens its own chat.
  const active = host.activeSession();
  if (active) {
    persist(host, active);
  }
  await host.context.workspaceState.update(KEY, picked.root);
  restoreSession(host);
}

export function registerFolderCommand(host: MiniMaxController, context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.selectFolder', () => void selectFolder(host)),
    vscode.commands.registerCommand('minimax.clearTrash', () => void emptyTrash(host))
  );
}

// The trash of the project goes away for good, the reader confirms it.
async function emptyTrash(host: MiniMaxController): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    'MiniMax: delete the files in the trash of the project for good?',
    { modal: true },
    'Delete'
  );
  if (answer === 'Delete') {
    await clearTrash(host.workspaceRoot());
  }
}
