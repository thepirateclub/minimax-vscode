import { useLinkClicks } from './components/linkClicks';
import { dropSuggestions, nextSuggestionId } from './suggestRequest';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanelMessages } from './usePanelMessages';
import type { GoalState, TodoItem } from '../../agent/state';
import type {
  UiChangedFile,
  UiMessage,
  UiQueuedMessage,
  UiSelection,
  UiSettings,
  UiState,
  UiSuggestion,
  UiRetryStatus,
  WebToExt,
  VoiceState
} from '../protocol';
import {
  Composer,
  type DictationRequest,
  type InsertRequest,
  type RestoreRequest
} from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { GoalBar, type GoalValues, type GoalWizardRequest } from './components/GoalBar';
import { parseSlashCommand } from './slashCommand';
import { DEFAULT_GOAL_FORM } from './goalWizard';
import { goalFormValues, parseGoalForm } from './components/GoalBar';
import { Header, type PanelTab } from './components/Header';
import { MessageList } from './components/MessageList';
import { SummaryBar } from './components/SummaryBar';
import { SettingsView } from './components/SettingsView';
import { SettingsTabs } from './components/settings/SettingsTabs';
import { useExtras } from './useExtras';
import { TaskList } from './components/TaskList';
import { STRINGS } from './strings';

interface VsCodeApi {
  postMessage(message: WebToExt): void;
}

const EMPTY_STATE: UiState = {
  sessions: [],
  activeSessionId: undefined,
  workspaceRoot: '',
  workspaceLabel: '',
  messages: [],
  model: 'MiniMax-M3.1-Flash',
  models: [],
  effort: 'max',
  mode: 'code',
  thinking: false,
  state: 'idle',
  tokens: 0,
  usage: [],
  hasApiKey: false,
  theme: 'dark',
  fontSize: 13,
  collapseTools: false,
  collapseCode: false,
  showToolSteps: false,
  summary: [],
  version: '',
  todos: [],
  queue: [],
  olderMessages: 0
};

