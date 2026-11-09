import * as vscode from 'vscode';
import type { ExtToWeb, WebToExt } from './protocol';
import { themeKind } from './theme';

export function postToWebview(view: vscode.Webview, message: ExtToWeb): void {
  void view.postMessage(message);
}

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'minimax.chat';
  private view: vscode.WebviewView | undefined;
  private readonly onMessage: (message: WebToExt) => void;
  private readonly extensionUri: vscode.Uri;

  constructor(options: { extensionUri: vscode.Uri; onMessage: (message: WebToExt) => void }) {
    this.extensionUri = options.extensionUri;
    this.onMessage = options.onMessage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri]
    };
    webviewView.webview.html = this.html(webviewView.webview, distUri);

    webviewView.webview.onDidReceiveMessage((message: WebToExt) => {
      this.onMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  post(message: ExtToWeb): void {
    if (this.view) {
      postToWebview(this.view.webview, message);
    }
  }

  reveal(): void {
    void vscode.commands.executeCommand('minimax.chat.focus');
  }

  private html(webview: vscode.Webview, distUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.js'));
    const nonce = makeNonce();
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' +
        nonce +
        '\'; img-src ' +
        webview.cspSource +
        ' data:;" />',
      '<title>MiniMax Agent</title>',
      '</head>',
      '<body class="mm-theme-' + themeKind() + '">',
      '<div id="root"></div>',
      '<script nonce="' + nonce + '" src="' + scriptUri + '"></script>',
      '</body>',
      '</html>'
    ].join('\n');
  }
}

function makeNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return text;
}
