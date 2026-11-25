import * as vscode from 'vscode';
import type { QuotaSnapshot } from '../api/quota';
import type { UsageSummary } from '../storage/usage';
import { buildUsageRows, weeklyResetText } from './usageRows';
import { formatCountdown } from './format';

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
    // The time left to the reset of the 5-hour window and of the week, next
    // to the share of the window.
    const left = (at: number | undefined, icon: string): string =>
      at !== undefined && at > Date.now() ? '  $(' + icon + ') ' + formatCountdown(at - Date.now()) : '';
    this.item.text =
      (remaining === undefined ? labels[this.state] : labels[this.state] + ' (' + remaining + '%)') +
      left(this.quota?.resetsAt, 'clock') +
      left(this.quota?.weeklyResetsAt, 'calendar');
    this.item.tooltip = this.tooltip();
    this.item.show();
  }

  private tooltip(): string {
    const rows = buildUsageRows(this.usage, this.quota);
    const lines = ['MiniMax Agent'];
    for (const row of rows) {
      lines.push(row.label + ': ' + row.value);
    }
    if (this.quota?.resetsAt !== undefined && this.quota.resetsAt > Date.now()) {
      lines.push('The 5-hour window resets ' + weeklyResetText(this.quota.resetsAt));
    }
    if (this.quota?.weeklyResetsAt !== undefined && this.quota.weeklyResetsAt > Date.now()) {
      lines.push('The weekly limit resets ' + weeklyResetText(this.quota.weeklyResetsAt));
    }
    return lines.join('\n');
  }
}
