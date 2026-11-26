import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';

export const state = {
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  viewProviders: new Map<string, { resolveWebviewView: (view: unknown) => void }>(),
  config: new Map<string, unknown>(),
  workspaceConfig: new Map<string, unknown>(),
  secrets: new Map<string, string>(),
  globalState: new Map<string, unknown>(),
  posted: [] as ExtToWeb[],
  receive: undefined as undefined | ((message: WebToExt) => void),
  fetched: [] as string[],
  headers: [] as Array<Record<string, string>>,
  bodies: [] as string[],
  responses: [] as string[],
  editor: undefined as unknown,
  documents: [] as Array<{ uri: { fsPath: string } }>,
  files: [] as string[],
  failState: false,
  statusBar: undefined as undefined | { text: string; tooltip: string },
  theme: 2,
  themeListener: undefined as undefined | (() => void),
  opened: [] as string[],
  shown: [] as string[],
  // The answer of the server waits until the test lets it come. The
  // response 'HOLD' holds the turn of the model.
  holdResponse: undefined as undefined | (() => void),
  quickPick: undefined as undefined | { title: string; items: unknown[] },
  progressCancel: undefined as undefined | (() => void),
  // The answer of the modal question about the address of another host.
  warningAnswer: undefined as undefined | string,
  warningCalls: [] as string[]
};

export function vscodeMock(): Record<string, unknown> {
  const configuration = {
    get: (key: string, fallback?: unknown) =>
      state.config.has(key) ? state.config.get(key) : fallback,
    // The editor tells where the value of a setting comes from: the user, the
    // workspace or the folder. The extension reads the value of the user for
    // the settings that hold the address of the API.
    inspect: (key: string) => ({
      key,
      defaultValue: undefined,
      globalValue: state.config.get(key),
      workspaceValue: state.workspaceConfig.get(key)
    }),
    update: async (key: string, value: unknown) => {
      state.config.set(key, value);
    }
  };
  return {
    QuickPickItemKind: {
      Separator: -1,
      Default: 0
    },
    window: {
      createOutputChannel: () => ({
        appendLine: () => undefined,
        show: () => undefined,
        dispose: () => undefined
      }),
      createStatusBarItem: () => {
        const item = {
          text: '',
          tooltip: '',
          command: '',
          show: () => undefined,
          dispose: () => undefined
        };
        state.statusBar = item;
        return item;
      },
      registerWebviewViewProvider: (id: string, provider: { resolveWebviewView: (v: unknown) => void }) => {
        state.viewProviders.set(id, provider);
        return { dispose: () => undefined };
      },
      visibleTextEditors: [],
      get activeTextEditor() {
        return state.editor;
      },
      get activeColorTheme() {
        return { kind: state.theme };
      },
      onDidChangeActiveColorTheme: (listener: () => void) => {
        state.themeListener = listener;
        return { dispose: () => undefined };
      },
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      createQuickPick: () => {
        const quickPick = {
          title: '',
          items: [] as unknown[],
          selectedItems: [] as unknown[],
          onDidAccept: () => ({ dispose: () => undefined }),
          onDidHide: () => ({ dispose: () => undefined }),
          show: () => undefined,
          hide: () => undefined,
          dispose: () => undefined
        };
        state.quickPick = quickPick;
        return quickPick;
      },
      showOpenDialog: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showWarningMessage: async (...args: unknown[]) => {
        state.warningCalls.push(String(args[0] ?? ''));
        return state.warningAnswer;
      },
      withProgress: async (
        _options: unknown,
        task: (progress: unknown, token: unknown) => Promise<unknown>
      ) =>
        task(
          { report: () => undefined },
          {
            onCancellationRequested: (listener: () => void) => {
              // The Cancel of the window of the editor, a test can pull it.
              state.progressCancel = listener;
              return { dispose: () => undefined };
            }
          }
        ),
      executeCommand: async () => undefined,
      showTextDocument: async (document: { uri: { fsPath: string } }) => {
        state.shown.push(document.uri.fsPath);
        return {
          selection: undefined,
          revealRange: () => undefined
        };
      }
    },
    commands: {
      registerCommand: (id: string, callback: (...args: unknown[]) => unknown) => {
        state.commands.set(id, callback);
        return { dispose: () => undefined };
      },
      executeCommand: async () => undefined
    },
    workspace: {
      getConfiguration: () => configuration,
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
      registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
      get workspaceFolders() {
        const root = state.config.get('root');
        return typeof root === 'string' && root.length > 0
          ? [{ uri: { fsPath: root } }]
          : undefined;
      },
      asRelativePath: (uri: { fsPath: string }) => uri.fsPath,
      get textDocuments() {
        return state.documents;
      },
      findFiles: async () => state.files.map((path) => ({ fsPath: path })),
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose: () => undefined }),
        onDidCreate: () => ({ dispose: () => undefined }),
        onDidDelete: () => ({ dispose: () => undefined }),
        dispose: () => undefined
      }),
      openTextDocument: async (uri: { fsPath: string }) => {
        state.opened.push(uri.fsPath);
        return { uri, lineCount: 500 };
      }
    },
    Uri: {
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        fsPath: [base.fsPath, ...parts].join('/')
      }),
      file: (fsPath: string) => ({ fsPath })
    },
    Position: class {
      constructor(
        public line: number,
        public character: number
      ) {}
    },
    Range: class {
      constructor(
        public start: unknown,
        public end: unknown
      ) {}
    },
    Selection: class {
      constructor(
        public anchor: unknown,
        public active: unknown
      ) {}
    },
    TextEditorRevealType: { InCenter: 2 },
    ThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ProgressLocation: { Window: 10 },
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Right: 2 }
  };
}
