import * as vscode from 'vscode';
import type { MiniMaxController } from '../extension';
import type { UiSelection } from '../ui/protocol';
import { COMMENT_PROMPT, EXPLAIN_REQUEST, improveRequest, wholeFileDetail } from '../agent/editorPrompts';
import { handleSend } from './turn';
import { addSelectionToChat } from './workspace';

// The commands of the editor: explain a selection, annotate it with a
// note for the chat, improve it with the prompt of the settings.

function currentSelection(host: MiniMaxController, note?: string): UiSelection | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage('MiniMax: select the code first.');
    return undefined;
  }
  const path = vscode.workspace.asRelativePath(editor.document.uri, false);
  const { start, end } = editor.selection;
  return {
    id: host.nextId('sel'),
    path,
    label: path.split(/[\\/]/).pop() ?? path,
    detail: 'lines ' + (start.line + 1) + '-' + (end.line + 1),
    content: editor.document.getText(editor.selection),
    ...(note ? { note } : {})
  };
}

export async function explainSelection(host: MiniMaxController): Promise<void> {
  const selection = currentSelection(host);
  if (!selection) {
    return;
  }
  host.panel.reveal();
  await handleSend(host, EXPLAIN_REQUEST, [], [selection]);
}

// An annotation is a selection with a note of the reader. Several of them
// gather above the input field and go with the next request.
export async function annotateSelection(host: MiniMaxController): Promise<void> {
  if (!vscode.window.activeTextEditor || vscode.window.activeTextEditor.selection.isEmpty) {
    void vscode.window.showInformationMessage('MiniMax: select the code first.');
    return;
  }
  const note = await vscode.window.showInputBox({
    title: 'MiniMax: annotate the selection',
    prompt: 'What should the agent know or do about this code? It goes to the chat with the next request.',
    placeHolder: 'For example: why is this slow?'
  });
  if (note === undefined) {
    return;
  }
  const selection = currentSelection(host, note.trim());
  if (!selection) {
    return;
  }
  host.panel.post({ type: 'selection', selection });
  host.panel.reveal();
}

export async function improveSelection(host: MiniMaxController, fixed?: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage('MiniMax: select the code first.');
    return;
  }
  const document = editor.document;
  const { start, end } = editor.selection;
  // A selection that ends at the start of a line does not take that line.
  const endLine = end.character === 0 && end.line > start.line ? end.line : end.line + 1;
  // The prompt goes to the model as an order: only the user sets it, a
  // cloned repository does not with its own settings.
  const instruction = fixed ?? vscode.workspace.getConfiguration('minimax').inspect<string>('improvePrompt')?.globalValue ?? '';
  const path = vscode.workspace.asRelativePath(document.uri, false);
  const startLine = start.line + 1;
  const { request, context } = improveRequest({ path, startLine, endLine, fileText: document.getText(), instruction });
  const file: UiSelection = {
    id: host.nextId('sel'),
    path,
    label: path.split(/[\\/]/).pop() ?? path,
    detail: wholeFileDetail(startLine, endLine),
    content: context
  };
  host.panel.reveal();
  await handleSend(host, request, [], [file]);
}

export function registerEditorActions(host: MiniMaxController, context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.addSelection', () => addSelectionToChat(host)),
    vscode.commands.registerCommand('minimax.explainSelection', () => explainSelection(host)),
    vscode.commands.registerCommand('minimax.annotateSelection', () => annotateSelection(host)),
    vscode.commands.registerCommand('minimax.improveSelection', () => improveSelection(host)),
    vscode.commands.registerCommand('minimax.commentSelection', () => improveSelection(host, COMMENT_PROMPT))
  );
}
