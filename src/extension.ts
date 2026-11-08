import { unlink, writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { HttpMiniMaxClient } from './api/client';
import type { AnthropicMessage, EffortLevel } from './api/types';
import type { AgentEvent } from './agent/agent';
import { buildWorkspaceSnapshot, renderSnapshot } from './agent/context';
import { buildSystemPrompt } from './agent/prompt';
import { AgentSession } from './agent/session';
import { MODELS, resolveBaseUrl } from './config/models';
import {
  clearApiKey as clearStoredApiKey,
  getApiKey,
  setApiKey
} from './config/secrets';
import { getSettings, onSettingsChanged } from './config/settings';
import { createLogger, type Logger } from './logger';
import { InMemoryBackupStore } from './storage/backups';
import { SessionStore, type StoredSession } from './storage/sessions';
import { createExploreTools } from './tools/explore';
import { createFileTools } from './tools/fs';
import { ToolRegistry } from './tools/registry';
import { createTerminalTools } from './tools/terminal';
import { AgentPanelProvider } from './ui/panel';
import type { AgentState, UiMessage, WebToExt } from './ui/protocol';
import { StatusBarController } from './ui/statusbar';

interface RuntimeSession {
  id: string;
  title: string;
  updatedAt: number;
  history: AnthropicMessage[];
  uiMessages: UiMessage[];
  agent: AgentSession | undefined;
  busy: boolean;
  errorReported: boolean;
}

const TITLE_LIMIT = 60;

class MiniMaxController {
  private readonly context: vscode.ExtensionContext;
  private readonly channel: vscode.OutputChannel;
  private readonly logger: Logger;
  private readonly backups = new InMemoryBackupStore();
  private readonly registry = new ToolRegistry();
  private readonly store: SessionStore;
  private readonly panel: AgentPanelProvider;
  private readonly statusBar = new StatusBarController();
  private readonly sessions = new Map<string, RuntimeSession>();
  private activeSessionId: string | undefined;
  private agentState: AgentState = 'idle';
  private tokens = 0;
  private counter = 0;

  constructor(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    this.context = context;
    this.channel = channel;
    this.logger = createLogger(channel);
    this.store = new SessionStore(context.globalState);
    this.panel = new AgentPanelProvider({
      extensionUri: context.extensionUri,
      onMessage: (message) => {
        void this.handleWebviewMessage(message);
      }
    });

    for (const tool of [
      ...createFileTools({ backups: this.backups }),
      ...createExploreTools(),
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
      vscode.commands.registerCommand('minimax.undoLastChange', () => void this.undoLastChange())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.refreshContext', () => void this.refreshContext())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.showLogs', () => this.showLogs())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('minimax.clearApiKey', () => void this.clearApiKey())
    );

    context.subscriptions.push(
      onSettingsChanged(() => {
        this.applySettings();
        void this.sendInit();
      })
    );
    context.subscriptions.push(this.statusBar);
  }

  private showLogs(): void {
    this.channel.show(true);
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

    return buildSystemPrompt({
      workspaceRoot: root,
      os: process.platform,
      shell: process.platform === 'win32' ? 'powershell' : 'bash',
      rulesText: settings.rulesEnabled ? renderSnapshot(snapshot) : '',
      treeText: snapshot.tree.join('\n'),
      stackText: snapshot.stack.join(', '),
      openFilesText: snapshot.openFiles.map((file) => file.path).join(', ')
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
    const agent = new AgentSession({
      client: new HttpMiniMaxClient({
        baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
        apiKey: key
      }),
      registry: this.registry,
      model: settings.model,
      maxTokens: settings.maxTokens,
      maxIterations: settings.maxIterations,
      effort: settings.effort,
      systemPrompt: await this.buildPrompt(),
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
      for (const message of runtime.uiMessages) {
        if (message.tool && message.tool.id === event.id) {
          message.tool.content = event.content;
          message.tool.isError = event.isError;
          message.tool.running = false;
        }
      }
      this.panel.post({
        type: 'tool_end',
        id: event.id,
        name: event.name,
        content: event.content,
        isError: event.isError
      });
      return;
    }
    if (event.type === 'approval_resolved') {
      return;
    }
    if (event.type === 'done') {
      this.tokens = event.usage.outputTokens;
      this.setState('idle');
      return;
    }
    if (event.type === 'error') {
      runtime.errorReported = true;
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
    this.statusBar.setState(state, this.tokens);
    this.panel.post({ type: 'status', state, tokens: this.tokens });
  }

  private async handleWebviewMessage(message: WebToExt): Promise<void> {
    if (message.type === 'ready') {
      await this.sendInit();
      return;
    }
    if (message.type === 'send') {
      await this.handleSend(message.text, message.mentions);
      return;
    }
    if (message.type === 'stop') {
      this.activeSession()?.agent?.stop();
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
  }

  private async handleSend(text: string, mentions: string[]): Promise<void> {
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

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'MiniMax is working',
          cancellable: true
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => agent.stop());
          await agent.send(text, mentions);
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
      this.persist(runtime);
    }
  }

  private persist(runtime: RuntimeSession): void {
    runtime.updatedAt = Date.now();
    const stored: StoredSession = {
      id: runtime.id,
      title: runtime.title,
      updatedAt: runtime.updatedAt,
      messages: runtime.history,
      uiMessages: runtime.uiMessages
    };
    this.store.save(stored);
    this.panel.post({ type: 'sessions', sessions: this.store.summaryList() });
  }

  startNewSession(): void {
    const id = 's-' + Date.now().toString(36);
    this.sessions.set(id, {
      id,
      title: 'New chat',
      updatedAt: Date.now(),
      history: [],
      uiMessages: [],
      agent: undefined,
      busy: false,
      errorReported: false
    });
    this.activeSessionId = id;
    this.setState('idle');
    void this.sendInit();
  }

  private selectSession(id: string): void {
    const stored = this.store.get(id);
    if (!stored) {
      return;
    }
    let runtime = this.sessions.get(id);
    if (!runtime) {
      runtime = {
        id,
        title: stored.title,
        updatedAt: stored.updatedAt,
        history: [...stored.messages],
        uiMessages: [...(stored.uiMessages ?? [])],
        agent: undefined,
        busy: false,
        errorReported: false
      };
      this.sessions.set(id, runtime);
    }
    this.activeSessionId = id;
    this.panel.post({ type: 'session_loaded', messages: runtime.uiMessages });
    void this.sendInit();
  }

  private deleteSession(id: string): void {
    this.store.remove(id);
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
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
        state: this.agentState,
        tokens: this.tokens,
        hasApiKey: Boolean(key)
      }
    });
  }

  private applySettings(): void {
    const settings = getSettings();
    for (const runtime of this.sessions.values()) {
      if (runtime.busy) {
        runtime.agent?.setAutoApprove(settings.autoApprove);
        continue;
      }
      runtime.agent = undefined;
    }
  }

  private async updateSetting(key: string, value: string): Promise<void> {
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
  controller.startNewSession();
}

export function deactivate(): void {
  controller = undefined;
}
