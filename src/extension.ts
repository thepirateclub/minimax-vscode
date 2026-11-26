import { notesFor } from './host/notes';
import type { Notes } from './notes/sqlite';
import { createMcpState, stopMcp } from './host/mcp';
import { restartMcpIfWarm } from './host/warmup';
import { discoverSkills } from './skills/skills';
import { toUiQuota } from './ui/quotaMeter';
import { isAbsolute } from 'node:path';
import { HttpSpeechClient } from './api/speech';
import { getSettings, onSettingsChanged } from './config/settings';
import { registerHostServices } from './host/services';
import { currentRoot } from './host/folders';
import { createLogger } from './logger';
import { ProjectSearch } from './search/project';
import { createBackupStore } from './storage/fileBackups';
import { projectLabel, SessionStore } from './storage/sessions';
import { UsageLedger } from './storage/usage';
import { editorDiagnostics } from './host/diagnostics';
import { createAllTools } from './tools/all';
import { ToolRegistry } from './tools/registry';
import { resetReplProcesses } from './tools/repl';
import type { ApprovalDecision } from './ui/approvals';
import { AgentPanelProvider } from './ui/panel';
import { themeKind } from './ui/theme';
import { VoiceController } from './voice/controller';
import { Recorder } from './voice/recorder';
import { StatusBarController } from './ui/statusbar';
import type { RuntimeSession } from './host/runtime';
import { usageTotal } from './host/channel';
import { persist, startNewSession, restoreSession, panelHistory } from './host/sessions';
import { spawnTask } from './host/child';
import { handleWebviewMessage } from './host/messages';
import type { Logger } from './logger';
import type { QuotaSnapshot } from './api/quota';
import { applySettings, addApiKey, clearApiKey, setEndpoint, warnAboutTheBaseUrl, selectModel, selectMode, selectEffort } from './host/settings';
import { showLogs, showUsage, generateCommitMessage, refreshQuota, undoLastChange, refreshContext, reindex } from './host/commands';
import { searchFor, addFileToChat } from './host/workspace';
import { registerEditorActions } from './host/editorActions';
import { exportChat } from './host/exportChat';
import type { AgentState } from './ui/protocol';
import { getApiKey } from './config/secrets';
import { resolveBaseUrl, MODELS } from './config/models';
import * as vscode from 'vscode';

export class MiniMaxController {
  readonly context: vscode.ExtensionContext;
  readonly channel: vscode.OutputChannel;
  readonly logger: Logger;
  readonly backups: ReturnType<typeof createBackupStore>;
  readonly registry = new ToolRegistry();
  readonly store: SessionStore;
  readonly ledger: UsageLedger;
  readonly panel: AgentPanelProvider;
  readonly statusBar = new StatusBarController();
  readonly sessions = new Map<string, RuntimeSession>();
  // The approvals of the sub-agents wait here, the id of the request of the
  // child starts with "child-". The map remembers the name of the tool and
  // the chat the child belongs to, the reader can allow the tool for the
  // whole session of that chat.
  readonly childApprovals = new Map<
    string,
    {
      toolName: string;
      input: Record<string, unknown>;
      sessionId: string;
      resolve: (decision: ApprovalDecision) => void;
    }
  >();
  // The approval cards that wait for the reader: the id of the card and the
  // chat it belongs to. The card lives in the messages of its chat, so
  // another chat does not show it and a switch of the chats keeps it.
  readonly approvalOwner = new Map<string, string>();
  // The index of the project, one per workspace folder.
  readonly searches = new Map<string, ProjectSearch>();
  activeSessionId: string | undefined;
  agentState: AgentState = 'idle';
  private counter = 0;
  fileCache: { files: string[]; at: number } | undefined;
  quota: QuotaSnapshot | undefined;
  // The running MCP servers and their tools.
  readonly mcp = createMcpState();
  // The notes of the agent, one store per workspace folder.
  readonly notes = new Map<string, Promise<Notes>>();
  // When every action started, the duration goes to the panel.
  readonly toolStarted = new Map<string, number>();
  // The voice input: ffmpeg records, MiniMax asr-1.0 transcribes.
  readonly voice: VoiceController;

