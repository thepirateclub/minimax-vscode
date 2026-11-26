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
  // The countdown of the week moves between the answers of the server.
  private readonly clock: ReturnType<typeof setInterval>;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // A click opens the numbers of the plan, the panel is one row away.
    this.item.command = 'minimax.showUsage';
    this.clock = setInterval(() => this.render(), 60_000);
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
    clearInterval(this.clock);
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
    // The badge stays short: the share of the 5-hour window. The resets and
    // the rest of the numbers open on a click (minimax.showUsage).
    this.item.text =
      remaining === undefined ? labels[this.state] : labels[this.state] + ' (' + remaining + '%)';
    this.item.tooltip = this.tooltip();
    this.item.show();
  }

  // The rows name both resets already: a line of its own printed them twice.
  private tooltip(): string {
    const rows = buildUsageRows(this.usage, this.quota);
    const lines = ['MiniMax Agent'];
    for (const row of rows) {
      lines.push(row.label + ': ' + row.value);
    }
    return lines.join('\n');
  }
}
