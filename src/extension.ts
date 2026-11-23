import { unlink, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as vscode from 'vscode';
import { HttpEmbeddingsClient } from './api/embeddings';
import { HttpMiniMaxClient } from './api/client';
import { HttpSpeechClient } from './api/speech';
import { fetchQuota, type QuotaSnapshot } from './api/quota';
import type { AnthropicMessage, EffortLevel } from './api/types';
import { Agent, type AgentEvent, type AgentRunResult } from './agent/agent';
import { buildWorkspaceSnapshot, renderSnapshot } from './agent/context';
import { readMentionedFiles } from './agent/mentions';
import {
  buildSystemPrompt,
  renderGitContext,
  renderGoalContext,
  renderTasksContext
} from './agent/prompt';
import { generateCommitMessage } from './agent/commitMessage';
import { AgentSession } from './agent/session';
import type { GoalState, TodoItem } from './agent/state';
import { budgetOver } from './agent/goalBudget';
import { isAbortMessage, stopNotice } from './agent/stopReason';
import { cutHistory, findRequestIndex, turnOfMessage, type TurnAnchor } from './agent/turns';
import {
  AGENT_MODES,
  checkBaseUrl,
  isOfficialBaseUrlHost,
  MODELS,
  resolveBaseUrl
} from './config/models';
import {
  clearApiKey as clearStoredApiKey,
  getApiKey,
  setApiKey
} from './config/secrets';
import { getSettings, onSettingsChanged, type MiniMaxSettings } from './config/settings';
import { readChangedFiles } from './git/changes';
import { collectStagedChanges, gitRepositories, setCommitMessage } from './git/scm';
import { readRepositoryState, summarizeState } from './git/status';
import { createLogger, type Logger } from './logger';
import { ProjectSearch } from './search/project';
import { InMemoryBackupStore } from './storage/backups';
import { projectLabel, SessionStore, type StoredSession } from './storage/sessions';
import { UsageLedger } from './storage/usage';
import { createExploreTools, isTextFile } from './tools/explore';
import { createFileTools, resolveWorkspacePath } from './tools/fs';
import { createGoalTools } from './tools/goal';
import { buildPreview } from './tools/preview';
import { ToolRegistry } from './tools/registry';
import { createGitTools } from './tools/git';
import { createTerminalTools } from './tools/terminal';
import { createTodoTools } from './tools/todo';
import { createTaskFileTools } from './tools/tasks';
import { createReplTools, resetReplProcesses, stopReplSession } from './tools/repl';
import { createContainerTools } from './tools/containers';
import { createCmdTools } from './tools/cmd';
import {
  CHILD_MAX_ITERATIONS,
  createTaskTools,
  describeInput,
  type TaskOutcome,
  type TaskRequest,
  type TaskRole
} from './tools/task';
import type { ToolContext } from './tools/types';
import {
  ApprovalGate,
  type ApprovalDecision,
  type ApprovalRequest
} from './ui/approvals';
import { fileErrorMessage } from './ui/fileError';
import { historyPage, historyTail } from './ui/historyPage';
import { AgentPanelProvider } from './ui/panel';
import { themeKind } from './ui/theme';
import { VoiceController } from './voice/controller';
import { Recorder } from './voice/recorder';
import type {
  AgentState,
  ExtToWeb,
  QueuedMessage,
  UiApproval,
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
  // The project of the chat: the root of the workspace it belongs to.
  workspaceRoot: string;
  history: AnthropicMessage[];
  uiMessages: UiMessage[];
  // Where the history of the panel starts in the messages of the session.
  // The older messages wait in the host until the panel asks for them.
  panelOffset: number | undefined;
  agent: AgentSession | undefined;
  busy: boolean;
  // The state of the dot: every chat keeps its own, the panel shows the
  // one of the chat that is open.
  state: AgentState;
  // The chat was deleted while its turn was still running: the turn ends,
  // but nothing of it goes back into the store.
  deleted: boolean;
  errorReported: boolean;
  // The token spend of every action of this session.
  usage: UiUsageTurn[];
  // The anchors of the requests, they tell where a request sits in the
  // history and let the chat roll back to it.
  turns: TurnAnchor[];
  // The list of tasks of the session, the model writes it.
  todos: TodoItem[];
  // The goal of the session, the user sets it.
  goal: GoalState | undefined;
  // When the turn of this moment started, the panel shows how long it
  // took.
  turnStartedAt: number;
  // The tools the reader allowed for the session. The permission of a
  // child belongs to the chat of this session, it must not leak into
  // another chat.
  approvedTools: Set<string>;
  // The messages the reader wrote while the agent worked. They go out one
  // after another when the turn is over.
  queue: QueuedMessage[];
  // The queue waits until the reader asks for it: the user stopped the
  // turn, the messages stay in the queue.
  queuePaused: boolean;
  // The user stopped the turn of this moment.
  turnStopped: boolean;
  // The reason of the last failure of the turn.
  lastError: string | undefined;
}

const TITLE_LIMIT = 60;
// How many messages wait in the queue of a chat.
const MAX_QUEUE_ITEMS = 30;
// How many actions the spend graph keeps in the header.
const MAX_USAGE_TURNS = 24;

// The role of a sub-agent tells it what it may do and what its answer looks
// like. The text goes to the model, it is English.
const ROLE_PROMPTS: Record<TaskRole, string> = {
  explore:
    'You are a sub-agent of the main agent. Your task is to explore: you read the files and you search the project, you never change anything. Answer with a short report: what you found, the paths and the facts. Your answer is the result of the task, write it as plain text.',
  worker:
    'You are a sub-agent of the main agent. Your task is to make the change: you edit the files and you run the commands. Answer with a short report: what you changed and what you checked. Your answer is the result of the task, write it as plain text.',
  verifier:
    'You are a sub-agent of the main agent. Your task is to check the work: you read the files and the changes and you look for the defects. Answer with the list of the defects you found, or with the words that there are none. Your answer is the result of the task, write it as plain text.'
};

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
  // The approvals of the sub-agents wait here, the id of the request of the
  // child starts with "child-". The map remembers the name of the tool and
  // the chat the child belongs to, the reader can allow the tool for the
  // whole session of that chat.
  private readonly childApprovals = new Map<
    string,
    {
      toolName: string;
      sessionId: string;
      resolve: (decision: ApprovalDecision) => void;
    }
  >();
  // The approval cards that wait for the reader: the id of the card and the
  // chat it belongs to. The card lives in the messages of its chat, so
  // another chat does not show it and a switch of the chats keeps it.
  private readonly approvalOwner = new Map<string, string>();
  // The index of the project, one per workspace folder.
  private readonly searches = new Map<string, ProjectSearch>();
  private activeSessionId: string | undefined;
  private agentState: AgentState = 'idle';
  private counter = 0;
  private fileCache: { files: string[]; at: number } | undefined;
  private quota: QuotaSnapshot | undefined;
  // When every action started, the duration goes to the panel.
  private readonly toolStarted = new Map<string, number>();
  // The voice input: ffmpeg records, MiniMax asr-1.0 transcribes.
  private readonly voice: VoiceController;

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

    for (const tool of [
      ...createFileTools({ backups: this.backups }),
      ...createExploreTools({ search: (root) => this.searchFor(root) }),
      ...createGitTools(),
      ...createTerminalTools(),
      ...createCmdTools(),
      ...createTodoTools(),
      ...createTaskFileTools(),
      ...createReplTools(),
      ...createContainerTools(),
      ...createGoalTools(),
      ...createTaskTools({
        spawn: async (request, ctx, progress) =>
          await this.spawnTask(request, ctx, progress)
      })
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

    // One save of the settings writes many keys and every write fires the
    // event. The agents and the panel are rebuilt once, after the last
    // write, not a dozen times in a row.
    let settingsTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
      onSettingsChanged(() => {
        if (settingsTimer !== undefined) {
          clearTimeout(settingsTimer);
        }
        settingsTimer = setTimeout(() => {
          settingsTimer = undefined;
          this.applySettings();
          this.warnAboutTheBaseUrl();
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
            effort: this.effortFor(settings),
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

  private async buildPrompt(registry: ToolRegistry = this.registry): Promise<string> {
    const settings = getSettings();
    const root = this.workspaceRoot();
    const openFiles = vscode.window.visibleTextEditors
      .map((editor) => vscode.workspace.asRelativePath(editor.document.uri, false))
      .filter((path) => path.length > 0 && !path.startsWith('..'));
    const snapshot = await buildWorkspaceSnapshot(root, {
      includeOpenFiles: settings.rulesEnabled,
      openFiles: openFiles.map((path) => ({ path }))
    });

    const tools = registry
      .list()
      .filter((tool) => registry.isAllowed(tool, settings.mode))
      .map((tool) => tool.name);

    return buildSystemPrompt({
      workspaceRoot: root,
      os: process.platform,
      shell: process.platform === 'win32' ? 'powershell' : 'sh',
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

  // The context of the turn carries the state of the repository and the
  // list of tasks, both change between the turns.
  private async sessionContext(runtime: RuntimeSession): Promise<string> {
    const parts: string[] = [];
    const git = await this.gitContext();
    if (git.length > 0) {
      parts.push(git);
    }
    const tasks = renderTasksContext(runtime.todos);
    if (tasks.length > 0) {
      parts.push(tasks);
    }
    const goal = renderGoalContext(runtime.goal);
    if (goal.length > 0) {
      parts.push(goal);
    }
    return parts.join('\n\n');
  }

  // The limits of the goal. The agent stops when one of them is over, the
  // user raises the limit and the work continues.
  // The status of the goal does not switch the budget off. The status is
  // the business of the model, the limits are the business of the user, and
  // a model that marks the goal as blocked or complete keeps its limit.
  // The idle time between the turns is not work, so the running time is
  // read only while the turn runs.
  private goalBudgetOk(runtime: RuntimeSession): boolean {
    const goal = runtime.goal;
    if (!goal) {
      return true;
    }
    // The time of the running turn counts too. The time of a turn that is
    // over is already in the spend of the goal, the time between the turns
    // is not the work.
    const running =
      runtime.busy && runtime.turnStartedAt > 0
        ? (Date.now() - runtime.turnStartedAt) / 1000
        : 0;
    return !budgetOver(goal, {
      tokens: goal.used.tokens,
      requests: goal.used.requests,
      seconds: goal.used.seconds + running
    });
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
      maxRetries: settings.maxRetries,
      effort: this.effortFor(settings),
      mode: settings.mode,
      thinking: this.thinkingMode(settings),
      contextWindow: model?.contextWindow,
      historyLimit: settings.historyMaxMessages,
      contextThreshold: settings.contextThreshold,
      systemPrompt: await this.buildPrompt(),
      contextProvider: async () => await this.sessionContext(runtime),
      sessionId: runtime.id,
      // The gate of the session, a child of this session shares it.
      sessionApproved: runtime.approvedTools,
      sessionState: {
        get todos() {
          return runtime.todos;
        },
        get goal() {
          return runtime.goal;
        }
      },
      budget: () => this.goalBudgetOk(runtime),
      workspaceRoot: this.workspaceRoot(),
      logger: this.logger,
      autoApprove: settings.autoApprove,
      onEvent: (event) => this.handleAgentEvent(runtime, event),
      onApproval: (approval) => {
        // The card belongs to the chat of the turn: it goes into the
        // messages of that chat and reaches the panel only while the chat
        // is open.
        runtime.uiMessages.push({
          id: 'approval-' + approval.id,
          role: 'assistant',
          approval
        });
        this.approvalOwner.set(approval.id, runtime.id);
        this.postFor(runtime, { type: 'approval_request', approval });
      }
    });
    agent.setHistory(runtime.history);
    runtime.agent = agent;
    return agent;
  }

  // The registry of a child: the role decides what it may do. A role that
  // only reads gets the tools without a side effect. The tool of the task is
  // not there, a child does not start another child.
  private registryForRole(role: TaskRole): ToolRegistry {
    const registry = new ToolRegistry();
    for (const entry of this.registry.list()) {
      if (entry.name === 'task') {
        continue;
      }
      if (role === 'worker' || !entry.sideEffect) {
        registry.register(entry);
      }
    }
    return registry;
  }

  // The gate of a child is the gate of the session: a write of the child
  // asks the user too. The tools the reader allowed for the session are
  // allowed for every child.
  private childApproval(
    runtime: RuntimeSession,
    signal: AbortSignal
  ): ApprovalGate {
    return new ApprovalGate({
      autoApprove: [...getSettings().autoApprove],
      request: async (request) =>
        await this.requestChildApproval(runtime, request, signal),
      // The gate of the child is the gate of the session: a permission that
      // the reader gave to the parent works for the child too.
      sessionApproved: runtime.approvedTools
    });
  }

  private async requestChildApproval(
    runtime: RuntimeSession,
    request: ApprovalRequest,
    signal: AbortSignal
  ): Promise<ApprovalDecision> {
    const id = 'child-' + request.id;
    const approval: UiApproval = { id, name: request.toolName, input: request.input };
    // The reader sees the change before he answers. A path outside of the
    // workspace breaks the preview, the approval goes on without it.
    try {
      const preview = await buildPreview(
        request.toolName,
        request.input,
        this.workspaceRoot()
      );
      if (preview) {
        approval.preview = { path: preview.path, lines: preview.lines };
      }
    } catch {
      // The preview is optional, a failure of it must not break the
      // approval.
    }
    if (signal.aborted) {
      // The turn was stopped while the preview was built, nobody answers.
      return { approved: false, allowForSession: false };
    }
    return await new Promise<ApprovalDecision>((resolve) => {
      this.childApprovals.set(id, {
        toolName: request.toolName,
        sessionId: runtime.id,
        resolve
      });
      runtime.uiMessages.push({
        id: 'approval-' + id,
        role: 'assistant',
        approval
      });
      this.approvalOwner.set(id, runtime.id);
      this.postFor(runtime, { type: 'approval_request', approval });
    });
  }

  // The card of an approval leaves the chat with its answer: a card that
  // outlives its question reads like a dead button. Returns false when the
  // card has no owner any more, the caller tells the panel itself then.
  private dropApprovalCard(approvalId: string, approved: boolean): boolean {
    const owner = this.approvalOwner.get(approvalId);
    if (owner === undefined) {
      return false;
    }
    this.approvalOwner.delete(approvalId);
    const runtime = this.sessions.get(owner);
    if (!runtime) {
      return true;
    }
    runtime.uiMessages = runtime.uiMessages.filter(
      (message) => message.approval?.id !== approvalId
    );
    this.postFor(runtime, { type: 'approval_resolved', id: approvalId, approved });
    return true;
  }

  // Every waiting card of a chat leaves it: the stop of the turn answers
  // the questions that nobody will answer.
  private dropApprovalCards(runtime: RuntimeSession, approved: boolean): void {
    const cards = runtime.uiMessages.filter((message) => message.approval);
    for (const card of cards) {
      this.dropApprovalCard(card.approval!.id, approved);
    }
  }

  // The approvals of the children that wait are released when the turn is
  // stopped, a child must not wait for an answer that never comes.
  private releaseChildApprovals(): void {
    for (const [id, pending] of this.childApprovals) {
      this.childApprovals.delete(id);
      // The card of the child leaves the chat with its answer, the same way
      // the cards of the parent do.
      this.dropApprovalCard(id, false);
      pending.resolve({ approved: false, allowForSession: false });
    }
  }

  // The events of the child: the spend goes to the counter of the goal,
  // the rest goes into the journal of the card of the call. The event of the
  // end of the child does not go to the host, the spend of the child is
  // already in the result of the call of the parent.
  private handleChildEvent(
    runtime: RuntimeSession,
    event: AgentEvent,
    progress: (line: string) => void
  ): void {
    if (event.type === 'usage') {
      this.handleAgentEvent(runtime, event);
      return;
    }
    if (event.type === 'tool_start') {
      // The line names the target of the action, the content of a file is
      // not a line of the journal.
      const target = describeInput(event.input);
      progress(target.length > 0 ? event.name + ' ' + target : event.name);
      return;
    }
    if (event.type === 'tool_end') {
      progress(event.name + (event.isError ? ' failed' : ' done'));
      // The change of the child must not be lost: the lines of the diff go
      // into the journal of the call.
      if (event.diff) {
        for (const line of event.diff.lines) {
          if (line.type === 'add') {
            progress('+ ' + line.text);
          } else if (line.type === 'remove') {
            progress('- ' + line.text);
          }
        }
      }
      return;
    }
    if (event.type === 'error') {
      progress('error: ' + event.message);
    }
  }

  // The child runs on its own: its own history, its own system prompt, its
  // own registry. The answer of the child is the result of the call.
  private async spawnTask(
    request: TaskRequest,
    ctx: ToolContext,
    progress: (line: string) => void
  ): Promise<TaskOutcome> {
    const runtime = ctx.sessionId
      ? this.sessions.get(ctx.sessionId)
      : this.activeSession();
    if (!runtime) {
      return { content: 'There is no session for the sub-agent.', isError: true };
    }
    const key = await getApiKey(this.context.secrets);
    if (!key) {
      return { content: 'No API key, the sub-agent cannot run.', isError: true };
    }
    const settings = getSettings();
    const model = MODELS.find((item) => item.id === settings.model);
    // The tools of the child, the prompt of the child names them and the
    // child calls only them.
    const registry = this.registryForRole(request.role);
    // The child works in the session of its parent, it gets the same context
    // of the turn as the parent: the goal, the list of the tasks and the
    // state of the repository.
    const context = await this.sessionContext(runtime);
    const systemPrompt = [
      await this.buildPrompt(registry),
      ROLE_PROMPTS[request.role],
      context
    ]
      .filter((part) => part.length > 0)
      .join('\n\n');
    const child = new Agent({
      client: new HttpMiniMaxClient({
        baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
        apiKey: key
      }),
      registry,
      approval: this.childApproval(runtime, ctx.signal),
      model: settings.model,
      maxTokens: model?.maxTokens ?? 65_536,
      maxIterations: CHILD_MAX_ITERATIONS,
      effort: this.effortFor(settings),
      thinking: this.thinkingMode(settings),
      mode: settings.mode,
      systemPrompt,
      workspaceRoot: this.workspaceRoot(),
      depth: 1,
      sessionId: runtime.id,
      sessionState: {
        get todos() {
          return runtime.todos;
        },
        get goal() {
          return runtime.goal;
        }
      },
      budget: () => this.goalBudgetOk(runtime),
      logger: this.logger,
      onEvent: (event) => this.handleChildEvent(runtime, event, progress)
    });
    // The stop of the parent stops the child too, and the approvals that
    // wait are released: a child must not wait for an answer that never
    // comes. The listener goes away with the child.
    const onAbort = (): void => {
      child.abort();
      this.releaseChildApprovals();
    };
    ctx.signal.addEventListener('abort', onAbort);
    if (ctx.signal.aborted) {
      onAbort();
    }
    let result: AgentRunResult;
    try {
      result = await child.run(request.prompt, []);
    } catch (error) {
      // The child was stopped or it failed, the tool reports the error and
      // the parent continues.
      const reason = error instanceof Error ? error.message : String(error);
      return {
        content: ctx.signal.aborted
          ? 'The sub-agent was stopped.'
          : 'The sub-agent failed: ' + reason,
        isError: true
      };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
    const text = finalText(result.messages);
    if (text.length === 0) {
      return {
        content:
          'The sub-agent finished without an answer, it stopped with: ' +
          result.stopReason +
          '.',
        isError: true,
        usage: result.usage
      };
    }
    return { content: text, usage: result.usage };
  }

  private handleAgentEvent(runtime: RuntimeSession, event: AgentEvent): void {
    if (event.type === 'assistant_start') {
      runtime.uiMessages.push({ id: this.nextId('assistant'), role: 'assistant', text: '' });
      const last = runtime.uiMessages[runtime.uiMessages.length - 1];
      this.postFor(runtime, { type: 'assistant_start', id: last ? last.id : '' });
      return;
    }
    if (event.type === 'assistant_text') {
      this.appendToAssistant(runtime, 'text', event.text);
      this.postFor(runtime, { type: 'text_delta', text: event.text });
      this.setState('streaming', runtime);
      return;
    }
    if (event.type === 'assistant_thinking') {
      this.appendToAssistant(runtime, 'thinking', event.text);
      this.postFor(runtime, { type: 'thinking_delta', text: event.text });
      this.setState('thinking', runtime);
      return;
    }
    if (event.type === 'assistant_reset') {
      // The answer broke in the middle: the piece that came is not the
      // answer. The request runs again and the new text takes its place.
      for (let index = runtime.uiMessages.length - 1; index >= 0; index--) {
        const message = runtime.uiMessages[index]!;
        if (message.role === 'assistant' && !message.approval) {
          message.text = '';
          message.thinking = '';
          break;
        }
      }
      this.postFor(runtime, { type: 'assistant_reset' });
      return;
    }
    if (event.type === 'retrying') {
      // The connection to MiniMax is lost, the request is repeated. The
      // panel shows the attempt and the reader knows the agent works.
      this.postFor(runtime, {
        type: 'retry_status',
        status: { attempt: event.attempt, total: event.total, delayMs: event.delayMs }
      });
      this.setState('thinking');
      return;
    }
    if (event.type === 'tool_progress') {
      // The journal of the action: the lines that the tool writes while it
      // runs. They stay in the card of the action. The same id of a tool
      // call can come back in a later turn, the last card with that id
      // takes the line.
      for (let index = runtime.uiMessages.length - 1; index >= 0; index--) {
        const message = runtime.uiMessages[index]!;
        if (message.tool && message.tool.id === event.id) {
          message.tool.progress = [
            ...(message.tool.progress ?? []),
            event.line
          ];
          break;
        }
      }
      this.postFor(runtime, {
        type: 'tool_progress',
        id: event.id,
        line: event.line
      });
      return;
    }
    if (event.type === 'tool_start') {
      this.toolStarted.set(event.id, Date.now());
      runtime.uiMessages.push({
        id: event.id,
        role: 'tool',
        tool: { id: event.id, name: event.name, input: event.input, running: true }
      });
      this.postFor(runtime, { type: 'tool_start', id: event.id, name: event.name, input: event.input });
      this.setState('tool', runtime);
      return;
    }
    if (event.type === 'tool_end') {
      const started = this.toolStarted.get(event.id);
      this.toolStarted.delete(event.id);
      const durationMs = started === undefined ? undefined : Date.now() - started;
      // The result of the call stands in the content of the card, the
      // journal of the action lives in its own field. The same id of a tool
      // call can come back in a later turn, the content goes into the last
      // card with that id, the card of the earlier turn keeps its own
      // result.
      for (let index = runtime.uiMessages.length - 1; index >= 0; index--) {
        const message = runtime.uiMessages[index]!;
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
          break;
        }
      }
      if (event.state?.kind === 'todos') {
        runtime.todos = event.state.todos;
        this.postFor(runtime, { type: 'todos', todos: runtime.todos });
        this.persist(runtime);
        // The tasks are done, the reader wants to see what changed.
        if (
          runtime.todos.length > 0 &&
          runtime.todos.every((item) => item.status === 'completed')
        ) {
          void this.postSummary(runtime);
        }
      }
      if (event.state?.kind === 'goal') {
        const goal = runtime.goal;
        if (goal) {
          goal.status = event.state.status;
          this.postFor(runtime, { type: 'goal', goal: { ...goal } });
          // The reason of the model stands in the card of the call: a notice
          // printed it twice and was lost on the reload of the panel, the
          // card stays in the saved chat.
          this.persist(runtime);
        }
      }
      this.postFor(runtime, {
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
    if (event.type === 'usage') {
      const goal = runtime.goal;
      // The spend is counted for every status of the goal, the panel has to
      // show the truth.
      if (goal) {
        goal.used.tokens +=
          event.usage.inputTokens +
          event.usage.outputTokens +
          (event.usage.cacheReadTokens ?? 0) +
          (event.usage.cacheCreationTokens ?? 0);
        goal.used.requests += 1;
        this.postFor(runtime, { type: 'goal', goal: { ...goal } });
      }
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
      this.postFor(runtime, { type: 'usage', turns: runtime.usage });
      // The last message of the step tells how long the step took, and
      // the reason of the stop is named, a silent stop confuses.
      this.markStepTime(runtime);
      const goal = runtime.goal;
      if (goal && runtime.turnStartedAt > 0) {
        goal.used.seconds += (Date.now() - runtime.turnStartedAt) / 1000;
        // The widget of the goal shows the time of the turn, the panel has
        // to get the goal with the time that was added.
        this.postFor(runtime, { type: 'goal', goal: { ...goal } });
      }
      // The action is over, the reader sees the files it changed.
      void this.postSummary(runtime);
      const notice = stopNotice(event.stopReason, getSettings().maxIterations, goal);
      if (notice) {
        this.postFor(runtime, { type: 'notice', message: notice.message, kind: notice.kind });
      }
      this.dropApprovalCards(runtime, false);
      this.setState('idle', runtime);
      // The turn is over, the time of the turn is not running anymore.
      runtime.turnStartedAt = 0;
      // The repeats are over, the panel drops the status of the attempt.
      this.postFor(runtime, { type: 'retry_status', status: undefined });
      return;
    }
    if (event.type === 'error') {
      runtime.errorReported = true;
      runtime.lastError = event.message;
      // A turn that ended with an error has no event `done`, its time is
      // added here, otherwise the limit of the time is evaded by failing
      // turns.
      const goal = runtime.goal;
      if (goal && runtime.turnStartedAt > 0) {
        goal.used.seconds += (Date.now() - runtime.turnStartedAt) / 1000;
        // The widget of the goal shows the time of the turn, the panel has
        // to get the goal with the time that was added.
        this.postFor(runtime, { type: 'goal', goal: { ...goal } });
      }
      // Every question of the turn is over: the answer that never comes
      // must not stay in the chat as a dead card, and the card must not go
      // to the disk with the chat. The drop stands before the early return
      // of the stopped turn below: a turn cancelled from the window of the
      // editor takes that branch too.
      this.dropApprovalCards(runtime, false);
      if (isAbortMessage(event.message)) {
        // The user stopped the turn, it is not a failure of the server.
        runtime.turnStopped = true;
        this.postFor(runtime, {
          type: 'notice',
          message: 'The request was stopped.',
          kind: 'info'
        });
        this.markStepTime(runtime);
        this.setState('idle', runtime);
        // The turn is over, the time of the turn is not running anymore.
        runtime.turnStartedAt = 0;
        return;
      }
      this.postFor(runtime, { type: 'error', message: event.message });
      this.setState('error', runtime);
      // The turn is over, the time of the turn is not running anymore.
      runtime.turnStartedAt = 0;
      // The repeats are over, the panel drops the status of the attempt.
      this.postFor(runtime, { type: 'retry_status', status: undefined });
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

  // The agents that may wait for an answer of the reader: the open chat
  // first, then the chats in the background. The reader can answer a card
  // of a chat that is not open anymore, an answer that only reached the open
  // chat was lost and the other turn waited forever.
  private agentsByPriority(): AgentSession[] {
    const active = this.activeSession();
    const agents: AgentSession[] = [];
    if (active?.agent) {
      agents.push(active.agent);
    }
    for (const runtime of this.sessions.values()) {
      if (runtime !== active && runtime.agent) {
        agents.push(runtime.agent);
      }
    }
    return agents;
  }

  // The events of a turn reach the panel only while their chat is open. A
  // chat that runs in the background keeps its messages in the host and
  // shows them when the user comes back; posted to the panel they landed in
  // the open chat: its text, its tasks and its goal were overwritten.
  private postFor(runtime: RuntimeSession, message: ExtToWeb): void {
    if (runtime.id === this.activeSessionId) {
      this.panel.post(message);
    }
  }

  private setState(state: AgentState, runtime?: RuntimeSession): void {
    // The state belongs to a chat: the events of a chat that runs in the
    // background do not write into the open one, and the chat keeps its
    // own dot for the moment the reader opens it again.
    const owner = runtime ?? this.activeSession();
    if (owner) {
      owner.state = state;
    }
    if (!runtime || runtime.id === this.activeSessionId) {
      this.agentState = state;
      this.statusBar.setState(state);
      this.panel.post({
        type: 'status',
        state,
        tokens: this.usageTotal(this.activeSession())
      });
      return;
    }
    this.statusBar.setState(state);
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

  // The levels of the reasoning depth go only to the models that take
  // them, the catalog decides. The client does not know the names of the
  // models, it only sees the effort it was given.
  private effortFor(settings: MiniMaxSettings): EffortLevel | undefined {
    const model = MODELS.find((item) => item.id === settings.model);
    return model?.supportsEffort ? settings.effort : undefined;
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

  // The files of the working tree after the action. The panel shows them
  // under the feed, the reader opens a file with a click.
  private async postSummary(runtime: RuntimeSession): Promise<void> {
    const files = await readChangedFiles(this.workspaceRoot());
    if (files.length === 0) {
      return;
    }
    this.postFor(runtime, { type: 'summary', files });
  }

  private async handleWebviewMessage(message: WebToExt): Promise<void> {
    if (message.type === 'ready') {
      // The panel has just loaded, it holds nothing of the chat yet.
      await this.sendInit(true);
      return;
    }
    if (message.type === 'load_older') {
      this.loadOlder();
      return;
    }
    if (message.type === 'send') {
      await this.handleSend(message.text, message.mentions, message.selections);
      return;
    }
    if (message.type === 'send_queued') {
      this.sendQueued(message.id);
      return;
    }
    if (message.type === 'send_all_queued') {
      this.sendAllQueued();
      return;
    }
    if (message.type === 'remove_queued') {
      this.removeQueued(message.id);
      return;
    }
    if (message.type === 'open_file') {
      await this.openFile(message.path, message.line);
      return;
    }
    if (message.type === 'stop') {
      const runtime = this.activeSession();
      runtime?.agent?.stop();
      // The stop rejects every approval that waits, the cards of them leave
      // the chat with the answer.
      if (runtime) {
        this.dropApprovalCards(runtime, false);
      }
      return;
    }
    if (message.type === 'retry') {
      await this.retryTurn(message.id);
      return;
    }
    if (message.type === 'rewind') {
      await this.rewindTo(message.id);
      return;
    }
    if (message.type === 'approve') {
      const handled = this.agentsByPriority().some(
        (agent) => agent.approve(message.id, message.allowForSession)
      );
      if (!handled) {
        const pending = this.childApprovals.get(message.id);
        if (pending) {
          this.childApprovals.delete(message.id);
          if (message.allowForSession) {
            // The permission belongs to the chat of the child. The chat that
            // is active now has nothing to do with it, the reader answered
            // from another chat.
            this.sessions
              .get(pending.sessionId)
              ?.approvedTools.add(pending.toolName);
          }
          pending.resolve({ approved: true, allowForSession: message.allowForSession });
        }
      }
      if (!this.dropApprovalCard(message.id, true)) {
        // The card has no owner, the panel of the open chat still has to
        // let it go.
        this.panel.post({ type: 'approval_resolved', id: message.id, approved: true });
      }
      return;
    }
    if (message.type === 'reject') {
      const handled = this.agentsByPriority().some((agent) => agent.reject(message.id));
      if (!handled) {
        const pending = this.childApprovals.get(message.id);
        if (pending) {
          this.childApprovals.delete(message.id);
          pending.resolve({ approved: false, allowForSession: false });
        }
      }
      if (!this.dropApprovalCard(message.id, false)) {
        this.panel.post({ type: 'approval_resolved', id: message.id, approved: false });
      }
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
    if (message.type === 'set_goal') {
      const runtime = this.activeSession();
      const objective = message.objective.trim();
      if (!runtime) {
        return;
      }
      if (objective.length === 0) {
        this.panel.post({
          type: 'notice',
          message: 'The goal is empty.',
          kind: 'error'
        });
        return;
      }
      // The limits are numbers the user typed. A limit that is not a
      // positive number would stop the agent before it starts, and a limit
      // that is not a number would take the limit away.
      const limits = [
        message.tokenBudget,
        message.requestLimit,
        message.secondsLimit
      ];
      if (
        limits.some(
          (limit) => limit !== undefined && (!Number.isFinite(limit) || limit <= 0)
        )
      ) {
        this.panel.post({
          type: 'notice',
          message: 'The limits of the goal must be positive numbers.',
          kind: 'error'
        });
        return;
      }
      // The same goal with new limits keeps the spend: the user raises the
      // limit of the goal that is already running and the work continues from
      // where it stopped. A new objective is a new goal and starts from zero.
      const previous = runtime.goal;
      const used =
        previous && previous.objective === objective
          ? { ...previous.used }
          : { tokens: 0, requests: 0, seconds: 0 };
      runtime.goal = {
        objective,
        tokenBudget: message.tokenBudget,
        requestLimit: message.requestLimit,
        secondsLimit: message.secondsLimit,
        status: 'active',
        used
      };
      this.panel.post({ type: 'goal', goal: runtime.goal });
      this.persist(runtime);
      return;
    }
    if (message.type === 'clear_todos') {
      const runtime = this.activeSession();
      if (!runtime) {
        return;
      }
      // The list lives in the host, the next turn shows the model an empty
      // section of the tasks and the reload does not bring them back.
      runtime.todos = [];
      this.panel.post({ type: 'todos', todos: [] });
      this.persist(runtime);
      // The tasks are cancelled, the reader sees what the work changed.
      void this.postSummary(runtime);
      return;
    }
    if (message.type === 'clear_goal') {
      const runtime = this.activeSession();
      if (!runtime) {
        return;
      }
      runtime.goal = undefined;
      this.panel.post({ type: 'goal', goal: undefined });
      this.persist(runtime);
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
    if (message.type === 'voice_start') {
      await this.voice.start();
      return;
    }
    if (message.type === 'voice_stop') {
      await this.voice.stop();
      return;
    }
    if (message.type === 'voice_cancel') {
      this.voice.cancel();
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
      // The agent works, the request waits in the queue. The reader writes
      // several messages in a row, they go out one after another.
      this.enqueue(runtime, text, mentions, selections);
      return;
    }
    // The reader wrote a new request, the queue is not on hold anymore.
    runtime.queuePaused = false;
    await this.runTurn(runtime, text, mentions, selections);
  }

  // One turn of the agent: the request goes out, the answer comes back.
  private async runTurn(
    runtime: RuntimeSession,
    text: string,
    mentions: string[],
    selections: UiSelection[],
    queued?: QueuedMessage
  ): Promise<void> {
    // The turn is taken at once: the building of the agent takes a moment
    // and a second send in that window would start two turns on one
    // history. The queue of the reader waits behind this flag.
    runtime.busy = true;
    // The budget of the goal is over, the request does not go out. The user
    // raises the limit and the work continues.
    if (!this.goalBudgetOk(runtime)) {
      runtime.busy = false;
      const notice = stopNotice(
        'goal_limit',
        getSettings().maxIterations,
        runtime.goal
      );
      this.panel.post({
        type: 'notice',
        message: notice?.message ?? 'The budget of the goal is exhausted.',
        kind: notice?.kind ?? 'warn'
      });
      // The request does not go out, it comes back to the input field, the
      // user does not lose it.
      this.panel.post({ type: 'restore_input', text, mentions, selections });
      if (queued) {
        queued.state = 'error';
        queued.error = 'The budget of the goal is exhausted.';
        this.postQueue(runtime);
      }
      return;
    }
    const agent = await this.ensureAgent(runtime);
    if (!agent) {
      runtime.busy = false;
      if (queued) {
        queued.state = 'error';
        queued.error = 'No API key, the request did not go out.';
        this.postQueue(runtime);
      }
      return;
    }

    runtime.errorReported = false;
    runtime.turnStopped = false;
    runtime.lastError = undefined;
    // The place of the request in the history of the model, the anchor
    // of the turn takes it when the turn is over.
    let requestPlace = -1;
    const userId = this.nextId('user');
    runtime.uiMessages.push({ id: userId, role: 'user', text });
    this.panel.post({ type: 'user_message', id: userId, text });
    if (runtime.title === 'New chat') {
      const firstLine = text.trim().split('\n')[0] ?? '';
      runtime.title = firstLine.slice(0, TITLE_LIMIT) || 'New chat';
    }
    this.setState('thinking', runtime);
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
          requestPlace = await agent.send(
            await this.buildPromptText(text, mentions, selections)
          );
        }
      );
    } catch (error) {
      this.logger.error('the agent run failed', error);
      if (!runtime.errorReported) {
        const message = error instanceof Error ? error.message : String(error);
        this.panel.post({ type: 'error', message });
        this.setState('error', runtime);
      }
    } finally {
      runtime.busy = false;
      runtime.history = agent.getHistory();
      // The anchor of the request, the chat can roll back to it.
      runtime.turns.push({
        uiId: userId,
        text,
        historyIndex: requestPlace,
        mentions,
        selections
      });
      if (queued) {
        if (runtime.turnStopped) {
          // The user stopped the turn, the message waits for the next
          // command. The queue is on hold until the reader asks for it.
          queued.state = 'waiting';
          queued.error = undefined;
          runtime.queuePaused = true;
        } else if (runtime.errorReported) {
          queued.state = 'error';
          queued.error = runtime.lastError;
        } else {
          queued.state = 'done';
        }
        this.postQueue(runtime);
      }
      this.persist(runtime);
      void this.refreshQuota();
      // The next message of the queue goes out.
      void this.pumpQueue(runtime);
    }
  }

  // One message of the queue goes out now, it goes before the others.
  private sendQueued(id: string): void {
    const runtime = this.activeSession();
    if (!runtime) {
      return;
    }
    const index = runtime.queue.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    const item = runtime.queue[index]!;
    if (item.state === 'sending') {
      return;
    }
    item.state = 'waiting';
    item.error = undefined;
    runtime.queue.splice(index, 1);
    runtime.queue.unshift(item);
    runtime.queuePaused = false;
    this.postQueue(runtime);
    void this.pumpQueue(runtime);
  }

  // Every message of the queue goes out, the failed ones are tried again.
  private sendAllQueued(): void {
    const runtime = this.activeSession();
    if (!runtime) {
      return;
    }
    runtime.queuePaused = false;
    for (const item of runtime.queue) {
      if (item.state === 'error') {
        item.state = 'waiting';
        item.error = undefined;
      }
    }
    this.postQueue(runtime);
    void this.pumpQueue(runtime);
  }

  // A message leaves the queue. A message that goes out cannot be removed.
  private removeQueued(id: string): void {
    const runtime = this.activeSession();
    if (!runtime) {
      return;
    }
    const index = runtime.queue.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    if (runtime.queue[index]!.state === 'sending') {
      return;
    }
    runtime.queue.splice(index, 1);
    this.postQueue(runtime);
    this.persist(runtime);
  }

  // The message waits in the queue of the chat.
  private enqueue(
    runtime: RuntimeSession,
    text: string,
    mentions: string[],
    selections: UiSelection[]
  ): void {
    runtime.queue.push({
      id: this.nextId('q'),
      text,
      mentions,
      selections,
      state: 'waiting'
    });
    this.trimQueue(runtime);
    this.postQueue(runtime);
    this.persist(runtime);
  }

  // The queue does not grow forever: the sent messages leave it.
  private trimQueue(runtime: RuntimeSession): void {
    while (runtime.queue.length > MAX_QUEUE_ITEMS) {
      const index = runtime.queue.findIndex((item) => item.state === 'done');
      if (index === -1) {
        return;
      }
      runtime.queue.splice(index, 1);
    }
  }

  private postQueue(runtime: RuntimeSession): void {
    this.postFor(runtime, {
      type: 'queue',
      items: runtime.queue.map((item) => ({
        id: item.id,
        text: item.text,
        state: item.state,
        error: item.error
      }))
    });
  }

  // The next message of the queue goes out, one after another.
  private async pumpQueue(runtime: RuntimeSession): Promise<void> {
    if (runtime.busy || runtime.queuePaused) {
      return;
    }
    const next = runtime.queue.find((item) => item.state === 'waiting');
    if (!next) {
      return;
    }
    next.state = 'sending';
    this.postQueue(runtime);
    await this.runTurn(runtime, next.text, next.mentions, next.selections, next);
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
      if (message.role === 'assistant' && !message.approval) {
        message.elapsedMs = elapsed;
        this.postFor(runtime, {
          type: 'step_time',
          id: message.id,
          elapsedMs: elapsed
        });
        return;
      }
    }
  }

  // The chat rolls back to a message of the user. The message and every
  // message after it go away, the text of the request comes back to the
  // input field and the agent waits for the next command.
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
    const index = runtime.uiMessages.findIndex((message) => message.id === id);
    if (index === -1) {
      return;
    }
    const message = runtime.uiMessages[index]!;
    if (message.role !== 'user') {
      this.panel.post({
        type: 'notice',
        message: 'Only a request of the user can be taken back.',
        kind: 'warn'
      });
      return;
    }
    const turn = runtime.turns.find((item) => item.uiId === id);
    const text = turn?.text ?? message.text ?? '';
    const mentions = turn?.mentions ?? [];
    const selections = turn?.selections ?? [];
    // The history of the model is cut before the request, the next
    // request starts from the same state.
    this.cutHistoryBefore(runtime, turn, text);
    // The turns after this one go away with the messages.
    runtime.turns = runtime.turns.filter((item) => {
      const at = runtime.uiMessages.findIndex((entry) => entry.id === item.uiId);
      return at !== -1 && at < index;
    });
    runtime.uiMessages = runtime.uiMessages.slice(0, index);
    // The list of the tasks belongs to the turn that goes away, it goes
    // away with it.
    runtime.todos = [];
    this.panel.post({ type: 'todos', todos: runtime.todos });
    // The panel gets a copy, the chat grows right after this line.
    this.postHistory(runtime);
    // The request comes back to the input field, the agent waits.
    this.panel.post({ type: 'restore_input', text, mentions, selections });
    this.persist(runtime);
  }

  // The request runs again. The messages after it go away, the history
  // of the model is cut at the same place, so the answer of the model
  // starts from the same state.
  private async retryTurn(id: string): Promise<void> {
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
    this.cutHistoryBefore(runtime, turn, turn.text);
    runtime.uiMessages = runtime.uiMessages.slice(0, userIndex);
    // The list of the tasks belongs to the turn that goes away, it goes
    // away with it.
    runtime.todos = [];
    this.panel.post({ type: 'todos', todos: runtime.todos });
    // The panel gets a copy, the chat grows right after this line.
    this.postHistory(runtime);
    await this.handleSend(turn.text, turn.mentions, turn.selections);
  }

  // The history of the model loses the request and everything after it.
  private cutHistoryBefore(
    runtime: RuntimeSession,
    turn: TurnAnchor | undefined,
    text: string
  ): void {
    const hint = turn?.historyIndex;
    const found = findRequestIndex(runtime.history, text, hint);
    let cut = found;
    if (cut === -1) {
      // The request is not in the history any more, the place of the
      // anchor is the best guess.
      cut =
        hint !== undefined && hint >= 0
          ? Math.min(hint, runtime.history.length)
          : runtime.history.length;
    }
    // The cut must not split a call of a tool from its result, the model
    // would see a call without the answer and the API would refuse the
    // request.
    runtime.history = cutHistory(runtime.history, cut);
    runtime.agent?.setHistory(runtime.history);
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
      showToolSteps: settings.showToolSteps,
      maxRetries: settings.maxRetries,
      speechLanguage: settings.speechLanguage,
      microphone: settings.microphone,
      hasApiKey: Boolean(key),
      tools: this.registry.list().map((tool) => tool.name)
    };
    this.panel.post({ type: 'settings', settings: payload });
  }

  private async saveSettings(values: UiSettingsValues): Promise<void> {
    const config = vscode.workspace.getConfiguration('minimax');
    // The address of the API holds the key of the user, a wrong address is
    // refused and the rest of the settings is saved.
    let customBaseUrl = values.customBaseUrl;
    if (typeof customBaseUrl === 'string' && customBaseUrl.trim().length > 0) {
      const check = checkBaseUrl(customBaseUrl);
      if (!check.ok) {
        this.panel.post({
          type: 'error',
          message: 'The custom base URL is not accepted: ' + check.reason + '.'
        });
        customBaseUrl = '';
      }
    }
    const updates: Array<[string, unknown]> = [
      ['baseUrl', values.baseUrl],
      ['customBaseUrl', customBaseUrl],
      ['model', values.model],
      ['effort', values.effort],
      ['mode', values.mode],
      ['thinking', values.thinking],
      ['maxIterations', values.maxIterations],
      ['maxRetries', values.maxRetries],
      ['fontSize', values.fontSize],
      ['historyMaxMessages', values.historyMaxMessages],
      ['contextThreshold', values.contextThreshold],
      ['semanticSearch', values.semanticSearch],
      ['autoApprove', values.autoApprove],
      ['rulesEnabled', values.rulesEnabled],
      ['enableWebSearch', values.enableWebSearch],
      ['collapseTools', values.collapseTools],
      ['collapseCode', values.collapseCode],
      ['showToolSteps', values.showToolSteps],
      ['speechLanguage', values.speechLanguage],
      ['microphone', values.microphone]
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
    // The chat was deleted while its turn ran, the finished turn must not
    // write it back into the store.
    if (runtime.deleted) {
      return;
    }
    runtime.updatedAt = Date.now();
    // While the turn runs the messages of the panel and the history of the
    // model do not match. A saved state has to be a state the agent can
    // continue from, so the session waits for the end of the turn and only
    // the list of the tasks is written in the meantime.
    if (runtime.busy) {
      this.persistTodos(runtime);
      return;
    }
    const stored: StoredSession = {
      id: runtime.id,
      title: runtime.title,
      updatedAt: runtime.updatedAt,
      workspaceRoot: runtime.workspaceRoot,
      messages: runtime.history,
      uiMessages: runtime.uiMessages,
      usage: runtime.usage,
      turns: runtime.turns,
      todos: runtime.todos,
      goal: runtime.goal,
      // The queue of the chat, it survives the reload of the panel.
      queue: runtime.queue.map((item) => ({ ...item }))
    };
    // A full state of the host must not break the turn, the chat stays in
    // memory and the failure goes to the log.
    void this.store.save(stored, getSettings().historyMaxMessages).then((saved) => {
      if (!saved) {
        this.logger.error('the chat was not saved to the state of the host');
      } else if (this.activeSessionId === runtime.id) {
        // The id of the active session goes to the state of the host after
        // the session itself. A lonely id would point to nothing. The id
        // belongs to the project of the chat, every project keeps its own.
        this.store.setActiveIdFor(runtime.workspaceRoot, runtime.id);
      }
      this.panel.post({ type: 'sessions', sessions: this.store.summaryList() });
    });
  }

  // The list of the tasks is written at once. The session keeps the last
  // complete turn, so the state that comes back after a crash is a state the
  // agent can continue from.
  private persistTodos(runtime: RuntimeSession): void {
    const saved = this.store.get(runtime.id);
    const stored: StoredSession = {
      id: runtime.id,
      title: runtime.title,
      updatedAt: Date.now(),
      workspaceRoot: saved?.workspaceRoot ?? runtime.workspaceRoot,
      messages: saved?.messages ?? [],
      uiMessages: saved?.uiMessages ?? [],
      usage: saved?.usage ?? [],
      turns: saved?.turns ?? [],
      todos: runtime.todos,
      goal: runtime.goal,
      // The queue of памяти хозяина истина, в состоянии хоста она лежит
      // вместе с остальным чатом.
      queue: runtime.queue.map((item) => ({ ...item }))
    };
    void this.store.save(stored, getSettings().historyMaxMessages).then((ok) => {
      if (!ok) {
        this.logger.error('the list of tasks was not saved to the state of the host');
      }
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
      // A chat of an older version does not know its project, the project
      // that opens it takes it.
      workspaceRoot: stored.workspaceRoot ?? this.workspaceRoot(),
      history: [...stored.messages],
      uiMessages: [...(stored.uiMessages ?? [])],
      panelOffset: undefined,
      agent: undefined,
      busy: false,
      state: 'idle',
      deleted: false,
      errorReported: false,
      usage: (stored.usage ?? []).map((turn) => ({
        input: turn.input,
        output: turn.output,
        cache: turn.cache ?? 0
      })),
      turns: stored.turns ?? [],
      todos: [...(stored.todos ?? [])],
      goal: stored.goal
        ? { ...stored.goal, used: { ...stored.goal.used } }
        : undefined,
      turnStartedAt: 0,
      approvedTools: new Set(),
      // A message that was going out when the panel closed waits again.
      queue: (stored.queue ?? []).map((item) => ({
        ...item,
        state: item.state === 'sending' ? 'waiting' : item.state
      })),
      queuePaused: false,
      turnStopped: false,
      lastError: undefined
    };
  }

  startNewSession(): void {
    // The processes of the REPL are keyed by the chat, a new chat has a new
    // id and starts with no process of its own. The processes of the other
    // chats stay alive: starting a chat must not drop their state.
    const current = this.activeSession();
    if (current) {
      this.persist(current);
    }
    const id = this.nextId('s');
    this.sessions.set(id, {
      id,
      title: 'New chat',
      updatedAt: Date.now(),
      // A new chat belongs to the project that is open.
      workspaceRoot: this.workspaceRoot(),
      history: [],
      uiMessages: [],
      panelOffset: undefined,
      agent: undefined,
      busy: false,
      state: 'idle',
      deleted: false,
      errorReported: false,
      usage: [],
      turns: [],
      todos: [],
      goal: undefined,
      turnStartedAt: 0,
      approvedTools: new Set(),
      queue: [],
      queuePaused: false,
      turnStopped: false,
      lastError: undefined
    });
    this.activeSessionId = id;
    // The id of the new chat goes to the state of the host together with the
    // chat itself. A lonely id would point to nothing after a restart.
    this.setState('idle');
    void this.sendInit();
  }

  // The chat of the project is opened again after a restart, an empty panel
  // would hide the work of the previous session. Every project keeps its own
  // chat: the chats of another project stay in the list, they are not shown
  // by default.
  restoreSession(): void {
    const root = this.workspaceRoot();
    // The chats of an older version do not know their project, this one
    // takes them.
    const list = this.store.claimUnbound(root);
    const activeId = this.store.activeIdFor(root);
    const active = activeId ? list.find((session) => session.id === activeId) : undefined;
    // The chat that was open in the project, otherwise the newest chat of
    // the project. A chat of another project is not opened here.
    const stored =
      active && (active.workspaceRoot === root || active.workspaceRoot === undefined)
        ? active
        : list.find((session) => session.workspaceRoot === root);
    if (!stored) {
      // The project has no chats, a new one starts.
      this.startNewSession();
      return;
    }
    const runtime = this.runtimeFrom(stored);
    this.sessions.set(runtime.id, runtime);
    this.activeSessionId = runtime.id;
    this.store.setActiveIdFor(root, runtime.id);
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
    // The chat that is open belongs to the project of the panel, every
    // project remembers its own.
    this.store.setActiveIdFor(this.workspaceRoot(), id);
    // The opened chat brings its own state: a chat that runs in the
    // background is busy and its stop button has to stand in the field,
    // otherwise the busy chat looks idle and cannot be stopped.
    this.setState(runtime.state);
    this.postHistory(runtime);
    void this.sendInit();
  }

  private deleteSession(id: string): void {
    const runtime = this.sessions.get(id);
    if (runtime) {
      // A chat that still runs stops first: the tokens of a deleted chat
      // must not burn any further, and the finished turn must not write
      // the chat back into the store.
      runtime.deleted = true;
      if (runtime.busy) {
        runtime.agent?.stop();
      }
      // The cards of the chat go with it, they must not keep an owner of a
      // chat that is gone.
      for (const [approvalId, owner] of this.approvalOwner) {
        if (owner === id) {
          this.approvalOwner.delete(approvalId);
        }
      }
    }
    // The processes of the REPL of the chat go with it.
    stopReplSession(id);
    this.store.remove(id);
    // The removed chat is not the open one of any project.
    this.store.clearActiveId(id);
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
      this.activeSessionId = undefined;
      // The removed chat must not stay active, its id would point to nothing
      // after a restart.
      this.store.setActiveIdFor(this.workspaceRoot(), undefined);
      this.startNewSession();
      return;
    }
    void this.sendInit();
  }

  // The part of the history the panel holds. The host keeps the whole
  // history, the panel asks for the older part when the reader wants to
  // see it. A panel that has just loaded holds nothing of the chat, the
  // tail of the chat goes to it.
  private panelHistory(
    runtime: RuntimeSession | undefined,
    reset: boolean
  ): { messages: UiMessage[]; olderMessages: number } {
    if (!runtime) {
      return { messages: [], olderMessages: 0 };
    }
    if (!reset && runtime.panelOffset !== undefined) {
      const start = Math.max(
        0,
        Math.min(runtime.panelOffset, runtime.uiMessages.length)
      );
      return { messages: runtime.uiMessages.slice(start), olderMessages: start };
    }
    const tail = historyTail(runtime.uiMessages);
    runtime.panelOffset = tail.offset;
    return { messages: tail.messages, olderMessages: tail.offset };
  }

  // The chat of the panel goes to it in one part: the tail of the chat,
  // the older part waits in the host until the reader asks for it.
  private postHistory(runtime: RuntimeSession): void {
    const tail = historyTail(runtime.uiMessages);
    runtime.panelOffset = tail.offset;
    this.panel.post({
      type: 'session_loaded',
      messages: tail.messages,
      olderMessages: tail.offset
    });
  }

  // The panel asks for the older part of the chat. The host keeps it, the
  // panel gets one more part.
  private loadOlder(): void {
    const runtime = this.activeSession();
    if (!runtime) {
      return;
    }
    const page = historyPage(runtime.uiMessages, runtime.panelOffset ?? 0);
    runtime.panelOffset = page.offset;
    this.panel.post({
      type: 'history_older',
      messages: page.messages,
      olderMessages: page.offset
    });
  }

  private async sendInit(reset = false): Promise<void> {
    const settings = getSettings();
    const key = await getApiKey(this.context.secrets);
    const runtime = this.activeSession();
    // The history goes to the panel in parts: the panel holds the last part
    // of it, the older part waits for the request of the reader.
    const history = this.panelHistory(runtime, reset);
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
        tokens: this.usageTotal(runtime),
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
      const trimmed = url.trim();
      const check = checkBaseUrl(trimmed);
      if (!check.ok) {
        void vscode.window.showErrorMessage(
          'MiniMax: the endpoint is not accepted, ' + check.reason + '.'
        );
        return;
      }
      // The key of the user goes to this host, the address of MiniMax is the
      // usual one and another host is asked about.
      if (!isOfficialBaseUrlHost(check.host ?? '')) {
        const answer = await vscode.window.showWarningMessage(
          'MiniMax: the API key will go to ' +
            check.host +
            '. It is not the address of MiniMax.',
          { modal: true },
          'Use it'
        );
        if (answer !== 'Use it') {
          return;
        }
      }
      await config.update('customBaseUrl', trimmed, vscode.ConfigurationTarget.Global);
      await config.update('baseUrl', 'auto', vscode.ConfigurationTarget.Global);
    } else {
      await config.update('baseUrl', choice.value, vscode.ConfigurationTarget.Global);
    }
    await this.sendInit();
  }

  // The address of the API can be wrong in the settings of the user, the
  // official endpoint is used then and the user is told about it.
  private warnAboutTheBaseUrl(): void {
    const custom = getSettings().customBaseUrl.trim();
    if (custom.length === 0) {
      return;
    }
    const check = checkBaseUrl(custom);
    if (check.ok) {
      return;
    }
    this.logger.error('the custom base URL is not accepted: ' + check.reason);
    void vscode.window.showWarningMessage(
      'MiniMax: the custom base URL is not accepted, ' +
        check.reason +
        '. The official endpoint is used.'
    );
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

// The answer of the child is the text of its last message.
function finalText(messages: AnthropicMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== 'assistant') {
      continue;
    }
    const parts = message.content.flatMap((block) =>
      block.type === 'text' ? [block.text] : []
    );
    const text = parts.join('\n').trim();
    if (text.length > 0) {
      return text;
    }
  }
  return '';
}
