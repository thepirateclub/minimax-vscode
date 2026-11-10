import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExtToWeb,
  UiMessage,
  UiSelection,
  UiSettings,
  UiState,
  UiSuggestion,
  WebToExt
} from '../protocol';
import { Composer, type InsertRequest } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { Header, type PanelTab } from './components/Header';
import { MessageList } from './components/MessageList';
import { SettingsView } from './components/SettingsView';
import { appendNotice } from './notices';
import { STRINGS } from './strings';

interface VsCodeApi {
  postMessage(message: WebToExt): void;
}

const EMPTY_STATE: UiState = {
  sessions: [],
  activeSessionId: undefined,
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
  version: ''
};

export function App({ vscode }: { vscode: VsCodeApi }) {
  const [state, setState] = useState<UiState>(EMPTY_STATE);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [selections, setSelections] = useState<UiSelection[]>([]);
  const [suggestions, setSuggestions] = useState<UiSuggestion[]>([]);
  const [settings, setSettings] = useState<UiSettings | undefined>(undefined);
  const [tab, setTab] = useState<PanelTab>('chat');
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [insert, setInsert] = useState<InsertRequest | undefined>(undefined);
  const insertToken = useRef(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtToWeb>): void => {
      const message = event.data;

      if (message.type === 'init') {
        setState(message.state);
        setMessages(message.state.messages);
        return;
      }
      if (message.type === 'user_message') {
        setMessages((prev) => [...prev, { id: message.id, role: 'user', text: message.text }]);
        return;
      }
      if (message.type === 'assistant_start') {
        setMessages((prev) => [...prev, { id: message.id, role: 'assistant', text: '' }]);
        return;
      }
      if (message.type === 'text_delta') {
        setMessages((prev) => appendToAssistant(prev, 'text', message.text));
        return;
      }
      if (message.type === 'thinking_delta') {
        setMessages((prev) => appendToAssistant(prev, 'thinking', message.text));
        return;
      }
      if (message.type === 'tool_start') {
        setMessages((prev) => [
          ...prev,
          {
            id: message.id,
            role: 'tool',
            tool: { id: message.id, name: message.name, input: message.input, running: true }
          }
        ]);
        return;
      }
      if (message.type === 'tool_end') {
        setMessages((prev) =>
          prev.map((item) =>
            item.tool && item.tool.id === message.id
              ? {
                  ...item,
                  tool: {
                    ...item.tool,
                    content: message.content,
                    isError: message.isError,
                    running: false,
                    diff: message.diff
                  }
                }
              : item
          )
        );
        return;
      }
      if (message.type === 'approval_request') {
        setMessages((prev) => [
          ...prev,
          { id: 'approval-' + message.approval.id, role: 'assistant', approval: message.approval }
        ]);
        return;
      }
      if (message.type === 'approval_resolved') {
        setMessages((prev) => prev.filter((item) => item.approval?.id !== message.id));
        return;
      }
      if (message.type === 'status') {
        setState((prev) => ({
          ...prev,
          state: message.state,
          tokens: message.tokens ?? prev.tokens
        }));
        return;
      }
      if (message.type === 'theme') {
        setState((prev) => ({ ...prev, theme: message.kind }));
        return;
      }
      if (message.type === 'usage') {
        setState((prev) => ({ ...prev, usage: message.turns }));
        return;
      }
      if (message.type === 'session_loaded') {
        setMessages(message.messages);
        return;
      }
      if (message.type === 'sessions') {
        setState((prev) => ({ ...prev, sessions: message.sessions }));
        return;
      }
      if (message.type === 'models') {
        setState((prev) => ({ ...prev, models: message.models, model: message.selected }));
        return;
      }
      if (message.type === 'files') {
        requestInsert(message.files.map((file) => file.path));
        return;
      }
      if (message.type === 'mention') {
        requestInsert([message.path]);
        return;
      }
      if (message.type === 'selection') {
        setSelections((prev) =>
          prev.some((item) => item.id === message.selection.id)
            ? prev
            : [...prev, message.selection]
        );
        setTab('chat');
        setFocusToken((value) => value + 1);
        return;
      }
      if (message.type === 'suggestions') {
        setSuggestions(message.items);
        return;
      }
      if (message.type === 'settings') {
        setSettings(message.settings);
        return;
      }
      if (message.type === 'error') {
        setMessages((prev) => appendNotice(prev, message.message, 'error-' + Date.now()));
      }
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);

  // The palette of the code blocks follows the theme of the host.
  useEffect(() => {
    const body = document.body;
    for (const kind of ['light', 'dark', 'high-contrast', 'high-contrast-light']) {
      body.classList.remove('mm-theme-' + kind);
    }
    body.classList.add('mm-theme-' + state.theme);
  }, [state.theme]);

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
      setSuggestions([]);
      return;
    }
    vscode.postMessage({ type: 'request_suggestions', requestId: 'suggestions', prefix });
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
        hasApiKey={state.hasApiKey}
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onSelectSession={(id) => vscode.postMessage({ type: 'select_session', id })}
        onDeleteSession={(id) => vscode.postMessage({ type: 'delete_session', id })}
        onNewChat={() => vscode.postMessage({ type: 'new_session' })}
        version={state.version}
      />
      <div className={'view' + (tab === 'chat' ? '' : ' view-hidden')}>
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <MessageList
            messages={messages}
            collapseTools={state.collapseTools}
            collapseCode={state.collapseCode}
            onApprove={approve}
            onReject={reject}
            onOpenFile={openFile}
          />
        )}
        <Composer
          busy={busy}
          selections={selections}
          focusToken={focusToken}
          resetToken={resetToken}
          suggestions={suggestions}
          insert={insert}
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
            vscode.postMessage({
              type: 'send',
              text: sent,
              mentions,
              selections: sentSelections
            });
            setResetToken((value) => value + 1);
            setSelections([]);
          }}
          onStop={() => vscode.postMessage({ type: 'stop' })}
          onPickFiles={() => vscode.postMessage({ type: 'pick_files', requestId: 'attach' })}
          onRemoveSelection={(id) =>
            setSelections((prev) => prev.filter((item) => item.id !== id))
          }
          onSuggest={suggest}
        />
      </div>
      <div className={'view' + (tab === 'settings' ? '' : ' view-hidden')}>
        {settings ? (
          <SettingsView
            settings={settings}
            onSave={(values) => vscode.postMessage({ type: 'save_settings', values })}
            onSetApiKey={(key) => vscode.postMessage({ type: 'set_api_key', key })}
            onClearApiKey={() => vscode.postMessage({ type: 'clear_api_key' })}
          />
        ) : (
          <div className="empty">{STRINGS.loading}</div>
        )}
      </div>
    </div>
  );
}

function appendToAssistant(
  messages: UiMessage[],
  field: 'text' | 'thinking',
  delta: string
): UiMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i]!;
    if (item.role === 'assistant' && !item.approval) {
      next[i] = { ...item, [field]: (item[field] ?? '') + delta };
      return next;
    }
  }
  next.push({ id: 'assistant-' + Date.now(), role: 'assistant', [field]: delta });
  return next;
}
