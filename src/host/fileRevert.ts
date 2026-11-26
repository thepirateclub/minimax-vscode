import { relative, sep } from 'node:path';
import type { MiniMaxController } from '../extension';
import { resolveWorkspacePath } from '../paths';
import { planRestore, restoreFiles } from '../storage/backups';
import type { UiChangedFile } from '../ui/protocol';
import { postFor } from './channel';
import { forgetChangedFiles } from './changedFiles';
import type { RuntimeSession } from './runtime';
import * as vscode from 'vscode';

// The scheme of the text of a file before the agent: the diff of the editor
// reads it from this provider.
const SCHEME = 'minimax-before';
const before = new Map<string, string>();

export function registerBeforeProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent: (uri) => before.get(uri.query) ?? ''
    })
  );
}

// The files of the agent that the store can still take back.
export async function markRevertible(
  host: MiniMaxController,
  runtime: RuntimeSession,
  files: UiChangedFile[]
): Promise<UiChangedFile[]> {
  const backed = new Set(
    (await host.backups.list())
      .filter((entry) => entry.sessionId === runtime.id)
      .map((entry) => relative(runtime.workspaceRoot, entry.path).split(sep).join('/'))
  );
  return files.map((file) => (backed.has(file.path) ? { ...file, revertible: true } : file));
}

// The state of the file before the first change of the agent in this chat.
async function originOf(host: MiniMaxController, runtime: RuntimeSession, absolute: string) {
  const entries = (await host.backups.list()).filter(
    (entry) => entry.sessionId === runtime.id && entry.path === absolute
  );
  return entries.length > 0 ? planRestore(entries)[0] : undefined;
}

export async function diffFile(host: MiniMaxController, path: string): Promise<void> {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  const absolute = resolveWorkspacePath(runtime.workspaceRoot, path);
  const plan = await originOf(host, runtime, absolute);
  if (!plan) {
    return;
  }
  const key = runtime.id + ':' + absolute;
  before.set(key, plan.restore ?? '');
  const left = vscode.Uri.from({ scheme: SCHEME, path: '/' + path, query: key });
  await vscode.commands.executeCommand('vscode.diff', left, vscode.Uri.file(absolute), path + ' (before the agent ↔ now)');
}

// One file goes back to the state before the agent, the rest of the work
// stays. A file the reader changed after the agent stays too.
export async function revertFile(host: MiniMaxController, path: string): Promise<void> {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  const absolute = resolveWorkspacePath(runtime.workspaceRoot, path);
  const entries = await host.backups.takeFile(runtime.id, absolute);
  if (entries.length === 0) {
    return;
  }
  const { restored } = await restoreFiles(planRestore(entries));
  if (restored.length === 0) {
    // The file is the reader's now: the backups go back, nothing changes.
    for (const entry of entries) {
      await host.backups.save(entry.path, entry.previousContent, {
        sessionId: entry.sessionId,
        next: entry.nextContent,
        at: entry.createdAt
      });
    }
    postFor(host, runtime, { type: 'notice', message: 'Left as it is, it changed after the agent: ' + path + '.', kind: 'warn' });
    return;
  }
  runtime.changedFiles = forgetChangedFiles(runtime.changedFiles, [path]);
  postFor(host, runtime, { type: 'notice', message: 'The file went back to the state before the agent: ' + path + '.', kind: 'info' });
  const { postSummary } = await import('./workspace');
  await postSummary(host, runtime);
}
