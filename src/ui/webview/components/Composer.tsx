import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { UiSelection, UiSuggestion } from '../../protocol';
import { STRINGS } from '../strings';

export interface InsertRequest {
  paths: string[];
  token: number;
}

export function Composer({
  busy,
  text,
  onTextChange,
  selections,
  focusToken,
  suggestions,
  insert,
  onInsertHandled,
  onSend,
  onStop,
  onPickFiles,
  onRemoveSelection,
  onSuggest
}: {
  busy: boolean;
  text: string;
  onTextChange: (updater: (previous: string) => string) => void;
  selections: UiSelection[];
  focusToken: number;
  suggestions: UiSuggestion[];
  insert: InsertRequest | undefined;
  onInsertHandled: () => void;
  onSend: (text: string, selections: UiSelection[]) => void;
  onStop: () => void;
  onPickFiles: () => void;
  onRemoveSelection: (id: string) => void;
  onSuggest: (prefix: string | undefined) => void;
}) {
  const [active, setActive] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    setActive(0);
  }, [suggestions]);

  useEffect(() => {
    if (!insert) {
      return;
    }
    const node = textareaRef.current;
    const caret = caretRef.current ?? node?.selectionStart ?? text.length;
    const mention = insert.paths.map((path) => '@' + path).join(' ') + ' ';
    onTextChange((previous) => previous.slice(0, caret) + mention + previous.slice(caret));
    onInsertHandled();
    const position = caret + mention.length;
    requestAnimationFrame(() => {
      placeCaret(node, position);
    });
  }, [insert?.token]);

  // The trigger only opens on a standalone "@", so an e-mail address or a
  // word inside a path never triggers the file list.
  const triggerOf = (
    value: string,
    caret: number
  ): { prefix: string; start: number } | undefined => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    if (!match) {
      return undefined;
    }
    const prefix = match[1] ?? '';
    return { prefix, start: caret - prefix.length - 1 };
  };

  const placeCaret = (node: HTMLTextAreaElement | null, position: number): void => {
    caretRef.current = position;
    if (!node) {
      return;
    }
    node.focus();
    node.setSelectionRange(position, position);
  };

  const pick = (item: UiSuggestion): void => {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? text.length;
    const trigger = triggerOf(text, caret);
    const start = trigger ? trigger.start : caret;
    const mention = '@' + item.path + ' ';
    onTextChange((previous) => previous.slice(0, start) + mention + previous.slice(caret));
    onSuggest(undefined);
    setActive(0);
    requestAnimationFrame(() => {
      placeCaret(node, start + mention.length);
    });
  };

  const submit = (): void => {
    if (busy || text.trim().length === 0) {
      return;
    }
    onSend(text.trim(), selections);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((value) => (value + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((value) => (value - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onSuggest(undefined);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const item = suggestions[active];
        if (item) {
          pick(item);
        }
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      {suggestions.length > 0 ? (
        <div className="suggestions">
          {suggestions.map((item, index) => (
            <button
              key={item.id}
              className={'suggestion' + (index === active ? ' active' : '')}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
            >
              <span className={'suggestion-dot source-' + item.source} />
              <span className="suggestion-path">{item.path}</span>
              <span className="suggestion-source">
                {item.source === 'open' ? STRINGS.openFiles : STRINGS.workspaceFiles}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {selections.length > 0 ? (
        <div className="selections">
          {selections.map((selection) => (
            <span key={selection.id} className="selection">
              <span className="selection-kind">{STRINGS.selection}</span>
              <span className="selection-label" title={selection.path}>
                {selection.label}
              </span>
              {selection.detail ? (
                <span className="selection-detail">{selection.detail}</span>
              ) : null}
              <button
                className="selection-remove"
                title={STRINGS.remove}
                onClick={() => onRemoveSelection(selection.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={text}
        placeholder={STRINGS.placeholder}
        onChange={(event) => {
          const value = event.target.value;
          const caret = event.target.selectionStart ?? value.length;
          caretRef.current = caret;
          onTextChange(() => value);
          const trigger = triggerOf(value, caret);
          onSuggest(trigger ? trigger.prefix : undefined);
        }}
        onSelect={(event) => {
          caretRef.current = event.currentTarget.selectionStart ?? undefined;
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="composer-actions">
        <button className="secondary" onClick={onPickFiles}>
          {STRINGS.attach}
        </button>
        {busy ? (
          <button className="stop" onClick={onStop}>
            {STRINGS.stop}
          </button>
        ) : (
          <button onClick={submit}>{STRINGS.send}</button>
        )}
      </div>
    </div>
  );
}
