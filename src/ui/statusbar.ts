import * as vscode from 'vscode';
import type { QuotaSnapshot } from '../api/quota';
import type { UsageSummary } from '../storage/usage';
import { buildUsageRows } from './usageRows';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private state: AgentState = 'idle';
  private quota: QuotaSnapshot | undefined;
  private usage: UsageSummary | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // A click opens the numbers of the plan, the panel is one row away.
    this.item.command = 'minimax.showUsage';
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

  setUsage(usage: UsageSummary | undefined): void {
    this.usage = usage;
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
    const rows = buildUsageRows(this.usage, this.quota);
    const lines = ['MiniMax Agent'];
    for (const row of rows) {
      lines.push(row.label + ': ' + row.value);
    }
    if (this.quota && this.quota.resetsInMs > 0) {
      lines.push('The 5-hour window resets in ' + formatDuration(this.quota.resetsInMs));
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
