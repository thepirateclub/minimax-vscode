import * as vscode from 'vscode';
import { buildUsageRows, type UsageRow } from './usageRows';

export const OPEN_PANEL_LABEL = 'Open the MiniMax panel';

// A click on the badge opens the numbers of the plan. The list stays open
// until the user picks a row or closes it.
export function showUsageDetails(
  rows: UsageRow[],
  onOpenPanel: () => void
): void {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = 'MiniMax token spend';
  quickPick.items = [
    ...rows.map((row) => ({ label: row.label, description: row.value })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: OPEN_PANEL_LABEL, description: '' }
  ];
  quickPick.onDidAccept(() => {
    const picked = quickPick.selectedItems[0];
    if (picked && picked.label === OPEN_PANEL_LABEL) {
      onOpenPanel();
    }
    quickPick.hide();
  });
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

// The rows of the badge, the status bar asks for them.
export { buildUsageRows };
