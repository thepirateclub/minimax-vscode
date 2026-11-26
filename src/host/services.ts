import type * as vscode from 'vscode';
import type { MiniMaxController } from '../extension';
import { registerFolderCommand } from './folders';
import { watchDenyPaths } from './denyPaths';
import { registerBeforeProvider } from './fileRevert';

// The small services of the host that only need the context of the
// extension: the closed paths, the text of a file before the agent and
// the choice of the project folder.
export function registerHostServices(host: MiniMaxController, context: vscode.ExtensionContext): void {
  watchDenyPaths(context);
  registerFolderCommand(host, context);
  registerBeforeProvider(context);
}
