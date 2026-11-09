import * as vscode from 'vscode';
import type { QuotaSnapshot } from '../api/quota';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private state: AgentState = 'idle';
  private quota: QuotaSnapshot | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'minimax.openPanel';
    this.render();
  }

  setState(state: AgentState): void {
    this.state = state;
    this.render();
  }

  setQuota(quota: QuotaSnapshot | undefined): void {
    this.quota = quota;
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    const labels: Record<AgentState, string> = {
      idle: '$(sparkle) MiniMax',
      thinking: '$(sync~spin) MiniMax thinking',
      streaming: '$(sync~spin) MiniMax streaming',
      tool: '$(tools) MiniMax running tool',
      error: '$(error) MiniMax error'
    };
    const remaining = this.quota?.remainingPercent;
    this.item.text =
      remaining === undefined ? labels[this.state] : labels[this.state] + ' (' + remaining + '%)';
    this.item.tooltip = this.tooltip();
    this.item.show();
  }

  private tooltip(): string {
    const quota = this.quota;
    if (!quota || quota.remainingPercent === undefined) {
      return 'MiniMax Agent';
    }
    const lines = ['MiniMax Agent', '5-hour window left: ' + quota.remainingPercent + '%'];
    if (quota.weeklyRemainingPercent !== undefined) {
      lines.push('Weekly window left: ' + quota.weeklyRemainingPercent + '%');
    }
    if (quota.resetsInMs > 0) {
      lines.push('The 5-hour window resets in ' + formatDuration(quota.resetsInMs));
    }
    return lines.join('\n');
  }
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return minutes + ' min';
  }
  return hours + ' h ' + minutes + ' min';
}
