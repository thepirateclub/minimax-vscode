import type * as vscode from 'vscode';
import { getSettings, onSettingsChanged } from '../config/settings';
import { setDenyPatterns } from '../denyPaths';

// The closed paths hold from the first call of a tool on, and change at
// once, not after the debounced rebuild of the agents: a call in flight must
// not read the file the reader has just closed.
export function watchDenyPaths(context: vscode.ExtensionContext): void {
  setDenyPatterns(getSettings().denyPaths);
  context.subscriptions.push(onSettingsChanged((settings) => setDenyPatterns(settings.denyPaths)));
}
