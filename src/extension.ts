import { unlink, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as vscode from 'vscode';
import { HttpEmbeddingsClient } from './api/embeddings';
import { HttpMiniMaxClient } from './api/client';
import { fetchQuota, type QuotaSnapshot } from './api/quota';
import type { AnthropicMessage, EffortLevel } from './api/types';
import type { AgentEvent } from './agent/agent';
import { buildWorkspaceSnapshot, renderSnapshot } from './agent/context';
import { readMentionedFiles } from './agent/mentions';
import { buildSystemPrompt, renderGitContext } from './agent/prompt';
import { generateCommitMessage } from './agent/commitMessage';
import { AgentSession } from './agent/session';
import { isAbortMessage, stopNotice } from './agent/stopReason';
import { findRequestIndex, turnOfMessage, type TurnAnchor } from './agent/turns';
import { AGENT_MODES, MODELS, resolveBaseUrl } from './config/models';
import {
  clearApiKey as clearStoredApiKey,
  getApiKey,
  setApiKey
} from './config/secrets';
import { getSettings, onSettingsChanged, type MiniMaxSettings } from './config/settings';
import { collectStagedChanges, gitRepositories, setCommitMessage } from './git/scm';
import { readRepositoryState, summarizeState } from './git/status';
import { createLogger, type Logger } from './logger';
import { ProjectSearch } from './search/project';
import { InMemoryBackupStore } from './storage/backups';
import { SessionStore, type StoredSession } from './storage/sessions';
import { UsageLedger } from './storage/usage';
import { createExploreTools, isTextFile } from './tools/explore';
import { createFileTools, resolveWorkspacePath } from './tools/fs';
import { ToolRegistry } from './tools/registry';
import { createGitTools } from './tools/git';
import { createTerminalTools } from './tools/terminal';
import { fileErrorMessage } from './ui/fileError';
import { AgentPanelProvider } from './ui/panel';
import { themeKind } from './ui/theme';
import type {
  AgentState,
  UiMessage,
  UiSelection,
  UiSettings,
  UiSettingsValues,
  UiSuggestion,
  UiUsageTurn,
  WebToExt
} from './ui/protocol';
import { StatusBarController } from './ui/statusbar';
import { showUsageDetails } from './ui/usageDetails';
import { buildUsageRows } from './ui/usageRows';

interface RuntimeSession {
  id: string;
  title: string;
  updatedAt: number;
  history: AnthropicMessage[];
  uiMessages: UiMessage[];
  agent: AgentSession | undefined;
  busy: boolean;
  errorReported: boolean;
  // The token spend of every action of this session.
  usage: UiUsageTurn[];
  // The anchors of the requests, they tell where a request sits in the
  // history and let the chat roll back to it.
  turns: TurnAnchor[];
  // When the turn of this moment started, the panel shows how long it
  // took.
  turnStartedAt: number;
}

const TITLE_LIMIT = 60;
// How many actions the spend graph keeps in the header.
const MAX_USAGE_TURNS = 24;

class MiniMaxController {
  private readonly context: vscode.ExtensionContext;
  private readonly channel: vscode.OutputChannel;
  private readonly logger: Logger;
  private readonly backups = new InMemoryBackupStore();
  private readonly registry = new ToolRegistry();
  private readonly store: SessionStore;
  private readonly ledger: UsageLedger;
  private readonly panel: AgentPanelProvider;
  private readonly statusBar = new StatusBarController();
  private readonly sessions = new Map<string, RuntimeSession>();
  // The index of the project, one per workspace folder.
  private readonly searches = new Map<string, ProjectSearch>();
  private activeSessionId: string | undefined;
  private agentState: AgentState = 'idle';
  private counter = 0;
  private fileCache: { files: string[]; at: number } | undefined;
  private quota: QuotaSnapshot | undefined;
  // When every action started, the duration goes to the panel.
  private readonly toolStarted = new Map<string, number>();

  constructor(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    this.context = context;
    this.channel = channel;
    this.logger = createLogger(channel);
    this.store = new SessionStore(context.globalState);
    this.ledger = new UsageLedger(context.globalState);
    this.panel = new AgentPanelProvider({
      extensionUri: context.extensionUri,
      onMessage: (message) => {
        void this.handleWebviewMessage(message);
      }
    });

    for (const tool of [
      ...createFileTools({ backups: this.backups }),
      ...createExploreTools({ search: (root) => this.searchFor(root) }),
      ...createGitTools(),
      ...createTerminalTools()
    ]) {
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
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.newChat', () => this.startNewSession())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.addApiKey', () => void this.addApiKey())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.setEndpoint', () => void this.setEndpoint())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.selectModel', () => void this.selectModel())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.setEffort', () => void this.selectEffort())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.setMode', () => void this.selectMode())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.undoLastChange', () => void this.undoLastChange())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.refreshContext', () => void this.refreshContext())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.showLogs', () => this.showLogs())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.showUsage', () => void this.showUsage())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.generateCommitMessage', () =>
        void this.generateCommitMessage()
      )
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.clearApiKey', () => void this.clearApiKey())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.addSelection', () => this.addSelectionToChat())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.addFile', (uri?: vscode.Uri) =>
        this.addFileToChat(uri)
      )
    );

    context.subscriptions.push(
      onSettingsChanged(() => {
        this.applySettings();
        void this.sendInit();
      })
    );
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
      this.searchFor(this.workspaceRoot()).invalidate(path);
    };
    watcher.onDidChange(onFile);
    watcher.onDidCreate(onFile);
    watcher.onDidDelete(onFile);
    context.subscriptions.push(watcher);

    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.reindex', () => void this.reindex())
    );
    context.subscriptions.push(this.statusBar);

    const quotaTimer = setInterval(() => {
      void this.refreshQuota();
    }, 300_000);
    context.subscriptions.push({
      dispose: () => {
        clearInterval(quotaTimer);
      }
    });
  }

  // The index of the project, it lives as long as the folder is open.
  private searchFor(root: string): ProjectSearch {
    let search = this.searches.get(root);
    if (!search) {
      search = new ProjectSearch(root);
      this.searches.set(root, search);
      void this.applySemanticProvider();
    }
    return search;
  }

  // The semantic layer asks the server for the vectors of the code, it stays
  // off until the user turns it on.
  private async applySemanticProvider(): Promise<void> {
    const settings = getSettings();
    const key = settings.semanticSearch ? await getApiKey(this.context.secrets) : undefined;
    for (const search of this.searches.values()) {
      if (!key) {
        search.setSemanticProvider(undefined);
        continue;
      }
      search.setSemanticProvider(
        new HttpEmbeddingsClient({
          baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
          apiKey: key
        })
      );
    }
  }

  // The index of the project starts to build before the first request.
  prepareIndex(): void {
    void this.searchFor(this.workspaceRoot()).ensureIndex();
  }

  // The index of the project is built again from the files of the disk.
  private async reindex(): Promise<void> {
    const search = this.searchFor(this.workspaceRoot());
    await search.rebuild();
    void vscode.window.showInformationMessage(
      'MiniMax: the index of the project is ready, ' + search.fileCount + ' files.'
    );
  }

  private showLogs(): void {
    this.channel.show(true);
  }

  // The panel of the source control asks the model for a commit message.
  private async generateCommitMessage(): Promise<void> {
    const repositories = await gitRepositories();
    const repository = repositories[0];
    const root = repository?.rootUri.fsPath ?? this.workspaceRoot();
    const changes = await collectStagedChanges(root);
    if (changes.diff.trim().length === 0) {
      void vscode.window.showInformationMessage(
        'MiniMax: there are no changes to describe.'
      );
      return;
    }
    const key = await getApiKey(this.context.secrets);
    if (!key) {
      void vscode.window.showErrorMessage(
        'MiniMax: no API key. Run "MiniMax: Add API Key" from the command palette.'
      );
      return;
    }
    const settings = getSettings();
    const model = MODELS.find((item) => item.id === settings.model);
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'MiniMax writes the commit message'
        },
        async () =>
          await generateCommitMessage({
            client: new HttpMiniMaxClient({
              baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
              apiKey: key
            }),
            model: settings.model,
            maxTokens: model?.maxTokens ?? 65_536,
            effort: settings.effort,
            thinking: this.thinkingMode(settings),
            context: {
              files: changes.files,
              diff: changes.diff,
              recentSubjects: changes.recentSubjects
            }
          })
      );
      this.ledger.add({
        at: Date.now(),
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
        cacheRead: result.usage.cacheReadTokens ?? 0,
        cacheCreation: result.usage.cacheCreationTokens ?? 0
      });
      this.statusBar.setUsage(this.ledger.lastDay());
      if (result.message.length === 0) {
        void vscode.window.showErrorMessage(
          'MiniMax: the model returned an empty commit message.'
        );
        return;
      }
      if (repository) {
        setCommitMessage(repository, result.message);
        void vscode.window.showInformationMessage(
          'MiniMax: the commit message is ready.'
        );
        return;
      }
      await vscode.env.clipboard.writeText(result.message);
      void vscode.window.showInformationMessage(
        'MiniMax: the commit message is in the clipboard.'
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('the commit message failed', error);
      void vscode.window.showErrorMessage('MiniMax: ' + reason);
    }
  }

  // A click on the badge opens the numbers of the plan.
  private async showUsage(): Promise<void> {
    await this.refreshQuota();
    const rows = buildUsageRows(this.ledger.lastDay(), this.quota);
    showUsageDetails(rows, () => this.panel.reveal());
  }

  private workspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    const first = folders && folders.length > 0 ? folders[0] : undefined;
    return first ? first.uri.fsPath : process.cwd();
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + this.counter;
  }

  private activeSession(): RuntimeSession | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  private async buildPrompt(): Promise<string> {
    const settings = getSettings();
    const root = this.workspaceRoot();
    const openFiles = vscode.window.visibleTextEditors
      .map((editor) => vscode.workspace.asRelativePath(editor.document.uri, false))
      .filter((path) => path.length > 0 && !path.startsWith('..'));
    const snapshot = await buildWorkspaceSnapshot(root, {
      includeOpenFiles: settings.rulesEnabled,
      openFiles: openFiles.map((path) => ({ path }))
    });

    const tools = this.registry
      .list()
      .filter((tool) => this.registry.isAllowed(tool, settings.mode))
      .map((tool) => tool.name);

    return buildSystemPrompt({
      workspaceRoot: root,
      os: process.platform,
      shell: process.platform === 'win32' ? 'powershell' : 'bash',
      mode: settings.mode,
      tools,
      rulesText: settings.rulesEnabled ? renderSnapshot(snapshot) : '',
      treeText: snapshot.tree.join('\n'),
      stackText: snapshot.stack.join(', '),
      openFilesText: snapshot.openFiles.map((file) => file.path).join(', ')
    });
  }

  // The state of the repository changes between the turns, the prompt of the
  // model carries the fresh one.
  private async gitContext(): Promise<string> {
    const state = await readRepositoryState(this.workspaceRoot());
    if (!state) {
      return '';
    }
    return renderGitContext(summarizeState(state));
  }

  private async ensureAgent(runtime: RuntimeSession): Promise<AgentSession | undefined> {
    if (runtime.agent) {
      return runtime.agent;
    }
    const key = await getApiKey(this.context.secrets);
    if (!key) {
      this.logger.error('no API key found in the secret storage');
      this.panel.post({
        type: 'error',
        message: 'No API key. Run "MiniMax: Add API Key" from the command palette.'
      });
      return undefined;
    }
    const settings = getSettings();
    const model = MODELS.find((item) => item.id === settings.model);
    const agent = new AgentSession({
      client: new HttpMiniMaxClient({
        baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
        apiKey: key
      }),
      registry: this.registry,
      model: settings.model,
      maxTokens: model?.maxTokens ?? 65_536,
      maxIterations: settings.maxIterations,
      effort: settings.effort,
      mode: settings.mode,
      thinking: this.thinkingMode(settings),
      contextWindow: model?.contextWindow,
      historyLimit: settings.historyMaxMessages,
      contextThreshold: settings.contextThreshold,
      systemPrompt: await this.buildPrompt(),
      contextProvider: async () => await this.gitContext(),
      workspaceRoot: this.workspaceRoot(),
      logger: this.logger,
      autoApprove: settings.autoApprove,
      onEvent: (event) => this.handleAgentEvent(runtime, event),
      onApproval: (approval) => {
        this.panel.post({ type: 'approval_request', approval });
      }
    });
    agent.setHistory(runtime.history);
    runtime.agent = agent;
    return agent;
  }

  private handleAgentEvent(runtime: RuntimeSession, event: AgentEvent): void {
    if (event.type === 'assistant_start') {
      runtime.uiMessages.push({ id: this.nextId('assistant'), role: 'assistant', text: '' });
      const last = runtime.uiMessages[runtime.uiMessages.length - 1];
      this.panel.post({ type: 'assistant_start', id: last ? last.id : '' });
      return;
    }
    if (event.type === 'assistant_text') {
      this.appendToAssistant(runtime, 'text', event.text);
      this.panel.post({ type: 'text_delta', text: event.text });
      this.setState('streaming');
      return;
    }
    if (event.type === 'assistant_thinking') {
      this.appendToAssistant(runtime, 'thinking', event.text);
      this.panel.post({ type: 'thinking_delta', text: event.text });
      this.setState('thinking');
      return;
    }
    if (event.type === 'tool_start') {
      this.toolStarted.set(event.id, Date.now());
      runtime.uiMessages.push({
        id: event.id,
        role: 'tool',
        tool: { id: event.id, name: event.name, input: event.input, running: true }
      });
      this.panel.post({ type: 'tool_start', id: event.id, name: event.name, input: event.input });
      this.setState('tool');
      return;
    }
    if (event.type === 'tool_end') {
      const started = this.toolStarted.get(event.id);
      this.toolStarted.delete(event.id);
      const durationMs = started === undefined ? undefined : Date.now() - started;
      for (const message of runtime.uiMessages) {
        if (message.tool && message.tool.id === event.id) {
          message.tool.content = event.content;
          message.tool.isError = event.isError;
          message.tool.running = false;
          if (event.diff) {
            message.tool.diff = event.diff;
          }
          if (durationMs !== undefined) {
            message.tool.durationMs = durationMs;
          }
        }
      }
      this.panel.post({
        type: 'tool_end',
        id: event.id,
        name: event.name,
        content: event.content,
        isError: event.isError,
        durationMs,
        diff: event.diff
      });
      return;
    }
    if (event.type === 'approval_resolved') {
      return;
    }
    if (event.type === 'done') {
      this.ledger.add({
        at: Date.now(),
        input: event.usage.inputTokens,
        output: event.usage.outputTokens,
        cacheRead: event.usage.cacheReadTokens ?? 0,
        cacheCreation: event.usage.cacheCreationTokens ?? 0
      });
      this.statusBar.setUsage(this.ledger.lastDay());
      runtime.usage.push({
        input: event.usage.inputTokens,
        output: event.usage.outputTokens,
        cache:
          (event.usage.cacheReadTokens ?? 0) + (event.usage.cacheCreationTokens ?? 0)
      });
      if (runtime.usage.length > MAX_USAGE_TURNS) {
        runtime.usage = runtime.usage.slice(-MAX_USAGE_TURNS);
      }
      this.panel.post({ type: 'usage', turns: runtime.usage });
      // The last message of the step tells how long the step took, and
      // the reason of the stop is named, a silent stop confuses.
      this.markStepTime(runtime);
      const notice = stopNotice(event.stopReason, getSettings().maxIterations);
      if (notice) {
        this.panel.post({ type: 'notice', message: notice.message, kind: notice.kind });
      }
      this.setState('idle');
      return;
    }
    if (event.type === 'error') {
      runtime.errorReported = true;
      if (isAbortMessage(event.message)) {
        // The user stopped the turn, it is not a failure of the server.
        this.panel.post({
          type: 'notice',
          message: 'The request was stopped.',
          kind: 'info'
        });
        this.markStepTime(runtime);
        this.setState('idle');
        return;
      }
      this.panel.post({ type: 'error', message: event.message });
      this.setState('error');
    }
  }

  private appendToAssistant(
    runtime: RuntimeSession,
    field: 'text' | 'thinking',
    text: string
  ): void {
    for (let i = runtime.uiMessages.length - 1; i >= 0; i--) {
      const message = runtime.uiMessages[i]!;
      if (message.role === 'assistant' && !message.approval) {
        message[field] = (message[field] ?? '') + text;
        return;
      }
    }
    runtime.uiMessages.push({
      id: this.nextId('assistant'),
      role: 'assistant',
      [field]: text
    });
  }

  private setState(state: AgentState): void {
    this.agentState = state;
    this.statusBar.setState(state);
    this.panel.post({
      type: 'status',
      state,
      tokens: this.usageTotal(this.activeSession())
    });
  }

  // The spend of the session, input and output tokens of every action.
  private usageTotal(runtime: RuntimeSession | undefined): number {
    if (!runtime) {
      return 0;
    }
    return runtime.usage.reduce(
      (sum, turn) => sum + turn.input + turn.output + (turn.cache ?? 0),
      0
    );
  }

  // M3.1-Flash always thinks, M3 thinks only when the user turns it on.
  private thinkingMode(settings: MiniMaxSettings): 'adaptive' | undefined {
    if (!settings.thinking) {
      return undefined;
    }
    const model = MODELS.find((item) => item.id === settings.model);
    if (!model || model.thinkingAlwaysOn) {
      return undefined;
    }
    return 'adaptive';
  }

  async refreshQuota(): Promise<void> {
    const key = await getApiKey(this.context.secrets);
    if (!key) {
      return;
    }
    const settings = getSettings();
    try {
      this.quota = await fetchQuota({
        baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
        apiKey: key
      });
      this.statusBar.setQuota(this.quota);
      this.statusBar.setUsage(this.ledger.lastDay());
    } catch (error) {
      this.logger.error('the quota request failed', error);
    }
  }

  // A snippet of a file opens that file in the editor.
  private async openFile(path: string, line?: number): Promise<void> {
    try {
      const target = resolveWorkspacePath(this.workspaceRoot(), path);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      const editor = await vscode.window.showTextDocument(document, { preview: true });
      if (line !== undefined && line > 0) {
        const row = Math.min(line - 1, Math.max(0, document.lineCount - 1));
        const position = new vscode.Position(row, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('cannot open ' + path + ': ' + reason);
      this.panel.post({ type: 'error', message: fileErrorMessage(path, reason) });
    }
  }

  private async handleWebviewMessage(message: WebToExt): Promise<void> {
    if (message.type === 'ready') {
      await this.sendInit();
      return;
    }
    if (message.type === 'send') {
      await this.handleSend(message.text, message.mentions, message.selections);
      return;
    }
    if (message.type === 'open_file') {
      await this.openFile(message.path, message.line);
      return;
    }
    if (message.type === 'stop') {
      this.activeSession()?.agent?.stop();
      return;
    }
    if (message.type === 'rewind') {
      await this.rewindTo(message.id);
      return;
    }
    if (message.type === 'approve') {
      this.activeSession()?.agent?.approve(message.id, message.allowForSession);
      this.panel.post({ type: 'approval_resolved', id: message.id, approved: true });
      return;
    }
    if (message.type === 'reject') {
      this.activeSession()?.agent?.reject(message.id);
      this.panel.post({ type: 'approval_resolved', id: message.id, approved: false });
      return;
    }
    if (message.type === 'new_session') {
      this.startNewSession();
      return;
    }
    if (message.type === 'select_session') {
      this.selectSession(message.id);
      return;
    }
    if (message.type === 'delete_session') {
      this.deleteSession(message.id);
      return;
    }
    if (message.type === 'set_model') {
      await this.updateSetting('model', message.model);
      return;
    }
    if (message.type === 'set_effort') {
      await this.updateSetting('effort', message.effort);
      return;
    }
    if (message.type === 'set_mode') {
      await this.updateSetting('mode', message.mode);
      return;
    }
    if (message.type === 'set_thinking') {
      await this.updateSetting('thinking', message.thinking);
      return;
    }
    if (message.type === 'pick_files') {
      await this.pickFiles(message.requestId);
      return;
    }
    if (message.type === 'undo_last_change') {
      await this.undoLastChange();
      return;
    }
    if (message.type === 'files_picked') {
      return;
    }
    if (message.type === 'request_suggestions') {
      await this.sendSuggestions(message.requestId, message.prefix);
      return;
    }
    if (message.type === 'request_settings') {
      await this.postSettings();
      return;
    }
    if (message.type === 'save_settings') {
      await this.saveSettings(message.values);
      return;
    }
    if (message.type === 'set_api_key') {
      await this.storeApiKey(message.key);
      return;
    }
    if (message.type === 'clear_api_key') {
      await this.clearApiKey();
      return;
    }
  }

  private async handleSend(
    text: string,
    mentions: string[],
    selections: UiSelection[]
  ): Promise<void> {
    let runtime = this.activeSession();
    if (!runtime) {
      this.startNewSession();
      runtime = this.activeSession();
    }
    if (!runtime) {
      return;
    }
    if (runtime.busy) {
      this.panel.post({
        type: 'error',
        message: 'The agent is busy. Stop the current turn before sending a new request.'
      });
      return;
    }
    const agent = await this.ensureAgent(runtime);
    if (!agent) {
      return;
    }

    runtime.busy = true;
    runtime.errorReported = false;
    const userId = this.nextId('user');
    runtime.uiMessages.push({ id: userId, role: 'user', text });
    this.panel.post({ type: 'user_message', id: userId, text });
    if (runtime.title === 'New chat') {
      const firstLine = text.trim().split('\n')[0] ?? '';
      runtime.title = firstLine.slice(0, TITLE_LIMIT) || 'New chat';
    }
    this.setState('thinking');
    runtime.turnStartedAt = Date.now();

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'MiniMax is working',
          cancellable: true
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => agent.stop());
          await agent.send(await this.buildPromptText(text, mentions, selections));
        }
      );
    } catch (error) {
      this.logger.error('the agent run failed', error);
      if (!runtime.errorReported) {
        const message = error instanceof Error ? error.message : String(error);
        this.panel.post({ type: 'error', message });
        this.setState('error');
      }
    } finally {
      runtime.busy = false;
      runtime.history = agent.getHistory();
      // The anchor of the request, the chat can roll back to it.
      runtime.turns.push({
        uiId: userId,
        text,
        historyIndex: findRequestIndex(runtime.history, text),
        mentions,
        selections
      });
      this.persist(runtime);
      void this.refreshQuota();
    }
  }

  // The last message of the step tells how long the step took.
  private markStepTime(runtime: RuntimeSession): void {
    if (runtime.turnStartedAt === 0) {
      return;
    }
    const elapsed = Date.now() - runtime.turnStartedAt;
    if (elapsed < 0) {
      return;
    }
    for (let i = runtime.uiMessages.length - 1; i >= 0; i--) {
      const message = runtime.uiMessages[i]!;
      if (message.role === 'assistant') {
        message.elapsedMs = elapsed;
        this.panel.post({
          type: 'step_time',
          id: message.id,
          elapsedMs: elapsed
        });
        return;
      }
    }
  }

  // The chat rolls back to a request and runs it again. The messages
  // after the request go away, the history of the model is cut at the
  // same place, so the answer of the model starts from the same state.
  private async rewindTo(id: string): Promise<void> {
    const runtime = this.activeSession();
    if (!runtime) {
      return;
    }
    if (runtime.busy) {
      this.panel.post({
        type: 'notice',
        message: 'The agent is busy, wait for the turn to end.',
        kind: 'warn'
      });
      return;
    }
    const turn = turnOfMessage(runtime.turns, runtime.uiMessages, id);
    if (!turn) {
      this.panel.post({
        type: 'notice',
        message: 'This message has no request to repeat, the chat is too old.',
        kind: 'warn'
      });
      return;
    }
    const userIndex = runtime.uiMessages.findIndex(
      (message) => message.id === turn.uiId
    );
    if (userIndex === -1) {
      return;
    }
    // The turns after this one go away with the messages.
    runtime.turns = runtime.turns.filter((item) => {
      const at = runtime.uiMessages.findIndex((message) => message.id === item.uiId);
      return at !== -1 && at < userIndex;
    });
    const found = findRequestIndex(runtime.history, turn.text, turn.historyIndex);
    const cut = found === -1 ? runtime.history.length : found;
    runtime.history = runtime.history.slice(0, cut);
    runtime.agent?.setHistory(runtime.history);
    runtime.uiMessages = runtime.uiMessages.slice(0, userIndex);
    // The panel gets a copy, the chat grows right after this line.
    this.panel.post({ type: 'session_loaded', messages: [...runtime.uiMessages] });
    await this.handleSend(turn.text, turn.mentions, turn.selections);
  }

  private async buildPromptText(
    text: string,
    mentions: string[],
    selections: UiSelection[]
  ): Promise<string> {
    const blocks: string[] = [];
    const files = await readMentionedFiles(this.workspaceRoot(), text, mentions);
    if (files.length > 0) {
      this.logger.info('attached ' + files.length + ' file(s) mentioned in the request');
    }
    for (const file of files) {
      blocks.push('Attached file: ' + file.path + '\n' + file.content);
    }
    for (const selection of selections) {
      const header =
        'Selected code from ' +
        selection.path +
        (selection.detail ? ' (' + selection.detail + ')' : '');
      blocks.push(header + ':\n' + (selection.content ?? ''));
    }
    if (blocks.length === 0) {
      return text;
    }
    return text + '\n\n' + blocks.join('\n\n');
  }

  private addSelectionToChat(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage('MiniMax: open a file to send a selection.');
      return;
    }
    const selection = editor.selection;
    if (selection.isEmpty) {
      void vscode.window.showInformationMessage('MiniMax: select the code you want to send.');
      return;
    }
    const path = vscode.workspace.asRelativePath(editor.document.uri, false);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    const selected: UiSelection = {
      id: this.nextId('sel'),
      path,
      label: path.split(/[\\/]/).pop() ?? path,
      detail: 'lines ' + startLine + '-' + endLine,
      content: editor.document.getText(selection)
    };
    this.panel.post({ type: 'selection', selection: selected });
    this.panel.reveal();
  }

  private addFileToChat(uri?: vscode.Uri): void {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      return;
    }
    const path = vscode.workspace.asRelativePath(target, false);
    this.panel.post({ type: 'mention', path });
    this.panel.reveal();
  }

  private async sendSuggestions(requestId: string, prefix: string): Promise<void> {
    const items = await this.collectSuggestions(prefix);
    this.panel.post({ type: 'suggestions', requestId, items });
  }

  private async collectSuggestions(prefix: string): Promise<UiSuggestion[]> {
    const query = prefix.trim().toLowerCase();
    const items: UiSuggestion[] = [];
    const seen = new Set<string>();

    for (const path of this.openFilePaths()) {
      if (seen.has(path)) {
        continue;
      }
      if (query.length === 0 || path.toLowerCase().includes(query)) {
        seen.add(path);
        items.push({ id: 'open:' + path, path, label: path, source: 'open' });
      }
    }

    for (const path of await this.workspaceFiles()) {
      if (items.length >= 60) {
        break;
      }
      if (seen.has(path)) {
        continue;
      }
      if (query.length > 0 && !path.toLowerCase().includes(query)) {
        continue;
      }
      seen.add(path);
      items.push({ id: 'file:' + path, path, label: path, source: 'workspace' });
    }

    return items;
  }

  private openFilePaths(): string[] {
    const paths: string[] = [];
    for (const document of vscode.workspace.textDocuments) {
      const path = vscode.workspace.asRelativePath(document.uri, false);
      if (path.length === 0 || path.startsWith('..')) {
        continue;
      }
      // Virtual documents, for example the git history, live outside the
      // workspace and come back as an absolute path.
      if (isAbsolute(path)) {
        continue;
      }
      paths.push(path);
    }
    return paths;
  }

  private async workspaceFiles(): Promise<string[]> {
    const now = Date.now();
    if (this.fileCache && now - this.fileCache.at < 60_000) {
      return this.fileCache.files;
    }
    let files: string[] = [];
    try {
      const uris = await vscode.workspace.findFiles(
        '**/*',
        '**/{node_modules,.git,dist,out,coverage,.next,build}/**',
        1000
      );
      files = uris
        .map((uri) => vscode.workspace.asRelativePath(uri, false))
        .filter(
          (path) =>
            path.length > 0 &&
            !path.startsWith('..') &&
            !isAbsolute(path) &&
            isTextFile(path)
        );
    } catch (error) {
      this.logger.error('the workspace file search failed', error);
    }
    this.fileCache = { files, at: now };
    return files;
  }

  private async postSettings(): Promise<void> {
    const settings = getSettings();
    const key = await getApiKey(this.context.secrets);
    const payload: UiSettings = {
      baseUrl: settings.baseUrl,
      customBaseUrl: settings.customBaseUrl,
      model: settings.model,
      models: MODELS,
      effort: settings.effort,
      mode: settings.mode,
      thinking: settings.thinking,
      maxIterations: settings.maxIterations,
      fontSize: settings.fontSize,
      historyMaxMessages: settings.historyMaxMessages,
      contextThreshold: settings.contextThreshold,
      semanticSearch: settings.semanticSearch,
      autoApprove: settings.autoApprove,
      rulesEnabled: settings.rulesEnabled,
      enableWebSearch: settings.enableWebSearch,
      collapseTools: settings.collapseTools,
      collapseCode: settings.collapseCode,
      hasApiKey: Boolean(key),
      tools: this.registry.list().map((tool) => tool.name)
    };
    this.panel.post({ type: 'settings', settings: payload });
  }

  private async saveSettings(values: UiSettingsValues): Promise<void> {
    const config = vscode.workspace.getConfiguration('minimax');
    const updates: Array<[string, unknown]> = [
      ['baseUrl', values.baseUrl],
      ['customBaseUrl', values.customBaseUrl],
      ['model', values.model],
      ['effort', values.effort],
      ['mode', values.mode],
      ['thinking', values.thinking],
      ['maxIterations', values.maxIterations],
      ['fontSize', values.fontSize],
      ['historyMaxMessages', values.historyMaxMessages],
      ['contextThreshold', values.contextThreshold],
      ['semanticSearch', values.semanticSearch],
      ['autoApprove', values.autoApprove],
      ['rulesEnabled', values.rulesEnabled],
      ['enableWebSearch', values.enableWebSearch],
      ['collapseTools', values.collapseTools],
      ['collapseCode', values.collapseCode]
    ];
    for (const [key, value] of updates) {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
    this.applySettings();
    await this.sendInit();
    await this.postSettings();
  }

  private async storeApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      this.panel.post({ type: 'error', message: 'The API key is empty.' });
      return;
    }
    await setApiKey(this.context.secrets, trimmed);
    await this.sendInit();
    await this.postSettings();
  }

  private persist(runtime: RuntimeSession): void {
    runtime.updatedAt = Date.now();
    const stored: StoredSession = {
      id: runtime.id,
      title: runtime.title,
      updatedAt: runtime.updatedAt,
      messages: runtime.history,
      uiMessages: runtime.uiMessages,
      usage: runtime.usage,
      turns: runtime.turns
    };
    // A full state of the host must not break the turn, the chat stays in
    // memory and the failure goes to the log.
    void this.store.save(stored).then((saved) => {
      if (!saved) {
        this.logger.error('the chat was not saved to the state of the host');
      } else if (this.activeSessionId === runtime.id) {
        // The id of the active session goes to the state of the host after
        // the session itself. A lonely id would point to nothing.
        this.store.setActiveId(runtime.id);
      }
      this.panel.post({ type: 'sessions', sessions: this.store.summaryList() });
    });
  }

  persistActive(): void {
    const runtime = this.activeSession();
    if (runtime) {
      this.persist(runtime);
    }
  }

  private runtimeFrom(stored: StoredSession): RuntimeSession {
    return {
      id: stored.id,
      title: stored.title,
      updatedAt: stored.updatedAt,
      history: [...stored.messages],
      uiMessages: [...(stored.uiMessages ?? [])],
      agent: undefined,
      busy: false,
      errorReported: false,
      usage: (stored.usage ?? []).map((turn) => ({
        input: turn.input,
        output: turn.output,
        cache: turn.cache ?? 0
      })),
      turns: stored.turns ?? [],
      turnStartedAt: 0
    };
  }

  startNewSession(): void {
    const current = this.activeSession();
    if (current) {
      this.persist(current);
    }
    const id = 's-' + Date.now().toString(36);
    this.sessions.set(id, {
      id,
      title: 'New chat',
      updatedAt: Date.now(),
      history: [],
      uiMessages: [],
      agent: undefined,
      busy: false,
      errorReported: false,
      usage: [],
      turns: [],
      turnStartedAt: 0
    });
    this.activeSessionId = id;
    // The id of the new chat goes to the state of the host together with the
    // chat itself. A lonely id would point to nothing after a restart.
    this.setState('idle');
    void this.sendInit();
  }

  // The last chat is opened again after a restart, an empty panel would hide
  // the work of the previous session.
  restoreSession(): void {
    const activeId = this.store.activeId();
    const active = activeId ? this.store.get(activeId) : undefined;
    const stored = active ?? this.store.list()[0];
    if (!stored) {
      this.startNewSession();
      return;
    }
    const runtime = this.runtimeFrom(stored);
    this.sessions.set(runtime.id, runtime);
    this.activeSessionId = runtime.id;
    this.store.setActiveId(runtime.id);
    this.setState('idle');
    void this.sendInit();
  }

  private selectSession(id: string): void {
    const stored = this.store.get(id);
    if (!stored) {
      return;
    }
    const current = this.activeSession();
    if (current && current.id !== id) {
      this.persist(current);
    }
    let runtime = this.sessions.get(id);
    if (!runtime) {
      runtime = this.runtimeFrom(stored);
      this.sessions.set(id, runtime);
    }
    this.activeSessionId = id;
    this.store.setActiveId(id);
    this.panel.post({ type: 'session_loaded', messages: runtime.uiMessages });
    void this.sendInit();
  }

  private deleteSession(id: string): void {
    this.store.remove(id);
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
      this.activeSessionId = undefined;
      // The removed chat must not stay active, its id would point to nothing
      // after a restart.
      this.store.setActiveId(undefined);
      this.startNewSession();
      return;
    }
    void this.sendInit();
  }

  private async sendInit(): Promise<void> {
    const settings = getSettings();
    const key = await getApiKey(this.context.secrets);
    const runtime = this.activeSession();
    this.panel.post({
      type: 'init',
      state: {
        sessions: this.store.summaryList(),
        activeSessionId: this.activeSessionId,
        messages: runtime ? [...runtime.uiMessages] : [],
        model: settings.model,
        models: MODELS,
        effort: settings.effort,
        mode: settings.mode,
        thinking: settings.thinking,
        state: this.agentState,
        tokens: this.usageTotal(runtime),
        usage: runtime ? [...runtime.usage] : [],
        hasApiKey: Boolean(key),
        theme: themeKind(),
        fontSize: settings.fontSize,
        collapseTools: settings.collapseTools,
        collapseCode: settings.collapseCode,
        // The version comes from the manifest, the webview does not know it.
        version: this.context.extension?.packageJSON?.version ?? ''
      }
    });
  }

  private applySettings(): void {
    const settings = getSettings();
    void this.applySemanticProvider();
    for (const runtime of this.sessions.values()) {
      if (runtime.busy) {
        runtime.agent?.setAutoApprove(settings.autoApprove);
        continue;
      }
      runtime.agent = undefined;
    }
  }

  private async updateSetting(key: string, value: unknown): Promise<void> {
    await vscode.workspace
      .getConfiguration('minimax')
      .update(key, value, vscode.ConfigurationTarget.Global);
    await this.sendInit();
  }

  private async pickFiles(requestId: string): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: 'Attach'
    });
    this.panel.post({
      type: 'files',
      requestId,
      files: (files ?? []).map((uri) => {
        const path = vscode.workspace.asRelativePath(uri, false);
        return { path, label: path };
      })
    });
  }

  private async undoLastChange(): Promise<void> {
    const entry = await this.backups.revertLast();
    if (!entry) {
      void vscode.window.showInformationMessage('MiniMax: there is nothing to undo.');
      return;
    }
    try {
      if (entry.previousContent === null) {
        await unlink(entry.path);
      } else {
        await writeFile(entry.path, entry.previousContent, 'utf8');
      }
      void vscode.window.showInformationMessage('MiniMax: reverted ' + entry.path);
    } catch (error) {
      this.logger.error('the undo failed', error);
      void vscode.window.showErrorMessage('MiniMax: the undo failed, see the output channel.');
    }
  }

  private async refreshContext(): Promise<void> {
    const runtime = this.activeSession();
    if (!runtime) {
      return;
    }
    runtime.agent?.setSystemPrompt(await this.buildPrompt());
    void vscode.window.showInformationMessage('MiniMax: the workspace context is refreshed.');
  }

  private async addApiKey(): Promise<void> {
    const key = await vscode.window.showInputBox({
      title: 'MiniMax API key',
      prompt: 'Paste your M Plan key. It is stored in the secret storage of VS Code.',
      password: true,
      ignoreFocusOut: true
    });
    if (!key || key.trim().length === 0) {
      return;
    }
    await setApiKey(this.context.secrets, key.trim());
    await this.sendInit();
    void vscode.window.showInformationMessage('MiniMax: the API key is saved.');
  }

  private async clearApiKey(): Promise<void> {
    await clearStoredApiKey(this.context.secrets);
    await this.sendInit();
    await this.postSettings();
    void vscode.window.showInformationMessage('MiniMax: the API key is removed.');
  }

  private async setEndpoint(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Global (api.minimax.io)', value: 'global' },
        { label: 'China (api.minimaxi.com)', value: 'china' },
        { label: 'Custom URL', value: 'custom' }
      ],
      { title: 'MiniMax endpoint' }
    );
    if (!choice) {
      return;
    }
    const config = vscode.workspace.getConfiguration('minimax');
    if (choice.value === 'custom') {
      const url = await vscode.window.showInputBox({
        title: 'Custom MiniMax base URL',
        prompt: 'For example https://api.minimax.io/anthropic',
        value: config.get<string>('customBaseUrl', '')
      });
      if (!url || url.trim().length === 0) {
        return;
      }
      await config.update('customBaseUrl', url.trim(), vscode.ConfigurationTarget.Global);
      await config.update('baseUrl', 'auto', vscode.ConfigurationTarget.Global);
    } else {
      await config.update('baseUrl', choice.value, vscode.ConfigurationTarget.Global);
    }
    await this.sendInit();
  }

  private async selectModel(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      MODELS.map((model) => ({ label: model.label, value: model.id })),
      { title: 'MiniMax model' }
    );
    if (!choice) {
      return;
    }
    await this.updateSetting('model', choice.value);
  }

  private async selectMode(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      AGENT_MODES.map((mode) => ({
        label: mode,
        description: mode === 'plan' ? 'read-only, the agent answers with a plan' : 'the agent can change files',
        value: mode
      })),
      { title: 'MiniMax agent mode' }
    );
    if (!choice) {
      return;
    }
    await this.updateSetting('mode', choice.value);
  }

  private async selectEffort(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      (['low', 'medium', 'high', 'xhigh', 'max'] as EffortLevel[]).map((level) => ({
        label: level,
        value: level
      })),
      { title: 'MiniMax thinking effort' }
    );
    if (!choice) {
      return;
    }
    await this.updateSetting('effort', choice.value);
  }
}

let controller: MiniMaxController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('MiniMax');
  context.subscriptions.push(channel);
  controller = new MiniMaxController(context, channel);
  controller.register(context);
  controller.restoreSession();
  void controller.refreshQuota();
  // The index of the project is built in the background, the first search
  // does not wait for the files of the disk.
  void controller.prepareIndex();
}

export function deactivate(): void {
  controller?.persistActive();
  controller = undefined;
}
