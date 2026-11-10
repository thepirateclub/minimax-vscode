// A stand of the panel for the eye: the real webview with a fake host. It
// posts one chat that holds every kind of message, so a change of the styles
// is checked on the whole panel at once. Build and serve: npm run preview.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/webview/App';
import styles from '../../src/ui/webview/styles.css';
import { MODELS } from '../../src/config/models';
import type { ExtToWeb, UiSettings, UiState } from '../../src/ui/protocol';
import { MESSAGES, USAGE, sessions } from './fixture';
import dark from './themes/dark.json';
import light from './themes/light.json';

// The colors of the themes of VS Code, taken from a live webview of the editor
// (Dark Modern and Light Modern of VS Code 1.145). Guessed colors hid that the
// modern themes draw a secondary button with a clear fill.
const THEMES: Record<string, Record<string, string>> = { dark, light };

const params = new URLSearchParams(location.search);
const themeKind = params.get('theme') === 'light' ? 'light' : 'dark';
const busy = params.get('busy') === '1';

const root = document.documentElement;
for (const [name, value] of Object.entries(THEMES[themeKind]!)) {
  root.style.setProperty('--vscode-' + name, value);
}
document.body.classList.add('mm-theme-' + themeKind);

// The default styles VS Code puts into every webview, in the same layer, so
// the stand shows what the host does to the panel.
const hostDefaults = document.createElement('style');
hostDefaults.textContent =
  '@layer vscode-default { html { scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background); } }';
document.head.appendChild(hostDefaults);

const styleElement = document.createElement('style');
styleElement.textContent = styles;
document.head.appendChild(styleElement);

const STATE: UiState = {
  sessions: sessions(Date.now()),
  activeSessionId: 's1',
  messages: params.get('empty') === '1' ? [] : MESSAGES,
  model: MODELS[0]!.id,
  models: MODELS,
  effort: 'max',
  mode: 'code',
  thinking: false,
  state: busy ? 'streaming' : 'idle',
  tokens: 184_320,
  usage: USAGE,
  hasApiKey: params.get('nokey') !== '1',
  theme: themeKind,
  fontSize: 13,
  collapseTools: params.get('collapse') === '1',
  collapseCode: params.get('collapse') === '1'
};

const SETTINGS: UiSettings = {
  baseUrl: 'auto',
  customBaseUrl: '',
  model: MODELS[0]!.id,
  effort: 'max',
  mode: 'code',
  thinking: false,
  maxIterations: 25,
  fontSize: 13,
  historyMaxMessages: 200,
  contextThreshold: 50,
  semanticSearch: false,
  autoApprove: ['read_file'],
  rulesEnabled: true,
  enableWebSearch: false,
  collapseTools: false,
  collapseCode: false,
  hasApiKey: true,
  models: MODELS,
  tools: ['read_file', 'write_file', 'edit_file', 'list_files', 'search_code', 'run_terminal']
};

function post(message: ExtToWeb): void {
  window.postMessage(message, '*');
}

const vscode = {
  postMessage(message: { type: string }): void {
    if (message.type === 'ready') {
      post({ type: 'init', state: STATE });
      // The composer with its chips and the popup of the file suggestions.
      if (params.get('composer') === '1') {
        post({ type: 'selection', selection: { id: 'sel1', path: 'src/ui/format.ts', label: 'format.ts', detail: '3-9' } });
        post({ type: 'mention', path: 'src/ui/webview/components/Header.tsx' });
        post({
          type: 'suggestions',
          requestId: 'suggestions',
          items: [
            { id: 'a', path: 'src/ui/format.ts', label: 'format.ts', source: 'open' },
            { id: 'b', path: 'src/ui/statusBar.ts', label: 'statusBar.ts', source: 'workspace' },
            { id: 'c', path: 'src/ui/webview/components/Header.tsx', label: 'Header.tsx', source: 'workspace' }
          ]
        });
      }
    }
    if (message.type === 'request_settings') {
      post({ type: 'settings', settings: SETTINGS });
    }
  }
};

const container = document.getElementById('root')!;
createRoot(container).render(
  <StrictMode>
    <App vscode={vscode} />
  </StrictMode>
);
