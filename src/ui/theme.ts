import * as vscode from 'vscode';
import type { ThemeKind } from './protocol';

// The kinds of the theme of the host. The numbers are the values of the enum
// of the api, the name of the enum changed between the versions of the
// editor, so the codes are compared as numbers.
const LIGHT = 1;
const HIGH_CONTRAST = 3;
const HIGH_CONTRAST_LIGHT = 4;

// The webview cannot read the theme of the host, the kind of the theme
// decides the palette of the code blocks.
export function themeKind(): ThemeKind {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === LIGHT) {
    return 'light';
  }
  if (kind === HIGH_CONTRAST) {
    return 'high-contrast';
  }
  if (kind === HIGH_CONTRAST_LIGHT) {
    return 'high-contrast-light';
  }
  return 'dark';
}
