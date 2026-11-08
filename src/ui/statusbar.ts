import * as vscode from 'vscode';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'minimax.openPanel';
    this.setState('idle');
  }

  setState(state: AgentState, tokens?: number): void {
    const labels: Record<AgentState, string> = {
      idle: '$(sparkle) MiniMax',
      thinking: '$(sync~spin) MiniMax thinking',
      streaming: '$(sync~spin) MiniMax streaming',
      tool: '$(tools) MiniMax running tool',
      error: '$(error) MiniMax error'
    };
    this.item.text = tokens === undefined ? labels[state] : labels[state] + ' (' + tokens + ')';
    this.item.tooltip = 'MiniMax Agent';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
