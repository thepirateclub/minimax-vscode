import * as vscode from 'vscode';
import { createDiagnosticsProvider, type DiagnosticsProvider } from '../tools/diagnostics';

// The language servers of the editor report the problems of a file a moment
// after the write. Two and a half seconds cover the TypeScript server on a
// warm project, a slow server gives no report rather than a stale one.
const DIAGNOSTICS_TIMEOUT_MS = 2500;

// The problems of a file for the result of write_file and edit_file, read
// from the editor. The logic of the waiting lives in src/tools/diagnostics.ts.
export function editorDiagnostics(): DiagnosticsProvider {
  return createDiagnosticsProvider(
    {
      open: async (path) => {
        await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      },
      read: (path) =>
        vscode.languages.getDiagnostics(vscode.Uri.file(path)).map((item) => ({
          severity: item.severity,
          line: item.range.start.line,
          message: item.message,
          ...(item.source ? { source: item.source } : {})
        })),
      onChange: (listener) => {
        const subscription = vscode.languages.onDidChangeDiagnostics((event) =>
          listener(event.uris.map((uri) => uri.fsPath))
        );
        return () => subscription.dispose();
      }
    },
    DIAGNOSTICS_TIMEOUT_MS
  );
}
