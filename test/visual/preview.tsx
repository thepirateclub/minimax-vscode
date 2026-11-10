// A stand of the panel for the eye: the real webview with a fake host. It
// posts one chat that holds every kind of message, so a change of the styles
// is checked on the whole panel at once. Build and serve: npm run preview.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/webview/App';
import styles from '../../src/ui/webview/styles.css';
import { MODELS } from '../../src/config/models';
import type { ExtToWeb, UiMessage, UiSettings, UiState } from '../../src/ui/protocol';

// The colors of the themes of VS Code, the host injects them into a webview.
const THEMES: Record<string, Record<string, string>> = {
  dark: {
    'font-family': '-apple-system, "Segoe UI", sans-serif',
    'editor-font-family': 'Consolas, "Courier New", monospace',
    foreground: '#cccccc',
    descriptionForeground: '#9d9d9d',
    'sideBar-background': '#181818',
    'widget-border': '#313131',
    'panel-border': '#2b2b2b',
    'textLink-foreground': '#4daafc',
    'textCodeBlock-background': '#2b2b2b',
    'textBlockQuote-background': '#2b2b2b',
    'editorWidget-background': '#202020',
    'button-background': '#0078d4',
    'button-foreground': '#ffffff',
    'button-hoverBackground': '#026ec1',
    'button-secondaryBackground': '#313131',
    'button-secondaryForeground': '#cccccc',
    'button-secondaryHoverBackground': '#3c3c3c',
    'input-background': '#313131',
    'input-foreground': '#cccccc',
    'input-border': '#3c3c3c',
    'dropdown-background': '#313131',
    focusBorder: '#0078d4',
    'toolbar-hoverBackground': 'rgba(90, 93, 94, 0.31)',
    'list-hoverBackground': '#2a2d2e',
    'list-activeSelectionBackground': '#04395e',
    'list-activeSelectionForeground': '#ffffff',
    'quickInput-background': '#222222',
    'testing-iconPassed': '#73c991',
    'testing-iconFailed': '#f14c4c',
    'inputValidation-errorForeground': '#f14c4c',
    'inputValidation-warningBackground': '#352a05',
    'inputValidation-warningBorder': '#b89500',
    'scrollbarSlider-background': 'rgba(121, 121, 121, 0.4)'
  },
  light: {
    'font-family': '-apple-system, "Segoe UI", sans-serif',
    'editor-font-family': 'Consolas, "Courier New", monospace',
    foreground: '#3b3b3b',
    descriptionForeground: '#717171',
    'sideBar-background': '#f8f8f8',
    'widget-border': '#e5e5e5',
    'panel-border': '#e5e5e5',
    'textLink-foreground': '#005fb8',
    'textCodeBlock-background': '#f2f2f2',
    'textBlockQuote-background': '#f2f2f2',
    'editorWidget-background': '#f8f8f8',
    'button-background': '#005fb8',
    'button-foreground': '#ffffff',
    'button-hoverBackground': '#0258a8',
    'button-secondaryBackground': '#e5e5e5',
    'button-secondaryForeground': '#3b3b3b',
    'button-secondaryHoverBackground': '#cccccc',
    'input-background': '#ffffff',
    'input-foreground': '#3b3b3b',
    'input-border': '#cecece',
    'dropdown-background': '#ffffff',
    focusBorder: '#005fb8',
    'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
    'list-hoverBackground': '#f2f2f2',
    'list-activeSelectionBackground': '#e8e8e8',
    'list-activeSelectionForeground': '#000000',
    'quickInput-background': '#f8f8f8',
    'testing-iconPassed': '#388a34',
    'testing-iconFailed': '#f14c4c',
    'inputValidation-errorForeground': '#a1260d',
    'inputValidation-warningBackground': '#f6f5d2',
    'inputValidation-warningBorder': '#b89500',
    'scrollbarSlider-background': 'rgba(100, 100, 100, 0.4)'
  }
};

const params = new URLSearchParams(location.search);
const themeKind = params.get('theme') === 'light' ? 'light' : 'dark';
const busy = params.get('busy') === '1';

const root = document.documentElement;
for (const [name, value] of Object.entries(THEMES[themeKind]!)) {
  root.style.setProperty('--vscode-' + name, value);
}
document.body.classList.add('mm-theme-' + themeKind);

const styleElement = document.createElement('style');
styleElement.textContent = styles;
document.head.appendChild(styleElement);

