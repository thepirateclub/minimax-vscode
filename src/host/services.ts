import type * as vscode from 'vscode';
import { watchDenyPaths } from './denyPaths';
import { registerBeforeProvider } from './fileRevert';

// The small services of the host that only need the context of the
// extension: the closed paths and the text of a file before the agent.
export function registerHostServices(context: vscode.ExtensionContext): void {
  watchDenyPaths(context);
  registerBeforeProvider(context);
}