  constructor(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    this.context = context;
    this.channel = channel;
    this.logger = createLogger(channel);
    this.store = new SessionStore(context.globalState);
    this.ledger = new UsageLedger(context.globalState);
    this.backups = createBackupStore(context.globalStorageUri?.fsPath);
    this.panel = new AgentPanelProvider({
      extensionUri: context.extensionUri,
      onMessage: (message) => {
        void handleWebviewMessage(this, message);
      }
    });

    this.voice = new VoiceController({
      post: (message) => this.panel.post(message),
      getApiKey: () => getApiKey(this.context.secrets),
      config: () => {
        const settings = getSettings();
        return {
          ffmpeg: settings.ffmpegPath,
          microphone: settings.microphone,
          language: settings.speechLanguage,
          vocabulary: settings.speechVocabulary,
          baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl)
        };
      },
      createRecorder: (config) => new Recorder(config.ffmpeg, config.microphone),
      createClient: (config, apiKey) => new HttpSpeechClient({ baseUrl: config.baseUrl, apiKey }),
      every: (ms, fn) => {
        const timer = setInterval(fn, ms);
        return () => clearInterval(timer);
      }
    });

    for (const tool of createAllTools({
      backups: this.backups,
      search: (root) => searchFor(this, root),
      spawn: async (request, ctx, progress) =>
        await spawnTask(this, request, ctx, progress),
      diagnostics: editorDiagnostics(),
      skills: async (root) => await discoverSkills(root),
      web: {
        connection: async () => {
          const key = await getApiKey(this.context.secrets);
          const settings = getSettings();
          return key ? { baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl), apiKey: key } : undefined;
        },
        webSearchEnabled: () => getSettings().enableWebSearch
      },
      notes: async (root) => await notesFor(this, root)
    })) {
      this.registry.register(tool);
    }
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(AgentPanelProvider.viewType, this.panel, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.openPanel', () => this.panel.reveal())
    );
    // A recording left running would hold the microphone after the window closes.
    // The REPL processes of the chats go away with the extension host too:
    // a child of the host outlives it otherwise.
    context.subscriptions.push({
      dispose: () => {
        this.voice.cancel();
        resetReplProcesses();
      }
    });
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.newChat', () => startNewSession(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.addApiKey', () => void addApiKey(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.setEndpoint', () => void setEndpoint(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.selectModel', () => void selectModel(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.setEffort', () => void selectEffort(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.setMode', () => void selectMode(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.undoLastChange', () => void undoLastChange(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.refreshContext', () => void refreshContext(this, ))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.showLogs', () => showLogs(this, )),
      vscode.commands.registerCommand('minimax.showUsage', () => void showUsage(this, )),
      vscode.commands.registerCommand('minimax.exportChat', () => void exportChat(this))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.generateCommitMessage', () =>
        void generateCommitMessage(this, )
      )
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.clearApiKey', () => void clearApiKey(this, ))
    );
    registerEditorActions(this, context);
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.addFile', (uri?: vscode.Uri) =>
        addFileToChat(this, uri)
      )
    );

    // One save of the settings writes many keys and every write fires the
    // event. The agents and the panel are rebuilt once, after the last write.
    let settingsTimer: ReturnType<typeof setTimeout> | undefined;
    registerHostServices(this, context);
    context.subscriptions.push(
      onSettingsChanged(() => {
        if (settingsTimer !== undefined) {
          clearTimeout(settingsTimer);
        }
        settingsTimer = setTimeout(() => {
          settingsTimer = undefined;
          applySettings(this, );
          restartMcpIfWarm(this);
          warnAboutTheBaseUrl(this, );
          void this.sendInit();
        }, 100);
      })
    );
    context.subscriptions.push({
      dispose: () => {
        if (settingsTimer !== undefined) {
          clearTimeout(settingsTimer);
        }
      }
    });
    context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.panel.post({ type: 'theme', kind: themeKind() });
      })
    );

    // The index of the project follows the files of the workspace.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const onFile = (uri: vscode.Uri): void => {
      const path = vscode.workspace.asRelativePath(uri, false);
      if (path.length === 0 || path.startsWith('..') || isAbsolute(path)) {
        return;
      }
      searchFor(this, this.workspaceRoot()).invalidate(path);
    };
    watcher.onDidChange(onFile);
    watcher.onDidCreate(onFile);
    watcher.onDidDelete(onFile);
    context.subscriptions.push(watcher);

    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.reindex', () => void reindex(this, ))
    );
    context.subscriptions.push(this.statusBar);
    // The MCP servers start with the first look at the panel and stop with
    // the extension (src/host/warmup.ts).
    context.subscriptions.push({ dispose: () => stopMcp(this) });

    const quotaTimer = setInterval(() => {
      void refreshQuota(this, );
    }, 300_000);
    context.subscriptions.push({
      dispose: () => {
        clearInterval(quotaTimer);
      }
    });
  }

  // The index of the project, it lives as long as the folder is open.
  // The semantic layer asks the server for the vectors of the code, it stays
  // off until the user turns it on.
  // The index of the project starts to build before the first request.
  // The index of the project is built again from the files of the disk.
  // The panel of the source control asks the model for a commit message.
  // A click on the badge opens the numbers of the plan.
  workspaceRoot(): string {
    return currentRoot(this.context);
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + this.counter;
  }

  activeSession(): RuntimeSession | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  // The state of the repository changes between the turns, the prompt of the
  // model carries the fresh one.
  // The context of the turn carries the state of the repository and the
  // list of tasks, both change between the turns.
  // The limits of the goal. The agent stops when one of them is over, the
  // user raises the limit and the work continues.
  // The status of the goal does not switch the budget off. The status is
  // the business of the model, the limits are the business of the user, and
  // a model that marks the goal as blocked or complete keeps its limit.
  // The idle time between the turns is not work, so the running time is
  // read only while the turn runs.
  // The levels of the reasoning depth go only to the models that take
  // them, the catalog decides. The client does not know the names of the
  // models, it only sees the effort it was given.
  // M3.1-Flash always thinks, M3 thinks only when the user turns it on.
  // A snippet of a file opens that file in the editor.
  // The files of the working tree after the action. The panel shows them
  // under the feed, the reader opens a file with a click.
  // One turn of the agent: the request goes out, the answer comes back.
  // The chat rolls back to a message of the user. The message and every
  // message after it go away, the text of the request comes back to the
  // input field and the agent waits for the next command.
  // The request runs again. The messages after it go away, the history
  // of the model is cut at the same place, so the answer of the model
  // starts from the same state.
  // The history of the model loses the request and everything after it.
  // The list of the tasks is written at once. The session keeps the last
  // complete turn, so the state that comes back after a crash is a state the
  // agent can continue from.
  persistActive(): void {
    const runtime = this.activeSession();
    if (runtime) {
      persist(this, runtime);
    }
  }
  async sendInit(reset = false): Promise<void> {
    const settings = getSettings();
    const key = await getApiKey(this.context.secrets);
    const runtime = this.activeSession();
    // The history goes to the panel in parts: the panel holds the last part
    // of it, the older part waits for the request of the reader.
    const history = panelHistory(this, runtime, reset);
    this.panel.post({
      type: 'init',
      state: {
        sessions: this.store.summaryList(),
        activeSessionId: this.activeSessionId,
        // The project of the panel: the list of the chats belongs to it.
        workspaceRoot: this.workspaceRoot(),
        workspaceLabel: projectLabel(this.workspaceRoot()),
        messages: history.messages,
        // How many messages of the chat wait in the host.
        olderMessages: history.olderMessages,
        model: settings.model,
        models: MODELS,
        effort: settings.effort,
        mode: settings.mode,
        thinking: settings.thinking,
        state: this.agentState,
        tokens: usageTotal(this, runtime),
        usage: runtime ? [...runtime.usage] : [],
        todos: runtime ? [...runtime.todos] : [],
        goal: runtime?.goal,
        // The queue of the chat survives the reload of the panel.
        queue: runtime
          ? runtime.queue.map((item) => ({
              id: item.id,
              text: item.text,
              state: item.state,
              error: item.error
            }))
          : [],
        ...(this.quota ? { quota: toUiQuota(this.quota) } : {}),
        hasApiKey: Boolean(key),
        theme: themeKind(),
        fontSize: settings.fontSize,
        collapseTools: settings.collapseTools,
        collapseCode: settings.collapseCode,
        showToolSteps: settings.showToolSteps,
        // The summary of the files lives in the panel only, the host
        // sends it again after the next action.
        summary: [],
        // The version comes from the manifest, the webview does not know it.
        version: this.context.extension?.packageJSON?.version ?? ''
      }
    });
  }

  // The address of the API can be wrong in the settings of the user, the
  // official endpoint is used then and the user is told about it.
}

let controller: MiniMaxController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('MiniMax');
  context.subscriptions.push(channel);
  controller = new MiniMaxController(context, channel);
  controller.register(context);
  restoreSession(controller);
  // The badge of the quota needs the start; the index and the servers wait
  // for the panel or the first turn (src/host/warmup.ts).
  void refreshQuota(controller);
}

export function deactivate(): void {
  controller?.persistActive();
  controller = undefined;
}