const README = Array.from({ length: 14 }, (_, i) => `${i + 1}: ${i % 3 === 0 ? 'import { join } from \'node:path\';' : i % 3 === 1 ? 'export function run(args: string[]): number {' : '  return args.length; // count'}`).join('\n');

const MESSAGES: UiMessage[] = [
  { id: 'u1', role: 'user', text: 'Найди, где считается расход токенов, и добавь округление.' },
  {
    id: 'a1',
    role: 'assistant',
    thinking: 'The user wants rounding. Look at src/ui/format.ts first.',
    text: '## Plan\n\nI will read **format.ts**, then patch `formatCount`.\n\n1. Read the module\n2. Add the `B` suffix\n\n> The status bar uses the same helper.\n\n```ts\nexport function formatCount(value: number): string {\n  return value >= 1e9 ? (value / 1e9).toFixed(1) + \'B\' : String(value);\n}\n```\n\n| Suffix | Value |\n|---|---|\n| K | 1e3 |\n| M | 1e6 |'
  },
  {
    id: 't1',
    role: 'tool',
    tool: { id: 't1', name: 'read_file', input: { path: 'src/ui/format.ts', start_line: 1, end_line: 14 }, content: README, durationMs: 4 }
  },
  {
    id: 't2',
    role: 'tool',
    tool: { id: 't2', name: 'search_code', input: { query: 'formatCount' }, content: 'src/ui/format.ts:3\nsrc/ui/statusBar.ts:12\nsrc/ui/webview/components/Header.tsx:5', durationMs: 18 }
  },
  {
    id: 't3',
    role: 'tool',
    tool: {
      id: 't3',
      name: 'edit_file',
      input: { path: 'src/ui/format.ts' },
      content: 'Edited src/ui/format.ts',
      durationMs: 9,
      diff: {
        path: 'src/ui/format.ts',
        lines: [
          { type: 'context', text: 'export function formatCount(value: number): string {' },
          { type: 'remove', text: '  return String(value);' },
          { type: 'add', text: '  if (value >= 1e9) return (value / 1e9).toFixed(1) + \'B\';' },
          { type: 'add', text: '  return String(value);' },
          { type: 'context', text: '}' }
        ]
      }
    }
  },
  {
    id: 't4',
    role: 'tool',
    tool: {
      id: 't4',
      name: 'run_terminal',
      input: { command: 'npm test -- format' },
      content: 'Command failed with exit code 1\n> vitest run format\n\nstderr: FAIL test/unit/format.test.ts > rounds billions\nstderr: AssertionError: expected \'1.0B\' to be \'1B\'\n Tests 1 failed | 12 passed',
      isError: true,
      durationMs: 2412
    }
  },
  {
    id: 't5',
    role: 'tool',
    tool: { id: 't5', name: 'list_files', input: { path: 'src/ui' }, content: 'format.ts\nprotocol.ts\nstatusBar.ts', durationMs: 2 }
  },
  {
    id: 't6',
    role: 'tool',
    tool: { id: 't6', name: 'run_terminal', input: { command: 'npm run typecheck' }, running: true }
  },
  { id: 'n1', role: 'notice', text: 'Cannot open src/missing.ts: the file does not exist.' },
  {
    id: 'ap1',
    role: 'assistant',
    approval: {
      id: 'ap1',
      name: 'write_file',
      input: { path: 'src/ui/format.ts' },
      preview: {
        path: 'src/ui/format.ts',
        lines: [
          { type: 'context', text: 'export function formatCount(value: number): string {' },
          { type: 'add', text: '  return value.toLocaleString();' },
          { type: 'context', text: '}' }
        ]
      }
    }
  }
];

const STATE: UiState = {
  sessions: [
    { id: 's1', title: 'Rounding of the token counter', updatedAt: Date.now() },
    { id: 's2', title: 'Fix the diff colors in the light theme of the editor', updatedAt: Date.now() - 90_000_000 }
  ],
  activeSessionId: 's1',
  messages: params.get('empty') === '1' ? [] : MESSAGES,
  model: MODELS[0]!.id,
  models: MODELS,
  effort: 'max',
  mode: 'code',
  thinking: false,
  state: busy ? 'streaming' : 'idle',
  tokens: 184_320,
  usage: Array.from({ length: 18 }, (_, i) => ({ input: 2000 + ((i * 937) % 5000), output: 200 + ((i * 431) % 1600), cache: i % 4 === 0 ? 800 : 0 })),
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