export function App({ vscode }: { vscode: VsCodeApi }) {
  const [state, setState] = useState<UiState>(EMPTY_STATE);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  // How many messages of the chat wait in the host. The panel asks for
  // them when the reader wants to see the older part of the chat.
  const [olderMessages, setOlderMessages] = useState(0);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // The files that the last action changed, the panel shows them under the
  // feed.
  const [summary, setSummary] = useState<UiChangedFile[]>([]);
  const [goal, setGoal] = useState<GoalState | undefined>(undefined);
  // The command /goal without a text opens the wizard of the goal.
  // The input field takes the goal instead of a request.
  const [goalMode, setGoalMode] = useState(false);
  const [goalRequest, setGoalRequest] = useState<GoalWizardRequest | undefined>(undefined);
  const [selections, setSelections] = useState<UiSelection[]>([]);
  const [suggestions, setSuggestions] = useState<UiSuggestion[]>([]);
  const [settings, setSettings] = useState<UiSettings | undefined>(undefined);
  const [tab, setTab] = useState<PanelTab>('chat');
  const extras = useExtras(vscode);
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [insert, setInsert] = useState<InsertRequest | undefined>(undefined);
  const insertToken = useRef(0);
  const [restore, setRestore] = useState<RestoreRequest | undefined>(undefined);
  const restoreToken = useRef(0);
  const [voice, setVoice] = useState<VoiceState>('idle');
  const [dictation, setDictation] = useState<DictationRequest | undefined>(undefined);
  const dictationToken = useRef(0);
  // The connection to MiniMax is lost, the request is repeated. The panel
  // shows the attempt.
  const [retryStatus, setRetryStatus] = useState<UiRetryStatus | undefined>(undefined);
  // The feed goes to the end of the history: the chat was replaced or
  // the request runs again. The flag lives in the app, the feed is built
  // from scratch when the history goes away.
  const [followEnd, setFollowEnd] = useState(false);
  // The queue of the messages of the chat.
  const [queue, setQueue] = useState<UiQueuedMessage[]>([]);

  usePanelMessages(
    {
      setState,
      setMessages,
      setTodos,
      setGoal,
      setOlderMessages,
      setSelections,
      setSuggestions,
      setSettings,
      setDictation,
      setRetryStatus,
      setFollowEnd,
      setQueue,
      setRestore,
      setVoice,
      setSummary,
      setTab,
      requestInsert,
      setFocusToken,
      insertToken,
      restoreToken,
      dictationToken
    },
    vscode
  );

  // The palette of the code blocks follows the theme of the host.
  useEffect(() => {
    const body = document.body;
    for (const kind of ['light', 'dark', 'high-contrast', 'high-contrast-light']) {
      body.classList.remove('mm-theme-' + kind);
    }
    body.classList.add('mm-theme-' + state.theme);
  }, [state.theme]);

  // A link of an answer goes to the host: the webview cannot navigate.
  useLinkClicks(vscode);

  // The size of the font of the panel comes from the settings of the host.
  useEffect(() => {
    document.body.style.setProperty('--mm-font-base', state.fontSize + 'px');
  }, [state.fontSize]);

  const busy = state.state !== 'idle' && state.state !== 'error';

  // The handlers keep their identity, the rows of the chat are not redrawn
  // when the answer of the model grows.
  const approve = useCallback(
    (id: string, allowForSession: boolean) => {
      vscode.postMessage({ type: 'approve', id, allowForSession });
    },
    [vscode]
  );

  const openFile = useCallback(
    (path: string, line?: number) => {
      vscode.postMessage({ type: 'open_file', path, line });
    },
    [vscode]
  );

  const reject = useCallback(
    (id: string) => {
      vscode.postMessage({ type: 'reject', id });
    },
    [vscode]
  );

  const openTab = (next: PanelTab): void => {
    setTab(next);
    if (next === 'settings') {
      vscode.postMessage({ type: 'request_settings' });
    }
  };

  const suggest = (prefix: string | undefined): void => {
    if (prefix === undefined) {
      dropSuggestions();
      setSuggestions([]);
      return;
    }
    vscode.postMessage({ type: 'request_suggestions', requestId: nextSuggestionId(), prefix });
  };

  // A file reference lives in the input field as "@path", so the user can
  // point at the file in the middle of the sentence.
  function requestInsert(paths: string[]): void {
    if (paths.length === 0) {
      return;
    }
    insertToken.current += 1;
    setInsert({ paths, token: insertToken.current });
    setTab('chat');
    setFocusToken((value) => value + 1);
  }

  return (
    <div className="app">
      <Header
        tab={tab}
        onTab={openTab}
        state={state.state}
        tokens={state.tokens}
        usage={state.usage}
        quota={state.quota}
        hasApiKey={state.hasApiKey}
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        workspaceRoot={state.workspaceRoot}
        workspaceLabel={state.workspaceLabel}
        onSelectSession={(id) => vscode.postMessage({ type: 'select_session', id })}
        onDeleteSession={(id) => vscode.postMessage({ type: 'delete_session', id })}
        onSearchSessions={(query) => vscode.postMessage({ type: 'search_sessions', query })}
        onNewChat={() => vscode.postMessage({ type: 'new_session' })}
        version={state.version}
      />
      <div className={'view' + (tab === 'chat' ? '' : ' view-hidden')}>
        <TaskList todos={todos} onClear={() => vscode.postMessage({ type: 'clear_todos' })} />
        <GoalBar
          // The key of the chat, the form of the goal does not survive a
          // switch to another chat, otherwise it writes the goal of the
          // old chat into the new one.
          key={state.activeSessionId ?? 'none'}
          goal={goal}
          request={goalRequest}
          onSet={(values: GoalValues) =>
            vscode.postMessage({
              type: 'set_goal',
              objective: values.objective,
              tokenBudget: values.tokenBudget,
              requestLimit: values.requestLimit,
              secondsLimit: values.secondsLimit
            })
          }
          onClear={() => vscode.postMessage({ type: 'clear_goal' })}
        />
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <MessageList
            messages={messages}
            olderMessages={olderMessages}
            onLoadOlder={() => vscode.postMessage({ type: 'load_older' })}
            collapseTools={state.collapseTools}
            collapseCode={state.collapseCode}
            showToolSteps={state.showToolSteps}
            onApprove={approve}
            onReject={reject}
            onOpenFile={openFile}
            onRetry={(id) => {
              // The reader asked for a new turn: the feed shows the end of
              // the history and follows the turn.
              setFollowEnd(true);
              vscode.postMessage({ type: 'retry', id });
            }}
            onRewind={(id) => vscode.postMessage({ type: 'rewind', id })}
            followEnd={followEnd}
            onFollowEnd={() => setFollowEnd(false)}
          />
        )}
        <SummaryBar
          files={summary}
          onOpenFile={(path) => vscode.postMessage({ type: 'open_file', path })}
          onClear={() => {
            setSummary([]);
            vscode.postMessage({ type: 'clear_summary' });
          }}
        />
        <Composer
          skills={extras.skills}
          busy={busy}
          selections={selections}
          focusToken={focusToken}
          resetToken={resetToken}
          suggestions={suggestions}
          insert={insert}
          restore={restore}
          onInsertHandled={() => setInsert(undefined)}
          models={state.models}
          model={state.model}
          effort={state.effort}
          mode={state.mode}
          thinking={state.thinking}
          onModel={(model) => vscode.postMessage({ type: 'set_model', model })}
          onEffort={(effort) => vscode.postMessage({ type: 'set_effort', effort })}
          onMode={(mode) => vscode.postMessage({ type: 'set_mode', mode })}
          onThinking={(thinking) => vscode.postMessage({ type: 'set_thinking', thinking })}
          onSend={(sent, mentions, sentSelections) => {
            // A command of the panel never reaches the model. The field of
            // the goal works as the command with the text of the field.
            const command = goalMode
              ? { kind: 'goal' as const, objective: sent.replace(/\s+/g, ' ').trim() }
              : parseSlashCommand(sent);
            setGoalMode(false);
            if (command?.kind === 'goal') {
              if (command.objective.length === 0) {
                setGoalRequest((prev) => ({ token: (prev?.token ?? 0) + 1, objective: '' }));
              } else {
                // "/goal text" takes the default limits, the wizard is for
                // the user who wants to set them.
                // The same objective keeps its limits: the command must not
                // take away the limits the user set in the wizard.
                const values = parseGoalForm(
                  goal && goal.objective === command.objective
                    ? goalFormValues(goal)
                    : { ...DEFAULT_GOAL_FORM, objective: command.objective }
                ).values;
                if (values) {
                  vscode.postMessage({ type: 'set_goal', ...values });
                }
              }
              setResetToken((value) => value + 1);
              return;
            }
            vscode.postMessage({
              type: 'send',
              text: sent,
              mentions,
              selections: sentSelections
            });
            setResetToken((value) => value + 1);
            setSelections([]);
          }}
          goalMode={goalMode}
          onGoalMode={setGoalMode}
          onStop={() => vscode.postMessage({ type: 'stop' })}
          onPickFiles={() => vscode.postMessage({ type: 'pick_files', requestId: 'attach' })}
          onPasteImage={(name, dataUrl) => vscode.postMessage({ type: 'paste_image', name, dataUrl })}
          onRemoveSelection={(id) =>
            setSelections((prev) => prev.filter((item) => item.id !== id))
          }
          onSuggest={suggest}
          voice={voice}
          dictation={dictation}
          retryStatus={retryStatus}
          queue={queue}
          onSendQueued={(id) => vscode.postMessage({ type: 'send_queued', id })}
          onSendAllQueued={() => vscode.postMessage({ type: 'send_all_queued' })}
          onRemoveQueued={(id) => vscode.postMessage({ type: 'remove_queued', id })}
          onVoiceStart={() => vscode.postMessage({ type: 'voice_start' })}
          onVoiceStop={() => vscode.postMessage({ type: 'voice_stop' })}
        />
      </div>
      <div className={'view' + (tab === 'settings' ? '' : ' view-hidden')}>
        {settings ? (
          <SettingsTabs
            general={
              <SettingsView
                settings={settings}
                onSave={(values) => vscode.postMessage({ type: 'save_settings', values })}
                onSetApiKey={(key) => vscode.postMessage({ type: 'set_api_key', key })}
                onClearApiKey={() => vscode.postMessage({ type: 'clear_api_key' })}
              />
            }
            skills={extras.skills}
            servers={extras.servers}
            onOpenSkill={(name) => vscode.postMessage({ type: 'open_skill', name })}
            onRefresh={extras.refresh}
            onAddServer={(server) => vscode.postMessage({ type: 'mcp_add', ...server })}
            onRemoveServer={(name) => vscode.postMessage({ type: 'mcp_remove', name })}
            onRestartMcp={() => vscode.postMessage({ type: 'mcp_restart' })}
            onOpenSettings={() => vscode.postMessage({ type: 'mcp_open_settings' })}
          />
        ) : (
          <div className="empty">{STRINGS.loading}</div>
        )}
      </div>
    </div>
  );
}

// The piece of the broken answer goes away, the last answer of the model
// is empty until the request comes again.
