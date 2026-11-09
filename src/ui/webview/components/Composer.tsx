import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { EffortLevel } from '../../../api/types';
import type { AgentMode, ModelInfo } from '../../../config/models';
import type { UiSelection, UiSuggestion } from '../../protocol';
import { STRINGS } from '../strings';

export interface InsertRequest {
  paths: string[];
  token: number;
}

export interface EditorContent {
  text: string;
  mentions: string[];
}

const BLOCK_TAGS = new Set(['DIV', 'P']);

interface WalkResult extends EditorContent {
  visible: string;
}

function fileLabel(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function walk(parent: Node, result: WalkResult): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      result.visible += text;
      result.text += text;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const element = child as HTMLElement;
    if (element.classList.contains('mention')) {
      const path = element.dataset.path ?? '';
      const label = element.dataset.label ?? path;
      result.visible += label;
      result.text += '@' + path;
      result.mentions.push(path);
      continue;
    }
    if (element.tagName === 'BR') {
      result.visible += '\n';
      result.text += '\n';
      continue;
    }
    walk(element, result);
    if (BLOCK_TAGS.has(element.tagName)) {
      result.visible += '\n';
      result.text += '\n';
    }
  }
}

function readContent(root: HTMLElement): EditorContent & { visible: string } {
  const result: WalkResult = { text: '', visible: '', mentions: [] };
  walk(root, result);
  return result;
}

// The visible text before the caret drives the "@" trigger, a chip counts as
// its own label so a path never looks like a fresh trigger.
function visibleBeforeCaret(root: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return '';
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return '';
  }
  const before = document.createRange();
  before.selectNodeContents(root);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return '';
  }
  const result: WalkResult = { text: '', visible: '', mentions: [] };
  walk(before.cloneContents(), result);
  return result.visible.replace(/\n+$/, '');
}

function triggerPrefix(value: string): string | undefined {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
  return match ? match[1] ?? '' : undefined;
}

function insertMention(root: HTMLElement, path: string): void {
  const label = fileLabel(path);
  const chip = document.createElement('span');
  chip.className = 'mention';
  chip.contentEditable = 'false';
  chip.dataset.path = path;
  chip.dataset.label = label;
  chip.title = path;

  const labelElement = document.createElement('span');
  labelElement.className = 'mention-label';
  labelElement.textContent = label;
  chip.appendChild(labelElement);

  const remove = document.createElement('span');
  remove.className = 'mention-remove';
  remove.textContent = '×';
  chip.appendChild(remove);

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).startContainer)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(chip);
    const spacer = document.createTextNode(' ');
    chip.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  root.appendChild(chip);
  root.appendChild(document.createTextNode(' '));
}

// The typed trigger is cut out of the text node that holds the caret.
function removeTrigger(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return;
  }
  const text = node.textContent ?? '';
  const offset = range.startOffset;
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, offset));
  if (!match) {
    return;
  }
  const start = offset - (match[1]?.length ?? 0) - 1;
  if (start < 0) {
    return;
  }
  node.textContent = text.slice(0, start) + text.slice(offset);
  range.setStart(node, start);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertLineBreak(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createTextNode('\n');
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function Composer({
  busy,
  selections,
  focusToken,
  suggestions,
  insert,
  onInsertHandled,
  resetToken,
  models,
  model,
  effort,
  mode,
  onModel,
  onEffort,
  onMode,
  onSend,
  onStop,
  onPickFiles,
  onRemoveSelection,
  onSuggest,
  onContentChange
}: {
  busy: boolean;
  selections: UiSelection[];
  focusToken: number;
  suggestions: UiSuggestion[];
  insert: InsertRequest | undefined;
  onInsertHandled: () => void;
  resetToken: number;
  models: ModelInfo[];
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  onModel: (model: string) => void;
  onEffort: (effort: EffortLevel) => void;
  onMode: (mode: AgentMode) => void;
  onSend: (text: string, mentions: string[], selections: UiSelection[]) => void;
  onStop: () => void;
  onPickFiles: () => void;
  onRemoveSelection: (id: string) => void;
  onSuggest: (prefix: string | undefined) => void;
  onContentChange?: (content: EditorContent) => void;
}) {
  const [active, setActive] = useState(0);
  const [empty, setEmpty] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const lastReset = useRef(resetToken);

  useEffect(() => {
    editorRef.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    setActive(0);
  }, [suggestions]);

  useEffect(() => {
    if (resetToken === lastReset.current) {
      return;
    }
    lastReset.current = resetToken;
    const root = editorRef.current;
    if (root) {
      root.textContent = '';
      setEmpty(true);
      onContentChange?.({ text: '', mentions: [] });
    }
  }, [resetToken]);

  useEffect(() => {
    if (!insert) {
      return;
    }
    const root = editorRef.current;
    if (!root) {
      return;
    }
    for (const path of insert.paths) {
      insertMention(root, path);
    }
    onInsertHandled();
    root.focus();
    report();
  }, [insert?.token]);

  const report = (): void => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const content = readContent(root);
    setEmpty(content.text.trim().length === 0);
    onContentChange?.({ text: content.text, mentions: content.mentions });
    const prefix = triggerPrefix(visibleBeforeCaret(root));
    onSuggest(prefix);
  };

  const pick = (item: UiSuggestion): void => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    removeTrigger();
    insertMention(root, item.path);
    onSuggest(undefined);
    setActive(0);
    report();
  };

  const submit = (): void => {
    const root = editorRef.current;
    if (!root || busy) {
      return;
    }
    const content = readContent(root);
    if (content.text.trim().length === 0) {
      return;
    }
    onSend(content.text.trim(), content.mentions, selections);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
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
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      insertLineBreak();
      report();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('mention-remove')) {
      return;
    }
    event.preventDefault();
    const chip = target.closest('.mention');
    if (chip) {
      chip.remove();
      report();
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
      <div
        ref={editorRef}
        className={'composer-input' + (empty ? ' is-empty' : '')}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={STRINGS.placeholder}
        onInput={report}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
      />
      <div className="composer-selects">
        <select
          value={mode}
          title={mode === 'plan' ? STRINGS.modePlanHint : STRINGS.modeCodeHint}
          onChange={(event) => onMode(event.target.value as AgentMode)}
        >
          {(['plan', 'code'] as const).map((value) => (
            <option key={value} value={value}>
              {STRINGS.mode}: {value}
            </option>
          ))}
        </select>
        <select value={model} onChange={(event) => onModel(event.target.value)}>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id}
            </option>
          ))}
        </select>
        <select
          value={effort}
          onChange={(event) => onEffort(event.target.value as EffortLevel)}
        >
          {(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) => (
            <option key={level} value={level}>
              {STRINGS.effort}: {level}
            </option>
          ))}
        </select>
      </div>
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
