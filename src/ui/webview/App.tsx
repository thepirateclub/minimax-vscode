import { useEffect, useRef, useState } from 'react';
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
import { Header, type PanelTab } from './components/Header';
import { MessageList } from './components/MessageList';
import { SettingsView } from './components/SettingsView';
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
  state: 'idle',
  tokens: 0,
  hasApiKey: false
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
                  tool: { ...item.tool, content: message.content, isError: message.isError, running: false }
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
        setMessages((prev) => [
          ...prev,
          { id: 'error-' + Date.now(), role: 'assistant', text: message.message }
        ]);
      }
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);

  const busy = state.state !== 'idle' && state.state !== 'error';

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
        hasApiKey={state.hasApiKey}
        onNewChat={() => vscode.postMessage({ type: 'new_session' })}
      />
      <div className={'view' + (tab === 'chat' ? '' : ' view-hidden')}>
        {messages.length === 0 ? (
          <div className="empty">{STRINGS.empty}</div>
        ) : (
          <MessageList
            messages={messages}
            onApprove={(id, allowForSession) =>
              vscode.postMessage({ type: 'approve', id, allowForSession })
            }
            onReject={(id) => vscode.postMessage({ type: 'reject', id })}
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
          onModel={(model) => vscode.postMessage({ type: 'set_model', model })}
          onEffort={(effort) => vscode.postMessage({ type: 'set_effort', effort })}
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
