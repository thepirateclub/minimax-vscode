import { isLatestSuggestion } from './suggestRequest';
import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GoalState, TodoItem } from '../../agent/state';
import type {
  ExtToWeb,
  UiMessage,
  UiChangedFile,
  UiQueuedMessage,
  UiRetryStatus,
  UiSelection,
  UiSettings,
  UiState,
  UiSuggestion,
  VoiceState,
  WebToExt
} from '../protocol';
import { DeltaBatch } from './deltaBatch';
import { endTool } from './toolCard';
import { appendNotice } from './notices';
import { messageId } from './messageId';
import type { DictationRequest, RestoreRequest } from './components/Composer';
import type { PanelTab } from './components/Header';

// The messages of the host arrive one by one. The handler lives in a hook
// of its own, the app is the shell of the panel and the messages are the
// life of it.
export interface PanelContext {
  setState: Dispatch<SetStateAction<UiState>>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  setGoal: Dispatch<SetStateAction<GoalState | undefined>>;
  setOlderMessages: Dispatch<SetStateAction<number>>;
  setSelections: Dispatch<SetStateAction<UiSelection[]>>;
  setSuggestions: Dispatch<SetStateAction<UiSuggestion[]>>;
  setSettings: Dispatch<SetStateAction<UiSettings | undefined>>;
  setDictation: Dispatch<SetStateAction<DictationRequest | undefined>>;
  setRetryStatus: Dispatch<SetStateAction<UiRetryStatus | undefined>>;
  setFollowEnd: Dispatch<SetStateAction<boolean>>;
  setQueue: Dispatch<SetStateAction<UiQueuedMessage[]>>;
  setRestore: Dispatch<SetStateAction<RestoreRequest | undefined>>;
  setVoice: Dispatch<SetStateAction<VoiceState>>;
  setSummary: Dispatch<SetStateAction<UiChangedFile[]>>;
  setTab: Dispatch<SetStateAction<PanelTab>>;
  requestInsert: (paths: string[]) => void;
  setFocusToken: Dispatch<SetStateAction<number>>;
  insertToken: MutableRefObject<number>;
  restoreToken: MutableRefObject<number>;
  dictationToken: MutableRefObject<number>;
}

