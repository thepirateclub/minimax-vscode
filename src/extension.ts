import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('MiniMax');
  context.subscriptions.push(channel);
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.openPanel', async () => {
      await vscode.commands.executeCommand('minimax.chat.focus');
    })
  );
  for (const id of [
    'minimax.newChat',
    'minimax.addApiKey',
    'minimax.setEndpoint',
    'minimax.selectModel',
    'minimax.setEffort',
    'minimax.undoLastChange',
    'minimax.refreshContext',
    'minimax.showLogs',
    'minimax.clearApiKey'
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        channel.appendLine('command not wired yet: ' + id);
      })
    );
  }
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('minimax.chat', {
      resolveWebviewView(view) {
        view.webview.html = '<!doctype html><html><body><div id="root"></div></body></html>';
      }
    })
  );
}

export function deactivate(): void {
  void 0;
}