export function usePanelMessages(
  ctx: PanelContext,
  vscode: { postMessage(message: WebToExt): void }
): void {
  const {
    setState, setMessages, setTodos, setGoal, setOlderMessages, setSelections,
    setSuggestions, setSettings, setDictation, setRetryStatus, setFollowEnd,
    setQueue, setRestore, setVoice, setSummary, setTab,
    requestInsert, setFocusToken, restoreToken,
    dictationToken
  } = ctx;
  useEffect(() => {
    // The deltas of the answer wait in a batch and go to the panel in one
    // piece: the redraw of the whole answer for every token is quadratic.
    // Every other event flushes the batch first, the order of the events
    // stays the order they came in.
    const batch = new DeltaBatch({
      onFlush: (text, thinking) => {
        setMessages((prev) => {
          const next = text.length > 0 ? appendToAssistant(prev, 'text', text) : prev;
          return thinking.length > 0
            ? appendToAssistant(next, 'thinking', thinking)
            : next;
        });
      }
    });

    const onMessage = (event: MessageEvent<ExtToWeb>): void => {
      const message = event.data;

      if (message.type === 'text_delta') {
        batch.pushText(message.text);
        return;
      }
      if (message.type === 'thinking_delta') {
        batch.pushThinking(message.text);
        return;
      }
      // The piece of a broken answer goes away, the text that waits in the
      // batch goes away with it.
      if (message.type === 'assistant_reset') {
        batch.clear();
      } else {
        batch.flush();
      }

      if (message.type === 'init') {
        setState(message.state);
        setMessages(message.state.messages);
        setOlderMessages(message.state.olderMessages ?? 0);
        setTodos(message.state.todos);
        setGoal(message.state.goal);
        setSummary(message.state.summary ?? []);
        setQueue(message.state.queue ?? []);
        return;
      }
      if (message.type === 'user_message') {
        setMessages((prev) => [...prev, { id: message.id, role: 'user', text: message.text, at: message.at }]);
        return;
      }
      if (message.type === 'assistant_start') {
        setMessages((prev) => [...prev, { id: message.id, role: 'assistant', text: '', at: message.at }]);
        return;
      }
      if (message.type === 'tool_start') {
        setMessages((prev) => [
          ...prev,
          {
            id: message.id,
            role: 'tool',
            tool: { id: message.id, name: message.name, input: message.input, running: true },
            at: message.at
          }
        ]);
        return;
      }
      if (message.type === 'tool_end') {
        // The result of the call goes into the last card with that id: the
        // same id of a tool call can come back in a later turn, the card of
        // the earlier turn keeps its own result.
        setMessages((prev) => endTool(prev, message));
        return;
      }
      if (message.type === 'tool_progress') {
        // The journal of the action goes to the last card with that id:
        // the same id of a tool call can come back in a later turn.
        setMessages((prev) => appendProgress(prev, message.id, message.line));
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
      if (message.type === 'retry_status') {
        setRetryStatus(message.status);
        return;
      }
      if (message.type === 'queue') {
        setQueue(message.items);
        return;
      }
      if (message.type === 'assistant_reset') {
        // The answer broke in the middle, the piece goes away: the request
        // runs again and the new text takes its place.
        setMessages((prev) => resetAssistant(prev));
        return;
      }
      if (message.type === 'theme') {
        setState((prev) => ({ ...prev, theme: message.kind }));
        return;
      }
      if (message.type === 'quota') {
        setState((prev) => ({ ...prev, quota: message.quota }));
        return;
      }
      if (message.type === 'usage') {
        setState((prev) => ({ ...prev, usage: message.turns }));
        return;
      }
      if (message.type === 'todos') {
        setTodos(message.todos);
        return;
      }
      if (message.type === 'goal') {
        setGoal(message.goal);
        return;
      }
      if (message.type === 'summary') {
        setSummary(message.files);
        return;
      }
      if (message.type === 'session_loaded') {
        // The host replaced the history of the chat: another chat was
        // opened, or the request runs again and the messages of the failed
        // turn went away. The feed shows the end of the history.
        setFollowEnd(true);
        setMessages(message.messages);
        setOlderMessages(message.olderMessages ?? 0);
        return;
      }
      if (message.type === 'history_older') {
        // The older part of the chat comes in front of the messages the
        // panel holds.
        setMessages((prev) => [...message.messages, ...prev]);
        setOlderMessages(message.olderMessages);
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
        if (isLatestSuggestion(message.requestId)) {
          setSuggestions(message.items);
        }
        return;
      }
      if (message.type === 'settings') {
        setSettings(message.settings);
        return;
      }
      if (message.type === 'error') {
        setMessages((prev) => appendNotice(prev, message.message, messageId('error')));
        return;
      }
      if (message.type === 'notice') {
        setMessages((prev) =>
          appendNotice(prev, message.message, messageId('notice'), message.kind)
        );
        return;
      }
      if (message.type === 'voice_state') {
        setVoice(message.state);
        return;
      }
      if (message.type === 'voice_partial' || message.type === 'voice_text') {
        dictationToken.current += 1;
        setDictation({
          text: message.text,
          final: message.type === 'voice_text',
          token: dictationToken.current
        });
        setTab('chat');
        return;
      }
      if (message.type === 'restore_input') {
        // The rollback of the chat puts the request back into the
        // input field, the agent waits for the next command.
        restoreToken.current += 1;
        setRestore({
          text: message.text,
          mentions: message.mentions,
          token: restoreToken.current
        });
        setSelections(message.selections);
        setTab('chat');
        setFocusToken((value) => value + 1);
        return;
      }
      if (message.type === 'step_time') {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === message.id
              ? { ...item, elapsedMs: message.elapsedMs, endedAt: message.endedAt }
              : item
          )
        );
      }
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      // A timer of the batch must not write into an unmounted panel.
      batch.clear();
    };
  }, [vscode]);
}
export function resetAssistant(messages: UiMessage[]): UiMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i]!;
    if (item.role === 'assistant' && !item.approval) {
      next[i] = { ...item, text: '', thinking: '' };
      return next;
    }
  }
  return next;
}

export function appendToAssistant(
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
  next.push({ id: messageId('assistant'), role: 'assistant', [field]: delta });
  return next;
}

// The journal of an action goes to the last card with that id: the same id
// of a tool call can come back in a later turn.
export function appendProgress(
  messages: UiMessage[],
  id: string,
  line: string
): UiMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i]!;
    if (item.tool && item.tool.id === id) {
      next[i] = {
        ...item,
        tool: {
          ...item.tool,
          progress: [...(item.tool.progress ?? []), line]
        }
      };
      return next;
    }
  }
  return next;
}
